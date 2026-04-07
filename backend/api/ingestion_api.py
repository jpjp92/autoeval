"""
Ingestion API  —  /api/ingestion/*

문서(PDF/DOCX) 업로드 → 청킹 → Gemini Embedding 2 벡터화 → Supabase doc_chunks 저장
및 hierarchy(H1/H2/H3) 분석·태깅 엔드포인트를 제공한다.

엔드포인트
  POST /upload                 파일 수신 → 텍스트 추출 → 청킹 → 임베딩 → DB 저장
  POST /analyze-hierarchy      문서 샘플 기반 H1/H2/H3 master + domain_profile 생성
  POST /analyze-tagging-samples  기존 태깅 결과 샘플 5개 반환 (미리보기용)
  POST /apply-granular-tagging   청크별 hierarchy 일괄 태깅 적용
  GET  /hierarchy-list         H1/H2/H3 고유 목록 (QA 생성용 / 표시용 필터 분리)

모듈 구조
  ingestion/prompts.py   — LLM 프롬프트 빌더
  ingestion/tagging.py   — 배치 태깅 코루틴, 행정 메타 청크 감지
  ingestion/chunker.py   — LLM/Rule-based 청킹 로직
  ingestion/pipeline.py  — 임베딩 → Supabase 저장 파이프라인
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from google import genai as google_genai
from pydantic import BaseModel

import asyncio

from config.models import MODEL_CONFIG
from config.supabase_client import (
    get_document_chunks,
    get_doc_chunks_sampled,
    get_hierarchy_list,
    is_supabase_available,
    patch_chunk_hierarchy,
)
from db.doc_metadata_repo import upsert_doc_metadata
from ingestion.parsers import extract_text_by_page
from ingestion.pipeline import process_and_ingest
from ingestion.prompts import build_hierarchy_prompt
from ingestion.tagging import _is_admin_anchor, run_tagging

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
    success: bool = True
    domain_analysis: str
    h1_candidates: List[str]
    h2_h3_master: Dict[str, Any]
    domain_profile: Optional[Dict[str, Any]] = None
    document_id: Optional[str] = None


class GranularTaggingRequest(BaseModel):
    filename: str
    selected_h1_list: List[str]
    h2_h3_master: Optional[Dict[str, Dict[str, List[str]]]] = None
    document_id: Optional[str] = None


class TaggingSamplesRequest(BaseModel):
    filename: str
    selected_h1_list: List[str]


# ============================================================================
# 엔드포인트
# ============================================================================

@router.post("/upload", response_model=IngestionResponse)
async def upload_document(
    file: UploadFile = File(...),
    hierarchy_h1: Optional[str] = Form(None),
    hierarchy_h2: Optional[str] = Form(None),
    hierarchy_h3: Optional[str] = Form(None),
    chunking_method: str = Form("llm"),
):
    """문서 업로드 및 벡터화 인제스션 (동기 — 완료 후 응답).

    chunking_method: "llm" (기본) | "rule"
    """
    if not is_supabase_available():
        raise HTTPException(status_code=500, detail="Supabase 설정이 구성되지 않았습니다.")
    if not gemini_client:
        raise HTTPException(status_code=500, detail="Gemini client not initialized")

    try:
        content_bytes = await file.read()
        pages = await asyncio.to_thread(extract_text_by_page, content_bytes, file.filename)
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
        await process_and_ingest(
            file.filename,
            pages,
            metadata,
            gemini_client=gemini_client,
            model_id=MODEL_CONFIG["gemini-flash"]["model_id"],
            chunking_method=chunking_method,
        )

        return IngestionResponse(
            success=True,
            message="문서 업로드 및 벡터화가 완료되었습니다.",
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

    anchor_chunks = await get_doc_chunks_sampled(request.filename, n=40)
    if not anchor_chunks:
        raise HTTPException(status_code=404, detail=f"No chunks found for: {request.filename}")

    filtered = [c for c in anchor_chunks if not _is_admin_anchor(c["content"])]
    if len(filtered) < 10:
        filtered = anchor_chunks
    anchor_chunks = filtered[:30]

    per_chunk_limit = max(400, 20000 // len(anchor_chunks))
    concatenated_text = "\n\n---\n\n".join(c["content"][:per_chunk_limit] for c in anchor_chunks)

    total_chunks = len(anchor_chunks)
    h2_guide = "2~3" if total_chunks <= 50 else ("3~7" if total_chunks > 150 else "2~5")

    prompt = build_hierarchy_prompt(concatenated_text, h2_guide)

    try:
        response = await gemini_client.aio.models.generate_content(
            model="gemini-3-flash-preview",
            contents=prompt,
            config=google_genai.types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.2,
                top_p=0.95,
                thinking_config=google_genai.types.ThinkingConfig(thinking_budget=0),
            ),
        )
        result = json.loads(response.text)
        if not isinstance(result.get("h2_h3_master"), dict):
            raise ValueError(f"Unexpected LLM response: {type(result.get('h2_h3_master'))}")

        h2_h3_master = result["h2_h3_master"]
        h1_candidates = list(h2_h3_master.keys())

        H1_MAX = 5
        if len(h1_candidates) > H1_MAX:
            logger.warning(
                f"H1 over-generation: {len(h1_candidates)}개 → {H1_MAX}개로 절단 "
                f"(제거: {h1_candidates[H1_MAX:]})"
            )
            h1_candidates = h1_candidates[:H1_MAX]
            h2_h3_master = {k: h2_h3_master[k] for k in h1_candidates}

        domain_profile: Optional[Dict[str, Any]] = result.get("domain_profile")
        if not (domain_profile and isinstance(domain_profile, dict)):
            domain_profile = None

        document_id = (
            anchor_chunks[0].get("document_id")
            or (anchor_chunks[0].get("metadata") or {}).get("document_id")
        ) if anchor_chunks else None

        if document_id:
            await upsert_doc_metadata(
                document_id=document_id,
                filename=request.filename,
                domain_profile=domain_profile,
                h2_h3_master=h2_h3_master,
            )

        return HierarchyAnalysisResponse(
            domain_analysis=result.get("domain_analysis", ""),
            h1_candidates=h1_candidates,
            h2_h3_master=h2_h3_master,
            domain_profile=domain_profile,
            document_id=document_id,
        )
    except Exception as e:
        logger.error(f"Hierarchy analysis failed: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@router.post("/analyze-tagging-samples")
async def analyze_tagging_samples(request: TaggingSamplesRequest):
    """이미 태깅된 청크에서 __admin__ 제외 샘플 5개를 반환한다."""
    if not is_supabase_available():
        return {"success": False, "samples": [], "message": "Supabase not available"}

    all_chunks = await get_document_chunks(request.filename, limit=2000)

    samples: list = []
    seen_h1s: set = set()
    remaining: list = []
    for chunk in all_chunks:
        meta = chunk.get("metadata") or {}
        h1 = meta.get("hierarchy_h1")
        if not h1 or h1 == "__admin__":
            continue
        if h1 not in seen_h1s and len(samples) < 5:
            samples.append({
                "id": chunk["id"],
                "content_preview": chunk["content"][:150] + "...",
                "hierarchy": {"h1": h1, "h2": meta.get("hierarchy_h2"), "h3": meta.get("hierarchy_h3")},
            })
            seen_h1s.add(h1)
        elif len(samples) < 5:
            remaining.append(chunk)

    for chunk in remaining:
        if len(samples) >= 5:
            break
        meta = chunk.get("metadata") or {}
        samples.append({
            "id": chunk["id"],
            "content_preview": chunk["content"][:150] + "...",
            "hierarchy": {
                "h1": meta.get("hierarchy_h1"),
                "h2": meta.get("hierarchy_h2"),
                "h3": meta.get("hierarchy_h3"),
            },
        })

    return {"success": True, "samples": samples}


@router.post("/apply-granular-tagging")
async def apply_granular_tagging(request: GranularTaggingRequest):
    """Pass 3: 청크별 hierarchy 일괄 적용 (동기 처리)."""
    if not gemini_client:
        raise HTTPException(status_code=500, detail="Gemini client not initialized")
    if not request.h2_h3_master:
        raise HTTPException(
            status_code=400,
            detail="h2_h3_master is required. Run /analyze-hierarchy first.",
        )
    logger.info(f"Granular tagging start: {request.filename} (document_id={request.document_id or 'all'})")

    all_chunks = await get_document_chunks(
        request.filename,
        limit=2000,
        document_id=request.document_id,
    )
    if not all_chunks:
        return {"success": True, "message": "No chunks found.", "samples": []}

    samples = await run_tagging(
        filename=request.filename,
        all_chunks=all_chunks,
        gemini_client=gemini_client,
        model_id=MODEL_CONFIG["gemini-flash"]["model_id"],
        h2_h3_master=request.h2_h3_master,
        selected_h1_list=request.selected_h1_list,
        patch_fn=patch_chunk_hierarchy,
    )
    return {
        "success": True,
        "message": f"Granular tagging completed for {request.filename}.",
        "samples": samples,
    }


@router.get("/hierarchy-list")
async def get_hierarchy_list_endpoint(filename: str = None, filter_for_qa: bool = True):
    """doc_chunks H1/H2/H3 고유 목록.

    filter_for_qa=true  (기본): QA 생성 드롭다운 — MIN_CHUNKS_FOR_QA + MIN_CONTENT_CHARS 필터 적용
    filter_for_qa=false        : 표시용 (카테고리 구조 트리) — 태깅된 노드 전부 반환
    """
    if not is_supabase_available():
        return {"success": False, "h1_list": [], "h2_by_h1": {}, "message": "Supabase not available"}
    result = await get_hierarchy_list(filename=filename, filter_for_qa=filter_for_qa)
    return {"success": True, **result}


def setup_ingestion_routes(app):
    app.include_router(router)
