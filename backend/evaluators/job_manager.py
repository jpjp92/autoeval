"""
Job Manager
평가 작업 상태 관리 (EvalJobStatus, EvalJob, EvaluationManager)
"""
import logging
from datetime import datetime
from dataclasses import dataclass
from enum import Enum
from threading import Lock
from typing import Optional, Dict

logger = logging.getLogger(__name__)


class EvalJobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class EvalJob:
    job_id: str
    result_filename: str
    status: EvalJobStatus = EvalJobStatus.PENDING
    progress: int = 0
    message: str = ""
    error: Optional[str] = None
    eval_report: Optional[Dict] = None
    timestamp: str = ""
    generation_id: Optional[str] = None   # qa_gen_results UUID (export용)
    # 4단계 평가 상황 추적
    layers_status: Dict[str, Dict] = None

    def __post_init__(self):
        if self.layers_status is None:
            self.layers_status = {
                "syntax": {"status": "pending", "progress": 0, "message": ""},
                "stats":  {"status": "pending", "progress": 0, "message": ""},
                "rag":    {"status": "pending", "progress": 0, "message": ""},
                "quality": {"status": "pending", "progress": 0, "message": ""},
            }


class EvaluationManager:
    """평가 작업 상태 관리 (스레드 안전)"""

    def __init__(self):
        self.jobs: Dict[str, EvalJob] = {}
        self.lock = Lock()

    def create_job(self, job_id: str, result_filename: str) -> EvalJob:
        job = EvalJob(
            job_id=job_id,
            result_filename=result_filename,
            timestamp=datetime.now().isoformat()
        )
        self.jobs[job_id] = job
        logger.info(f"Created evaluation job: {job_id}")
        return job

    def get_job(self, job_id: str) -> Optional[EvalJob]:
        return self.jobs.get(job_id)

    def update_job(self, job_id: str, **kwargs):
        """Job 필드 업데이트 (progress, message, status 등)"""
        with self.lock:
            if job_id in self.jobs:
                for key, value in kwargs.items():
                    if hasattr(self.jobs[job_id], key):
                        setattr(self.jobs[job_id], key, value)

    def update_layer_status(self, job_id: str, layer: str, status: str, progress: int = 0, message: str = ""):
        """특정 Layer 상태 업데이트 (스레드 안전)"""
        with self.lock:
            if job_id in self.jobs:
                job = self.jobs[job_id]
                if layer in job.layers_status:
                    job.layers_status[layer]["status"] = status
                    job.layers_status[layer]["progress"] = progress
                    job.layers_status[layer]["message"] = message
                    logger.debug(f"[{job_id}] Updated {layer}: {status} ({progress}%)")
