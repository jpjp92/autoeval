import os
import json
import logging
import io
import re
import hashlib
import numpy as np
from datetime import datetime
from uuid import uuid4
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks, Form
from pydantic import BaseModel
from pathlib import Path

# Document Parsers
import fitz  # PyMuPDF
from docx import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter

# Embedding & Supabase
from google import genai as google_genai
from config.supabase_client import (
    save_doc_chunk, 
    is_supabase_available,
    get_document_chunks,
    update_document_hierarchy
)

logger = logging.getLogger("autoeval.ingestion")

router = APIRouter(prefix="/api/ingestion", tags=["ingestion"])

# Initialize Gemini Client for Embeddings
GEMINI_API_KEY = os.getenv("GOOGLE_API_KEY")
gemini_client = google_genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None

class IngestionResponse(BaseModel):
    success: bool
    message: str
    file_name: str = ""

class HierarchyAnalysisRequest(BaseModel):
    filename: str

class HierarchyAnalysisResponse(BaseModel):
    domain_analysis: str
    l1_candidates: List[str]
    suggested_hierarchy: Dict[str, str] # Default sample
    validation: str

class GranularTaggingRequest(BaseModel):
    filename: str
    selected_l1_list: List[str]

class TaggingSample(BaseModel):
    id: str
    content_preview: str
    hierarchy: Dict[str, str]

class TaggingPreviewResponse(BaseModel):
    samples: List[TaggingSample]

def is_toc_chunk(text: str) -> bool:
    """
    목차(Table of Contents) 청크인지 판단하는 휴리스틱 개선
    - 도트 비율, 기호 비율, 숫자 패턴 기반
    """
    if not text or len(text) < 20:
        return False
        
    # 심볼 비율 계산 (Phase 4: Symbol Ratio 도입)
    symbols = re.findall(r'[·. \t\-_|]', text)
    symbol_ratio = len(symbols) / len(text)
    if symbol_ratio > 0.4 and len(text) > 100: # 목차나 표 파편은 기호 비율이 매우 높음
        return True

    dot_count = text.count('.')
    special_dot_count = text.count('·')
    if special_dot_count > 20 or dot_count > 50:
        return True
        
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    if not lines:
        return False
        
    toc_lines = 0
    for line in lines:
        if (line.count('·') > 5 or line.count('.') > 5) and any(c.isdigit() for c in line[-5:]):
            toc_lines += 1
            
    if toc_lines / len(lines) > 0.5:
        return True
        
    return False

def detect_section(block_text: str, font_size: float, prev_font_size: float) -> Optional[str]:
    """
    하이브리드 섹션 탐지 (정규식 + 폰트 크기)
    """
    # 1. 정규식 패턴 (제1장, 1.1, 1. 주요 현황 등)
    heading_pattern = r'^([0-9]{1,2}(\.[0-9]{1,2})*|제\s*[0-9]{1,2}\s*[장장]|I{1,3}|[A-Z]\.)\s+'
    if re.match(heading_pattern, block_text):
        return block_text[:50].strip()
    
    # 2. 폰트 크기 기반 (이전 블록보다 눈에 띄게 큰 경우)
    if font_size > 14 and font_size > prev_font_size * 1.1:
        # 단락이 너무 길면 제목이 아닐 가능성이 높음
        if len(block_text) < 100:
            return block_text.strip()
            
    return None

def normalize_text(text: str) -> str:
    """
    RAG 품질을 위한 텍스트 정규화 (Phase 2.1: 구조 보존형)
    - 다중 공백 제거
    - 불렛 기호 표준화 (•, *, l -> -)
    - 줄바꿈은 보존하여 표/리스트 구조 유지
    """
    if not text:
        return ""
    
    # 1. 불렛 기호 표준화 (•, *, l -> -)
    text = re.sub(r'^[ \t]*[•*l][ \t]+', '- ', text, flags=re.MULTILINE)
    
    # 2. 다중 공백 하나로 통합 (줄바꿈 제외)
    text = re.sub(r'[ \t]+', ' ', text)
    
    return text.strip()

