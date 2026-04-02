"""
generators/job_manager.py — QA 생성 Job 상태 관리

JobStatus, GenerationJob, JobManager 및 전역 인스턴스 job_manager 를 제공한다.
(generation_api.py에서 분리)
"""

import threading
from dataclasses import dataclass, asdict
from datetime import datetime
from enum import Enum
from typing import Any, Dict, Optional


class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class GenerationJob:
    job_id: str
    status: JobStatus
    progress: int = 0
    message: str = ""
    error: Optional[str] = None
    result_file: Optional[str] = None
    result_id: Optional[str] = None  # Supabase UUID
    config: Dict[str, Any] = None
    started_at: str = ""
    completed_at: Optional[str] = ""

    def to_dict(self):
        return asdict(self)


class JobManager:
    """In-memory job manager. For production, use Redis or DB."""

    def __init__(self):
        self.jobs: Dict[str, GenerationJob] = {}
        self.lock = threading.Lock()

    def create_job(self, job_id: str, config: Dict[str, Any]) -> GenerationJob:
        with self.lock:
            job = GenerationJob(
                job_id=job_id,
                status=JobStatus.PENDING,
                progress=0,
                message="Queued for generation",
                config=config,
                started_at=datetime.now().isoformat(),
            )
            self.jobs[job_id] = job
            return job

    def get_job(self, job_id: str) -> Optional[GenerationJob]:
        return self.jobs.get(job_id)

    def update_job(
        self,
        job_id: str,
        status: Optional[JobStatus] = None,
        progress: Optional[int] = None,
        message: Optional[str] = None,
        error: Optional[str] = None,
        result_file: Optional[str] = None,
        result_id: Optional[str] = None,
    ) -> Optional[GenerationJob]:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return None

            if status:
                job.status = status
            if progress is not None:
                job.progress = progress
            if message:
                job.message = message
            if error:
                job.error = error
            if result_file:
                job.result_file = result_file
            if result_id:
                job.result_id = result_id
            if status in [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED]:
                job.completed_at = datetime.now().isoformat()

            return job

    def list_jobs(self) -> list:
        with self.lock:
            return list(self.jobs.values())


# 전역 싱글턴
job_manager = JobManager()
