"""
doc_metadata 테이블 — 문서 단위 도메인 프로파일 + 계층 master 저장/조회
"""

import logging
from typing import Any, Dict, Optional

from .base_client import supabase

logger = logging.getLogger("autoeval.db")


async def upsert_doc_metadata(
    document_id: str,
    filename: str,
    domain_profile: Optional[Dict[str, Any]] = None,
    h2_h3_master: Optional[Dict[str, Any]] = None,
) -> bool:
    """
    doc_metadata 테이블에 upsert (ON CONFLICT document_id DO UPDATE).

    Args:
        document_id: doc_chunks.metadata->>'document_id'와 일치하는 논리 키
        filename: 원본 파일명
        domain_profile: analyze_domain() 반환값 dict (없으면 기존 값 유지)
        h2_h3_master: {"H1명": {"H2명": ["H3", ...]}} (없으면 기존 값 유지)

    Returns:
        True if success, False on error
    """
    if not supabase:
        logger.warning("Supabase unavailable — skipping doc_metadata upsert")
        return False

    payload: Dict[str, Any] = {"document_id": document_id, "filename": filename}
    if domain_profile is not None:
        payload["domain_profile"] = domain_profile
    if h2_h3_master is not None:
        payload["h2_h3_master"] = h2_h3_master

    try:
        supabase.table("doc_metadata").upsert(
            payload, on_conflict="document_id"
        ).execute()
        logger.info(f"doc_metadata upserted: document_id={document_id!r}")
        return True
    except Exception as e:
        logger.error(f"doc_metadata upsert failed: {e}")
        return False


async def get_doc_metadata(document_id: str) -> Optional[Dict[str, Any]]:
    """
    document_id로 doc_metadata 조회.

    Returns:
        {"domain_profile": {...}, "h2_h3_master": {...}} or None
    """
    if not supabase:
        return None

    try:
        response = (
            supabase.table("doc_metadata")
            .select("domain_profile, h2_h3_master")
            .eq("document_id", document_id)
            .maybe_single()
            .execute()
        )
        if not response.data:
            return None
        return response.data
    except Exception as e:
        logger.error(f"doc_metadata fetch failed (document_id={document_id!r}): {e}")
        return None


async def get_doc_metadata_by_filename(filename: str) -> Optional[Dict[str, Any]]:
    """
    filename으로 doc_metadata 조회 (document_id를 모를 때 폴백용).

    Returns:
        {"document_id": "...", "domain_profile": {...}, "h2_h3_master": {...}} or None
    """
    if not supabase:
        return None

    try:
        response = (
            supabase.table("doc_metadata")
            .select("document_id, domain_profile, h2_h3_master")
            .eq("filename", filename)
            .order("created_at", desc=True)
            .limit(1)
            .maybe_single()
            .execute()
        )
        if not response.data:
            return None
        return response.data
    except Exception as e:
        logger.error(f"doc_metadata fetch failed (filename={filename!r}): {e}")
        return None
