"""
Supabase 클라이언트 초기화 및 공통 유틸리티
"""

import logging
import os
from typing import Dict, Any, Optional

from supabase import create_client, Client

logger = logging.getLogger("autoeval.db")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_API_KEY = os.getenv("SUPABASE_API_KEY")

if not SUPABASE_URL or not SUPABASE_API_KEY:
    logger.warning("Supabase credentials not found in .env")
    supabase: Optional[Client] = None
else:
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_API_KEY)


def require_client() -> Client:
    """클라이언트 반환. 초기화 안 됐으면 RuntimeError."""
    if not supabase:
        raise RuntimeError("Supabase client not initialized")
    return supabase


def is_supabase_available() -> bool:
    """Supabase 클라이언트 가용성 확인"""
    return supabase is not None


async def health_check() -> Dict[str, Any]:
    """Supabase 연결 상태 확인"""
    if not supabase:
        return {"status": "unavailable", "message": "Supabase credentials not configured"}
    try:
        supabase.table("qa_gen_results").select("count", count="exact").limit(1).execute()
        return {"status": "healthy", "message": "Connected to Supabase"}
    except Exception as e:
        return {"status": "error", "message": str(e)}
