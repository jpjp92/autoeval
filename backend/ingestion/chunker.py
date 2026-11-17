"""
ingestion/chunker.py

청킹 로직 모음:
  - LLM 청킹 경로  : _ingest_with_llm_chunking()
  - Rule-based 경로: _ingest_with_rule_chunking()
  - 필터 유틸      : _TOC_BLOCK_RE, _is_docx_noise_block()
"""

from __future__ import annotations

import hashlib
import logging
import re
from typing import Any, Dict, List

from ingestion.llm_chunker import run_llm_chunking, run_llm_chunking_docx
from ingestion.parsers import (
    build_context_prefix,
    build_sections,
    chunk_blocks_aware,
    detect_chunk_type,
    is_toc_chunk,
    merge_adjacent_short_blocks,
    normalize_for_hash,
    remove_footer_noise,
    split_large_table_text,
    strip_redundant_headings,
    _is_colophon_chunk,
    _is_symbol_noise_chunk,
    _merge_short_chunks,
    _resolve_chunk_page,
)

logger = logging.getLogger("autoeval.ingestion.chunker")

# TOC 블록 감지 정규식
_TOC_BLOCK_RE = re.compile(
    r'[·]{3,}'                       # 가운뎃점 점선 TOC
    r'|(?:\.{4,})\s*\d+\s*$'         # 마침표 점선 + 숫자
    r'|[가-힣\?)\]】』]\d{1,3}\s*$'  # 점선 없는 TOC 페이지 참조 ("요약 및 정리66")
)


def _is_docx_noise_block(text: str) -> bool:
    """DOCX 커버/장식 요소에서 잘못 추출된 노이즈 블록 감지."""
    if len(text) <= 15:
        meaningful = len(re.findall(r'[가-힣a-zA-Z0-9]', text))
        if meaningful / max(len(text), 1) < 0.3:
            return True
    # 영문 1-2자 + 기호 + 한글 조합 (로고/워터마크 OCR 잔여물)
    if len(text) <= 12 and re.match(r'^[A-Za-z]{1,2}[)（\]】]', text):
        return True
    return False


def _split_verbatim_tables(blocks: List[Dict[str, Any]]) -> tuple:
    """큰 표 블록을 LLM 입력에서 빼고, 머리글을 붙인 조각을 그대로 청크로 만든다.

    큰 표를 LLM이 산문으로 풀면 수치의 절반 이상이 빠지고 값이 다른 행에 붙는다
    (2026-11-17 보도자료 PDF 실측). TABLE_SPLIT_MAX_CHARS 이하 표는 기존처럼 LLM에 넘긴다.

    Returns: (llm_blocks, table_chunks) — 둘 다 같은 index 공간을 쓴다.
    """
    llm_blocks: List[Dict[str, Any]] = []
    table_chunks: List[Dict[str, Any]] = []
    prev_text = ""
    for b in blocks:
        text = b["text"]
        parts = split_large_table_text(text)
        if len(parts) == 1:
            llm_blocks.append({**b, "index": len(llm_blocks) + len(table_chunks)})
        else:
            # 바로 앞 블록이 짧으면 표 제목으로 보고 각 조각 첫 줄에 넣는다(조각만 봐도 무슨 표인지 알 수 있게).
            prev = re.sub(r"\[\s*\]", "", prev_text).strip()
            caption = prev if prev and len(prev) <= 40 and "\n" not in prev else ""
            for k, part in enumerate(parts, 1):
                idx = len(llm_blocks) + len(table_chunks)
                label = f"{caption} ({k}/{len(parts)})" if caption else f"({k}/{len(parts)})"
                part = part.replace(f"[표] ({k}/{len(parts)})", f"[표] {label}", 1)
                table_chunks.append({
                    "text": part,
                    "section_title": label if caption else f"[표] {label}",
                    "source_blocks": [idx],
                    "page": b.get("page", 1),
                    "table_verbatim": True,
                })
        prev_text = text
    return llm_blocks, table_chunks


