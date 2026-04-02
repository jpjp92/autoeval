"""
generators/worker.py — QA 생성 Background Worker

run_qa_generation()        : ThreadPoolExecutor 진입점 (background_tasks에서 호출)
run_qa_generation_real()   : 실제 Vector DB 조회·도메인 프로파일·병렬 생성 로직
run_qa_generation_simulation() : 시뮬레이션 폴백 (qa_generator 미사용 환경)

(generation_api.py에서 분리)
"""

from __future__ import annotations

import asyncio
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from threading import Lock
from typing import Any, Dict, Optional

import numpy as np

from config.models import MODEL_CONFIG
from config.supabase_client import is_supabase_available, save_qa_generation_to_supabase
from generators.job_manager import JobStatus, job_manager
from generators.prompts import build_system_prompt, build_user_template
from generators.qa_generator import (
    APIAuthError,
    APIQuotaExceededError,
    generate_qa as _generate_qa,
)

logger = logging.getLogger("autoeval.worker")

# ── provider별 최대 동시 workers ───────────────────────────────────────────────
# 추정: input ~1,600 + output ~700 tokens, 호출 1회 ~25초
#   - gemini-3.1-flash: RPM 1,000 / TPM 2M  → workers=5
#   - claude-sonnet-4.6: RPM 50 / TPM 30K   → workers=2 (429 방지)
#   - gpt-5.2:           RPM 500 / TPM 500K → workers=5
GENERATION_MAX_WORKERS: Dict[str, int] = {
    "anthropic": 2,
    "google":    5,
    "openai":    5,
}

# 429 발생 시 다른 provider 폴백
QUOTA_FALLBACK_MODELS: Dict[str, str] = {
    "anthropic": "gemini-flash",
    "google":    "gpt-5.2",
    "openai":    "gemini-flash",
}


def _get_generation_workers(model: str) -> int:
    m = model.lower()
    if "claude" in m:
        return GENERATION_MAX_WORKERS["anthropic"]
    if "gemini" in m:
        return GENERATION_MAX_WORKERS["google"]
    return GENERATION_MAX_WORKERS["openai"]


def _get_fallback_model(model: str) -> Optional[str]:
    provider = MODEL_CONFIG.get(model, {}).get("provider")
    fallback = QUOTA_FALLBACK_MODELS.get(provider)
    return fallback if fallback and fallback in MODEL_CONFIG else None


# ── 진입점 ─────────────────────────────────────────────────────────────────────

def run_qa_generation(
    job_id: str,
    model: str,
    lang: str,
    samples: int,
    qa_per_doc: Optional[int],
    prompt_version: str,
) -> None:
    """Background task 진입점. asyncio.run() 으로 실제/시뮬레이션 로직 실행."""
    try:
        logger.info(f"[{job_id}] Starting generation: model={model}, lang={lang}, samples={samples}")
        job_manager.update_job(
            job_id,
            status=JobStatus.RUNNING,
            progress=5,
            message="Initializing generation pipeline...",
        )
        asyncio.run(
            run_qa_generation_real(job_id, model, lang, samples, qa_per_doc, prompt_version)
        )
    except Exception as e:
        error_msg = str(e)
        logger.error(f"[{job_id}] Generation failed: {error_msg}", exc_info=True)
        job_manager.update_job(
            job_id,
            status=JobStatus.FAILED,
            progress=0,
            error=error_msg,
            message="Generation failed",
        )


# ── 실제 생성 로직 ──────────────────────────────────────────────────────────────

