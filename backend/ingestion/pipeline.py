"""
ingestion/pipeline.py

문서 인제스션 핵심 파이프라인:
  청킹 → Gemini Embedding 2 → Supabase 저장
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import uuid4

import numpy as np
from google import genai as google_genai

from config.supabase_client import save_doc_chunks_batch
from db.doc_metadata_repo import upsert_doc_metadata
from exceptions import APIQuotaExceededError
from ingestion.chunker import ingest_with_llm_chunking, ingest_with_rule_chunking
from ingestion.job_manager import IngestionStatus, ingestion_job_manager
from ingestion.parsers import detect_repeated_headers

logger = logging.getLogger("autoeval.ingestion.pipeline")

_EMBED_SEM = asyncio.Semaphore(int(os.getenv("EMBED_CONCURRENCY", "5")))

_EMBED_MODEL = os.getenv("EMBED_MODEL", "gemini-embedding-2")
_EMBED_BATCH_SIZE = int(os.getenv("EMBED_BATCH_SIZE", "64"))


def _embedding_quota_hint(error_text: str) -> str:
    """Return an operator-facing hint for common Gemini embedding quota failures."""
    if "aiplatform.googleapis.com" in error_text or "online_prediction_requests_per_base_model" in error_text:
        return (
            "Vertex AI base-model quota 제한입니다. Render 환경의 "
            "GOOGLE_GENAI_USE_VERTEXAI / GOOGLE_CLOUD_PROJECT / GOOGLE_CLOUD_LOCATION 값과 "
            "Google Cloud 콘솔에서 확인한 프로젝트·리전·base model(gemini-embedding-2)이 "
            "일치하는지 확인하세요."
        )
    return (
        "Gemini API quota/rate limit 제한입니다. API key가 연결된 프로젝트의 "
        "embedding 모델 quota와 결제/tier 상태를 확인하세요."
    )


def _uses_embedding_2() -> bool:
    return _EMBED_MODEL == "gemini-embedding-2"


def _document_embedding_input(chunk: Dict[str, Any]) -> str:
    title = chunk.get("section_title") or ""
    text = chunk.get("text") or chunk.get("raw_text") or ""
    if _uses_embedding_2():
        return f"title: {title}\ntext: {text}" if title else f"text: {text}"
    return text


def _embed_config(document: bool = True) -> google_genai.types.EmbedContentConfig:
    if _uses_embedding_2():
        return google_genai.types.EmbedContentConfig(output_dimensionality=1536)
    return google_genai.types.EmbedContentConfig(
        task_type="RETRIEVAL_DOCUMENT" if document else "RETRIEVAL_QUERY",
        output_dimensionality=1536,
    )


async def _embed_and_save_guarded(*args, **kwargs) -> None:
    async with _EMBED_SEM:
        await _embed_and_save(*args, **kwargs)


async def _embed_and_save(
    batch_num: int,
    batch_start: int,
    batch: List[Dict[str, Any]],
    *,
    filename: str,
    doc_id: str,
    metadata: Dict[str, Any],
    chunking_method: str,
    source_ext: str,
    ingested_at: str,
    total_chunks: int,
    gemini_client: Any,
    job_id: Optional[str] = None,
) -> None:
    """배치 임베딩 후 Supabase 저장."""
    for attempt in range(3):
        try:
            if _uses_embedding_2():
                embeddings = []
                for item in batch:
                    res = await gemini_client.aio.models.embed_content(
                        model=_EMBED_MODEL,
                        contents=_document_embedding_input(item),
                        config=_embed_config(document=True),
                    )
                    embeddings.append(res.embeddings[0])
            else:
                res = await gemini_client.aio.models.embed_content(
                    model=_EMBED_MODEL,
                    contents=[item["text"] for item in batch],
                    config=_embed_config(document=True),
                )
                embeddings = res.embeddings
            break
        except Exception as e:
            err_str = str(e)
            if "429" in err_str or "quota" in err_str.lower() or "resource_exhausted" in err_str.lower():
                hint = _embedding_quota_hint(err_str)
                logger.error(f"[{filename}] 임베딩 API quota/rate limit (429) — 즉시 중단: {e} | {hint}")
                raise APIQuotaExceededError(f"Gemini Embedding API 한도 초과: {e}. {hint}") from e
            if attempt == 2:
                raise
            wait = 2 ** attempt
            logger.warning(f"[{filename}] embed_content retry {attempt + 1}/3 (wait={wait}s): {e}")
            await asyncio.sleep(wait)
    batch_rows = []
    if len(embeddings) != len(batch):
        raise ValueError(f"Embedding count mismatch: got {len(embeddings)}, expected {len(batch)}")

    for idx, emb_data in enumerate(embeddings):
        c = batch[idx]
        embedding_np = np.array(emb_data.values)
        norm = np.linalg.norm(embedding_np)
        normalized_embedding = (embedding_np / norm).tolist() if norm > 0 else emb_data.values
        chunk_metadata = {
            **metadata,
            "filename": filename,
            "content_hash": c["hash"],
            "section_title": c["section_title"],
            "chunk_type": c["chunk_type"],
            "page": c["page"],
            "char_length": len(c["raw_text"]),
            "chunk_index": batch_start + idx,
            "total_chunks": total_chunks,
            "chunking_method": chunking_method,
            "source": source_ext,
            "ingested_at": ingested_at,
            "embedding_model": _EMBED_MODEL,
        }
        batch_rows.append({
            "content":     c["raw_text"],
            "embedding":   normalized_embedding,
            "metadata":    chunk_metadata,
            "document_id": doc_id,
        })
    await save_doc_chunks_batch(batch_rows)
    if job_id:
        ingestion_job_manager.update_job(job_id, progress=batch_num)
    logger.info(f"[{filename}] Embed batch {batch_num} done ({len(batch)} chunks)")


async def process_and_ingest(
    filename: str,
    pages: List[Dict[str, Any]],
    metadata: Dict[str, Any],
    gemini_client: Any,
    model_id: str,
    chunking_method: str = "llm",
    job_id: Optional[str] = None,
) -> None:
    """청킹 → Gemini Embedding 2 → Supabase 저장.

    chunking_method:
      "llm"  — Gemini 2.5 Flash LLM 청킹 (기본, 품질 우선)
      "rule" — rule-based 청킹 (parsers.chunk_blocks_aware, 하위 호환)

    job_id: IngestionJobManager job ID. 전달 시 단계별 상태 업데이트.
    """

    def _update(status=None, **kwargs):
        if job_id:
            ingestion_job_manager.update_job(job_id, status=status, **kwargs)

    try:
        doc_id = str(uuid4())
        ingested_at = datetime.utcnow().isoformat()

        await upsert_doc_metadata(document_id=doc_id, filename=filename)
        if job_id:
            ingestion_job_manager.update_job(job_id, doc_id=doc_id)

        repeated_headers = detect_repeated_headers(pages)
        if repeated_headers:
            logger.info(f"[{filename}] Repeated headers: {list(repeated_headers)[:5]}")

        all_blocks: List[Dict[str, Any]] = []
        for page_data in pages:
            all_blocks.extend(page_data.get("blocks", []))

        if not all_blocks:
            logger.warning(f"[{filename}] No blocks extracted.")
            _update(status=IngestionStatus.FAILED, error="추출된 블록 없음")
            return

        _update(status=IngestionStatus.CHUNKING, message="청킹 중")
        if chunking_method == "llm":
            all_chunks_to_embed = await ingest_with_llm_chunking(
                filename, pages, all_blocks, repeated_headers,
                gemini_client=gemini_client, model_id=model_id,
            )
        else:
            all_chunks_to_embed = ingest_with_rule_chunking(
                filename, all_blocks, repeated_headers,
            )

        if not all_chunks_to_embed:
            logger.error(f"[{filename}] 0 chunks produced")
            _update(status=IngestionStatus.FAILED, error="청크 생성 결과 없음")
            return

        total_chunks = len(all_chunks_to_embed)
        total_batches = (total_chunks + _EMBED_BATCH_SIZE - 1) // _EMBED_BATCH_SIZE
        source_ext = filename.split('.')[-1].lower() if '.' in filename else 'unknown'

        _update(
            status=IngestionStatus.EMBEDDING,
            message="임베딩 중",
            progress=0,
            total=total_batches,
        )

        embed_kwargs = dict(
            filename=filename,
            doc_id=doc_id,
            metadata=metadata,
            chunking_method=chunking_method,
            source_ext=source_ext,
            ingested_at=ingested_at,
            total_chunks=total_chunks,
            gemini_client=gemini_client,
            job_id=job_id,
        )

        embed_tasks = [
            _embed_and_save_guarded(
                i // _EMBED_BATCH_SIZE + 1,
                i,
                all_chunks_to_embed[i: i + _EMBED_BATCH_SIZE],
                **embed_kwargs,
            )
            for i in range(0, total_chunks, _EMBED_BATCH_SIZE)
        ]
        await asyncio.gather(*embed_tasks)

        _update(
            status=IngestionStatus.COMPLETED,
            progress=total_batches,
            message=f"완료 ({total_chunks}청크, method={chunking_method})",
        )
        logger.info(
            f"Ingestion complete: {filename} "
            f"({total_chunks} chunks, method={chunking_method})"
        )

    except Exception as e:
        logger.error(f"Ingestion pipeline failed for {filename}: {e}", exc_info=True)
        _update(status=IngestionStatus.FAILED, error=str(e))
