import os
import json
import logging
import io
import numpy as np
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks, Form
from pydantic import BaseModel
from pathlib import Path

# Document Parsers
import PyPDF2
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

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/ingestion", tags=["ingestion"])

print("--- INGESTION ROUTER INITIALIZING ---")

@router.get("/ping")
async def ping():
    return "pong"

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
    목차(Table of Contents) 청크인지 판단하는 휴리스틱
    - 특수 도트(·) 또는 일반 도트(.)가 비정상적으로 많은 경우
    - 페이지 번호(숫자)와 도트 패턴이 반복되는 경우
    """
    if not text:
        return False
        
    dot_count = text.count('.')
    special_dot_count = text.count('·')
    
    # 한국어 목차에서 흔히 쓰이는 '·' 패턴 감지
    if special_dot_count > 20: 
        return True
    
    # 일반적인 점 패턴이 매우 많은 경우 (TOC 특징)
    if dot_count > 50:
        return True
        
    # 줄 바꿈 대비 도트 비율 확인
    lines = [line.strip() for line in text.split('\n') if line.strip()]
    if not lines:
        return False
        
    toc_lines = 0
    for line in lines:
        # "제목 ...... 12" 같은 패턴
        if (line.count('·') > 5 or line.count('.') > 5) and any(c.isdigit() for c in line[-5:]):
            toc_lines += 1
            
    if toc_lines / len(lines) > 0.5:
        return True
        
    return False

def extract_text(file_content: bytes, filename: str) -> str:
    """파일 확장자에 따라 텍스트 추출"""
    ext = filename.split('.')[-1].lower()
    
    try:
        if ext == 'pdf':
            reader = PyPDF2.PdfReader(io.BytesIO(file_content))
            text = ""
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
            return text
        
        elif ext in ['doc', 'docx']:
            doc = Document(io.BytesIO(file_content))
            return "\n".join([para.text for para in doc.paragraphs])
        
        elif ext in ['txt', 'md']:
            return file_content.decode('utf-8')
        
        else:
            raise ValueError(f"지원하지 않는 파일 형식입니다: {ext}")
    except Exception as e:
        logger.error(f"Text extraction failed for {filename}: {e}")
        raise ValueError(f"텍스트 추출 중 오류가 발생했습니다: {str(e)}")

async def process_and_ingest(filename: str, text: str, metadata: Dict[str, Any]):
    """배경 작업: 텍스트 분할, 임베딩 생성 및 벡터 DB 저장"""
    try:
        if not gemini_client:
            logger.error("Gemini client not initialized. Check GOOGLE_API_KEY.")
            return

        # 1. Chunking (의미 단위 분할)
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=100,
            separators=["\n\n", "\n", ".", "!", "?", " ", ""]
        )
        chunks = splitter.split_text(text)
        logger.info(f"[{filename}] Split into {len(chunks)} chunks")
        
        # 청킹 확인용 상세 로그 (첫 2개 청크만 예시로 출력)
        for i, chunk in enumerate(chunks[:2]):
            preview = chunk[:100].replace('\n', ' ')
            logger.info(f"   - Chunk {i+1} Preview: {preview}...")

        # 2. Embedding & Save
        ingested_count = 0
        for i, chunk_text in enumerate(chunks):
            # 목차 필터링
            if is_toc_chunk(chunk_text):
                logger.info(f"   [SKIP] TOC-like chunk detected at index {i}")
                continue

            # Gemini Embedding 2 Preview (gemini-embedding-2-preview) 사용
            # task_type="RETRIEVAL_DOCUMENT" 권장
            res = gemini_client.models.embed_content(
                model="gemini-embedding-2-preview",
                contents=chunk_text,
                config=google_genai.types.EmbedContentConfig(
                    task_type="RETRIEVAL_DOCUMENT",
                    output_dimensionality=1536
                )
            )
            embedding_values = res.embeddings[0].values
            
            # 2.2. L2 Normalization (Gemini 가이드라인 반영: 1536차원 품질 최적화)
            embedding_np = np.array(embedding_values)
            norm = np.linalg.norm(embedding_np)
            if norm > 0:
                normalized_embedding = (embedding_np / norm).tolist()
            else:
                normalized_embedding = embedding_values
            
            # 메타데이터 구성 (파일명, 청크 인덱스, 계층 정보 등)
            chunk_metadata = {
                **metadata,
                "chunk_index": i,
                "total_chunks": len(chunks),
                "source": filename
            }
            
            await save_doc_chunk(chunk_text, normalized_embedding, chunk_metadata)
            ingested_count += 1
            
        logger.info(f"✅ Successfully ingested {filename} ({ingested_count}/{len(chunks)} chunks, {len(chunks)-ingested_count} skipped)")
        
    except Exception as e:
        logger.error(f"❌ Error processing {filename}: {e}", exc_info=True)

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
        
        # 2. 텍스트 추출 (초기 검증 - 동기 방식)
        text = extract_text(content_bytes, file.filename)
        if not text.strip():
            raise HTTPException(status_code=400, detail="추출된 텍스트가 비어 있습니다.")

        # 3. 비동기 백그라운드 작업 예약
        metadata = {
            "hierarchy_l1": hierarchy_l1,
            "hierarchy_l2": hierarchy_l2,
            "hierarchy_l3": hierarchy_l3,
            "filename": file.filename
        }
        
        background_tasks.add_task(process_and_ingest, file.filename, text, metadata)
        
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
