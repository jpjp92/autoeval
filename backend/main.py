"""
FastAPI Backend for Auto Evaluation Dashboard
Supports QA generation, evaluation, and result management
"""

import os
import sys
from pathlib import Path
from fastapi import FastAPI, HTTPException, File, UploadFile, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import json
import logging
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# ============= Config Imports =============
# Import centralized config from backend/config/
sys.path.insert(0, str(Path(__file__).parent))
from config.constants import (
    BASE_DIR,
    OUTPUT_DIR,
    VALIDATED_OUTPUT_DIR,
    THREAD_POOL_WORKERS,
    DATA_FILE,
)

# ============= Logging Configuration =============
class ColoredFormatter(logging.Formatter):
    """로그 레벨별로 색상을 적용하는 커스텀 포맷터"""
    COLORS = {
        'DEBUG': '\033[94m',    # Blue
        'INFO': '\033[92m',     # Green
        'WARNING': '\033[93m',  # Yellow
        'ERROR': '\033[91m',    # Red
        'CRITICAL': '\033[1;91m', # Bold Red
        'RESET': '\033[0m'
    }

    def __init__(self, fmt=None, datefmt=None, style='%', validate=True, **kwargs):
        super().__init__(fmt=fmt, datefmt=datefmt, style=style, validate=validate)

    def format(self, record):
        log_color = self.COLORS.get(record.levelname, self.COLORS['RESET'])
        reset = self.COLORS['RESET']
        # 레벨 이름에 색상 입히기
        original_levelname = record.levelname
        record.levelname = f"{log_color}{original_levelname}{reset}"
        result = super().format(record)
        # 다른 로그에 영향을 주지 않도록 원복
        record.levelname = original_levelname
        return result

LOG_FORMAT = "[%(asctime)s] %(levelname)s: %(message)s"
LOG_DATE_FORMAT = "%H:%M:%S"

# 루트 로거 설정 수정
handler = logging.StreamHandler()
handler.setFormatter(ColoredFormatter(LOG_FORMAT, datefmt=LOG_DATE_FORMAT))
logging.root.handlers = [handler]
logging.root.setLevel(os.getenv("LOG_LEVEL", "INFO"))

logger = logging.getLogger("autoeval.main")

# TruLens 내부 직렬화 경고 억제 (RAGTriadEvaluator 커스텀 피드백 함수 관련)
logging.getLogger("trulens").setLevel(logging.ERROR)
logging.getLogger("trulens.core").setLevel(logging.ERROR)

# Uvicorn 로그 설정 (색상 지원 포맷터 사용)
UVICORN_LOG_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {
            "()": "__main__.ColoredFormatter", # 커스텀 포맷터 클래스 참조
            "fmt": LOG_FORMAT,
            "datefmt": LOG_DATE_FORMAT,
        },
        "access": {
            "()": "__main__.ColoredFormatter", # 커스텀 포맷터 클래스 참조
            "fmt": LOG_FORMAT,
            "datefmt": LOG_DATE_FORMAT,
        },
    },
    "handlers": {
        "default": {
            "formatter": "default",
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stderr",
        },
        "access": {
            "formatter": "access",
            "class": "logging.StreamHandler",
            "stream": "ext://sys.stdout",
        },
    },
    "loggers": {
        "uvicorn.error": {"handlers": ["default"], "level": "INFO", "propagate": False},
        "uvicorn.access": {"handlers": ["access"], "level": "INFO", "propagate": False},
    },
}

# Initialize FastAPI app
app = FastAPI(
    title="Auto Evaluation API",
    description="Backend API for QA generation and evaluation",
    version="1.0.0"
)

# Configure CORS
cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# ============= Generation API Integration =============
# Import generation_api for QA generation with main.py integration
try:
    from api.generation_api import (
        JobManager,
        setup_generation_routes,
    )
    
    # Initialize job manager
    job_manager = JobManager()
    
    # Setup generation routes
    setup_generation_routes(app)
    
    logger.info("✓ Generation API integrated successfully")
except ImportError as e:
    logger.warning(f"Generation API import failed: {e}. /api/generate endpoints will not be available.")
    job_manager = None

