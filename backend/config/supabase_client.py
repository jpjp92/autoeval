"""
Supabase 클라이언트 모듈
- QA 생성 결과 저장
- 평가 결과 저장
- 생성-평가 링크
"""

import os
import json
import logging
import asyncio
from typing import Optional, Dict, Any
from datetime import datetime
from uuid import UUID

from supabase import create_client, Client

logger = logging.getLogger("autoeval.config.supabase")

# Supabase 클라이언트 초기화
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_API_KEY = os.getenv("SUPABASE_API_KEY")

if not SUPABASE_URL or not SUPABASE_API_KEY:
    logger.warning("Supabase credentials not found in .env")
    supabase_client: Optional[Client] = None
else:
    supabase_client: Client = create_client(SUPABASE_URL, SUPABASE_API_KEY)


# ============================================================================
# QA Generation 저장
# ============================================================================

async def save_qa_generation_to_supabase(
    job_id: str,
    metadata: Dict[str, Any],  # {generation_model, lang, prompt_version}
    hierarchy: Dict[str, Any],  # {sampling, category, path_prefix, filtered_document_count}
    stats: Dict[str, Any],      # {total_qa, total_documents, tokens, cost}
    qa_list: list,              # [{q, a, context, hierarchy, docId, ...}]
) -> Optional[str]:
    """
    QA 생성 결과를 Supabase에 저장하고 생성된 ID를 반환
    
    Args:
        job_id: 생성 작업 ID (고유)
        metadata: 생성 메타데이터
        hierarchy: Hierarchy 샘플링 정보
        stats: 생성 통계
        qa_list: 생성된 QA 배열
        
    Returns:
        생성된 UUID (또는 None if failed)
    """
    if not supabase_client:
        logger.warning("Supabase client not initialized. Skipping save.")
        return None
    
    try:
        # Supabase에 저장
        data = {
            "job_id": job_id,
            "metadata": metadata,
            "hierarchy": hierarchy,
            "stats": stats,
            "qa_list": qa_list,
            "created_at": datetime.utcnow().isoformat(),
        }
        
        response = supabase_client.table("qa_generation_results").insert(data).execute()
        
        # 저장된 레코드에서 ID 추출
        if response.data and len(response.data) > 0:
            generated_id = response.data[0]["id"]
            logger.info(f"✅ QA generation saved to Supabase: {generated_id}")
            return generated_id
        else:
            logger.error("No data returned from Supabase insert")
            return None
            
    except Exception as e:
        logger.error(f"❌ Failed to save QA generation to Supabase: {e}")
        return None


# ============================================================================
# 평가 결과 저장
# ============================================================================

async def save_evaluation_to_supabase(
    job_id: str,
    metadata: Dict[str, Any],          # {generation_model, evaluator_model, lang, prompt_version}
    total_qa: int,
    valid_qa: int,
    scores: Dict[str, Any],            # {syntax, stats, rag, quality}
    final_score: float,
    final_grade: str,
    pipeline_results: Dict[str, Any],  # 4단계 전체 결과 (상세)
    interpretation: Optional[Dict[str, Any]] = None,  # 해석 & 개선
) -> Optional[str]:
    """
    평가 결과를 Supabase에 저장하고 평가 ID를 반환
    
    Args:
        job_id: 평가 작업 ID (고유)
        metadata: 평가 메타데이터 (모델, 언어 등)
        total_qa: 전체 QA 개수
        valid_qa: 유효한 QA 개수
        scores: 4단계 평가 점수
        final_score: 최종 종합 점수 (0-1)
        final_grade: 최종 등급 (A+, A, B+, B, C, F)
        pipeline_results: 4단계 전체 평가 결과
        interpretation: 해석 & 개선 추천사항
        
    Returns:
        생성된 UUID (또는 None if failed)
    """
    if not supabase_client:
        logger.warning("Supabase client not initialized. Skipping save.")
        return None
    
    try:
        data = {
            "job_id": job_id,
            "metadata": metadata,
            "total_qa": total_qa,
            "valid_qa": valid_qa,
            "scores": scores,
            "final_score": final_score,
            "final_grade": final_grade,
            "pipeline_results": pipeline_results,
            "interpretation": interpretation,
            "created_at": datetime.utcnow().isoformat(),
        }
        
        response = supabase_client.table("evaluation_results").insert(data).execute()
        
        if response.data and len(response.data) > 0:
            evaluation_id = response.data[0]["id"]
            logger.info(f"✅ Evaluation saved to Supabase: {evaluation_id}")
            return evaluation_id
        else:
            logger.error("No data returned from Supabase insert")
            return None
            
    except Exception as e:
        logger.error(f"❌ Failed to save evaluation to Supabase: {e}")
        return None


