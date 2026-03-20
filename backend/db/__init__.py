"""
DB package — Supabase repository 모음
모든 DB 접근은 이 패키지를 통해 이루어진다.
"""
from .base_client import supabase, is_supabase_available, require_client, health_check
from .qa_generation_repo import (
    save_qa_generation_to_supabase,
    get_qa_generation_from_supabase,
    get_generation_result,
    get_generations_by_chunk,
    get_generations_by_source_doc,
)
from .evaluation_repo import (
    save_evaluation_to_supabase,
    get_evaluation_result,
)
from .generation_eval_link import link_generation_to_evaluation
from .doc_chunk_repo import (
    save_doc_chunk,
    update_chunk_metadata,
    search_doc_chunks,
    get_doc_chunks_by_filter,
    get_document_chunks,
)
from .hierarchy_repo import get_hierarchy_list, update_document_hierarchy
from .dashboard_repo import get_dashboard_metrics

__all__ = [
    "supabase",
    "is_supabase_available",
    "require_client",
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
    "update_chunk_metadata",
    "search_doc_chunks",
    "get_doc_chunks_by_filter",
    "get_document_chunks",
    "get_hierarchy_list",
    "update_document_hierarchy",
    "get_dashboard_metrics",
]