# ============= Evaluation API Integration =============
# Import evaluation_api for RAG Triad evaluation
try:
    from api.evaluation_api import (
        EvaluationManager,
        setup_evaluation_routes,
    )
    
    # Initialize evaluation manager
    eval_manager = EvaluationManager()
    
    # Setup evaluation routes
    setup_evaluation_routes(app, eval_manager)
    
    logger.info("✓ Evaluation API integrated successfully")
except ImportError as e:
    logger.warning(f"Evaluation API import failed: {e}. /api/evaluate endpoints will not be available.")
    eval_manager = None

# ============= Ingestion API Integration =============
try:
    from api.ingestion_api import setup_ingestion_routes
    setup_ingestion_routes(app)
    logger.info("✓ Ingestion API integrated successfully")
except ImportError as e:
    logger.warning(f"Ingestion API import failed: {e}. /api/ingestion endpoints will not be available.")

# ============= Configuration =============
BASE_DIR = Path(__file__).parent.parent
OUTPUT_DIR = BASE_DIR / "output"
VALIDATED_OUTPUT_DIR = BASE_DIR / "validated_output"

# Create directories if they don't exist
OUTPUT_DIR.mkdir(exist_ok=True)
VALIDATED_OUTPUT_DIR.mkdir(exist_ok=True)

# ============= Models =============

class ResultMetadata(BaseModel):
    """Metadata for evaluation result"""
    model: str
    lang: str
    prompt_version: str
    samples: int
    qa_per_doc: Optional[int] = None
    timestamp: str


class ResultFile(BaseModel):
    """Information about a result file"""
    filename: str
    filepath: str
    model: str
    lang: str
    prompt_version: str
    qa_count: int
    timestamp: str
    size_kb: float


class GenerateRequest(BaseModel):
    """Request for QA generation"""
    model: str = "flashlite"  # flashlite, gpt-5.1, gpt-4o, claude-sonnet
    lang: str = "ko"  # ko, en
    samples: int = 10
    qa_per_doc: Optional[int] = None
    prompt_version: str = "v2"


class EvaluateRequest(BaseModel):
    """Request for QA evaluation"""
    result_filename: str  # qa_model_lang_v2_timestamp.json
    limit: Optional[int] = None


class EvaluateRequest(BaseModel):
    """Request for QA evaluation"""
    result_filename: str
    limit: Optional[int] = None
    doc_ids: Optional[List[str]] = None


class EvaluateRequest(BaseModel):
    """Request for evaluation"""
    result_filename: str
    include_l1: bool = True
    include_l2: bool = True


class ExportRequest(BaseModel):
    """Request for exporting results"""
    result_filename: str
    export_format: str = "csv"  # csv, html, xlsx, json


# ============= Health Check =============

@app.get("/health")
def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


@app.get("/")
def root():
    """Root endpoint"""
    return {
        "message": "Auto Evaluation API",
        "version": "1.0.0",
        "docs": "/docs"
    }


# ============= Dashboard API =============

@app.get("/api/dashboard/metrics")
async def dashboard_metrics():
    """Dashboard 요약 데이터 조회"""
    from config.supabase_client import get_dashboard_metrics
    result = await get_dashboard_metrics()
    if "error" in result:
        return {"success": False, "error": result["error"]}
    return {"success": True, "data": result}


# ============= Results API =============

