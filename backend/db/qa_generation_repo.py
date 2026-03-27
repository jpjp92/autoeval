"""
QA 생성 결과 저장/조회 (qa_gen_results)
"""

import logging
from datetime import datetime
from typing import Dict, Any, Optional

from .base_client import supabase

logger = logging.getLogger("autoeval.db")


async def save_qa_generation_to_supabase(
    job_id: str,
    metadata: Dict[str, Any],
    stats: Dict[str, Any],
    qa_list: list,
) -> Optional[str]:
    """QA 생성 결과를 Supabase에 저장하고 생성된 ID를 반환"""
    if not supabase:
        logger.warning("Supabase client not initialized. Skipping save.")
        return None

    try:
        doc_chunk_ids = list({r.get("docId") for r in qa_list if r.get("docId")})
        data = {
            "job_id":        job_id,
            "metadata":      metadata,
            "stats":         stats,
            "qa_list":       qa_list,
            "source_doc":    metadata.get("source_doc", ""),
            "doc_chunk_ids": doc_chunk_ids,
            "created_at":    datetime.utcnow().isoformat(),
        }
        response = supabase.table("qa_gen_results").insert(data).execute()
        if response.data:
            generated_id = response.data[0]["id"]
            return generated_id
        logger.error("No data returned from Supabase insert")
        return None
    except Exception as e:
        logger.error(f"Failed to save QA generation: {e}")
        return None


async def get_qa_generation_from_supabase(generation_id: str) -> Optional[Dict[str, Any]]:
    """qa_gen_results에서 생성 결과 조회"""
    if not supabase:
        return None
    try:
        response = (
            supabase.table("qa_gen_results")
            .select("metadata, qa_list")
            .eq("id", generation_id)
            .single()
            .execute()
        )
        return response.data if response.data else None
    except Exception as e:
        logger.error(f"Failed to fetch QA generation: {e}")
        return None


async def get_generation_result(generation_id: str) -> Optional[Dict[str, Any]]:
    """QA 생성 결과 전체 조회"""
    if not supabase:
        return None
    try:
        response = (
            supabase.table("qa_gen_results")
            .select("*")
            .eq("id", generation_id)
            .execute()
        )
        return response.data[0] if response.data else None
    except Exception as e:
        logger.error(f"Failed to get generation result: {e}")
        return None


async def get_generations_by_chunk(chunk_id: str) -> list:
    """특정 doc_chunks.id가 포함된 qa_gen_results 목록 조회 (역방향 추적)"""
    if not supabase:
        return []
    try:
        response = (
            supabase.table("qa_gen_results")
            .select("id, job_id, source_doc, created_at, metadata")
            .contains("doc_chunk_ids", [chunk_id])
            .order("created_at", desc=True)
            .execute()
        )
        return response.data or []
    except Exception as e:
        logger.error(f"Failed to get generations by chunk {chunk_id}: {e}")
        return []


async def get_generations_by_source_doc(source_doc: str) -> list:
    """특정 문서로 생성된 qa_gen_results 목록 조회"""
    if not supabase:
        return []
    try:
        response = (
            supabase.table("qa_gen_results")
            .select("id, job_id, source_doc, doc_chunk_ids, created_at, metadata, stats")
            .eq("source_doc", source_doc)
            .order("created_at", desc=True)
            .execute()
        )
        return response.data or []
    except Exception as e:
        logger.error(f"Failed to get generations by source_doc {source_doc}: {e}")
        return []