def _merge_by_source_order(llm_chunks: List[Dict[str, Any]], table_chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """LLM 청크와 원문 표 청크를 원래 블록 순서대로 합친다."""
    merged = sorted(
        llm_chunks + table_chunks,
        key=lambda c: min(c.get("source_blocks") or [10 ** 9]),
    )
    for i, c in enumerate(merged):
        c["chunk_index"] = i
    return merged


def ingest_with_table_chunking(
    filename: str,
    all_blocks: List[Dict[str, Any]],
    language: str = "ko",
) -> List[Dict[str, Any]]:
    """표 전용 청킹 (xlsx·xlsm·csv). LLM을 쓰지 않고 표를 머리글 반복 조각으로 나눈다.

    블록 첫 줄 "[표] 시트 · 제목" 을 각 조각의 제목으로 유지한다: "[표] 시트 · 제목 (2/5)".
    """
    chunks: List[Dict[str, Any]] = []
    seen: set = set()
    for b in all_blocks:
        text = (b.get("text") or "").strip()
        if not text:
            continue
        if not text.startswith("[표]"):
            parts, label = [text], ""
        else:
            first, _, rest = text.partition("\n")
            label = first[len("[표]"):].strip()
            parts = split_large_table_text("[표]\n" + rest)
            n = len(parts)
            parts = [
                p.replace(f"[표] ({k}/{n})", f"[표] {label} ({k}/{n})".replace("  ", " "), 1) if n > 1
                else p.replace("[표]", f"[표] {label}".rstrip(), 1)
                for k, p in enumerate(parts, 1)
            ]
        for k, part in enumerate(parts, 1):
            content_hash = hashlib.sha1(normalize_for_hash(part).encode("utf-8")).hexdigest()
            if content_hash in seen:
                continue
            seen.add(content_hash)
            title = (f"{label} ({k}/{len(parts)})" if len(parts) > 1 else label) or part.split("\n")[0][:30]
            chunks.append({
                "text": part,
                "raw_text": part,
                "page": b.get("page", 1),
                "hash": content_hash,
                "section_title": title,
                "chunk_type": "table" if part.startswith("[표]") else "body",
                "source_language": language,
                "fallback_reason": None,
                "sheet": b.get("sheet"),
            })
    logger.info(f"[{filename}] Table chunking ({language}): {len(chunks)} chunks from {len(all_blocks)} blocks")
    return chunks


async def ingest_with_llm_chunking(
    filename: str,
    pages: List[Dict[str, Any]],
    all_blocks: List[Dict[str, Any]],
    repeated_headers: set,
    gemini_client: Any,
    model_id: str,
    language: str = "ko",
) -> List[Dict[str, Any]]:
    """LLM 청킹 경로: 파일 확장자에 따라 PDF/DOCX 전용 함수로 분기 후 공통 필터 적용.

    language: 문서 언어("ko" | "en"). 프롬프트 선택과 청크 metadata(source_language)에 쓴다.
    """
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    is_docx = ext in ("doc", "docx")

    if is_docx:
        indexed_blocks = []
        for b in all_blocks:
            text = b.get("text", "").strip()
            if not text:
                continue
            if _is_docx_noise_block(text):
                continue
            if _TOC_BLOCK_RE.search(text) or is_toc_chunk(text, language):
                continue
            indexed_blocks.append({
                "index": len(indexed_blocks),
                "page": b.get("page", 1),
                "text": text,
            })
        indexed_blocks, table_chunks = _split_verbatim_tables(indexed_blocks)
        chunks = await run_llm_chunking_docx(
            blocks=indexed_blocks,
            client=gemini_client,
            model=model_id,
            language=language,
        )
        chunks = _merge_by_source_order(chunks, table_chunks)
    else:
        page_count = max((p.get("page", 1) for p in pages), default=1)
        indexed_blocks, table_chunks = _split_verbatim_tables([
            {"page": b.get("page", 1), "text": b.get("text", "").strip()}
            for b in all_blocks
            if b.get("text", "").strip()
        ])
        chunks = await run_llm_chunking(
            blocks=indexed_blocks,
            client=gemini_client,
            model=model_id,
            page_count=page_count,
            language=language,
        )
        chunks = _merge_by_source_order(chunks, table_chunks)

    all_chunks_to_embed = []
    seen_hashes: set = set()
    _filter_counts = {"toc": 0, "colophon": 0, "symbol": 0, "too_short": 0, "duplicate": 0}

    for chunk in chunks:
        chunk_text = chunk.get("text", "").strip()
        if not chunk_text:
            continue

        chunk_text = remove_footer_noise(chunk_text, repeated_headers)

        if is_toc_chunk(chunk_text, language):
            _filter_counts["toc"] += 1
            continue
        if _is_colophon_chunk(chunk_text):
            _filter_counts["colophon"] += 1
            continue
        if _is_symbol_noise_chunk(chunk_text):
            _filter_counts["symbol"] += 1
            continue
        if len(chunk_text) < 60:
            _filter_counts["too_short"] += 1
            continue

        norm_text = normalize_for_hash(chunk_text)
        content_hash = hashlib.sha1(norm_text.encode("utf-8")).hexdigest()
        if content_hash in seen_hashes:
            _filter_counts["duplicate"] += 1
            continue
        seen_hashes.add(content_hash)

        chunk_type = detect_chunk_type(chunk_text).lower()
        section_title = chunk.get("section_title", "") or chunk_text.split("\n")[0].strip()[:30]

        all_chunks_to_embed.append({
            "text": chunk_text,
            "raw_text": chunk_text,
            "page": chunk.get("page", 1),
            "hash": content_hash,
            "section_title": section_title,
            "chunk_type": chunk_type,
            "source_language": language,
            "fallback_reason": chunk.get("fallback_reason") if chunk.get("fallback") else None,
        })

    _fallbacks = sum(1 for c in all_chunks_to_embed if c["fallback_reason"])
    method_tag = "docx" if is_docx else "pdf"
    logger.info(
        f"[{filename}] LLM chunking ({method_tag}, {language}): {len(all_chunks_to_embed)} chunks, "
        f"fallback {_fallbacks}. "
        f"Filtered: {_filter_counts}"
    )
    return all_chunks_to_embed


def ingest_with_rule_chunking(
    filename: str,
    all_blocks: List[Dict[str, Any]],
    repeated_headers: set,
    language: str = "ko",
) -> List[Dict[str, Any]]:
    """Rule-based 청킹 경로 (기존 파이프라인, 하위 호환).

    language: 문서 언어("ko" | "en"). 영문 섹션 제목 감지와 청크 metadata에 쓴다.
    """
    all_blocks_text = [b.get("text", "") for b in all_blocks]
    merged_blocks_data, _ = merge_adjacent_short_blocks(all_blocks, all_blocks_text)
    logger.info(f"[{filename}] Block merge: {len(all_blocks)} → {len(merged_blocks_data)}")

    sections = build_sections(merged_blocks_data, language=language)
    logger.info(f"[{filename}] Sections built: {len(sections)}")
    if not sections:
        logger.warning(f"[{filename}] No sections built.")
        return []

    section_stack: List[str] = []
    all_chunks_to_embed = []
    seen_hashes: set = set()
    _filter_counts = {"toc": 0, "colophon": 0, "symbol": 0, "too_short": 0, "duplicate": 0}
    _law_title_re = re.compile(r'^(제\d+조(?:의\d+)?(?:\([^)]{1,30}\))?)')

    for sec in sections:
        heading = sec["heading"]
        level = sec["level"]
        normalized_heading = heading.replace('\n', ' ').replace('  ', ' ').strip()

        if normalized_heading != "Root":
            section_stack = section_stack[:level - 1]
            section_stack.append(normalized_heading)

        block_page_offsets = []
        section_text_parts = []
        cur_offset = 0
        for b in sec["blocks"]:
            b_text = b.get("text", "")
            block_page_offsets.append((cur_offset, b.get("page", sec["page"])))
            section_text_parts.append(b_text)
            cur_offset += len(b_text) + 1
        section_text = "\n".join(section_text_parts)

        raw_chunks = chunk_blocks_aware(sec["blocks"])
        raw_chunks = _merge_short_chunks(raw_chunks, min_chars=300, max_chars=1200)

        for chunk_text in raw_chunks:
            stripped = chunk_text.lstrip()
            if stripped.startswith("|") and "---" in stripped and not stripped.startswith("[표]"):
                chunk_text = "[표]\n" + stripped

            if is_toc_chunk(chunk_text, language):
                _filter_counts["toc"] += 1
                continue
            if _is_colophon_chunk(chunk_text):
                _filter_counts["colophon"] += 1
                continue
            if _is_symbol_noise_chunk(chunk_text):
                _filter_counts["symbol"] += 1
                continue

            chunk_text = remove_footer_noise(chunk_text, repeated_headers)
            chunk_text = strip_redundant_headings(chunk_text, heading)

            if len(chunk_text.strip()) < 60:
                _filter_counts["too_short"] += 1
                continue

            norm_text = normalize_for_hash(chunk_text)
            content_hash = hashlib.sha1(norm_text.encode('utf-8')).hexdigest()
            if content_hash in seen_hashes:
                _filter_counts["duplicate"] += 1
                continue
            seen_hashes.add(content_hash)

            chunk_type = detect_chunk_type(chunk_text).lower()
            normalized_section_title = heading.replace('\n', ' ').replace('  ', ' ').strip()
            _m = _law_title_re.match(normalized_section_title)
            prefix_title = _m.group(1) if _m else normalized_section_title
            context_prefix = build_context_prefix(filename, prefix_title, sec["page"])
            enriched_text = context_prefix + chunk_text

            all_chunks_to_embed.append({
                "text": enriched_text,
                "raw_text": chunk_text,
                "page": _resolve_chunk_page(chunk_text, section_text, block_page_offsets, sec["page"]),
                "hash": content_hash,
                "section_title": normalized_section_title,
                "chunk_type": chunk_type,
                "source_language": language,
                "fallback_reason": None,
            })

    too_short_samples = _filter_counts.pop("_too_short_samples", [])
    logger.info(
        f"[{filename}] Rule chunking ({language}): {len(all_chunks_to_embed)} chunks. "
        f"Filtered: {_filter_counts}"
    )
    if too_short_samples:
        logger.info(f"[{filename}] too_short samples: {too_short_samples}")
    return all_chunks_to_embed
