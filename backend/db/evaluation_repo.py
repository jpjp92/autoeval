"""
평가 결과 저장/조회 (qa_eval_results)
"""

import logging
from datetime import datetime
from typing import Dict, Any, Optional

from .base_client import supabase

logger = logging.getLogger("autoeval.db")


async def save_evaluation_to_supabase(
    job_id: str,
    metadata: Dict[str, Any],
    total_qa: int,
    valid_qa: int,
    scores: Dict[str, Any],
    final_score: float,
    final_grade: str,
    pipeline_results: Dict[str, Any],
) -> Optional[str]:
    """평가 결과를 Supabase에 저장하고 평가 ID를 반환"""
    if not supabase:
        logger.warning("Supabase client not initialized. Skipping save.")
        return None

    try:
        raw_gen_id = metadata.get("generation_id")
        generation_id = raw_gen_id if raw_gen_id and raw_gen_id.strip() else None
        data = {
            "job_id":           job_id,
            "metadata":         metadata,
            "total_qa":         total_qa,
            "valid_qa":         valid_qa,
            "scores":           scores,
            "final_score":      final_score,
            "final_grade":      final_grade,
            "pipeline_results": pipeline_results,
            "generation_id":    generation_id,
            "created_at":       datetime.utcnow().isoformat(),
        }
        response = supabase.table("qa_eval_results").insert(data).execute()
        if response.data:
            evaluation_id = response.data[0]["id"]
            return evaluation_id
        logger.error("No data returned from Supabase insert")
        return None
    except Exception as e:
        logger.error(f"Failed to save evaluation: {e}")
        return None


async def get_evaluation_result(evaluation_id: str) -> Optional[Dict[str, Any]]:
    """평가 결과 전체 조회"""
    if not supabase:
        return None
    try:
        response = (
            supabase.table("qa_eval_results")
            .select("*")
            .eq("id", evaluation_id)
            .execute()
        )
        return response.data[0] if response.data else None
    except Exception as e:
        logger.error(f"Failed to get evaluation result: {e}")
        return None