# ============================================================================
# 생성-평가 링크
# ============================================================================

async def link_generation_to_evaluation(
    generation_id: str,  # UUID
    evaluation_id: str,  # UUID
) -> bool:
    """
    QA 생성 결과와 평가 결과를 링크
    
    Args:
        generation_id: qa_generation_results ID
        evaluation_id: evaluation_results ID
        
    Returns:
        성공 여부
    """
    if not supabase_client:
        logger.warning("Supabase client not initialized. Skipping link.")
        return False
    
    try:
        # qa_generation_results.linked_evaluation_id 업데이트
        response = supabase_client.table("qa_generation_results").update(
            {"linked_evaluation_id": evaluation_id}
        ).eq("id", generation_id).execute()
        
        if response.data:
            logger.info(f"✅ Linked generation {generation_id} to evaluation {evaluation_id}")
            return True
        else:
            logger.error("Failed to link generation to evaluation")
            return False
            
    except Exception as e:
        logger.error(f"❌ Failed to link generation to evaluation: {e}")
        return False


# ============================================================================
# 데이터 조회
# ============================================================================

async def get_generation_result(generation_id: str) -> Optional[Dict[str, Any]]:
    """
    QA 생성 결과 조회
    
    Args:
        generation_id: UUID
        
    Returns:
        생성 결과 (또는 None if not found)
    """
    if not supabase_client:
        return None
    
    try:
        response = supabase_client.table("qa_generation_results").select("*").eq(
            "id", generation_id
        ).execute()
        
        return response.data[0] if response.data else None
        
    except Exception as e:
        logger.error(f"Failed to get generation result: {e}")
        return None


async def get_evaluation_result(evaluation_id: str) -> Optional[Dict[str, Any]]:
    """
    평가 결과 조회
    
    Args:
        evaluation_id: UUID
        
    Returns:
        평가 결과 (또는 None if not found)
    """
    if not supabase_client:
        return None
    
    try:
        response = supabase_client.table("evaluation_results").select("*").eq(
            "id", evaluation_id
        ).execute()
        
        return response.data[0] if response.data else None
        
    except Exception as e:
        logger.error(f"Failed to get evaluation result: {e}")
        return None


async def get_evaluation_qa_joined(evaluation_id: str) -> Optional[Dict[str, Any]]:
    """
    평가 결과와 생성 결과를 함께 조회 (evaluation_qa_joined 뷰 사용)
    
    Args:
        evaluation_id: evaluation_results ID
        
    Returns:
        조인된 결과 (또는 None if not found)
    """
    if not supabase_client:
        return None
    
    try:
        response = supabase_client.table("evaluation_qa_joined").select("*").eq(
            "evaluation_id", evaluation_id
        ).execute()
        
        return response.data[0] if response.data else None
        
    except Exception as e:
        logger.warning(f"evaluation_qa_joined view not available yet: {e}")
        return None


# ============================================================================
# 헬퍼 함수
# ============================================================================

def is_supabase_available() -> bool:
    """Supabase 클라이언트 가용성 확인"""
    return supabase_client is not None


# ============================================================================
# Document Chunks (Vector DB) 저장 및 조회
# ============================================================================

