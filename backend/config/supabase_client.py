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

logger = logging.getLogger(__name__)

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
