"""
문서 청크 저장/검색/조회 (doc_chunks)
"""

import asyncio
import logging
from datetime import datetime
from typing import Dict, Any, Optional

from .base_client import supabase

logger = logging.getLogger("autoeval.db")

# supabase-py sync 클라이언트는 HTTP/2 커넥션 풀을 공유하므로
# asyncio.to_thread 동시 호출이 많아지면 스레드 경합 발생.
# 전역 세마포어로 동시 DB 쓰기를 제한해 ConnectionTerminated / Broken pipe 방지.
_DB_WRITE_CONCURRENCY = 2
_db_write_sem: asyncio.Semaphore | None = None


def _write_sem() -> asyncio.Semaphore:
    global _db_write_sem
    if _db_write_sem is None:
        _db_write_sem = asyncio.Semaphore(_DB_WRITE_CONCURRENCY)
    return _db_write_sem


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
                logger.debug(f"Skipped duplicate chunk (hash={content_hash[:8]})")
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
        logger.error(f"Failed to save doc chunk: {e}")
        return None


async def save_doc_chunks_batch(chunks: list, retries: int = 3) -> list:
    """
    배치 단위로 doc_chunks 저장.
    - (content_hash, document_id) 쌍 1회 SELECT로 중복 확인
    - 동일 content + 동일 document_id 조합만 skip (exact duplicate)
    - 동일 content + 새 document_id → 새 버전 row INSERT (이전 버전 보존)
    chunks: [{"content": str, "embedding": list, "metadata": dict}]

    Note: _write_sem()으로 동시 DB 쓰기를 제한해 supabase-py HTTP/2 커넥션 풀 경합 방지.
    실패 시 최대 retries회 지수 백오프 재시도.
    """
    if not supabase or not chunks:
        return []

    async with _write_sem():
        for attempt in range(retries):
            try:
                # 1. hash 목록 수집
                hash_list = [
                    h for h in (
                        (c.get("metadata") or {}).get("content_hash") for c in chunks
                    ) if h
                ]

                # 2. 기존 (content_hash, document_id) 쌍 1회 SELECT
                existing_pairs: set = set()
                if hash_list:
                    existing_res = await asyncio.to_thread(
                        lambda: supabase.table("doc_chunks")
                            .select("document_id, metadata")
                            .in_("metadata->>content_hash", hash_list)
                            .execute()
                    )
                    for r in (existing_res.data or []):
                        meta = r.get("metadata") or {}
                        h = meta.get("content_hash")
                        # 전용 컬럼 우선, 구버전 row는 metadata fallback
                        d = r.get("document_id") or meta.get("document_id")
                        if h and d:
                            existing_pairs.add((h, d))

                # 3. 신규 청크만 필터링 — 동일 (hash, doc_id) 쌍만 skip
                now = datetime.utcnow().isoformat()
                new_rows = []
                skipped = 0
                for c in chunks:
                    meta = c.get("metadata") or {}
                    content_hash = meta.get("content_hash")
                    # 전용 컬럼 우선, 구버전 row는 metadata fallback
                    document_id = c.get("document_id") or meta.get("document_id")
                    if content_hash and document_id and (content_hash, document_id) in existing_pairs:
                        logger.debug(f"Skipped duplicate chunk (hash={content_hash[:8]}, doc_id={document_id[:8]})")
                        skipped += 1
                        continue
                    new_rows.append({
                        "content":     c["content"],
                        "embedding":   c["embedding"],
                        "metadata":    meta,
                        "document_id": document_id,
                        "created_at":  now,
                    })

                if skipped:
                    logger.info(f"Batch duplicate skip: {skipped} chunks")

                # 4. 신규 청크 1회 배치 INSERT
                if not new_rows:
                    return []

                response = await asyncio.to_thread(
                    lambda: supabase.table("doc_chunks").insert(new_rows).execute()
                )
                return [r["id"] for r in (response.data or [])]

            except Exception as e:
                if attempt < retries - 1:
                    wait = 2 ** attempt
                    logger.warning(f"save_doc_chunks_batch retry {attempt + 1}/{retries} (wait={wait}s): {e}")
                    await asyncio.sleep(wait)
                else:
                    logger.error(f"Failed to save doc chunks batch: {e}")
                    return []
    return []


async def update_chunk_metadata(chunk_id: str, metadata: Dict[str, Any], retries: int = 3) -> bool:
    """특정 청크의 메타데이터 전체 교체 — to_thread로 이벤트루프 블로킹 방지.
    retries: 실패 시 최대 재시도 횟수 (기본 3회, 총 4회 시도)

    전역 세마포어(_write_sem)로 동시 실행 수를 제한해
    supabase-py HTTP/2 커넥션 풀 경합(Broken pipe, ConnectionTerminated) 방지.
    """
    if not supabase:
        return False
    _id = chunk_id
    _meta = metadata
    for attempt in range(retries + 1):
        try:
            async with _write_sem():
                await asyncio.to_thread(
                    lambda: supabase.table("doc_chunks")
                        .update({"metadata": _meta})
                        .eq("id", _id)
                        .execute()
                )
            return True
        except Exception as e:
            if attempt < retries:
                wait = 0.5 * (2 ** attempt)  # 0.5 → 1.0 → 2.0 → 4.0 초
                logger.warning(f"update_chunk_metadata retry {attempt + 1}/{retries} (chunk={chunk_id[:8]}): {e}")
                await asyncio.sleep(wait)
            else:
                logger.error(f"Failed to update chunk metadata: {e}")
                return False