async def save_doc_chunk(
    content: str,
    embedding: list,
    metadata: Dict[str, Any] = None
) -> Optional[str]:
    """
    문서 청크와 임베딩을 Supabase에 저장
    
    Args:
        content: 청크 텍스트
        embedding: 벡터 리스트
        metadata: 메타데이터 (파일명, 계층 등)
        
    Returns:
        생성된 UUID
    """
    if not supabase_client:
        return None
    
    try:
        data = {
            "content": content,
            "embedding": embedding,
            "metadata": metadata or {},
            "created_at": datetime.utcnow().isoformat(),
        }
        
        response = supabase_client.table("doc_chunks").insert(data).execute()
        
        if response.data and len(response.data) > 0:
            return response.data[0]["id"]
        return None
    except Exception as e:
        logger.error(f"❌ Failed to save doc chunk: {e}")
        return None


async def update_chunk_metadata(chunk_id: str, metadata: Dict[str, Any]) -> bool:
    """
    특정 청크의 메타데이터를 개별적으로 업데이트
    """
    if not supabase_client:
        return False
    
    try:
        supabase_client.table("doc_chunks").update({"metadata": metadata}).eq("id", chunk_id).execute()
        return True
    except Exception as e:
        logger.error(f"❌ Failed to update chunk metadata: {e}")
        return False


async def search_doc_chunks(
    query_embedding: list,
    match_threshold: float = 0.5,
    match_count: int = 5,
    filter: Dict[str, Any] = None
) -> list:
    """
    유사도 기반 문서 청크 검색 (RPC 호출)
    
    Args:
        query_embedding: 검색 쿼리의 벡터
        match_threshold: 유사도 임계값
        match_count: 반환할 결과 개수
        filter: 메타데이터 필터 (JSONB match)
        
    Returns:
        검색된 청크 리스트
    """
    if not supabase_client:
        return []
    
    try:
        response = supabase_client.rpc(
            "match_doc_chunks",
            {
                "query_embedding": query_embedding,
                "match_threshold": match_threshold,
                "match_count": match_count,
                "filter": filter or {}
            }
        ).execute()
        
        return response.data if response.data else []
    except Exception as e:
        logger.error(f"❌ Failed to search doc chunks: {e}")
        return []


async def get_document_chunks(source_name: str, limit: int = 10) -> list:
    """
    특정 문서의 청크들을 조회 (주로 계층 구조 분석용)
    """
    if not supabase_client:
        return []
    
    try:
        response = supabase_client.table("doc_chunks").select("id, content, metadata").eq("metadata->>filename", source_name).order("created_at").limit(limit).execute()
        return response.data if response.data else []
    except Exception as e:
        logger.error(f"❌ Failed to get document chunks: {e}")
        return []


async def update_document_hierarchy(source_name: str, l1: str, l2: str, l3: str) -> bool:
    """
    특정 문서에 속한 모든 청크의 계층 정보(L1, L2, L3)를 업데이트
    """
    if not supabase_client:
        return False
    
    try:
        # 기존 메타데이터를 유지하면서 계층 정보만 추가/업데이트하기 위해 
        # supabase의 컬럼 단위 업데이트 보다는 jsonb_set 같은 기능이 좋으나 
        # python client에서는 전체 metadata 필드를 교체해야 할 수도 있음.
        # 여기서는 doc_chunks의 metadata 컬럼을 가져와서 합치는 방식 또는 
        # 그냥 hierarchy 필드를 명시적으로 업데이트하는 전략 사용
        
        # 1. 대상 청크 조회
        chunks = await get_document_chunks(source_name, limit=1000)
        if not chunks:
            return False
            
        for chunk in chunks:
            current_metadata = chunk.get("metadata", {})
            current_metadata.update({
                "hierarchy_l1": l1,
                "hierarchy_l2": l2,
                "hierarchy_l3": l3
            })
            
            supabase_client.table("doc_chunks").update({"metadata": current_metadata}).eq("id", chunk["id"]).execute()
            
        return True
    except Exception as e:
        logger.error(f"❌ Failed to update document hierarchy: {e}")
        return False


async def health_check() -> Dict[str, Any]:
    """Supabase 헬스 체크"""
    if not supabase_client:
        return {"status": "unavailable", "message": "Supabase credentials not configured"}
    
    try:
        # 간단한 쿼리로 연결 확인
        response = supabase_client.table("qa_generation_results").select("count", count='exact').limit(1).execute()
        return {"status": "healthy", "message": "Connected to Supabase"}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}
