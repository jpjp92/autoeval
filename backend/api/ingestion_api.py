"""
Ingestion API  —  POST /api/ingestion/*

문서(PDF/DOCX) 업로드 → 청킹 → Gemini Embedding 2 벡터화 → Supabase doc_chunks 저장
및 hierarchy(H1/H2/H3) 분석·태깅 엔드포인트를 제공한다.

엔드포인트
  POST /api/ingestion/upload                파일 수신 → extract_text_by_page → process_and_ingest
  POST /api/ingestion/analyze-hierarchy     H1 후보 도출 (Gemini)
  POST /api/ingestion/analyze-h2-h3        H2/H3 master 생성
  POST /api/ingestion/analyze-tagging-samples  태깅 샘플 미리보기
  POST /api/ingestion/apply-granular-tagging   청크별 hierarchy 일괄 적용
  GET  /api/ingestion/hierarchy-list        H1/H2/H3 고유 목록
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

import numpy as np
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from google import genai as google_genai
from pydantic import BaseModel

from config.supabase_client import (
    get_document_chunks,
    get_doc_chunks_sampled,
    get_hierarchy_list,
    is_supabase_available,
    save_doc_chunks_batch,
    update_chunk_metadata,
)
from ingestion.parsers import (
    build_context_prefix,
    build_sections,
    detect_chunk_type,
    detect_repeated_headers,
    extract_keywords,
    extract_text_by_page,
    is_toc_chunk,
    make_splitter,
    merge_adjacent_short_blocks,
    normalize_for_hash,
    remove_footer_noise,
    strip_redundant_headings,
    _is_colophon_chunk,
    _is_symbol_noise_chunk,
    _merge_short_chunks,
    _resolve_chunk_page,
)

logger = logging.getLogger("autoeval.ingestion")

router = APIRouter(prefix="/api/ingestion", tags=["ingestion"])

GEMINI_API_KEY = os.getenv("GOOGLE_API_KEY")
gemini_client = google_genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None


# ============================================================================
# Pydantic 모델
# ============================================================================

class IngestionResponse(BaseModel):
    success: bool
    message: str
    file_name: str = ""


class HierarchyAnalysisRequest(BaseModel):
    filename: str


class HierarchyAnalysisResponse(BaseModel):
    domain_analysis: str
    h1_candidates: List[str]
    h2_h3_master: Dict[str, Any]
    anchor_ids: Optional[List[str]] = None


class GranularTaggingRequest(BaseModel):
    filename: str
    selected_h1_list: List[str]
    h2_h3_master: Optional[Dict[str, Dict[str, List[str]]]] = None




# ============================================================================
# 핵심 처리 파이프라인 (Background Task)
# ============================================================================

async def process_and_ingest(filename: str, pages: List[Dict[str, Any]], metadata: Dict[str, Any]):
    """Section-First 청킹 → Gemini Embedding 2 → Supabase 저장."""
    try:
        if not gemini_client:
            logger.error("Gemini client not initialized.")
            return

        doc_id = str(uuid4())
        ingested_at = datetime.utcnow().isoformat()

        repeated_headers = detect_repeated_headers(pages)
        if repeated_headers:
            logger.info(f"[{filename}] Repeated headers: {list(repeated_headers)[:5]}")

        all_blocks = []
        for page_data in pages:
            all_blocks.extend(page_data.get("blocks", []))

        if not all_blocks:
            logger.warning(f"[{filename}] No blocks extracted.")
            return

        all_blocks_text = [b.get("text", "") for b in all_blocks]
        merged_blocks_data, _ = merge_adjacent_short_blocks(all_blocks, all_blocks_text)
        logger.info(f"[{filename}] Block merge: {len(all_blocks)} → {len(merged_blocks_data)}")
        all_blocks = merged_blocks_data

        sections = build_sections(all_blocks)
        logger.info(f"[{filename}] Sections built: {len(sections)}")
        if not sections:
            logger.warning(f"[{filename}] No sections built.")
            return

        splitter = make_splitter()
        section_stack: List[str] = []
        all_chunks_to_embed = []
        seen_hashes: set = set()
        _filter_counts = {"toc": 0, "colophon": 0, "symbol": 0, "too_short": 0, "duplicate": 0}

        for sec in sections:
            heading = sec["heading"]
            level = sec["level"]
            normalized_heading = heading.replace('\n', ' ').replace('  ', ' ').strip()

            if normalized_heading != "Root":
                section_stack = section_stack[:level - 1]
                section_stack.append(normalized_heading)

            section_path = " > ".join(section_stack) if section_stack else "Document"

            block_page_offsets = []
            section_text_parts = []
            cur_offset = 0
            for b in sec["blocks"]:
                b_text = b.get("text", "")
                block_page_offsets.append((cur_offset, b.get("page", sec["page"])))
                section_text_parts.append(b_text)
                cur_offset += len(b_text) + 1
            section_text = "\n".join(section_text_parts)

            raw_chunks = splitter.split_text(section_text)
            raw_chunks = _merge_short_chunks(raw_chunks, min_chars=200, max_chars=1200)

            for chunk_text in raw_chunks:
                stripped = chunk_text.lstrip()
                if stripped.startswith("|") and "---" in stripped and not stripped.startswith("[표]"):
                    chunk_text = "[표]\n" + stripped

                if is_toc_chunk(chunk_text):
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

                if len(chunk_text.strip()) < 50:
                    _filter_counts["too_short"] += 1
                    continue

                norm_text = normalize_for_hash(chunk_text)
                content_hash = hashlib.sha1(norm_text.encode('utf-8')).hexdigest()
                if content_hash in seen_hashes:
                    _filter_counts["duplicate"] += 1
                    continue
                seen_hashes.add(content_hash)

                context_prefix = build_context_prefix(filename, section_path, sec["page"])
                enriched_text = context_prefix + chunk_text
                keywords = extract_keywords(chunk_text)
                chunk_type = detect_chunk_type(chunk_text).lower()
                normalized_section_title = heading.replace('\n', ' ').replace('  ', ' ').strip()

                all_chunks_to_embed.append({
                    "text": enriched_text,
                    "raw_text": chunk_text,
                    "page": _resolve_chunk_page(chunk_text, section_text, block_page_offsets, sec["page"]),
                    "hash": content_hash,
                    "section_title": normalized_section_title,
                    "section_path": section_path,
                    "section_level": level,
                    "chunk_type": chunk_type,
                    "keywords": keywords,
                })

        logger.info(f"[{filename}] {len(all_chunks_to_embed)} chunks ready. Filtered — {_filter_counts}")

        if len(all_chunks_to_embed) == 0:
            logger.error(f"❌ [{filename}] 0 chunks produced. Filtered — {_filter_counts}")
            return

        batch_size = 64
        for i in range(0, len(all_chunks_to_embed), batch_size):
            batch = all_chunks_to_embed[i: i + batch_size]
            batch_texts = [item["text"] for item in batch]

            res = await gemini_client.aio.models.embed_content(
                model="gemini-embedding-2-preview",
                contents=batch_texts,
                config=google_genai.types.EmbedContentConfig(
                    task_type="RETRIEVAL_DOCUMENT",
                    output_dimensionality=1536,
                ),
            )

            batch_rows = []
            for idx, emb_data in enumerate(res.embeddings):
                c = batch[idx]
                embedding_np = np.array(emb_data.values)
                norm = np.linalg.norm(embedding_np)
                normalized_embedding = (embedding_np / norm).tolist() if norm > 0 else emb_data.values

                chunk_metadata = {
                    **metadata,
                    "document_id": doc_id,
                    "filename": filename,
                    "content_hash": c["hash"],
                    "section_title": c["section_title"],
                    "section_path": c["section_path"],
                    "section_level": c["section_level"],
                    "chunk_type": c["chunk_type"],
                    "keywords": c["keywords"],
                    "page": c["page"],
                    "char_length": len(c["raw_text"]),
                    "chunk_index": i + idx,
                    "total_chunks": len(all_chunks_to_embed),
                    "source": filename.split('.')[-1].lower() if '.' in filename else 'unknown',
                    "ingested_at": ingested_at,
                    "embedding_model": "gemini-embedding-2-preview",
                }

                batch_rows.append({
                    "content":   c["raw_text"],
                    "embedding": normalized_embedding,
                    "metadata":  chunk_metadata,
                })

            await save_doc_chunks_batch(batch_rows)
            logger.info(f"   Batch {i // batch_size + 1} done ({len(batch)} chunks).")

        logger.info(f"✅ Ingestion complete: {filename} ({len(all_chunks_to_embed)} chunks)")

    except Exception as e:
        logger.error(f"❌ Ingestion pipeline failed for {filename}: {e}", exc_info=True)


# ============================================================================
# 엔드포인트
# ============================================================================

@router.post("/upload", response_model=IngestionResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    hierarchy_h1: Optional[str] = Form(None),
    hierarchy_h2: Optional[str] = Form(None),
    hierarchy_h3: Optional[str] = Form(None),
):
    """문서 업로드 및 벡터화 인제스션 시작."""
    if not is_supabase_available():
        raise HTTPException(status_code=500, detail="Supabase 설정이 구성되지 않았습니다.")

    try:
        content_bytes = await file.read()
        pages = extract_text_by_page(content_bytes, file.filename)
        if not pages:
            raise HTTPException(status_code=400, detail="텍스트를 추출할 수 없거나 비어 있는 문서입니다.")

        ext_lower = file.filename.split('.')[-1].lower()
        if ext_lower == 'pdf':
            total_text = "".join(b.get("text", "") for p in pages for b in p.get("blocks", []))
            total_blocks = sum(len(p.get("blocks", [])) for p in pages)
            avg_chars = len(total_text) / max(total_blocks, 1)
            if len(total_text) < 300 or avg_chars < 5:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "PDF에서 텍스트를 추출할 수 없습니다. "
                        "이미지 기반 PDF이거나 커스텀 심볼 폰트를 사용하는 문서입니다."
                    ),
                )
        else:
            total_text = "".join(p.get("text", "") for p in pages)
            if len(total_text) < 100:
                raise HTTPException(status_code=400, detail="문서 내용이 비어 있거나 지원하지 않는 형식입니다.")

        metadata = {
            "hierarchy_h1": hierarchy_h1,
            "hierarchy_h2": hierarchy_h2,
            "hierarchy_h3": hierarchy_h3,
            "filename": file.filename,
        }
        background_tasks.add_task(process_and_ingest, file.filename, pages, metadata)

        return IngestionResponse(
            success=True,
            message="문서 업로드가 완료되었습니다. 백그라운드에서 벡터화 작업이 진행됩니다.",
            file_name=file.filename,
        )

    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/analyze-hierarchy", response_model=HierarchyAnalysisResponse)
async def analyze_hierarchy(request: HierarchyAnalysisRequest):
    """Pass 1+2 통합: 문서 샘플 → H1/H2/H3 master 한 번에 생성."""
    if not gemini_client:
        raise HTTPException(status_code=500, detail="Gemini client not initialized")

    # anchor 균등 샘플링 (30개) — 이후 도메인분석/QA생성에 재사용
    anchor_chunks = await get_doc_chunks_sampled(request.filename, n=30)
    if not anchor_chunks:
        raise HTTPException(status_code=404, detail=f"No chunks found for: {request.filename}")
    anchor_ids = [c["id"] for c in anchor_chunks]

    concatenated_text = "\n\n---\n\n".join(c["content"][:600] for c in anchor_chunks)

    prompt = f"""