def extract_text_by_page(file_content: bytes, filename: str) -> List[Dict[str, Any]]:
    """파일 확장자에 따라 텍스트 및 메타데이터 추출 (폰트/위치 정보 포함)"""
    ext = filename.split('.')[-1].lower()
    results = []
    
    try:
        if ext == 'pdf':
            doc = fitz.open(stream=file_content, filetype="pdf")
            for page_index, page in enumerate(doc):
                blocks_data = []
                # "dict" 모드는 폰트 크기, 스타일, 좌표 정보를 상세히 제공함
                page_dict = page.get_text("dict")
                
                # 시각적으로 읽기 편한 순서로 정렬 (Y좌표 우선, 그 다음 X좌표)
                blocks = page_dict.get("blocks", [])
                blocks.sort(key=lambda b: (b["bbox"][1], b["bbox"][0]))
                
                page_text_parts = []
                for b in blocks:
                    if b["type"] == 0:  # 텍스트 블록
                        block_lines = []
                        max_font_size = 0
                        for line in b["lines"]:
                            line_text = ""
                            prev_x = None
                            for span in line["spans"]:
                                # Phase 2.1: BBox 간격 인지하여 표 구분자 | 삽입
                                if prev_x is not None and span["bbox"][0] - prev_x > 20:
                                    line_text += " | "
                                line_text += span["text"]
                                max_font_size = max(max_font_size, span["size"])
                                prev_x = span["bbox"][2]
                            block_lines.append(line_text)
                        
                        block_text = "\n".join(block_lines)
                        normalized_block = normalize_text(block_text)
                        if normalized_block:
                            blocks_data.append({
                                "text": normalized_block,
                                "font_size": max_font_size,
                                "bbox": b["bbox"]
                            })
                            page_text_parts.append(normalized_block)
                
                if page_text_parts:
                    results.append({
                        "text": "\n\n".join(page_text_parts),
                        "page": page_index + 1,
                        "blocks": blocks_data # Phase 3(Section Detection)에서 활용
                    })
            doc.close()
            return results
        
        elif ext in ['doc', 'docx']:
            doc = Document(io.BytesIO(file_content))
            full_text = "\n\n".join([normalize_text(para.text) for para in doc.paragraphs if para.text.strip()])
            return [{"text": full_text, "page": 1, "blocks": []}]
        
        elif ext in ['txt', 'md']:
            full_text = normalize_text(file_content.decode('utf-8'))
            return [{"text": full_text, "page": 1, "blocks": []}]
        
        else:
            raise ValueError(f"지원하지 않는 파일 형식입니다: {ext}")
    except Exception as e:
        logger.error(f"Text extraction failed for {filename}: {e}")
        raise ValueError(f"텍스트 추출 중 오류가 발생했습니다: {str(e)}")

