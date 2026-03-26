"""
계층 구조 조회/업데이트 (doc_chunks hierarchy)
"""

import logging
from typing import Dict, Any, Optional

from .base_client import supabase
from .doc_chunk_repo import get_document_chunks

logger = logging.getLogger("autoeval.db")


async def get_hierarchy_list(filename: Optional[str] = None) -> Dict[str, Any]:
    """
    doc_chunks에서 hierarchy_h1, h2, h3 고유값 목록 반환.
    filename 지정 시 해당 문서 청크만 대상으로 조회.

    Returns:
        {
            "h1_list": [...],
            "h2_by_h1": { "h1": ["h2", ...], ... },
            "h3_by_h1_h2": { "h1__h2": ["h3", ...], ... }
        }
    """
    if not supabase:
        return {"h1_list": [], "h2_by_h1": {}, "h3_by_h1_h2": {}}

    try:
        query = supabase.table("doc_chunks").select("metadata")
        if filename:
            query = query.eq("metadata->>filename", filename)
        response = query.execute()
        chunks = response.data or []

        # filename별 최신 document_id만 사용 (재인제스션 시 구버전 H1 누적 방지)
        latest_doc_ids: dict[str, tuple[str, str]] = {}  # filename → (document_id, ingested_at)
        for chunk in chunks:
            meta = chunk.get("metadata", {})
            fn = meta.get("filename", "")
            did = meta.get("document_id", "")
            iat = meta.get("ingested_at", "")
            if fn and did:
                prev = latest_doc_ids.get(fn)
                if prev is None or iat > prev[1]:
                    latest_doc_ids[fn] = (did, iat)
        latest_ids = {v[0] for v in latest_doc_ids.values()}
        if latest_ids:
            chunks = [c for c in chunks if c.get("metadata", {}).get("document_id") in latest_ids]

        h2_by_h1: Dict[str, set] = {}
        h3_by_h1_h2: Dict[str, set] = {}
        admin_count = 0
        for chunk in chunks:
            meta = chunk.get("metadata", {})
            h1 = meta.get("hierarchy_h1")
            h2 = meta.get("hierarchy_h2")
            h3 = meta.get("hierarchy_h3")
            if not h1:
                continue
            if h1 == "__admin__":
                admin_count += 1
                continue
            if h1 not in h2_by_h1:
                h2_by_h1[h1] = set()
            if h2 and h2 != "__admin__":
                h2_by_h1[h1].add(h2)
                if h3 and h3 != "__admin__":
                    key = f"{h1}__{h2}"
                    if key not in h3_by_h1_h2:
                        h3_by_h1_h2[key] = set()
                    h3_by_h1_h2[key].add(h3)

        if admin_count:
            logger.info(f"⏭️ __admin__ chunks excluded from hierarchy list: {admin_count} (filename={filename!r})")

        return {
            "h1_list": sorted(h2_by_h1.keys()),
            "h2_by_h1": {k: sorted(v) for k, v in h2_by_h1.items()},
            "h3_by_h1_h2": {k: sorted(v) for k, v in h3_by_h1_h2.items()},
        }
    except Exception as e:
        logger.error(f"❌ Failed to get hierarchy list: {e}")
        return {"h1_list": [], "h2_by_h1": {}, "h3_by_h1_h2": {}}


async def update_document_hierarchy(source_name: str, h1: str, h2: str, h3: str) -> bool:
    """특정 문서에 속한 모든 청크의 계층 정보(H1/H2/H3)를 업데이트"""
    if not supabase:
        return False

    try:
        chunks = await get_document_chunks(source_name, limit=1000)
        if not chunks:
            return False

        for chunk in chunks:
            current_metadata = chunk.get("metadata", {})
            current_metadata.update({
                "hierarchy_h1": h1,
                "hierarchy_h2": h2,
                "hierarchy_h3": h3,
            })
            supabase.table("doc_chunks").update({"metadata": current_metadata}).eq("id", chunk["id"]).execute()

        return True
    except Exception as e:
        logger.error(f"❌ Failed to update document hierarchy: {e}")
        return False