<role>
You are an expert document classifier. Build a complete hierarchical taxonomy (H1/H2/H3) for the provided document.
</role>

<constraints>
- Identify exactly 3~5 distinct H1 domain categories covering the full document.
- For each H1, create 2~5 H2 sub-categories covering distinct content themes.
- For each H2, create 2~4 specific H3 leaf labels.
- All names in Korean (한국어), under 15 characters each.
- H1 must represent content themes or domains — NOT section titles or headings.
</constraints>

<context>
{concatenated_text[:18000]}
</context>

<task>
Return a JSON object with this exact structure:
{{
  "domain_analysis": "한 문장으로 문서 전체 성격 요약",
  "h2_h3_master": {{
    "H1명A": {{
      "H2명1": ["H3명1", "H3명2"],
      "H2명2": ["H3명1", "H3명2"]
    }},
    "H1명B": {{
      "H2명1": ["H3명1", "H3명2"]
    }}
  }}
}}
</task>
"""

    try:
        response = await gemini_client.aio.models.generate_content(
            model="gemini-3-flash-preview",
            contents=prompt,
            config=google_genai.types.GenerateContentConfig(response_mime_type="application/json"),
        )
        result = json.loads(response.text)
        if not isinstance(result.get("h2_h3_master"), dict):
            raise ValueError(f"Unexpected LLM response: {type(result.get('h2_h3_master'))}")
        h2_h3_master = result["h2_h3_master"]
        h1_candidates = list(h2_h3_master.keys())
        return HierarchyAnalysisResponse(
            domain_analysis=result.get("domain_analysis", ""),
            h1_candidates=h1_candidates,
            h2_h3_master=h2_h3_master,
            anchor_ids=anchor_ids,
        )
    except Exception as e:
        logger.error(f"❌ Hierarchy analysis failed: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")




@router.post("/apply-granular-tagging")
async def apply_granular_tagging(request: GranularTaggingRequest):
    """Pass 3: 청크별 hierarchy 일괄 적용 (동기 처리)."""
    logger.info(f"🚀 Granular Tagging: {request.filename}")

    async def run_tagging() -> list:
        all_chunks = await get_document_chunks(request.filename, limit=2000)
        if not all_chunks:
            return []

        batch_size = 5
        batches = [all_chunks[i: i + batch_size] for i in range(0, len(all_chunks), batch_size)]
        semaphore = asyncio.Semaphore(5)
        completed = 0
        samples_collected: list = []

        def _build_prompt(chunks_data: list) -> str:
            if request.h2_h3_master:
                return f"""
