"""
생성-평가 연결 (qa_gen_results.linked_evaluation_id)
"""

import logging

from .base_client import supabase

logger = logging.getLogger("autoeval.db")


async def link_generation_to_evaluation(
    generation_id: str,
    evaluation_id: str,
) -> bool:
    """QA 생성 결과와 평가 결과를 링크 (linked_evaluation_id 업데이트)"""
    if not supabase:
        logger.warning("Supabase client not initialized. Skipping link.")
        return False

    try:
        response = (
            supabase.table("qa_gen_results")
            .update({"linked_evaluation_id": evaluation_id})
            .eq("id", generation_id)
            .execute()
        )
        if response.data:
            logger.info(f"✅ Linked generation {generation_id} → evaluation {evaluation_id}")
            return True
        logger.error("Failed to link generation to evaluation")
        return False
    except Exception as e:
        logger.error(f"❌ Failed to link: {e}")
        return False
