"""
계층 구조 조회/업데이트 (doc_chunks hierarchy)
"""

import logging
from typing import Dict, Any, Optional

from .base_client import supabase
from .doc_chunk_repo import get_document_chunks

logger = logging.getLogger("autoeval.db")


# QA 생성에 필요한 최소 청크 수 — 이 값 미만의 h3/h2는 드롭다운에 노출하지 않음
# 법률 문서처럼 조문 단위 청크(1개/조문)가 많은 문서도 카테고리 표시 가능하도록 1로 설정
MIN_CHUNKS_FOR_QA = 1
# QA 생성에 필요한 최소 콘텐츠 길이(자) — 노드 내 총 텍스트가 이 값 미만이면 드롭다운에서 제외
MIN_CONTENT_CHARS = 300


async def get_hierarchy_list(filename: Optional[str] = None, filter_for_qa: bool = True) -> Dict[str, Any]:
    """
    doc_chunks에서 hierarchy_h1, h2, h3 고유값 목록 반환.
    filename 지정 시 해당 문서 청크만 대상으로 조회.

    filter_for_qa=True (기본): QA 생성 드롭다운용 — MIN_CHUNKS_FOR_QA + MIN_CONTENT_CHARS 필터 적용
    filter_for_qa=False       : 표시용 (Documents 카테고리 구조 트리) — 필터 없이 태깅된 노드 전부 반환

    QA 생성에 충분하지 않은 계층(청크 수 < MIN_CHUNKS_FOR_QA)은 제외.
    - h3: 해당 (h1, h2, h3) 조합의 청크 수가 MIN_CHUNKS_FOR_QA 미만이면 제외
    - h2: 유효한 h3가 없고 (h1, h2) 조합의 총 청크 수도 MIN_CHUNKS_FOR_QA 미만이면 제외
    - h1: 유효한 h2가 하나도 없으면 제외

    MIN_CHUNKS_FOR_QA=2: 1청크 단독 노드는 제외하되, 소규모 문서(13청크/4H1 등)도
    대부분의 계층이 표시될 수 있도록 임계값을 낮게 유지.

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
        query = supabase.table("doc_chunks").select("metadata, document_id")
        if filename:
            query = query.eq("metadata->>filename", filename)
        response = query.execute()
        chunks = response.data or []

        # filename별 최신 document_id만 사용 (재인제스션 시 구버전 H1 누적 방지)
        latest_doc_ids: dict[str, tuple[str, str]] = {}  # filename → (document_id, ingested_at)
        for chunk in chunks:
            meta = chunk.get("metadata", {})
            fn = meta.get("filename", "")
            did = chunk.get("document_id") or meta.get("document_id", "")
            iat = meta.get("ingested_at", "")
            if fn and did:
                prev = latest_doc_ids.get(fn)
                if prev is None or iat > prev[1]:
                    latest_doc_ids[fn] = (did, iat)
        latest_ids = {v[0] for v in latest_doc_ids.values()}
        if latest_ids:
            chunks = [
                c for c in chunks
                if (c.get("document_id") or c.get("metadata", {}).get("document_id")) in latest_ids
            ]

        # 1단계: (h1, h2, h3) / (h1, h2) 단위 청크 수 및 콘텐츠 길이 집계
        from collections import defaultdict
        h3_counts: Dict[tuple, int] = defaultdict(int)   # (h1, h2, h3) → count
        h2_counts: Dict[tuple, int] = defaultdict(int)   # (h1, h2)      → count
        h3_chars:  Dict[tuple, int] = defaultdict(int)   # (h1, h2, h3) → total chars
        h2_chars:  Dict[tuple, int] = defaultdict(int)   # (h1, h2)      → total chars
        admin_count = 0

        for chunk in chunks:
            meta    = chunk.get("metadata", {})
            content = chunk.get("content", "") or ""
            h1 = meta.get("hierarchy_h1")
            h2 = meta.get("hierarchy_h2")
            h3 = meta.get("hierarchy_h3")
            if not h1:
                continue
            if h1 == "__admin__":
                admin_count += 1
                continue
            if h2 and h2 != "__admin__":
                h2_counts[(h1, h2)] += 1
                h2_chars[(h1, h2)]  += len(content)
                if h3 and h3 != "__admin__":
                    h3_counts[(h1, h2, h3)] += 1
                    h3_chars[(h1, h2, h3)]  += len(content)

        if admin_count:
            logger.info(f"Admin chunks excluded from hierarchy list: {admin_count} (filename={filename!r})")

        # 2단계: 계층 수집 (filter_for_qa 여부에 따라 필터 적용/스킵)
        h2_by_h1: Dict[str, set] = {}
        h3_by_h1_h2: Dict[str, set] = {}
        filtered_h3_total = 0

        for (h1, h2, h3), cnt in h3_counts.items():
            chars = h3_chars[(h1, h2, h3)]
            if filter_for_qa and (cnt < MIN_CHUNKS_FOR_QA or chars < MIN_CONTENT_CHARS):
                logger.debug(
                    f"h3 excluded (chunks={cnt}, chars={chars}): {h1} > {h2} > {h3}"
                )
                filtered_h3_total += 1
                continue
            if h1 not in h2_by_h1:
                h2_by_h1[h1] = set()
            h2_by_h1[h1].add(h2)
            key = f"{h1}__{h2}"
            if key not in h3_by_h1_h2:
                h3_by_h1_h2[key] = set()
            h3_by_h1_h2[key].add(h3)

        # h3가 없더라도 h2 레벨이 존재하면 h2 유지
        # filter_for_qa=True: 청크 수·길이 조건 모두 충족해야 노출
        # filter_for_qa=False: 청크가 1개라도 있으면 노출
        for (h1, h2), cnt in h2_counts.items():
            chars = h2_chars[(h1, h2)]
            if h1 not in h2_by_h1:
                h2_by_h1[h1] = set()
            qa_ok = (cnt >= MIN_CHUNKS_FOR_QA and chars >= MIN_CONTENT_CHARS)
            if not filter_for_qa or qa_ok:
                h2_by_h1[h1].add(h2)

        # h2가 하나도 없는 h1 제거
        h2_by_h1 = {h1: v for h1, v in h2_by_h1.items() if v}

        if filter_for_qa and filtered_h3_total:
            logger.info(
                f"Hierarchy filtered: {filtered_h3_total} h3 node(s) excluded "
                f"(chunk count < {MIN_CHUNKS_FOR_QA} or chars < {MIN_CONTENT_CHARS}) "
                f"(filename={filename!r})"
            )

        return {
            "h1_list": sorted(h2_by_h1.keys()),
            "h2_by_h1": {k: sorted(v) for k, v in h2_by_h1.items()},
            "h3_by_h1_h2": {k: sorted(v) for k, v in h3_by_h1_h2.items()},
        }
    except Exception as e:
        logger.error(f"Failed to get hierarchy list: {e}")
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
        logger.error(f"Failed to update document hierarchy: {e}")
        return False
