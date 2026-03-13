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
from typing import Optional, List, Dict
from datetime import datetime
import json
import logging
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor

# Load environment variables
load_dotenv()

# ============= Config Imports =============
# Import centralized config from backend/config/
sys.path.insert(0, str(Path(__file__).parent))
from config.models import MODEL_CONFIG, PROMPT_VERSION, INTENT_COLORS
from config.prompts import (
    SYSTEM_PROMPT_KO_V1,
    SYSTEM_PROMPT_EN_V1,
    USER_TEMPLATE_KO_V1,
    USER_TEMPLATE_EN_V1,
)
from config.constants import (
    BASE_DIR,
    OUTPUT_DIR,
    VALIDATED_OUTPUT_DIR,
    THREAD_POOL_WORKERS,
    DATA_FILE,
)

# Configure logging
log_level = os.getenv("LOG_LEVEL", "INFO")
logging.basicConfig(level=log_level)
logger = logging.getLogger(__name__)

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
    from generation_api import (
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

# ============= QA Generation Functions =============
# Core functions for QA generation (imported by generation_api.py)

_clients = {}


def get_client(provider: str):
    """API 클라이언트 반환 (lazy loading)"""
    if provider not in _clients:
        if provider == "anthropic":
            import anthropic
            _clients[provider] = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        elif provider == "google":
            from google import genai as google_genai
            _clients[provider] = google_genai.Client(api_key=os.environ.get("GOOGLE_API_KEY"))
        elif provider == "openai":
            import openai
            openai.api_key = os.environ.get("OPENAI_API_KEY")
            _clients[provider] = openai
    return _clients[provider]


def generate_qa_anthropic(model_id: str, system_prompt: str, user_prompt: str) -> Dict:
    """Anthropic (Claude) API를 사용한 QA 생성"""
    client = get_client("anthropic")
    
    response = client.messages.create(
        model=model_id,
        max_tokens=2048,
        messages=[
            {
                "role": "user",
                "content": user_prompt,
            }
        ],
        system=system_prompt,
    )
    
    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    
    try:
        qa_list = json.loads(raw).get("qa_list", [])
    except json.JSONDecodeError:
        qa_list = []
    
    return {
        "raw": raw,
        "qa_list": qa_list,
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
    }


def generate_qa_google(model_id: str, system_prompt: str, user_prompt: str) -> Dict:
    """Google Generative AI (Gemini) API를 사용한 QA 생성"""
    client = get_client("google")
    
    prompt = system_prompt + "\n\n" + user_prompt
    response = client.models.generate_content(
        model=model_id,
        contents=prompt,
    )
    
    raw = response.text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    
    try:
        qa_list = json.loads(raw).get("qa_list", [])
    except json.JSONDecodeError:
        qa_list = []
    
    return {
        "raw": raw,
        "qa_list": qa_list,
        "input_tokens": response.usage_metadata.prompt_token_count,
        "output_tokens": response.usage_metadata.candidates_token_count,
    }


def generate_qa_openai(model_id: str, system_prompt: str, user_prompt: str) -> Dict:
    """OpenAI API를 사용한 QA 생성"""
    from openai import OpenAI
    
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    
    response = client.chat.completions.create(
        model=model_id,
        max_completion_tokens=2048,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    
    raw = response.choices[0].message.content.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    
    try:
        qa_list = json.loads(raw).get("qa_list", [])
    except json.JSONDecodeError:
        qa_list = []
    
    return {
        "raw": raw,
        "qa_list": qa_list,
        "input_tokens": response.usage.prompt_tokens,
        "output_tokens": response.usage.completion_tokens,
    }


def generate_qa(item: Dict, model: str, lang: str, prompt_version: str) -> Dict:
    """QA 생성 메인 함수"""
    model_info = MODEL_CONFIG[model]
    provider = model_info["provider"]
    model_id = model_info["model_id"]
    
    # 프롬프트 선택
    if lang == "ko":
        if prompt_version == "v1":
            system_prompt = SYSTEM_PROMPT_KO_V1
            user_template = USER_TEMPLATE_KO_V1
    else:  # en
        if prompt_version == "v1":
            system_prompt = SYSTEM_PROMPT_EN_V1
            user_template = USER_TEMPLATE_EN_V1
    
    hierarchy = " > ".join(item["hierarchy"]) if item.get("hierarchy") else "Uncategorized"
    text = item.get("text", "")[:2000]
    user_prompt = user_template.format(hierarchy=hierarchy, text=text)
    
    # 프로바이더별 API 호출
    if provider == "anthropic":
        result = generate_qa_anthropic(model_id, system_prompt, user_prompt)
    elif provider == "google":
        result = generate_qa_google(model_id, system_prompt, user_prompt)
    elif provider == "openai":
        result = generate_qa_openai(model_id, system_prompt, user_prompt)
    
    return {
        "docId": item.get("docId", ""),
        "hierarchy": item.get("hierarchy", []),
        "text": item.get("text", ""),
        "model": model,
        "provider": provider,
        "lang": lang,
        "prompt_version": prompt_version,
        **result,
    }

# ============= Evaluation API Integration =============
# Import evaluation_api for RAG Triad evaluation
try:
    from evaluation_api import (
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
    from ingestion_api import setup_ingestion_routes
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
    return {
        "success": False,
        "error": exc.detail,
        "status_code": exc.status_code
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
        access_log=False,  # 평가 상태 체크 로그 제거
        use_colors=True    # 터미널 색상 활성화
    )
