"""
[Deprecated] backend/db/ 패키지로 이전됨.
하위 호환성을 위해 기존 import 경로를 유지하는 re-export wrapper.
"""

# 클라이언트 및 유틸
from db.base_client import supabase as supabase_client, require_client, is_supabase_available, health_check

# QA 생성
from db.qa_generation_repo import (
    save_qa_generation_to_supabase,
    get_qa_generation_from_supabase,
    get_generation_result,
    get_generations_by_chunk,
    get_generations_by_source_doc,
)

# 평가
from db.evaluation_repo import (
    save_evaluation_to_supabase,
    get_evaluation_result,
)

# 생성-평가 링크
from db.generation_eval_link import link_generation_to_evaluation

# 문서 청크
from db.doc_chunk_repo import (
    save_doc_chunk,
    save_doc_chunks_batch,
    update_chunk_metadata,
    search_doc_chunks,
    get_doc_chunks_by_filter,
    get_document_chunks,
)

# 계층 구조
from db.hierarchy_repo import get_hierarchy_list, update_document_hierarchy

# 대시보드
from db.dashboard_repo import get_dashboard_metrics

__all__ = [
    "supabase_client",
    "require_client",
    "is_supabase_available",
    "health_check",
    "save_qa_generation_to_supabase",
    "get_qa_generation_from_supabase",
    "get_generation_result",
    "get_generations_by_chunk",
    "get_generations_by_source_doc",
    "save_evaluation_to_supabase",
    "get_evaluation_result",
    "link_generation_to_evaluation",
    "save_doc_chunk",
    "save_doc_chunks_batch",
    "update_chunk_metadata",
    "search_doc_chunks",
    "get_doc_chunks_by_filter",
    "get_document_chunks",
    "get_hierarchy_list",
    "update_document_hierarchy",
    "get_dashboard_metrics",
]
