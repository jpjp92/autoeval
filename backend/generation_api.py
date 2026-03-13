"""
개선된 Backend QA Generation API
- 실제 main.py 로직 통합
- Job 상태 추적
- Progress monitoring
- Error handling
"""

import os
import json
import logging
import threading
import queue
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from datetime import datetime
from threading import Lock
from typing import Optional, Dict, Any
from enum import Enum
from dataclasses import dataclass, asdict
import numpy as np

# Main.py 모듈 import (지연 import로 순환 참조 방지)
# Import backend/main.py for generate_qa function
sys.path.insert(0, str(Path(__file__).parent))
MAIN_PY_AVAILABLE = True  # 함수 실행 시 import 시도

def _get_main_generate_qa():
    """지연 import: 함수 실행 시점에 backend/main.py에서 generate_qa import"""
    global MAIN_PY_AVAILABLE
    try:
        from main import generate_qa as main_generate_qa
        return main_generate_qa
    except ImportError as e:
        logging.warning(f"main.py import failed: {e}. Using simulation mode.")
        MAIN_PY_AVAILABLE = False
        return None

# FastAPI 세트업
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel

# Supabase 클라이언트
from config.supabase_client import (
    save_qa_generation_to_supabase,
    is_supabase_available,
)

# ============= Configurations =============

BASE_DIR = Path(__file__).parent.parent
OUTPUT_DIR = BASE_DIR / "output"

logger = logging.getLogger("autoeval.generation")

# 프로바이더별 최대 동시 생성 workers
# 생성은 평가보다 요청당 토큰이 무거우므로 평가보다 낮게 설정
#   - gemini-3.1-flash: RPM 1,000 / TPM 2M, 문서당 ~5K tok → 5
#   - claude-sonnet:    RPM 50 / Output TPM 8K (병목) → 2
#   - gpt-5.2:          RPM 500 / TPM 500K, 문서당 ~5K tok → 5
GENERATION_MAX_WORKERS: Dict[str, int] = {
    "anthropic": 2,   # claude-sonnet Output TPM 8K 병목
    "google":    5,   # gemini-3.1-flash Tier 1 Paid
    "openai":    5,   # gpt-5.1 / gpt-5.2
}

def _get_generation_workers(model: str) -> int:
    """model 이름으로 provider 감지 → 권장 generation workers 반환"""
    m = model.lower()
    if "claude" in m:
        return GENERATION_MAX_WORKERS["anthropic"]
    if "gemini" in m:
        return GENERATION_MAX_WORKERS["google"]
    return GENERATION_MAX_WORKERS["openai"]

# ============= Job Status Enum =============

class JobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

# ============= Models =============

class GenerateRequest(BaseModel):
    model: str = "gemini-3.1-flash"
    lang: str = "ko"
    samples: int = 10
    qa_per_doc: Optional[int] = None
    prompt_version: str = "v1"
    
    # Hierarchy filters for vector search
    hierarchy_l1: Optional[str] = None
    hierarchy_l2: Optional[str] = None
    hierarchy_l3: Optional[str] = None
    retrieval_query: Optional[str] = None

class GenerationStatus(BaseModel):
    job_id: str
    status: JobStatus
    progress: int = 0
    message: str = ""
    error: Optional[str] = None
    result_file: Optional[str] = None
    timestamp: str = ""
    config: Optional[Dict[str, Any]] = None

# ============= Job Manager =============

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
        result_id: Optional[str] = None
    ) -> GenerationJob:
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

    def list_jobs(self) -> list[GenerationJob]:
        with self.lock:
            return list(self.jobs.values())

# Global job manager
job_manager = JobManager()

# ============= Generation Logic =============

