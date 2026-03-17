"""
Backend Evaluation API
구문정확성, 통계, RAG Triad, quality 평가를 Backend에서 처리

이 파일은 API 라우트 설정만 담당합니다.
실제 평가 로직은 evaluators/ 패키지에 분리되어 있습니다.
"""

import logging
from datetime import datetime
from typing import Optional, Any, TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import FastAPI, BackgroundTasks

# Suppress verbose logging
logging.getLogger("google.generativeai").setLevel(logging.WARNING)
logging.getLogger("google_genai").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("trulens.core.utils.evaluator").setLevel(logging.WARNING)
logging.getLogger("trulens.core.database.sqlalchemy").setLevel(logging.WARNING)
logging.getLogger("alembic").setLevel(logging.WARNING)
logging.getLogger("trulens.experimental.otel_tracing.core.session").setLevel(logging.WARNING)

logger = logging.getLogger("autoeval.evaluation")

# ============= evaluators 패키지에서 모두 import =============
try:
    from evaluators import (
        EvalJobStatus,
        EvalJob,
        EvaluationManager,
        SyntaxValidator,
        DatasetStats,
        RAGTriadEvaluator,
        clean_markdown,
        QAQualityEvaluator,
        generate_recommendations,
        run_full_evaluation_pipeline,
        run_evaluation,
    )
except ImportError:
    from backend.evaluators import (
        EvalJobStatus,
        EvalJob,
        EvaluationManager,
        SyntaxValidator,
        DatasetStats,
        RAGTriadEvaluator,
        clean_markdown,
        QAQualityEvaluator,
        generate_recommendations,
        run_full_evaluation_pipeline,
        run_evaluation,
    )


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

    @app.post("/api/evaluate")
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
            evaluator_model = body.get("evaluator_model", "gemini-2.5-flash") if isinstance(body, dict) else "gemini-2.5-flash"
            generation_id   = body.get("generation_id") if isinstance(body, dict) else None
            limit           = body.get("limit")         if isinstance(body, dict) else None

            if not result_filename:
                return {"success": False, "error": "result_filename is required"}

            job_id = f"eval_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"
            eval_manager.create_job(job_id, result_filename)

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

    @app.get("/api/evaluate/{job_id}/status")
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
