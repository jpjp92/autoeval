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
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any
from enum import Enum
from dataclasses import dataclass, asdict

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

logger = logging.getLogger(__name__)

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
    
    # Load data
    data_file = Path(__file__).parent.parent / "ref/data/data_2026-03-06_normalized.json"
    
    if not data_file.exists():
        raise FileNotFoundError(f"Data file not found: {data_file}")
    
    with open(data_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    # Extract items
    items = data if isinstance(data, list) else data.get("documents", [])
    items = items[:samples]
    
    logger.info(f"[{job_id}] Loaded {len(items)} documents")
    job_manager.update_job(job_id, progress=10, message=f"Loaded {len(items)} documents")
    
    # Generate QA for each document
    results = []
    total_input_tokens = 0
    total_output_tokens = 0
    
    for i, item in enumerate(items, 1):
        try:
            logger.info(f"[{job_id}] Generating QA for document {i}/{len(items)}: {item.get('docId', 'unknown')}")
            
            # Call main.py's generate_qa function
            result = main_generate_qa(item, model, lang, prompt_version)
            
            # Apply qa_per_doc limit if specified
            if qa_per_doc and result.get("qa_list"):
                result["qa_list"] = result["qa_list"][:qa_per_doc]
            
            results.append(result)
            
            # Track tokens
            total_input_tokens += result.get("input_tokens", 0)
            total_output_tokens += result.get("output_tokens", 0)
            
            # Update progress
            progress = 10 + int((i / len(items)) * 80)  # 10-90%
            job_manager.update_job(
                job_id,
                progress=progress,
                message=f"Generating QA pairs ({i}/{len(items)})..."
            )
            
        except Exception as e:
            logger.warning(f"[{job_id}] Failed to generate QA for document {i}: {e}")
            # Continue with next document instead of failing
            continue
    
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

# ============= Usage in main.py =============
#
# This module integrates with the main.py QA generation logic:
#
# 1. Direct Function Call (main.py available)
#    ├─ Main.py's generate_qa() is called directly
#    ├─ Real API calls (Anthropic, Google, OpenAI)
#    └─ Actual QA pairs are generated
#
# 2. Fallback Simulation (main.py not available)
#    ├─ Used during development/testing
#    ├─ Simulates QA generation with progress
#    └─ Still creates result files for testing
#
# Flow:
#   Frontend → POST /api/generate
#       ↓
#   Backend → generate_qa() endpoint (returns job_id)
#       ↓
#   Background task → run_qa_generation()
#       ├─if MAIN_PY_AVAILABLE:
#       │   └─ Call main.py's generate_qa() for each document
#       │   (Uses real API keys from environment)
#       └─else:
#           └─ Use simulation mode (for testing)
#
# Required Environment Variables:
#   - ANTHROPIC_API_KEY
#   - GOOGLE_API_KEY
#   - OPENAI_API_KEY
#
# Data Location:
#   - Input: ref/data/data_2026-03-06_normalized.json
#   - Output: output/qa_*.json
#
# Add to FastAPI app initialization:
# 
# app = FastAPI()
# setup_generation_routes(app)