def run_qa_generation(
    job_id: str,
    model: str,
    lang: str,
    samples: int,
    qa_per_doc: Optional[int],
    prompt_version: str
) -> None:
    """
    Background task: Run actual QA generation using main.py logic
    Falls back to simulation if main.py unavailable
    """
    import asyncio
    
    try:
        logger.info(f"[{job_id}] Starting generation: model={model}, lang={lang}, samples={samples}")
        
        # Update job status
        job_manager.update_job(
            job_id,
            status=JobStatus.RUNNING,
            progress=5,
            message="Initializing generation pipeline..."
        )

        # Try to get main.py's generate_qa function
        main_generate_qa = _get_main_generate_qa()
        
        if main_generate_qa is not None:
            # ===== REAL: Use main.py functions =====
            logger.info(f"[{job_id}] Using real main.py logic")
            asyncio.run(run_qa_generation_real(job_id, model, lang, samples, qa_per_doc, prompt_version, main_generate_qa))
        else:
            # ===== FALLBACK: Simulation =====
            logger.warning(f"[{job_id}] main.py not available, using simulation mode")
            asyncio.run(run_qa_generation_simulation(job_id, model, lang, samples, qa_per_doc, prompt_version))
            
    except Exception as e:
        error_msg = str(e)
        logger.error(f"[{job_id}] Generation failed: {error_msg}", exc_info=True)
        job_manager.update_job(
            job_id,
            status=JobStatus.FAILED,
            progress=0,
            error=error_msg,
            message="Generation failed"
        )


