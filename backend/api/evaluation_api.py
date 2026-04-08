"""
Evaluation API  —  POST|GET /api/evaluate/*

QA 평가 Job 관리 및 결과 export 엔드포인트.
실제 평가 로직은 evaluators/ 패키지에 분리되어 있다.

엔드포인트
  POST   /api/evaluate                          평가 Job 시작 (BackgroundTask)
  GET    /api/evaluate/{job_id}/status           Job 상태 조회
  GET    /api/evaluate/list                      세션 내 Job 목록
  GET    /api/evaluate/history                   Supabase 저장 평가 히스토리
  GET    /api/evaluate/{job_id}/export           세션 Job 결과 export (QA + 점수 조인)
  GET    /api/evaluate/export-by-id/{eval_id}    eval_id 기반 히스토리 export

모듈 구조
  evaluators/job_manager.py    — EvalJobStatus, EvalJob, EvaluationManager
  evaluators/syntax_validator.py — SyntaxValidator (Layer 1-A)
  evaluators/dataset_stats.py  — DatasetStats (Layer 1-B)
  evaluators/rag_triad.py      — RAGTriadEvaluator (Layer 2)
  evaluators/qa_quality.py     — QAQualityEvaluator (Layer 3)
  evaluators/recommendations.py — generate_recommendations
  evaluators/pipeline.py       — run_evaluation, build_export_detail,
                                  _classify_failure_types (내부 사용)
"""

import logging
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional, Any, List

sys.path.insert(0, str(Path(__file__).parent.parent))

# Suppress verbose logging
logging.getLogger("google.generativeai").setLevel(logging.WARNING)
logging.getLogger("google_genai").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("alembic").setLevel(logging.WARNING)

logger = logging.getLogger("autoeval.evaluation")

# ============= evaluators 패키지에서 import =============
from config.models import MODEL_CONFIG
from evaluators import (
    EvalJobStatus,
    EvalJob,
    EvaluationManager,
    run_evaluation,
)
from evaluators.pipeline import build_export_detail


# ============= API Endpoints =============

