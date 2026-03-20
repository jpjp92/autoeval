"""
문서 청크 저장/검색/조회 (doc_chunks)
"""

import logging
from datetime import datetime
from typing import Dict, Any, Optional

from .base_client import supabase

logger = logging.getLogger("autoeval.db")


async def save_doc_chunk(
    content: str,
    embedding: list,
    metadata: Dict[str, Any] = None,
) -> Optional[str]:
    """
    문서 청크와 임베딩을 Supabase에 저장.
    content_hash가 이미 존재하면 skip (중복 방지).
    """
    if not supabase:
        return None

    try:
        content_hash = (metadata or {}).get("content_hash")
        if content_hash:
            existing = (
                supabase.table("doc_chunks")
                .select("id")
                .eq("metadata->>content_hash", content_hash)
                .limit(1)
                .execute()
            )
            if existing.data:
                logger.debug(f"⏭️ Skipped duplicate chunk (hash={content_hash[:8]})")
                return None

        data = {
            "content":    content,
            "embedding":  embedding,
            "metadata":   metadata or {},
            "created_at": datetime.utcnow().isoformat(),
        }
        response = supabase.table("doc_chunks").insert(data).execute()
        if response.data:
            return response.data[0]["id"]
        return None
    except Exception as e:
        logger.error(f"❌ Failed to save doc chunk: {e}")
        return None


async def update_chunk_metadata(chunk_id: str, metadata: Dict[str, Any]) -> bool:
    """특정 청크의 메타데이터 업데이트"""
    if not supabase:
        return False
    try:
        supabase.table("doc_chunks").update({"metadata": metadata}).eq("id", chunk_id).execute()
        return True
    except Exception as e:
        logger.error(f"❌ Failed to update chunk metadata: {e}")
        return False


async def search_doc_chunks(
    query_embedding: list,
    match_threshold: float = 0.5,
    match_count: int = 5,
    filter: Dict[str, Any] = None,
) -> list:
    """유사도 기반 문서 청크 검색 (RPC: match_doc_chunks)"""
    if not supabase:
        return []
    try:
        response = supabase.rpc(
            "match_doc_chunks",
            {
                "query_embedding":  query_embedding,
                "match_threshold":  match_threshold,
                "match_count":      match_count,
                "filter":           filter or {},
            },
        ).execute()
        return response.data if response.data else []
    except Exception as e:
        logger.error(f"❌ Failed to search doc chunks: {e}")
        return []


async def get_doc_chunks_by_filter(
    hierarchy_h1: Optional[str] = None,
    hierarchy_h2: Optional[str] = None,
    hierarchy_h3: Optional[str] = None,
    filename: Optional[str] = None,
    limit: int = 20,
) -> list:
    """metadata 필터 기반 doc_chunks 직접 조회 (vector similarity 없음)"""
    if not supabase:
        return []
    try:
        query = supabase.table("doc_chunks").select("id, content, metadata")
        if filename:
            query = query.eq("metadata->>filename", filename)
        if hierarchy_h1:
            query = query.eq("metadata->>hierarchy_h1", hierarchy_h1)
        if hierarchy_h2:
            query = query.eq("metadata->>hierarchy_h2", hierarchy_h2)
        if hierarchy_h3:
            query = query.eq("metadata->>hierarchy_h3", hierarchy_h3)
        response = query.limit(limit).execute()
        return response.data if response.data else []
    except Exception as e:
        logger.error(f"❌ Failed to get doc chunks by filter: {e}")
        return []


async def get_document_chunks(source_name: str, limit: int = 10) -> list:
    """특정 문서의 청크 조회 (계층 구조 분석용)"""
    if not supabase:
        return []
    try:
        response = (
            supabase.table("doc_chunks")
            .select("id, content, metadata")
            .eq("metadata->>filename", source_name)
            .order("created_at")
            .limit(limit)
            .execute()
        )
        return response.data if response.data else []
    except Exception as e:
        logger.error(f"❌ Failed to get document chunks: {e}")
        return []
