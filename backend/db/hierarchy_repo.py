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
    doc_chunks에서 hierarchy_l1, l2, l3 고유값 목록 반환.
    filename 지정 시 해당 문서 청크만 대상으로 조회.

    Returns:
        {
            "l1_list": [...],
            "l2_by_l1": { "l1": ["l2", ...], ... },
            "l3_by_l1_l2": { "l1__l2": ["l3", ...], ... }
        }
    """
    if not supabase:
        return {"l1_list": [], "l2_by_l1": {}, "l3_by_l1_l2": {}}

    try:
        query = supabase.table("doc_chunks").select("metadata")
        if filename:
            query = query.eq("metadata->>filename", filename)
        response = query.execute()
        chunks = response.data or []

        l2_by_l1: Dict[str, set] = {}
        l3_by_l1_l2: Dict[str, set] = {}
        for chunk in chunks:
            meta = chunk.get("metadata", {})
            l1 = meta.get("hierarchy_l1")
            l2 = meta.get("hierarchy_l2")
            l3 = meta.get("hierarchy_l3")
            if l1:
                if l1 not in l2_by_l1:
                    l2_by_l1[l1] = set()
                if l2:
                    l2_by_l1[l1].add(l2)
                    if l3:
                        key = f"{l1}__{l2}"
                        if key not in l3_by_l1_l2:
                            l3_by_l1_l2[key] = set()
                        l3_by_l1_l2[key].add(l3)

        return {
            "l1_list": sorted(l2_by_l1.keys()),
            "l2_by_l1": {k: sorted(v) for k, v in l2_by_l1.items()},
            "l3_by_l1_l2": {k: sorted(v) for k, v in l3_by_l1_l2.items()},
        }
    except Exception as e:
        logger.error(f"❌ Failed to get hierarchy list: {e}")
        return {"l1_list": [], "l2_by_l1": {}, "l3_by_l1_l2": {}}


async def update_document_hierarchy(source_name: str, l1: str, l2: str, l3: str) -> bool:
    """특정 문서에 속한 모든 청크의 계층 정보(L1/L2/L3)를 업데이트"""
    if not supabase:
        return False

    try:
        chunks = await get_document_chunks(source_name, limit=1000)
        if not chunks:
            return False

        for chunk in chunks:
            current_metadata = chunk.get("metadata", {})
            current_metadata.update({
                "hierarchy_l1": l1,
                "hierarchy_l2": l2,
                "hierarchy_l3": l3,
            })
            supabase.table("doc_chunks").update({"metadata": current_metadata}).eq("id", chunk["id"]).execute()

        return True
    except Exception as e:
        logger.error(f"❌ Failed to update document hierarchy: {e}")
        return False