async def process_and_ingest(filename: str, pages: List[Dict[str, Any]], metadata: Dict[str, Any]):
    """배경 작업: 8단계 고도화 파이프라인 적용"""
    try:
        if not gemini_client:
            logger.error("Gemini client not initialized.")
            return

        doc_id = str(uuid4()) # Phase 4: Document ID
        ingested_at = datetime.utcnow().isoformat()
        
        # 청킹 전략 (Phase 2.1: 페이지 단위 병합 및 사이즈 조정)
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1500,
            chunk_overlap=200,
            separators=["\n\n", "\n- ", "\n"]
        )
        
        current_section_path = []
        all_chunks_to_embed = []
        seen_hashes = set() # Phase 5: Deduplication (세션 내)
        
        # 1. 페이지별 스트리밍 처리
        for page_data in pages:
            page_num = page_data["page"]
            blocks = page_data.get("blocks", [])
            
            page_full_text_list = []
            prev_font_size = 10.0 # 기본값
            
            # 페이지 내 블록들을 먼저 취합하고 섹션 탐지
            # (문장 중간 단절 방지를 위해 페이지 단위로 병합 후 청킹)
            for block in blocks:
                text = block["text"]
                font_size = block["font_size"]
                
                # 섹션(제목) 탐지
                detected_title = detect_section(text, font_size, prev_font_size)
                if detected_title:
                    current_section_path = [detected_title]
                
                page_full_text_list.append(text)
                prev_font_size = font_size
            
            if not page_full_text_list:
                continue
                
            page_full_text = "\n\n".join(page_full_text_list)
            
            # 청킹 수행 (페이지 단위)
            raw_chunks = splitter.split_text(page_full_text)
            for chunk_text in raw_chunks:
                # 품질 필터 (Phase 4)
                if len(chunk_text) < 50 or is_toc_chunk(chunk_text):
                    continue
                
                # 중복 제거 (Phase 5: 해시)
                content_hash = hashlib.sha1(chunk_text.encode('utf-8')).hexdigest()
                if content_hash in seen_hashes:
                    continue
                seen_hashes.add(content_hash)
                
                # 맥락 주입 (Phase 6: Context Injection)
                section_prefix = f"[섹션: {' > '.join(current_section_path)}]\n\n" if current_section_path else ""
                enriched_text = section_prefix + chunk_text
                
                # 청크 타입 분류 (Phase 7)
                chunk_type = "Body"
                if any(sec in chunk_text for sec in current_section_path):
                    chunk_type = "Heading"
                elif chunk_text.strip().startswith("- "):
                    chunk_type = "List"

                all_chunks_to_embed.append({
                    "text": enriched_text,
                    "raw_text": chunk_text,
                    "page": page_num,
                    "hash": content_hash,
                    "section_path": " > ".join(current_section_path) if current_section_path else "Root",
                    "chunk_type": chunk_type
                })

        logger.info(f"[{filename}] Processed into {len(all_chunks_to_embed)} unique enriched chunks.")

        # 2. 배치 임베딩 (Phase 8: 최적 사이즈 32)
        batch_size = 32
        for i in range(0, len(all_chunks_to_embed), batch_size):
            batch = all_chunks_to_embed[i : i + batch_size]
            batch_texts = [item["text"] for item in batch]
            
            res = gemini_client.models.embed_content(
                model="gemini-embedding-2-preview",
                contents=batch_texts,
                config=google_genai.types.EmbedContentConfig(
                    task_type="RETRIEVAL_DOCUMENT",
                    output_dimensionality=1536
                )
            )
            
            for idx, emb_data in enumerate(res.embeddings):
                c = batch[idx]
                embedding_np = np.array(emb_data.values)
                norm = np.linalg.norm(embedding_np)
                normalized_embedding = (embedding_np / norm).tolist() if norm > 0 else emb_data.values
                
                chunk_metadata = {
                    **metadata,
                    "document_id": doc_id,
                    "content_hash": c["hash"],
                    "section_path": c["section_path"],
                    "chunk_type": c["chunk_type"],
                    "page": c["page"],
                    "char_length": len(c["raw_text"]),
                    "chunk_index": i + idx,
                    "total_chunks": len(all_chunks_to_embed),
                    "source": filename.split('.')[-1].lower() if '.' in filename else 'unknown',
                    "ingested_at": ingested_at,
                    "embedding_model": "gemini-embedding-2-preview"
                }
                
                await save_doc_chunk(c["raw_text"], normalized_embedding, chunk_metadata)
            
            logger.info(f"   - Batch {i//batch_size + 1} finalized.")
            
        logger.info(f"✅ Enhanced Ingestion Complete: {filename} ({len(all_chunks_to_embed)} chunks)")
        
    except Exception as e:
        logger.error(f"❌ Ingestion Pipeline Failure {filename}: {e}", exc_info=True)