def setup_evaluation_routes(app: Any, eval_manager: Optional[EvaluationManager] = None):
    """Setup evaluation endpoints

    Args:
        app: FastAPI application instance
        eval_manager: EvaluationManager instance for tracking jobs
    """
    if not eval_manager:
        eval_manager = EvaluationManager()

    try:
        from fastapi import Request, BackgroundTasks
    except ImportError:
        Request = Any
        BackgroundTasks = Any

    @app.post("/api/evaluate", tags=["evaluation"])
    async def evaluate_qa(request: Request, background_tasks: BackgroundTasks) -> dict:
        """
        Start QA evaluation (4-layer pipeline)

        Request body:
        {
            "result_filename": "qa_model_lang_v1_timestamp.json",
            "evaluator_model": optional(str, default="gemini-2.5-flash"),
            "generation_id": optional(str, Supabase ID from generation),
            "limit": optional(int)
        }
        """
        try:
            try:
                body = await request.json()
            except Exception:
                body = {}

            result_filename = body.get("result_filename") if isinstance(body, dict) else None
            _default_eval_model = MODEL_CONFIG["gemini-flash"]["model_id"]
            evaluator_model = body.get("evaluator_model", _default_eval_model) if isinstance(body, dict) else _default_eval_model
            generation_id   = body.get("generation_id") if isinstance(body, dict) else None
            limit           = body.get("limit")         if isinstance(body, dict) else None

            if not result_filename:
                return {"success": False, "error": "result_filename is required"}

            job_id = f"eval_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"
            job = eval_manager.create_job(job_id, result_filename)
            if generation_id:
                eval_manager.update_job(job_id, generation_id=generation_id)

            logger.info(f"Starting evaluation job: {job_id} for {result_filename} with evaluator_model={evaluator_model}")
            if generation_id:
                logger.info(f"[{job_id}] Linked to generation ID: {generation_id}")

            background_tasks.add_task(
                run_evaluation,
                job_id=job_id,
                result_filename=result_filename,
                limit=limit,
                evaluator_model=evaluator_model,
                eval_manager=eval_manager,
                generation_id=generation_id,
            )

            return {
                "success":        True,
                "job_id":         job_id,
                "message":        "Evaluation started",
                "evaluator_model": evaluator_model,
                "generation_id":  generation_id,
                "timestamp":      datetime.now().isoformat(),
            }
        except Exception as e:
            logger.error(f"Evaluation start failed: {e}")
            return {"success": False, "error": str(e)}

    @app.get("/api/evaluate/{job_id}/status", tags=["evaluation"])
    async def get_eval_status(job_id: str) -> dict:
        """Get evaluation job status with 4-layer details"""
        job = eval_manager.get_job(job_id)
        if not job:
            return {"success": False, "error": f"Job {job_id} not found", "status": "not_found"}

        return {
            "success":     True,
            "job_id":      job_id,
            "status":      job.status.value,
            "progress":    job.progress,
            "message":     job.message,
            "error":       job.error,
            "eval_report": job.eval_report,
            "timestamp":   job.timestamp,
            "layers":      job.layers_status,
        }

    @app.get("/api/evaluate/list", tags=["evaluation"])
    async def list_eval_jobs() -> dict:
        """현재 서버 세션의 평가 Job 목록 반환 (최신순)"""
        jobs = sorted(eval_manager.jobs.values(), key=lambda j: j.timestamp, reverse=True)
        return {
            "success": True,
            "count": len(jobs),
            "jobs": [
                {
                    "job_id":          j.job_id,
                    "result_filename": j.result_filename,
                    "status":          j.status.value,
                    "timestamp":       j.timestamp,
                    "summary":         j.eval_report.get("summary")  if j.eval_report else None,
                    "metadata":        j.eval_report.get("metadata") if j.eval_report else None,
                }
                for j in jobs
            ],
        }

    @app.get("/api/evaluate/history", tags=["evaluation"])
    async def get_eval_history() -> dict:
        """Supabase qa_eval_results 테이블에서 과거 평가 기록 조회 (영구 보존)"""
        try:
            from config.supabase_client import supabase_client
        except ImportError:
            try:
                from backend.config.supabase_client import supabase_client
            except ImportError:
                supabase_client = None

        if not supabase_client:
            return {"success": False, "error": "Supabase not available", "history": []}

        try:
            response = (
                supabase_client.table("qa_eval_results")
                .select("id, job_id, metadata, total_qa, valid_qa, final_score, final_grade, created_at, scores, pipeline_results")
                .order("created_at", desc=True)
                .limit(50)
                .execute()
            )
            history = response.data or []

            # source_doc 없는 레코드를 위해 qa_gen_results에서 일괄 보완
            missing = [r for r in history if not (r.get("metadata") or {}).get("source_doc")]
            if missing:
                missing_eval_ids = [r["id"] for r in missing]

                # 1차: linked_evaluation_id 기반 조회
                gen_resp = (
                    supabase_client.table("qa_gen_results")
                    .select("id, linked_evaluation_id, metadata")
                    .in_("linked_evaluation_id", missing_eval_ids)
                    .execute()
                )
                source_map: dict = {}  # eval_id → source_doc
                for row in (gen_resp.data or []):
                    eid = row.get("linked_evaluation_id")
                    src = (row.get("metadata") or {}).get("source_doc", "")
                    if eid and src:
                        source_map[eid] = src

                # 2차: metadata.generation_id 기반 조회 (linked_evaluation_id 미설정 레코드 보완)
                still_missing = [r for r in missing if r["id"] not in source_map]
                if still_missing:
                    gen_ids = [
                        (r.get("metadata") or {}).get("generation_id")
                        for r in still_missing
                    ]
                    gen_ids = [g for g in gen_ids if g]
                    if gen_ids:
                        gen_resp2 = (
                            supabase_client.table("qa_gen_results")
                            .select("id, metadata")
                            .in_("id", gen_ids)
                            .execute()
                        )
                        gen_by_id = {
                            row["id"]: (row.get("metadata") or {}).get("source_doc", "")
                            for row in (gen_resp2.data or [])
                        }
                        for r in still_missing:
                            gid = (r.get("metadata") or {}).get("generation_id", "")
                            src = gen_by_id.get(gid, "")
                            if src:
                                source_map[r["id"]] = src

                # 보완 주입
                for r in history:
                    if r["id"] in source_map:
                        r.setdefault("metadata", {})
                        if not r["metadata"].get("source_doc"):
                            r["metadata"]["source_doc"] = source_map[r["id"]]

            return {"success": True, "history": history}
        except Exception as e:
            logger.error(f"Failed to fetch eval history: {e}")
            return {"success": False, "error": str(e), "history": []}

    @app.get("/api/evaluate/{job_id}/export", tags=["evaluation"])
    async def export_eval_by_job(job_id: str) -> dict:
        """현재 세션 job의 전체 QA + 평가 점수 조인 (generation_id → Supabase qa_gen_results)"""
        import asyncio

        job = eval_manager.get_job(job_id)
        if not job:
            return {"success": False, "error": f"Job {job_id} not found"}
        if job.status.value != "completed":
            return {"success": False, "error": "Evaluation not completed yet"}
        if not job.generation_id:
            return {"success": False, "error": "No generation_id linked to this job"}

        try:
            from config.supabase_client import get_qa_generation_from_supabase
        except ImportError:
            from backend.config.supabase_client import get_qa_generation_from_supabase

        gen_data = await get_qa_generation_from_supabase(job.generation_id)
        if not gen_data:
            return {"success": False, "error": f"Generation data not found for id={job.generation_id}"}

        pipeline = (job.eval_report or {}).get("pipeline_results", {})
        detail = build_export_detail(gen_data.get("qa_list", []), pipeline)

        return {
            "success":   True,
            "detail":    detail,
            "metadata":  (job.eval_report or {}).get("metadata", {}),
            "timestamp": (job.eval_report or {}).get("timestamp"),
        }

    @app.get("/api/evaluate/export-by-id/{eval_id}", tags=["evaluation"])
    async def export_eval_by_id(eval_id: str) -> dict:
        """Supabase eval_id 기반 export (히스토리 항목용) — linked generation에서 QA 조회"""
        try:
            from config.supabase_client import supabase_client
        except ImportError:
            from backend.config.supabase_client import supabase_client

        if not supabase_client:
            return {"success": False, "error": "Supabase not available"}

        try:
            # 1. 평가 메타데이터 조회 (pipeline_results 제외 — RPC로 qa_scores만 별도 조회)
            eval_resp = supabase_client.table("qa_eval_results").select(
                "id, job_id, metadata, created_at"
            ).eq("id", eval_id).single().execute()
            eval_row = eval_resp.data
            if not eval_row:
                return {"success": False, "error": f"Eval record {eval_id} not found"}

            # 2. linked gen_results 조회 (qa_list만)
            gen_resp = supabase_client.table("qa_gen_results").select(
                "qa_list, metadata"
            ).eq("linked_evaluation_id", eval_id).limit(1).execute()

            if not gen_resp.data:
                return {"success": False, "error": "Linked generation not found for this evaluation"}

            gen_row = gen_resp.data[0]

            # 3. RPC로 qa_scores만 추출 (pipeline_results 전체 전송 방지)
            scores_resp = supabase_client.rpc(
                "get_eval_qa_scores", {"p_eval_id": eval_id}
            ).execute()
            scores_data = scores_resp.data or {}
            pipeline_slim = {
                "layers": {
                    "rag":     {"qa_scores": scores_data.get("rag_qa_scores")     or []},
                    "quality": {"qa_scores": scores_data.get("quality_qa_scores") or []},
                }
            }

            detail = build_export_detail(gen_row.get("qa_list", []), pipeline_slim)

            return {
                "success":   True,
                "detail":    detail,
                "metadata":  eval_row.get("metadata", {}),
                "timestamp": eval_row.get("created_at"),
            }
        except Exception as e:
            logger.error(f"Export by eval_id failed: {e}")
            return {"success": False, "error": str(e)}
