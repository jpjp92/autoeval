"""
Generation API  —  POST|GET|DELETE /api/generate/*

QA 데이터셋 생성 Job 관리 및 실행 엔드포인트.
실제 생성 로직은 generators/ 패키지로 분리되어 있다.

엔드포인트
  POST   /api/generate                       QA 생성 Job 시작 (BackgroundTask)
  GET    /api/generate/{job_id}/status        Job 상태 조회
  GET    /api/generate/jobs                   Job 목록 조회 (status 필터 지원)
  DELETE /api/generate/{job_id}               Job 취소
  GET    /api/generate/{job_id}/preview       생성 결과 미리보기 (limit개)

모듈 구조
  generators/prompts.py         — 시스템 프롬프트 / 유저 템플릿 (config/prompts.py에서 이전)
  generators/job_manager.py     — JobStatus, GenerationJob, JobManager (싱글턴 job_manager)
  generators/worker.py          — run_qa_generation*, 병렬 생성 오케스트레이션
  generators/qa_generator.py    — 모델별 API 호출 (generate_qa)
  generators/domain_profiler.py — 도메인 프로파일 분석
  config/prompts.py             — 하위 호환 shim (generators.prompts re-export)
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Dict, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException
from pydantic import BaseModel

from config.supabase_client import get_qa_generation_from_supabase, is_supabase_available
from generators.job_manager import JobStatus, job_manager
from generators.worker import run_qa_generation

logger = logging.getLogger("autoeval.generation")


# ============================================================================
# Pydantic 모델
# ============================================================================

class GenerateRequest(BaseModel):
    model: str = "gemini-3.1-flash"
    lang: str = "ko"
    samples: int = 10
    qa_per_doc: Optional[int] = None
    prompt_version: str = "v1"

    # Source document filename (Vector DB 필터용)
    filename: Optional[str] = None

    # Hierarchy 필터
    hierarchy_h1: Optional[str] = None
    hierarchy_h2: Optional[str] = None
    hierarchy_h3: Optional[str] = None
    retrieval_query: Optional[str] = None

    # document_id: 업로드 버전 식별자
    document_id: Optional[str] = None


# ============================================================================
# 엔드포인트
# ============================================================================

def setup_generation_routes(app: FastAPI):
    """QA 생성 엔드포인트 등록"""

    @app.post("/api/generate", tags=["generation"])
    async def generate_qa(
        request: GenerateRequest,
        background_tasks: BackgroundTasks,
    ) -> dict:
        """
        QA 생성 Job 시작.
        Returns job_id for tracking progress.

        Usage:
            POST /api/generate
            {"model": "gemini-3.1-flash", "lang": "ko", "samples": 8, "prompt_version": "v1"}
        """
        try:
            job_id = f"gen_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"
            job_manager.create_job(job_id, request.model_dump())
            logger.info(f"Created generation job: {job_id}")

            background_tasks.add_task(
                run_qa_generation,
                job_id=job_id,
                model=request.model,
                lang=request.lang,
                samples=request.samples,
                qa_per_doc=request.qa_per_doc,
                prompt_version=request.prompt_version,
            )

            return {
                "success": True,
                "job_id": job_id,
                "message": "Generation started",
                "config": request.model_dump(),
                "timestamp": datetime.now().isoformat(),
            }

        except Exception as e:
            logger.error(f"Error creating generation job: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/api/generate/{job_id}/status", tags=["generation"])
    async def get_generation_status(job_id: str) -> dict:
        """Job 상태 조회."""
        try:
            job = job_manager.get_job(job_id)
            if not job:
                raise HTTPException(status_code=404, detail="Job not found")

            return {
                "success": True,
                "job_id": job_id,
                "status": job.status.value,
                "progress": job.progress,
                "message": job.message,
                "error": job.error,
                "result_file": job.result_file,
                "result_id": job.result_id,
                "timestamp": job.started_at,
                "config": job.config,
            }

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error getting job status: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/api/generate/jobs", tags=["generation"])
    async def list_generation_jobs(
        status: Optional[str] = None,
        limit: int = 100,
    ) -> dict:
        """Job 목록 조회. status 파라미터로 필터링 가능."""
        try:
            jobs = job_manager.list_jobs()
            if status:
                jobs = [j for j in jobs if j.status.value == status]
            jobs = jobs[:limit]

            return {
                "success": True,
                "count": len(jobs),
                "jobs": [
                    {
                        "job_id": j.job_id,
                        "status": j.status.value,
                        "progress": j.progress,
                        "message": j.message,
                        "result_file": j.result_file,
                        "started_at": j.started_at,
                        "completed_at": j.completed_at,
                    }
                    for j in jobs
                ],
            }

        except Exception as e:
            logger.error(f"Error listing jobs: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @app.delete("/api/generate/{job_id}", tags=["generation"])
    async def cancel_generation(job_id: str) -> dict:
        """실행 중인 Job 취소."""
        try:
            job = job_manager.get_job(job_id)
            if not job:
                raise HTTPException(status_code=404, detail="Job not found")
            if job.status == JobStatus.COMPLETED:
                raise HTTPException(status_code=400, detail="Cannot cancel completed job")

            job_manager.update_job(job_id, status=JobStatus.CANCELLED, message="Cancelled by user")
            return {"success": True, "job_id": job_id, "message": "Job cancelled"}

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error cancelling job: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/api/generate/{job_id}/preview", tags=["generation"])
    async def get_generation_preview(job_id: str, limit: int = 5) -> dict:
        """생성 완료된 Job의 QA 미리보기 (최대 limit개)."""
        job = job_manager.get_job(job_id)
        if not job:
            return {"success": False, "error": "Job not found"}
        if not job.result_id:
            return {"success": False, "error": "No result available yet"}

        try:
            data = await get_qa_generation_from_supabase(job.result_id)
            if not data:
                return {"success": False, "error": "Generation data not found"}

            preview = []
            total = 0
            for chunk in data.get("qa_list") or []:
                chunk_qa_list = chunk.get("qa_list") or []
                total += len(chunk_qa_list)
                for qa in chunk_qa_list:
                    if len(preview) >= limit:
                        break
                    preview.append(
                        {
                            "context": (chunk.get("text") or "")[:200],
                            "q": qa.get("q", ""),
                            "a": qa.get("a", ""),
                            "intent": qa.get("intent", ""),
                        }
                    )
                if len(preview) >= limit:
                    break

            return {"success": True, "preview": preview, "total": total}
        except Exception as e:
            logger.error(f"Failed to fetch generation preview: {e}")
            return {"success": False, "error": str(e)}