@router.post("/upload", response_model=IngestionResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    hierarchy_l1: Optional[str] = Form(None),
    hierarchy_l2: Optional[str] = Form(None),
    hierarchy_l3: Optional[str] = Form(None)
):
    """문서 업로드 및 벡터화 인제스션 시작"""
    if not is_supabase_available():
        raise HTTPException(status_code=500, detail="Supabase 설정이 구성되지 않았습니다.")
    
    try:
        # 1. 파일 내용 읽기
        content_bytes = await file.read()
        
        # 2. 텍스트 추출 (페이지 기반)
        pages = extract_text_by_page(content_bytes, file.filename)
        if not pages:
            raise HTTPException(status_code=400, detail="텍스트를 추출할 수 없거나 비어 있는 문서입니다.")

        # 3. 비동기 백그라운드 작업 예약
        metadata = {
            "hierarchy_l1": hierarchy_l1,
            "hierarchy_l2": hierarchy_l2,
            "hierarchy_l3": hierarchy_l3,
            "filename": file.filename
        }
        
        background_tasks.add_task(process_and_ingest, file.filename, pages, metadata)
        
        return IngestionResponse(
            success=True,
            message="문서 업로드가 완료되었습니다. 백그라운드에서 벡터화 작업이 진행됩니다.",
            file_name=file.filename
        )
        
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.error(f"Upload error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/analyze-tagging-samples", response_model=TaggingPreviewResponse)
async def analyze_tagging_samples(request: GranularTaggingRequest):
    """
    검증용 샘플 분석: DB 업데이트 없이 3~5개 청크에 대해 AI가 어떻게 태깅할지 미리 보여줌
    """
    logger.info(f"🧪 [Preview] Analyzing tagging samples for: {request.filename}")
    if not gemini_client:
        raise HTTPException(status_code=500, detail="Gemini client not initialized")

    # 1. 문서 청크 가져오기 (중간 지점에서 3-5개 샘플링)
    # get_document_chunks는 Supabase 헬퍼 함수
    all_chunks = await get_document_chunks(request.filename, limit=100)
    if not all_chunks:
        # 이 부분이 detail="No chunks found"를 반환하지만, 전체 404면 FASTAPI가 "Not Found"를 뱉음
        raise HTTPException(status_code=404, detail="No chunks found")
    
    sample_indices = [0, len(all_chunks)//2, min(len(all_chunks)-1, 20)]
    sample_indices = sorted(list(set(sample_indices)))
    samples = [all_chunks[i] for i in sample_indices if i < len(all_chunks)]
    
    chunks_data = [{"id": s["id"], "content": s["content"][:800]} for s in samples]
    
    prompt = f"""
    Analyze these text chunks and assign the most appropriate [L1, L2, L3] hierarchy for each.
    This is for PREVIEW only.
    
    ### Master L1 List (Choose ONE for each chunk):
    {request.selected_l1_list}
    
    ### Requirements:
    - Korean term, under 15 characters.
    - Result MUST be valid JSON array.
    
    ### Input Chunks:
    {json.dumps(chunks_data, ensure_ascii=False)}
    
    ### JSON Structure:
    [
      {{
        "id": "chunk_uuid",
        "hierarchy": {{ "l1": "...", "l2": "...", "l3": "..." }}
      }},
      ...
    ]
    """
    
    try:
        res = gemini_client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=prompt,
            config=google_genai.types.GenerateContentConfig(
                response_mime_type="application/json"
            )
        )
        tagging_results = json.loads(res.text)
        
        final_samples = []
        for item in tagging_results:
            orig = next((s for s in samples if s["id"] == item["id"]), None)
            if orig:
                final_samples.append(TaggingSample(
                    id=item["id"],
                    content_preview=orig["content"][:150] + "...",
                    hierarchy=item["hierarchy"]
                ))
        return TaggingPreviewResponse(samples=final_samples)
    except Exception as e:
        logger.error(f"❌ Sample analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/analyze-hierarchy", response_model=HierarchyAnalysisResponse)
async def analyze_hierarchy(request: HierarchyAnalysisRequest):
    """
    1단계: 마스터 스키마 도출 (Global Analysis)
    문서의 주요 샘플들을 분석하여 문서 전체를 관통하는 L1 후보 그룹 도출
    """
    logger.info(f"🔍 [Step 1] Master Schema Discovery for: {request.filename}")
    if not gemini_client:
        raise HTTPException(status_code=500, detail="Gemini client not initialized")
    
    # 1. 문서 샘플 청크 가져오기 (첫 15개 정도 여유있게)
    chunks = await get_document_chunks(request.filename, limit=15)
    if not chunks:
        raise HTTPException(status_code=404, detail=f"No chunks found for document: {request.filename}")
    
    concatenated_text = "\n\n".join([c["content"] for c in chunks])
    
    prompt = f"""
    You are an expert document classifier. Your task is to discover a 'Master Schema' for the provided document snippets.
    
    ### Task:
    1. **Domain Analysis**: Summarize the overall nature of the document.
    2. **L1 Candidates**: Based on the content, identify 3-5 distinct 'Directives' or 'Domains' (L1) that cover the various parts of this document (e.g., 'Operation Policy', 'Technical Specs', 'Case Studies').
    3. **Default Sample**: Provide one specific L1-L2-L3 example from the first few paragraphs.
    4. **Validation**: Explain why this multi-domain approach is better for this document.
    
    ### CRITICAL:
    - Names MUST be in Korean (한국어).
    - Brevity is absolute: L1/L2/L3 names MUST be under 15 characters.
    - Result MUST be valid JSON.
    
    ### Input:
    {concatenated_text[:15000]} # Limit input context
    
    ### JSON Structure:
    {{
      "domain_analysis": "...",
      "l1_candidates": ["카테고리1", "카테고리2", "카테고리3"],
      "suggested_hierarchy": {{
        "l1": "L1명",
        "l2": "L2명",
        "l3": "L3명"
      }},
      "validation": "..."
    }}
    """
    
    try:
        response = gemini_client.models.generate_content(
            model="gemini-3-flash-preview",
            contents=prompt,
            config=google_genai.types.GenerateContentConfig(
                response_mime_type="application/json"
            )
        )
        
        analysis_res = json.loads(response.text)
        logger.info(f"✅ Master Schema discovered with {len(analysis_res.get('l1_candidates', []))} candidates")
        return HierarchyAnalysisResponse(**analysis_res)
        
    except Exception as e:
        logger.error(f"❌ Master Schema Discovery failed: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")


