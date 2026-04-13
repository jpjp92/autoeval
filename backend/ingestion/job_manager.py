"""
ingestion/job_manager.py — 인제스션 Job 상태 관리

IngestionStatus, IngestionJob, IngestionJobManager 및 전역 인스턴스 ingestion_job_manager 제공.
"""

import threading
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Optional, Dict


class IngestionStatus(str, Enum):
    PENDING    = "pending"
    EXTRACTING = "extracting"   # PDF/DOCX 텍스트 추출
    CHUNKING   = "chunking"     # LLM 청킹 (배치 진행률)
    EMBEDDING  = "embedding"    # 임베딩 + DB 저장
    COMPLETED  = "completed"
    FAILED     = "failed"


@dataclass
class IngestionJob:
    job_id: str
    status: IngestionStatus
    filename: str = ""
    doc_id: str = ""        # retry 시 동일 doc_id 재사용을 위해 보존
    progress: int = 0       # 현재 배치 번호
    total: int = 0          # 전체 배치 수
    message: str = ""
    error: Optional[str] = None
    started_at: str = ""
    completed_at: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "job_id":       self.job_id,
            "status":       self.status,
            "filename":     self.filename,
            "doc_id":       self.doc_id,
            "progress":     self.progress,
            "total":        self.total,
            "message":      self.message,
            "error":        self.error,
            "started_at":   self.started_at,
            "completed_at": self.completed_at,
        }


class IngestionJobManager:
    """인제스션 작업 상태 관리 (in-memory, 스레드 안전)."""

    def __init__(self):
        self.jobs: Dict[str, IngestionJob] = {}
        self.lock = threading.Lock()

    def create_job(self, job_id: str, filename: str) -> IngestionJob:
        with self.lock:
            job = IngestionJob(
                job_id=job_id,
                status=IngestionStatus.PENDING,
                filename=filename,
                message="대기 중",
                started_at=datetime.now().isoformat(),
            )
            self.jobs[job_id] = job
            return job

    def get_job(self, job_id: str) -> Optional[IngestionJob]:
        return self.jobs.get(job_id)

    def update_job(
        self,
        job_id: str,
        status: Optional[IngestionStatus] = None,
        doc_id: Optional[str] = None,
        progress: Optional[int] = None,
        total: Optional[int] = None,
        message: Optional[str] = None,
        error: Optional[str] = None,
    ) -> Optional[IngestionJob]:
        with self.lock:
            job = self.jobs.get(job_id)
            if not job:
                return None
            if status is not None:
                job.status = status
            if doc_id is not None:
                job.doc_id = doc_id
            if progress is not None:
                job.progress = progress
            if total is not None:
                job.total = total
            if message is not None:
                job.message = message
            if error is not None:
                job.error = error
            if status in (IngestionStatus.COMPLETED, IngestionStatus.FAILED):
                job.completed_at = datetime.now().isoformat()
            return job

    def list_jobs(self) -> list:
        with self.lock:
            return list(self.jobs.values())


# 전역 싱글턴
ingestion_job_manager = IngestionJobManager()