async def patch_chunk_hierarchy(
    chunk_id: str,
    h1: Optional[str],
    h2: Optional[str],
    h3: Optional[str],
    retries: int = 3,
) -> bool:
    """hierarchy 3개 필드만 DB side에서 jsonb merge (patch_chunk_hierarchy RPC).

    메타데이터 전체를 재전송하지 않으므로 페이로드가 작고
    Cloudflare WAF/rate-limit 문제를 방지한다.
    전제: Supabase에 patch_chunk_hierarchy 함수가 존재해야 함.

    CREATE OR REPLACE FUNCTION patch_chunk_hierarchy(
      p_chunk_id UUID, p_h1 TEXT, p_h2 TEXT, p_h3 TEXT
    ) RETURNS VOID AS $$
    BEGIN
      UPDATE doc_chunks
      SET metadata = metadata || jsonb_build_object(
        'hierarchy_h1', p_h1, 'hierarchy_h2', p_h2, 'hierarchy_h3', p_h3
      )
      WHERE id = p_chunk_id;
    END;
    $$ LANGUAGE plpgsql;
    """
    if not supabase:
        return False
    _id = chunk_id
    _params = {"p_chunk_id": _id, "p_h1": h1, "p_h2": h2, "p_h3": h3}
    for attempt in range(retries + 1):
        try:
            async with _write_sem():
                await asyncio.to_thread(
                    lambda: supabase.rpc("patch_chunk_hierarchy", _params).execute()
                )
            return True
        except Exception as e:
            if attempt < retries:
                wait = 0.5 * (2 ** attempt)
                logger.warning(f"patch_chunk_hierarchy retry {attempt + 1}/{retries} (chunk={chunk_id[:8]}): {e}")
                await asyncio.sleep(wait)
            else:
                logger.error(f"patch_chunk_hierarchy failed: {e}")
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
        logger.error(f"Failed to search doc chunks: {e}")
        return []


async def get_doc_chunks_by_filter(
    hierarchy_h1: Optional[str] = None,
    hierarchy_h2: Optional[str] = None,
    hierarchy_h3: Optional[str] = None,
    filename: Optional[str] = None,
    document_id: Optional[str] = None,
    limit: int = 20,
    exclude_ids: Optional[list] = None,
) -> list:
    """metadata 필터 기반 doc_chunks 직접 조회 (vector similarity 없음).
    document_id: 지정 시 해당 업로드 버전 청크만 반환 (버전 격리).
    exclude_ids: anchor_ids coverage gap 보충 시 중복 제외용.
    """
    if not supabase:
        return []
    try:
        query = supabase.table("doc_chunks").select("id, content, metadata, document_id")
        if filename:
            query = query.eq("metadata->>filename", filename)
        if document_id:
            query = query.eq("document_id", document_id)
        if hierarchy_h1:
            query = query.eq("metadata->>hierarchy_h1", hierarchy_h1)
        if hierarchy_h2:
            query = query.eq("metadata->>hierarchy_h2", hierarchy_h2)
        if hierarchy_h3:
            query = query.eq("metadata->>hierarchy_h3", hierarchy_h3)
        if exclude_ids:
            query = query.not_.in_("id", exclude_ids)
        response = query.limit(limit).execute()
        return response.data if response.data else []
    except Exception as e:
        logger.error(f"Failed to get doc chunks by filter: {e}")
        return []


async def get_doc_chunks_sampled(
    filename: str,
    n: int = 30,
    document_id: Optional[str] = None,
) -> list:
    """
    문서 전체에서 균등 샘플링 (Supabase RPC: sample_doc_chunks).
    document_id 미지정 시 가장 최근 인제스천 자동 선택.
    """
    if not supabase:
        return []
    try:
        params = {"p_filename": filename, "p_n": n}
        if document_id:
            params["p_document_id"] = document_id
        response = supabase.rpc("sample_doc_chunks", params).execute()
        return response.data if response.data else []
    except Exception as e:
        logger.error(f"get_doc_chunks_sampled failed: {e}")
        return []


async def get_doc_chunks_by_ids(chunk_ids: list) -> list:
    """anchor_ids 목록으로 청크 정확 조회."""
    if not supabase or not chunk_ids:
        return []
    try:
        response = (
            supabase.table("doc_chunks")
            .select("id, content, metadata, document_id")
            .in_("id", chunk_ids)
            .execute()
        )
        return response.data if response.data else []
    except Exception as e:
        logger.error(f"get_doc_chunks_by_ids failed: {e}")
        return []


async def get_document_chunks(
    source_name: str,
    limit: int = 10,
    document_id: Optional[str] = None,
) -> list:
    """특정 문서의 청크 조회 (계층 구조 분석용).
    document_id 지정 시 해당 업로드 버전 청크만 반환.
    미지정 시 filename 기준 전체 조회 (하위 호환).
    """
    if not supabase:
        return []
    try:
        query = (
            supabase.table("doc_chunks")
            .select("id, content, metadata, document_id")
            .eq("metadata->>filename", source_name)
        )
        if document_id:
            query = query.eq("document_id", document_id)
        response = query.order("created_at").limit(limit).execute()
        return response.data if response.data else []
    except Exception as e:
        logger.error(f"Failed to get document chunks: {e}")
        return []