@app.get("/api/results")
def get_results() -> dict:
    """
    Get list of available evaluation result files
    Returns metadata and file information
    """
    try:
        results = []
        
        # Scan output directory
        if OUTPUT_DIR.exists():
            for json_file in OUTPUT_DIR.glob("*.json"):
                try:
                    with open(json_file, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                    
                    config = data.get('config', {})
                    stats = data.get('statistics', {})
                    
                    result_info = ResultFile(
                        filename=json_file.name,
                        filepath=str(json_file.relative_to(BASE_DIR)),
                        model=config.get('model', 'unknown'),
                        lang=config.get('lang', 'ko'),
                        prompt_version=config.get('prompt_version', 'v2'),
                        qa_count=stats.get('total_qa', 0),
                        timestamp=json_file.stat().st_mtime,
                        size_kb=json_file.stat().st_size / 1024
                    )
                    results.append(result_info.model_dump())
                except (json.JSONDecodeError, KeyError) as e:
                    logger.warning(f"Error reading {json_file.name}: {e}")
                    continue
        
        return {
            "success": True,
            "count": len(results),
            "results": sorted(results, key=lambda x: x['timestamp'], reverse=True)
        }
    except Exception as e:
        logger.error(f"Error getting results: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/results/{filename}")
def get_result_detail(filename: str) -> dict:
    """
    Get detailed evaluation result for a specific file
    """
    try:
        filepath = OUTPUT_DIR / filename
        
        if not filepath.exists():
            raise HTTPException(status_code=404, detail="Result file not found")
        
        with open(filepath, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        return {
            "success": True,
            "filename": filename,
            "data": data
        }
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON file")
    except Exception as e:
        logger.error(f"Error getting result detail: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============= QA Generation API =============
# NOTE: Generation API is now integrated via generation_api.py
# The /api/generate and /api/generate/{job_id}/status endpoints are provided by setup_generation_routes()
# Generated QA files are saved to output/ directory

# Original placeholder endpoint - REPLACED by generation_api.py
# @app.post("/api/generate")
# def generate_qa(request: GenerateRequest):
#     """
#     Start QA generation
#     Note: In production, this should use SSE (Server-Sent Events) for streaming
#     """
#     try:
#         logger.info(f"Generation request: {request.model_dump()}")
#         
#         # TODO: Integrate with main.py's generate_qa function
#         # For now, return a placeholder response
#         
#         return {
#             "success": True,
#             "message": "Generation started",
#             "job_id": f"job_{datetime.now().timestamp()}",
#             "config": request.model_dump()
#         }
#     except Exception as e:
#         logger.error(f"Error in generation: {e}")
#         raise HTTPException(status_code=500, detail=str(e))


# ============= Evaluation API =============
# NOTE: Evaluation API integration planned for Phase 2
# Will integrate with qa_quality_evaluator.py

# Placeholder endpoint - To be implemented
# @app.post("/api/evaluate")
# def evaluate_qa(request: EvaluateRequest):
#     """
#     Start QA evaluation
#     Note: In production, this should use SSE for streaming progress
#     """
#     try:
#         logger.info(f"Evaluation request: {request.model_dump()}")
#         
#         # TODO: Integrate with qa_quality_evaluator.py
#         # For now, return a placeholder response
#         
#         return {
#             "success": True,
#             "message": "Evaluation started",
#             "job_id": f"job_{datetime.now().timestamp()}",
#             "filename": request.result_filename
#         }
#     except Exception as e:
#         logger.error(f"Error in evaluation: {e}")
#         raise HTTPException(status_code=500, detail=str(e))


# ============= Export API =============

@app.post("/api/export")
def export_results(request: ExportRequest):
    """
    Export evaluation results in specified format
    Supports: csv, html, xlsx, json
    """
    try:
        filepath = OUTPUT_DIR / request.result_filename
        
        if not filepath.exists():
            raise HTTPException(status_code=404, detail="Result file not found")
        
        # TODO: Implement export logic for different formats
        # csv, html, xlsx using openpyxl/pandas
        
        return {
            "success": True,
            "message": f"Export to {request.export_format} completed",
            "format": request.export_format,
            "filename": f"{request.result_filename.replace('.json', f'.{request.export_format}')}"
        }
    except Exception as e:
        logger.error(f"Error in export: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============= Config / Status API =============

@app.get("/api/config")
def get_config():
    """
    Get system configuration
    """
    return {
        "models": ["flashlite", "gpt-5.1", "gpt-4o", "claude-sonnet"],
        "languages": ["ko", "en"],
        "prompt_versions": ["v2"],
        "max_samples": 100,
        "output_formats": ["csv", "html", "xlsx", "json"]
    }


@app.get("/api/status")
def get_status():
    """
    Get system status and resource information
    """
    return {
        "status": "ready",
        "output_dir_exists": OUTPUT_DIR.exists(),
        "output_file_count": len(list(OUTPUT_DIR.glob("*.json"))) if OUTPUT_DIR.exists() else 0,
        "validated_file_count": len(list(VALIDATED_OUTPUT_DIR.glob("*.json"))) if VALIDATED_OUTPUT_DIR.exists() else 0,
        "timestamp": datetime.now().isoformat()
    }


# ============= Error Handlers =============

@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": exc.detail,
            "status_code": exc.status_code
        }
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
        access_log=False,
        use_colors=True,
        log_config=UVICORN_LOG_CONFIG # 커스텀 로그 설정 적용
    )