@router.get("/test")
async def test_ingestion_route():
    return {"message": "Ingestion router is working"}


@router.post("/apply-granular-tagging")
async def apply_granular_tagging(request: GranularTaggingRequest, background_tasks: BackgroundTasks):
    """
    2&3단계: 개별 청크별 세밀한 매핑 실행 (백그라운드 처리)
    """
    logger.info(f"🚀 [Step 2&3] Starting Granular Tagging for: {request.filename}")
    
    # 백그라운드 태깅 프로세스 정의
    async def run_tagging():
        # 로컬 임포트로 NameError 방지
        from config.supabase_client import update_chunk_metadata
        
        # 1. 모든 청크 가져오기
        all_chunks = await get_document_chunks(request.filename, limit=2000) # 상한선
        if not all_chunks:
            return
            
        logger.info(f"📊 Processing {len(all_chunks)} chunks for {request.filename}")
        
        # 2. 배치 처리 (5개씩 묶어서 비용/정확도 타협)
        batch_size = 5
        for i in range(0, len(all_chunks), batch_size):
            batch = all_chunks[i:i+batch_size]
            
            # 배치 분석 프롬프트
            chunks_data = [{"id": c["id"], "content": c["content"][:1000]} for c in batch]
            
            prompt = f"""
            Analyze each text chunk and assign the most appropriate [L1, L2, L3] hierarchy.
            
            ### Master L1 List (Choose ONE for each chunk):
            {request.selected_l1_list}
            
            ### Output:
            - Provide L2 and L3 that specifically describe each chunk's content within the chosen L1.
            - Terminology: Korean. Brevity (under 15 chars).
            - Return JSON array of objects.
            
            ### Input Chunks:
            {json.dumps(chunks_data, ensure_ascii=False)}
            
            ### JSON Structure:
            [
              {{
                "id": "chunk_uuid",
                "hierarchy": {{ "l1": "...", "l2": "...", "l3": "..." }}
              }},
              ...
            ]
            """
            
            try:
                res = gemini_client.models.generate_content(
                    model="gemini-3-flash-preview",
                    contents=prompt,
                    config=google_genai.types.GenerateContentConfig(
                        response_mime_type="application/json"
                    )
                )
                
                tagging_results = json.loads(res.text)
                
                # 3. DB 업데이트
                for item in tagging_results:
                    chunk_id = item.get("id")
                    h = item.get("hierarchy", {})
                    
                    # 기존 메타데이터 가져와서 업데이트
                    target_chunk = next((c for c in batch if c["id"] == chunk_id), None)
                    if target_chunk:
                        meta = target_chunk.get("metadata", {})
                        meta.update({
                            "hierarchy_l1": h.get("l1"),
                            "hierarchy_l2": h.get("l2"),
                            "hierarchy_l3": h.get("l3")
                        })
                        await update_chunk_metadata(chunk_id, meta)
                
                logger.info(f"✅ Logged/Tagged batch {i//batch_size + 1}")
                
            except Exception as e:
                logger.error(f"❌ Batch tagging error at {i}: {e}")
                continue
        
        logger.info(f"🏁 Granular Tagging finished for {request.filename}")

    background_tasks.add_task(run_tagging)
    return {"success": True, "message": f"Granular tagging started for {len(request.selected_l1_list)} L1 categories."}


@router.post("/update-hierarchy")
async def update_hierarchy(filename: str = Form(...), l1: str = Form(...), l2: str = Form(...), l3: str = Form(...)):
    """
    AI로 제안된 또는 사용자가 수정한 계층 정보를 해당 문서의 모든 청크에 반영
    """
    logger.info(f"💾 Updating hierarchy for {filename}: L1={l1}, L2={l2}, L3={l3}")
    success = await update_document_hierarchy(filename, l1, l2, l3)
    if success:
        return {"success": True, "message": f"Updated hierarchy for {filename}"}
    else:
        raise HTTPException(status_code=500, detail="Failed to update hierarchy in database")


def setup_ingestion_routes(app):
    app.include_router(router)