async def run_qa_generation_real(
    job_id: str,
    model: str,
    lang: str,
    samples: int,
    qa_per_doc: Optional[int],
    prompt_version: str,
    main_generate_qa: Any
) -> None:
    """Real QA generation using main.py functions"""
    import time
    
    logger.info(f"[{job_id}] Loading data...")
    job_manager.update_job(job_id, progress=5, message="Loading document data...")
    
    # 1. 결정: Vector DB에서 가져올지, 로컬 JSON에서 가져올지
    # hierarchy 필터가 하나라도 있으면 Vector DB 검색 시도
    config = job_manager.get_job(job_id).config or {}
    h1 = config.get("hierarchy_l1")
    h2 = config.get("hierarchy_l2")
    h3 = config.get("hierarchy_l3")
    r_query = config.get("retrieval_query")
    
    items = []
    
    from config.supabase_client import search_doc_chunks, is_supabase_available
    
    if is_supabase_available() and (h1 or h2 or h3 or r_query):
        logger.info(f"[{job_id}] Using Vector DB retrieval (hierarchy filters present)")
        job_manager.update_job(job_id, message="Searching Vector DB...")
        
        # 필터 구성
        filter_dict = {}
        if h1: filter_dict["hierarchy_l1"] = h1
        if h2: filter_dict["hierarchy_l2"] = h2
        if h3: filter_dict["hierarchy_l3"] = h3
        
        # 쿼리 임베딩 생성 (유사도 검색 필요시)
        query_vector = None
        if r_query:
            from google import genai as google_genai
            gemini_client = google_genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
            res = gemini_client.models.embed_content(
                model="gemini-embedding-2-preview",
                contents=r_query,
                config=google_genai.types.EmbedContentConfig(
                    task_type="RETRIEVAL_QUERY",
                    output_dimensionality=1536
                )
            )
            query_vector_values = res.embeddings[0].values
            
            # L2 Normalization
            v_np = np.array(query_vector_values)
            v_norm = np.linalg.norm(v_np)
            query_vector = (v_np / v_norm).tolist() if v_norm > 0 else query_vector_values
        
        # 만약 query_vector가 없으면 빈 벡터(모두 0)를 보내거나, 
        # 그냥 전체 리스트를 가져오는 RPC를 사용할 수도 있지만 
        # 현재 match_doc_chunks는 query_embedding이 필수이므로 더미를 보내거나 random sample
        if query_vector is None:
            query_vector = [0.0] * 1536 # Dummy for metadata filter only
            
        chunks = await search_doc_chunks(
            query_embedding=query_vector,
            match_threshold=0.0, # 필터링 위주
            match_count=samples,
            filter=filter_dict
        )
        
        # Chunk -> Item 형식으로 변환
        for c in chunks:
            meta = c.get("metadata", {})
            items.append({
                "docId": c.get("id"),
                "hierarchy": [meta.get("hierarchy_l1"), meta.get("hierarchy_l2"), meta.get("hierarchy_l3")],
                "text": c.get("content"),
                "metadata": meta
            })
            
        logger.info(f"[{job_id}] Vector DB found {len(items)} chunks")
    
    # 2. Vector DB에서 결과가 없거나 필터가 없는 경우 로컬 JSON 폴백
    if not items:
        logger.info(f"[{job_id}] Using local JSON data file")
        data_file = Path(__file__).parent.parent / "ref/data/data_2026-03-06_normalized.json"
        
        if not data_file.exists():
            raise FileNotFoundError(f"Data file not found: {data_file}")
        
        with open(data_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Extract items
        items = data if isinstance(data, list) else data.get("documents", [])
        items = items[:samples]
    
    logger.info(f"[{job_id}] Loaded {len(items)} items for generation")
    job_manager.update_job(job_id, progress=10, message=f"Loaded {len(items)} items")
    
    # Generate QA for each document (병렬 처리)
    max_workers = _get_generation_workers(model)
    logger.info(f"[{job_id}] 병렬 생성 시작: {len(items)} 문서 × workers={max_workers} ({model})")

    results_map: Dict[int, Any] = {}
    total_input_tokens  = 0
    total_output_tokens = 0
    token_lock = Lock()
    completed_count = 0
    progress_lock = Lock()

    def _generate_one(args):
        idx, item = args
        try:
            logger.info(f"[{job_id}] Generating QA for document {idx+1}/{len(items)}: {item.get('docId', 'unknown')}")
            result = main_generate_qa(item, model, lang, prompt_version)
            if qa_per_doc and result.get("qa_list"):
                result["qa_list"] = result["qa_list"][:qa_per_doc]
            return idx, result, None
        except Exception as e:
            logger.warning(f"[{job_id}] Failed to generate QA for document {idx+1}: {e}")
            return idx, None, str(e)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(_generate_one, (i, item)): i
            for i, item in enumerate(items)
        }
        for future in as_completed(futures):
            idx, result, error = future.result()

            with progress_lock:
                completed_count += 1
                cnt = completed_count

            if result is not None:
                results_map[idx] = result
                with token_lock:
                    total_input_tokens  += result.get("input_tokens", 0)
                    total_output_tokens += result.get("output_tokens", 0)

            progress = 10 + int(cnt / len(items) * 80)  # 10~90%
            job_manager.update_job(
                job_id,
                progress=progress,
                message=f"Generating QA pairs ({cnt}/{len(items)})..."
            )

    # 인덱스 순서대로 정렬
    results = [results_map[i] for i in range(len(items)) if i in results_map]

    if not results:
        raise Exception("No QA pairs were generated")
    
    logger.info(f"[{job_id}] Saving results...")
    job_manager.update_job(job_id, progress=92, message="Saving results...")
    
    # Save results
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    lang_suffix = "ko" if lang == "ko" else "en"
    result_filename = f"qa_{model}_{lang_suffix}_{prompt_version}_{timestamp}.json"
    result_filepath = OUTPUT_DIR / result_filename
    
    output_data = {
        "config": {
            "model": model,
            "lang": lang,
            "prompt_version": prompt_version,
            "samples": len(items),
            "timestamp": timestamp,
        },
        "statistics": {
            "total_docs": len(items),
            "total_qa": sum(len(r.get("qa_list", [])) for r in results),
            "total_input_tokens": total_input_tokens,
            "total_output_tokens": total_output_tokens,
        },
        "results": results,
    }
    
    OUTPUT_DIR.mkdir(exist_ok=True)
    with open(result_filepath, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
    
    logger.info(f"[{job_id}] Results saved to {result_filename}")
    
    # ✨ Save to Supabase
    supabase_id = None
    try:
        if is_supabase_available():
            # Prepare metadata, hierarchy, and stats
            total_qa = output_data["statistics"]["total_qa"]
            total_docs = output_data["statistics"]["total_docs"]
            input_tokens = output_data["statistics"].get("total_input_tokens", 0)
            output_tokens = output_data["statistics"].get("total_output_tokens", 0)
            
            # Estimate cost based on model
            cost_per_1m_input = {"gemini-3.1-flash": 0.3, "claude-sonnet": 3.0, "gpt-5.2": 1.75}.get(model, 0)
            cost_per_1m_output = {"gemini-3.1-flash": 1.2, "claude-sonnet": 15.0, "gpt-5.2": 14.0}.get(model, 0)
            estimated_cost = (input_tokens * cost_per_1m_input + output_tokens * cost_per_1m_output) / 1_000_000
            
            supabase_id = await save_qa_generation_to_supabase(
                job_id=job_id,
                metadata={
                    "generation_model": model,
                    "lang": lang,
                    "prompt_version": prompt_version
                },
                hierarchy={
                    "sampling": "random",
                    "category": None,
                    "path_prefix": None,
                    "filtered_document_count": total_docs
                },
                stats={
                    "total_qa": total_qa,
                    "total_documents": total_docs,
                    "total_tokens_input": input_tokens,
                    "total_tokens_output": output_tokens,
                    "estimated_cost": round(estimated_cost, 4)
                },
                qa_list=output_data["results"]
            )
            
            if supabase_id:
                logger.info(f"[{job_id}] ✅ Supabase saved: {supabase_id}")
            else:
                logger.warning(f"[{job_id}] ⚠️ Supabase save returned None")
        else:
            logger.warning(f"[{job_id}] ⚠️ Supabase not available, skipping save")
    except Exception as e:
        logger.error(f"[{job_id}] Error saving to Supabase: {e}")
        # Continue even if Supabase save fails
    
    # Final update
    job_manager.update_job(
        job_id,
        status=JobStatus.COMPLETED,
        progress=100,
        message="Generation completed successfully",
        result_file=result_filename,
        result_id=supabase_id
    )
    
    logger.info(f"[{job_id}] Generation completed successfully")


async def run_qa_generation_simulation(
    job_id: str,
    model: str,
    lang: str,
    samples: int,
    qa_per_doc: Optional[int],
    prompt_version: str
) -> None:
    """Fallback: Simulation mode when main.py not available"""
    import time
    
    # Simulate generation steps
    steps = [
        (20, "Loading document hierarchy..."),
        (35, "Parsing documents..."),
        (50, "Generating QA pairs (50%)..."),
        (65, "Generating QA pairs (65%)..."),
        (80, "Saving results..."),
        (95, "Finalizing..."),
    ]
    
    for progress, msg in steps:
        job_manager.update_job(job_id, progress=progress, message=msg)
        time.sleep(1)  # Simulate work

    # Save simulated result
    result_filename = f"qa_{model}_{lang}_{prompt_version}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    result_filepath = OUTPUT_DIR / result_filename

    result_data = {
        "config": {
            "model": model,
            "lang": lang,
            "samples": samples,
            "prompt_version": prompt_version,
            "timestamp": datetime.now().isoformat()
        },
        "statistics": {
            "total_qa": samples * 8,
            "tokens_used": 1951 * samples,
            "documents_processed": samples,
            "_note": "Simulation mode (main.py not available)"
        },
        "qa_pairs": [
            {
                "doc_id": f"doc_{i}",
                "question": f"Sample question {i}",
                "answer": f"Sample answer {i}",
                "intent": "factoid"
            }
            for i in range(samples * 8)
        ]
    }

    OUTPUT_DIR.mkdir(exist_ok=True)
    with open(result_filepath, 'w', encoding='utf-8') as f:
        json.dump(result_data, f, ensure_ascii=False, indent=2)

    logger.info(f"[{job_id}] Simulated results saved to {result_filename}")
    
    # ✨ Save to Supabase
    supabase_id = None
    try:
        if is_supabase_available():
            total_qa = samples * 8  # Simulated QA count
            
            supabase_id = await save_qa_generation_to_supabase(
                job_id=job_id,
                metadata={
                    "generation_model": model,
                    "lang": lang,
                    "prompt_version": prompt_version
                },
                hierarchy={
                    "sampling": "random",
                    "category": None,
                    "path_prefix": None,
                    "filtered_document_count": samples
                },
                stats={
                    "total_qa": total_qa,
                    "total_documents": samples,
                    "total_tokens_input": 0,
                    "total_tokens_output": 0,
                    "estimated_cost": 0.0
                },
                qa_list=result_data["qa_pairs"]
            )
            
            if supabase_id:
                logger.info(f"[{job_id}] ✅ Supabase saved (simulation): {supabase_id}")
            else:
                logger.warning(f"[{job_id}] ⚠️ Supabase save returned None")
        else:
            logger.warning(f"[{job_id}] ⚠️ Supabase not available, skipping save")
    except Exception as e:
        logger.error(f"[{job_id}] Error saving to Supabase: {e}")
        # Continue even if Supabase save fails
    
    job_manager.update_job(
        job_id,
        status=JobStatus.COMPLETED,
        progress=100,
        message="Generation completed (simulation mode)",
        result_file=result_filename,
        result_id=supabase_id
    )

# ============= API Endpoints =============

def setup_generation_routes(app: FastAPI):
    """Setup QA generation endpoints"""

    @app.post("/api/generate")
    async def generate_qa(
        request: GenerateRequest,
        background_tasks: BackgroundTasks
    ) -> dict:
        """
        Start QA generation
        Returns job_id for tracking progress
        
        Usage:
            POST /api/generate
            {
                "model": "gemini-3.1-flash",
                "lang": "ko",
                "samples": 8,
                "prompt_version": "v1"
            }
        """
        try:
            # Generate unique job ID
            job_id = f"gen_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}"

            # Create job
            job = job_manager.create_job(
                job_id,
                request.model_dump()
            )

            logger.info(f"Created generation job: {job_id}")

            # Start background task
            background_tasks.add_task(
                run_qa_generation,
                job_id=job_id,
                model=request.model,
                lang=request.lang,
                samples=request.samples,
                qa_per_doc=request.qa_per_doc,
                prompt_version=request.prompt_version
            )

            return {
                "success": True,
                "job_id": job_id,
                "message": "Generation started",
                "config": request.model_dump(),
                "timestamp": datetime.now().isoformat()
            }

        except Exception as e:
            logger.error(f"Error creating generation job: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/api/generate/{job_id}/status")
    async def get_generation_status(job_id: str) -> dict:
        """
        Get generation job status
        
        Usage:
            GET /api/generate/{job_id}/status
            
        Response:
            {
                "job_id": "gen_20260311_153000_123456",
                "status": "running",  # pending, running, completed, failed, cancelled
                "progress": 45,
                "message": "Generating QA pairs...",
                "error": null,
                "result_file": null,
                "timestamp": "2026-03-11T15:30:00.123456"
            }
        """
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
                "config": job.config
            }

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error getting job status: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @app.get("/api/generate/jobs")
    async def list_generation_jobs(
        status: Optional[str] = None,
        limit: int = 100
    ) -> dict:
        """
        List all generation jobs
        
        Usage:
            GET /api/generate/jobs?status=completed&limit=10
            
        Parameters:
            status: Filter by status (pending, running, completed, failed, cancelled)
            limit: Maximum number of jobs to return
        """
        try:
            jobs = job_manager.list_jobs()

            # Filter by status if provided
            if status:
                jobs = [j for j in jobs if j.status.value == status]

            # Limit results
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
                ]
            }

        except Exception as e:
            logger.error(f"Error listing jobs: {e}")
            raise HTTPException(status_code=500, detail=str(e))

    @app.delete("/api/generate/{job_id}")
    async def cancel_generation(job_id: str) -> dict:
        """
        Cancel a running generation job
        
        Usage:
            DELETE /api/generate/{job_id}
        """
        try:
            job = job_manager.get_job(job_id)
            if not job:
                raise HTTPException(status_code=404, detail="Job not found")

            if job.status == JobStatus.COMPLETED:
                raise HTTPException(status_code=400, detail="Cannot cancel completed job")

            job_manager.update_job(
                job_id,
                status=JobStatus.CANCELLED,
                message="Cancelled by user"
            )

            return {
                "success": True,
                "job_id": job_id,
                "message": "Job cancelled"
            }

        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error cancelling job: {e}")
            raise HTTPException(status_code=500, detail=str(e))