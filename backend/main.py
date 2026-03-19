"""
FastAPI Backend — AutoEval
QA 생성·평가·인제스션 라우터 통합 허브
"""

import os
import sys
import logging
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, str(Path(__file__).parent))

# ============================================================================
# 로깅 설정
# ============================================================================

class ColoredFormatter(logging.Formatter):
    COLORS = {
        'DEBUG': '\033[94m',
        'INFO': '\033[92m',
        'WARNING': '\033[93m',
        'ERROR': '\033[91m',
        'CRITICAL': '\033[1;91m',
        'RESET': '\033[0m',
    }

    def __init__(self, fmt=None, datefmt=None, style='%', validate=True, **kwargs):
        super().__init__(fmt=fmt, datefmt=datefmt, style=style, validate=validate)

    def format(self, record):
        log_color = self.COLORS.get(record.levelname, self.COLORS['RESET'])
        reset = self.COLORS['RESET']
        original_levelname = record.levelname
        record.levelname = f"{log_color}{original_levelname}{reset}"
        result = super().format(record)
        record.levelname = original_levelname
        return result


LOG_FORMAT = "[%(asctime)s] %(levelname)s: %(message)s"
LOG_DATE_FORMAT = "%H:%M:%S"

handler = logging.StreamHandler()
handler.setFormatter(ColoredFormatter(LOG_FORMAT, datefmt=LOG_DATE_FORMAT))
logging.root.handlers = [handler]
logging.root.setLevel(os.getenv("LOG_LEVEL", "INFO"))

logger = logging.getLogger("autoeval.main")

# TruLens 내부 경고 억제
logging.getLogger("trulens").setLevel(logging.ERROR)
logging.getLogger("trulens.core").setLevel(logging.ERROR)

UVICORN_LOG_CONFIG = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "default": {"()": "__main__.ColoredFormatter", "fmt": LOG_FORMAT, "datefmt": LOG_DATE_FORMAT},
        "access":  {"()": "__main__.ColoredFormatter", "fmt": LOG_FORMAT, "datefmt": LOG_DATE_FORMAT},
    },
    "handlers": {
        "default": {"formatter": "default", "class": "logging.StreamHandler", "stream": "ext://sys.stderr"},
        "access":  {"formatter": "access",  "class": "logging.StreamHandler", "stream": "ext://sys.stdout"},
    },
    "loggers": {
        "uvicorn.error":  {"handlers": ["default"], "level": "INFO", "propagate": False},
        "uvicorn.access": {"handlers": ["access"],  "level": "INFO", "propagate": False},
    },
}

# ============================================================================
# FastAPI 앱
# ============================================================================

app = FastAPI(
    title="Auto Evaluation API",
    description="Backend API for QA generation and evaluation",
    version="1.0.0",
)

cors_origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# ============================================================================
# 라우터 등록
# ============================================================================

try:
    from api.generation_api import setup_generation_routes
    setup_generation_routes(app)
    logger.info("✓ Generation API registered")
except ImportError as e:
    logger.warning(f"Generation API import failed: {e}")

try:
    from api.evaluation_api import EvaluationManager, setup_evaluation_routes
    eval_manager = EvaluationManager()
    setup_evaluation_routes(app, eval_manager)
    logger.info("✓ Evaluation API registered")
except ImportError as e:
    logger.warning(f"Evaluation API import failed: {e}")

try:
    from api.ingestion_api import setup_ingestion_routes
    setup_ingestion_routes(app)
    logger.info("✓ Ingestion API registered")
except ImportError as e:
    logger.warning(f"Ingestion API import failed: {e}")

# ============================================================================
# 공통 엔드포인트
# ============================================================================

@app.get("/health", tags=["system"])
def health_check():
    """헬스체크"""
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


@app.get("/api/dashboard/metrics", tags=["dashboard"])
async def dashboard_metrics():
    """Dashboard 요약 데이터 조회"""
    from config.supabase_client import get_dashboard_metrics
    result = await get_dashboard_metrics()
    if "error" in result:
        return {"success": False, "error": result["error"]}
    return {"success": True, "data": result}


# ============================================================================
# 에러 핸들러
# ============================================================================

@app.exception_handler(HTTPException)
async def http_exception_handler(request, exc):
    from fastapi.responses import JSONResponse
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "error": exc.detail, "status_code": exc.status_code},
    )


# ============================================================================
# 직접 실행
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info",
        access_log=False,
        use_colors=True,
        log_config=UVICORN_LOG_CONFIG,
    )