<role>
You are a strict document taxonomy classifier.
Select H1, H2, H3 values EXCLUSIVELY from master_hierarchy. Do NOT generate new values.
</role>

<constraints>
- H1: select ONE from top-level keys of master_hierarchy
- H2: select ONE from H2 keys under selected H1
- H3: select ONE from H3 list under selected H2
</constraints>

<master_hierarchy>
{json.dumps(request.h2_h3_master, ensure_ascii=False, indent=2)}
</master_hierarchy>

<chunks>
{json.dumps(chunks_data, ensure_ascii=False)}
</chunks>

<task>
Return ONLY a JSON array — no explanation:
[{{ "idx": 0, "hierarchy": {{ "h1": "...", "h2": "...", "h3": "..." }} }}]
</task>
"""
            else:
                return f"""
<role>You are a document taxonomy classifier.</role>

<constraints>
- H1: select ONE from h1_master
- H2/H3: Korean, under 15 characters each
</constraints>

<h1_master>
{json.dumps(request.selected_h1_list, ensure_ascii=False)}
</h1_master>

<chunks>
{json.dumps(chunks_data, ensure_ascii=False)}
</chunks>

<task>
Return ONLY a JSON array — no explanation:
[{{ "idx": 0, "hierarchy": {{ "h1": "...", "h2": "...", "h3": "..." }} }}]
</task>
"""

        async def process_batch(batch_idx: int, batch: list):
            nonlocal completed
            async with semaphore:
                def _make_chunk_entry(i: int, c: dict) -> dict:
                    entry = {"idx": i, "content": c["content"][:800]}
                    meta = c.get("metadata") or {}
                    sp = (meta.get("section_path") or "").strip()
                    st = (meta.get("section_title") or "").strip()
                    if sp:
                        entry["section_path"] = sp
                    if st:
                        entry["section_title"] = st
                    return entry
                chunks_data = [_make_chunk_entry(i, c) for i, c in enumerate(batch)]
                try:
                    res = await gemini_client.aio.models.generate_content(
                        model="gemini-3-flash-preview",
                        contents=_build_prompt(chunks_data),
                        config=google_genai.types.GenerateContentConfig(response_mime_type="application/json"),
                    )
                    tagging_results = json.loads(res.text)

                    update_tasks = []
                    matched = 0
                    for item in tagging_results:
                        idx = item.get("idx")
                        h = item.get("hierarchy", {})
                        if idx is None or not isinstance(idx, int) or idx >= len(batch):
                            continue
                        target = batch[idx]
                        meta = {
                            **target.get("metadata", {}),
                            "hierarchy_h1": h.get("h1"),
                            "hierarchy_h2": h.get("h2"),
                            "hierarchy_h3": h.get("h3"),
                        }
                        update_tasks.append(update_chunk_metadata(target["id"], meta))
                        matched += 1
                        if len(samples_collected) < 5:
                            samples_collected.append({
                                "id": target["id"],
                                "content_preview": target["content"][:150] + "...",
                                "hierarchy": h,
                            })

                    if update_tasks:
                        await asyncio.gather(*update_tasks)

                    completed += 1
                    logger.info(f"✅ Batch {batch_idx + 1}/{len(batches)} tagged ({matched} updated)")
                except Exception as e:
                    logger.error(f"❌ Batch {batch_idx + 1} error: {e}")

        await asyncio.gather(*[process_batch(i, b) for i, b in enumerate(batches)])
        logger.info(f"🏁 Tagging done: {request.filename} ({completed}/{len(batches)} batches)")
        return samples_collected

    samples = await run_tagging()
    return {"success": True, "message": f"Granular tagging completed for {request.filename}.", "samples": samples}


@router.get("/hierarchy-list")
async def get_hierarchy_list_endpoint(filename: str = None):
    """doc_chunks H1/H2/H3 고유 목록 (프론트엔드 드롭다운용)."""
    if not is_supabase_available():
        return {"success": False, "h1_list": [], "h2_by_h1": {}, "message": "Supabase not available"}
    result = await get_hierarchy_list(filename=filename)
    return {"success": True, **result}


def setup_ingestion_routes(app):
    app.include_router(router)