async def run_qa_generation_real(
    job_id: str,
    model: str,
    lang: str,
    samples: int,
    qa_per_doc: Optional[int],
    prompt_version: str,
) -> None:
    """실제 QA 생성: Vector DB → 도메인 프로파일 → 병렬 생성 → Supabase 저장."""
    job_manager.update_job(job_id, progress=5, message="Loading document data...")

    config = job_manager.get_job(job_id).config or {}
    h1 = config.get("hierarchy_h1")
    h2 = config.get("hierarchy_h2")
    h3 = config.get("hierarchy_h3")
    r_query = config.get("retrieval_query")
    doc_filename = config.get("filename")
    document_id = config.get("document_id")

    logger.info(
        f"[{job_id}] Config: filename={doc_filename!r}, "
        f"h1={h1!r}, h2={h2!r}, h3={h3!r}, document_id={document_id!r}"
    )

    items: list = []

    from config.supabase_client import (
        get_doc_chunks_by_filter,
        get_doc_chunks_by_ids,
        search_doc_chunks,
    )

    if is_supabase_available() and (h1 or h2 or h3 or r_query or doc_filename):
        logger.info(f"[{job_id}] Using Vector DB retrieval (filters present)")
        job_manager.update_job(job_id, message="Searching Vector DB...")

        filter_dict: Dict[str, str] = {}
        if h1:
            filter_dict["hierarchy_h1"] = h1
        if h2:
            filter_dict["hierarchy_h2"] = h2
        if h3:
            filter_dict["hierarchy_h3"] = h3

        query_vector = None
        if r_query:
            from google import genai as google_genai

            gemini_client = google_genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
            res = await gemini_client.aio.models.embed_content(
                model="gemini-embedding-2-preview",
                contents=r_query,
                config=google_genai.types.EmbedContentConfig(
                    task_type="RETRIEVAL_QUERY",
                    output_dimensionality=1536,
                ),
            )
            v_np = np.array(res.embeddings[0].values)
            v_norm = np.linalg.norm(v_np)
            query_vector = (v_np / v_norm).tolist() if v_norm > 0 else res.embeddings[0].values

        if query_vector is not None:
            chunks = await search_doc_chunks(
                query_embedding=query_vector,
                match_threshold=0.3,
                match_count=samples,
                filter=filter_dict,
            )
        else:
            if document_id and doc_filename:
                from db.doc_chunk_repo import get_doc_chunks_sampled

                chunks = await get_doc_chunks_sampled(
                    filename=doc_filename,
                    n=max(samples * 3, 30),
                    document_id=document_id,
                )
                logger.info(f"[{job_id}] Chunks fetched via sample_doc_chunks(document_id): {len(chunks)}")
                if chunks and (h1 or h2 or h3):
                    chunks = [
                        c
                        for c in chunks
                        if (not h1 or c.get("metadata", {}).get("hierarchy_h1") == h1)
                        and (not h2 or c.get("metadata", {}).get("hierarchy_h2") == h2)
                        and (not h3 or c.get("metadata", {}).get("hierarchy_h3") == h3)
                    ]
                    logger.info(f"[{job_id}] After hierarchy filter: {len(chunks)}")
            else:
                chunks = await get_doc_chunks_by_filter(
                    hierarchy_h1=h1,
                    hierarchy_h2=h2,
                    hierarchy_h3=h3,
                    filename=doc_filename,
                    document_id=document_id,
                    limit=max(samples * 3, 30),
                )

            if not chunks and (h1 or h2 or h3):
                raise ValueError(
                    f"선택한 계층(h1={h1!r}, h2={h2!r})에 해당하는 청크가 없습니다. "
                    "Pass3 Hierarchy 태깅이 완료됐는지 확인하세요."
                )

        logger.info(f"[{job_id}] Raw chunks from DB: {len(chunks)} (before skip filter)")

        if chunks:
            untagged = [c for c in chunks if not c.get("metadata", {}).get("hierarchy_h1")]
            if len(untagged) > len(chunks) * 0.3:
                raise ValueError(
                    f"hierarchy 태깅이 완료되지 않았습니다 "
                    f"({len(untagged)}/{len(chunks)}개 미태깅). Pass3 태깅을 다시 실행해 주세요."
                )

        _COLOPHON_KEYWORDS = ["발행처:", "발행인:", "저작권", "©", "무단전재", "재배포를 금"]

        def _should_skip(chunk: dict) -> bool:
            meta = chunk.get("metadata", {})
            content = chunk.get("content", "")
            if meta.get("chunk_type") == "heading":
                return True
            if meta.get("hierarchy_h1") == "__admin__":
                return True
            if sum(1 for kw in _COLOPHON_KEYWORDS if kw in content) >= 2:
                return True
            return False

        skipped = 0
        untagged_skipped = 0
        for c in chunks:
            if _should_skip(c):
                skipped += 1
                logger.debug(
                    f"[{job_id}] Skipped chunk "
                    f"({c.get('metadata', {}).get('chunk_type', '?')}): "
                    f"{c.get('content', '')[:40]!r}"
                )
                continue
            meta = c.get("metadata", {})
            if not meta.get("hierarchy_h1"):
                untagged_skipped += 1
                logger.debug(f"[{job_id}] Skipped untagged chunk: {c.get('content', '')[:40]!r}")
                continue
            items.append(
                {
                    "docId": c.get("id"),
                    "hierarchy": [
                        meta.get("hierarchy_h1"),
                        meta.get("hierarchy_h2"),
                        meta.get("hierarchy_h3"),
                    ],
                    "text": c.get("content"),
                    "metadata": meta,
                }
            )
        if untagged_skipped:
            logger.warning(
                f"[{job_id}] Skipped {untagged_skipped} untagged chunks — re-run Pass3 if unexpected"
            )

        logger.info(f"[{job_id}] Vector DB found {len(items)} chunks (skipped {skipped})")

    if not items:
        if is_supabase_available():
            raise ValueError(
                "QA 생성에 필요한 문서 청크를 찾을 수 없습니다. "
                "데이터 규격화 페이지에서 문서를 먼저 업로드·인제스션한 후 "
                "H1/H2 계층을 선택하고 다시 시도하세요."
            )
        # Supabase 미사용 환경: 로컬 JSON 폴백
        logger.info(f"[{job_id}] Supabase unavailable — trying local JSON fallback")
        data_file = Path(__file__).parent.parent / "ref/data/data_2026-03-06_normalized.json"
        if not data_file.exists():
            raise FileNotFoundError(
                f"로컬 데이터 파일을 찾을 수 없습니다: {data_file}\n"
                "Supabase 연결을 확인하거나 문서를 먼저 인제스션하세요."
            )
        with open(data_file, "r", encoding="utf-8") as f:
            data = f.read()
        raw = __import__("json").loads(data)
        items = raw if isinstance(raw, list) else raw.get("documents", [])
        items = items[:samples]

    if not doc_filename and items:
        doc_filename = items[0].get("metadata", {}).get("filename", "") or ""
        if doc_filename:
            logger.info(f"[{job_id}] doc_filename inferred from chunks: {doc_filename!r}")

    logger.info(f"[{job_id}] Loaded {len(items)} items for generation")
    job_manager.update_job(job_id, progress=10, message=f"Loaded {len(items)} items")

    # ── 도메인 프로파일 조회 ──────────────────────────────────────────────────────
    from generators.domain_profiler import GENERIC_DOMAIN_PROFILE, analyze_domain

    job_manager.update_job(job_id, progress=12, message="Loading domain profile...")
    domain_profile = None

    if document_id or doc_filename:
        try:
            from db.doc_metadata_repo import get_doc_metadata, get_doc_metadata_by_filename

            meta_row = None
            if document_id:
                meta_row = await get_doc_metadata(document_id)
            if not meta_row and doc_filename:
                meta_row = await get_doc_metadata_by_filename(doc_filename)
                if meta_row and not document_id:
                    document_id = meta_row.get("document_id")
            if meta_row and meta_row.get("domain_profile"):
                domain_profile = meta_row["domain_profile"]
                logger.info(f"[{job_id}] Domain profile from doc_metadata: '{domain_profile.get('domain', '?')}'")
        except Exception as _e:
            logger.warning(f"[{job_id}] doc_metadata fetch failed, fallback to analyze_domain: {_e}")

    if not domain_profile:
        job_manager.update_job(job_id, progress=13, message="Analyzing document domain (LLM)...")
        domain_profile = await analyze_domain(
            hierarchy_h1=h1,
            hierarchy_h2=h2,
            hierarchy_h3=h3,
            model=model,
        )
        logger.info(
            f"[{job_id}] Domain profile (LLM): '{domain_profile.get('domain', '?')}' | "
            f"key_terms={domain_profile.get('key_terms', [])[:3]}"
        )

    # ── 병렬 QA 생성 ──────────────────────────────────────────────────────────────
    max_workers = _get_generation_workers(model)
    logger.info(f"[{job_id}] Parallel generation: {len(items)} chunks x workers={max_workers} ({model})")

    results_map: Dict[int, Any] = {}
    total_input_tokens = 0
    total_output_tokens = 0
    token_lock = Lock()
    completed_count = 0
    progress_lock = Lock()

    fatal_error: list = []
    active_model = [model]

    def _generate_one(args):
        idx, item = args
        if fatal_error:
            return idx, None, "aborted"
        current_model = active_model[0]
        try:
            chunk_type = item.get("metadata", {}).get("chunk_type", "body")
            sys_prompt = build_system_prompt(domain_profile, lang)
            usr_template = build_user_template(domain_profile, chunk_type)
            result = _generate_qa(
                item,
                current_model,
                lang,
                prompt_version,
                system_prompt=sys_prompt,
                user_template=usr_template,
            )
            if qa_per_doc and result.get("qa_list"):
                result["qa_list"] = result["qa_list"][:qa_per_doc]
            return idx, result, None
        except Exception as e:
            if isinstance(e, APIQuotaExceededError):
                fallback = _get_fallback_model(current_model)
                if fallback:
                    with progress_lock:
                        if active_model[0] == current_model:
                            active_model[0] = fallback
                            logger.warning(
                                f"[{job_id}] {current_model} 429 한도 초과 → {fallback}으로 전환"
                            )
                            job_manager.update_job(
                                job_id,
                                message=f"모델 전환: {MODEL_CONFIG[fallback]['name']}으로 재시도 중...",
                            )
                    try:
                        chunk_type = item.get("metadata", {}).get("chunk_type", "body")
                        sys_prompt = build_system_prompt(domain_profile, lang)
                        usr_template = build_user_template(domain_profile, chunk_type)
                        result = _generate_qa(
                            item,
                            fallback,
                            lang,
                            prompt_version,
                            system_prompt=sys_prompt,
                            user_template=usr_template,
                        )
                        if qa_per_doc and result.get("qa_list"):
                            result["qa_list"] = result["qa_list"][:qa_per_doc]
                        return idx, result, None
                    except Exception as e2:
                        logger.error(f"[{job_id}] Fallback {fallback} also failed: {e2}")
                        if not fatal_error:
                            fatal_error.append(str(e2))
                        return idx, None, str(e2)
                else:
                    logger.error(f"[{job_id}] API quota exceeded, no fallback: {e}")
                    if not fatal_error:
                        fatal_error.append(str(e))
                    return idx, None, str(e)
            if isinstance(e, APIAuthError):
                logger.error(f"[{job_id}] API auth error, aborting: {e}")
                if not fatal_error:
                    fatal_error.append(str(e))
                return idx, None, str(e)
            logger.warning(f"[{job_id}] Failed to generate QA for doc {idx + 1}: {e}")
            return idx, None, str(e)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(_generate_one, (i, item)): i for i, item in enumerate(items)
        }
        for future in as_completed(futures):
            idx, result, error = future.result()

            if fatal_error:
                executor.shutdown(wait=False, cancel_futures=True)
                job_manager.update_job(
                    job_id,
                    status=JobStatus.FAILED,
                    progress=0,
                    error=fatal_error[0],
                    message=fatal_error[0],
                )
                return

            with progress_lock:
                completed_count += 1
                cnt = completed_count

            if result is not None:
                results_map[idx] = result
                with token_lock:
                    total_input_tokens += result.get("input_tokens", 0)
                    total_output_tokens += result.get("output_tokens", 0)

            progress = 10 + int(cnt / len(items) * 80)
            job_manager.update_job(
                job_id,
                progress=progress,
                message=f"Generating QA pairs ({cnt}/{len(items)})...",
            )

    results = [results_map[i] for i in range(len(items)) if i in results_map]

    if not results:
        raise Exception("No QA pairs were generated")

    job_manager.update_job(job_id, progress=92, message="Saving results...")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    lang_suffix = "ko" if lang == "ko" else "en"
    result_filename = f"qa_{model}_{lang_suffix}_{prompt_version}_{timestamp}.json"

    output_data = {
        "config": {
            "model": model,
            "lang": lang,
            "prompt_version": prompt_version,
            "samples": len(items),
            "timestamp": timestamp,
        },
        "statistics": {
            "total_docs": len(items),
            "total_qa": sum(len(r.get("qa_list", [])) for r in results),
            "total_input_tokens": total_input_tokens,
            "total_output_tokens": total_output_tokens,
        },
        "results": results,
    }

    supabase_id = None
    try:
        if is_supabase_available():
            total_qa = output_data["statistics"]["total_qa"]

            if total_qa == 0:
                msg = "선택한 계층의 컨텍스트가 부족하여 QA를 생성할 수 없습니다."
                job_manager.update_job(
                    job_id, status=JobStatus.FAILED, progress=0, error=msg, message=msg
                )
                logger.warning(f"QA generation produced 0 results — skipping DB save (job_id={job_id})")
                return

            total_docs = output_data["statistics"]["total_docs"]
            input_tokens = output_data["statistics"].get("total_input_tokens", 0)
            output_tokens = output_data["statistics"].get("total_output_tokens", 0)

            cost_per_1m_input = {
                "gemini-3.1-flash": 0.3,
                "claude-sonnet": 3.0,
                "gpt-5.2": 1.75,
            }.get(model, 0)
            cost_per_1m_output = {
                "gemini-3.1-flash": 1.2,
                "claude-sonnet": 15.0,
                "gpt-5.2": 14.0,
            }.get(model, 0)
            estimated_cost = (
                input_tokens * cost_per_1m_input + output_tokens * cost_per_1m_output
            ) / 1_000_000

            supabase_id = await save_qa_generation_to_supabase(
                job_id=job_id,
                metadata={
                    "generation_model": MODEL_CONFIG.get(model, {}).get("model_id", model),
                    "lang": lang,
                    "prompt_version": prompt_version,
                    "source_doc": doc_filename or "",
                    "document_id": document_id or "",
                    "hierarchy_h1": h1 or "",
                    "hierarchy_h2": h2 or "",
                    "hierarchy_h3": h3 or "",
                },
                stats={
                    "total_qa": total_qa,
                    "total_documents": total_docs,
                    "total_tokens_input": input_tokens,
                    "total_tokens_output": output_tokens,
                    "estimated_cost": round(estimated_cost, 4),
                },
                qa_list=output_data["results"],
            )

            if supabase_id:
                logger.info(f"[{job_id}] Saved to Supabase: {supabase_id}")
            else:
                logger.warning(f"[{job_id}] Supabase save returned None")
        else:
            logger.warning(f"[{job_id}] Supabase not available, skipping save")
    except Exception as e:
        logger.error(f"[{job_id}] Error saving to Supabase: {e}")

    job_manager.update_job(
        job_id,
        status=JobStatus.COMPLETED,
        progress=100,
        message="Generation completed successfully",
        result_file=result_filename,
        result_id=supabase_id,
    )
    logger.info(f"[{job_id}] Generation completed successfully")


# ── 시뮬레이션 폴백 ─────────────────────────────────────────────────────────────

async def run_qa_generation_simulation(
    job_id: str,
    model: str,
    lang: str,
    samples: int,
    qa_per_doc: Optional[int],
    prompt_version: str,
) -> None:
    """qa_generator 미사용 환경용 시뮬레이션 폴백."""
    import time

    steps = [
        (20, "Loading document hierarchy..."),
        (35, "Parsing documents..."),
        (50, "Generating QA pairs (50%)..."),
        (65, "Generating QA pairs (65%)..."),
        (80, "Saving results..."),
        (95, "Finalizing..."),
    ]
    for progress, msg in steps:
        job_manager.update_job(job_id, progress=progress, message=msg)
        time.sleep(1)

    result_filename = (
        f"qa_{model}_{lang}_{prompt_version}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    )
    result_data = {
        "config": {
            "model": model,
            "lang": lang,
            "samples": samples,
            "prompt_version": prompt_version,
            "timestamp": datetime.now().isoformat(),
        },
        "statistics": {
            "total_qa": samples * 8,
            "tokens_used": 1951 * samples,
            "documents_processed": samples,
            "_note": "Simulation mode (qa_generator not available)",
        },
        "qa_pairs": [
            {"doc_id": f"doc_{i}", "question": f"Sample question {i}", "answer": f"Sample answer {i}"}
            for i in range(samples * 8)
        ],
    }

    supabase_id = None
    try:
        if is_supabase_available():
            supabase_id = await save_qa_generation_to_supabase(
                job_id=job_id,
                metadata={
                    "generation_model": MODEL_CONFIG.get(model, {}).get("model_id", model),
                    "lang": lang,
                    "prompt_version": prompt_version,
                    "source_doc": "",
                },
                stats={
                    "total_qa": samples * 8,
                    "total_documents": samples,
                    "total_tokens_input": 0,
                    "total_tokens_output": 0,
                    "estimated_cost": 0.0,
                },
                qa_list=result_data["qa_pairs"],
            )
    except Exception as e:
        logger.error(f"[{job_id}] Error saving to Supabase (simulation): {e}")

    job_manager.update_job(
        job_id,
        status=JobStatus.COMPLETED,
        progress=100,
        message="Generation completed (simulation mode)",
        result_file=result_filename,
        result_id=supabase_id,
    )
