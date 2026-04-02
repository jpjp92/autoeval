"""
ingestion/pipeline.py

문서 인제스션 핵심 파이프라인:
  청킹 → Gemini Embedding 2 → Supabase 저장
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any, Dict, List
from uuid import uuid4

import numpy as np
from google import genai as google_genai

from config.supabase_client import save_doc_chunks_batch
from db.doc_metadata_repo import upsert_doc_metadata
from ingestion.chunker import ingest_with_llm_chunking, ingest_with_rule_chunking
from ingestion.parsers import detect_repeated_headers

logger = logging.getLogger("autoeval.ingestion.pipeline")

_EMBED_MODEL = "gemini-embedding-2-preview"
_EMBED_BATCH_SIZE = 64


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
) -> None:
    """배치 임베딩 후 Supabase 저장."""
    batch_texts = [item["text"] for item in batch]
    res = await gemini_client.aio.models.embed_content(
        model=_EMBED_MODEL,
        contents=batch_texts,
        config=google_genai.types.EmbedContentConfig(
            task_type="RETRIEVAL_DOCUMENT",
            output_dimensionality=1536,
        ),
    )
    batch_rows = []
    for idx, emb_data in enumerate(res.embeddings):
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
    logger.info(f"[{filename}] Embed batch {batch_num} done ({len(batch)} chunks)")


async def process_and_ingest(
    filename: str,
    pages: List[Dict[str, Any]],
    metadata: Dict[str, Any],
    gemini_client: Any,
    model_id: str,
    chunking_method: str = "llm",
) -> None:
    """청킹 → Gemini Embedding 2 → Supabase 저장.

    chunking_method:
      "llm"  — Gemini 2.5 Flash LLM 청킹 (기본, 품질 우선)
      "rule" — rule-based 청킹 (parsers.chunk_blocks_aware, 하위 호환)
    """
    try:
        doc_id = str(uuid4())
        ingested_at = datetime.utcnow().isoformat()

        await upsert_doc_metadata(document_id=doc_id, filename=filename)

        repeated_headers = detect_repeated_headers(pages)
        if repeated_headers:
            logger.info(f"[{filename}] Repeated headers: {list(repeated_headers)[:5]}")

        all_blocks: List[Dict[str, Any]] = []
        for page_data in pages:
            all_blocks.extend(page_data.get("blocks", []))

        if not all_blocks:
            logger.warning(f"[{filename}] No blocks extracted.")
            return

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
            return

        total_chunks = len(all_chunks_to_embed)
        source_ext = filename.split('.')[-1].lower() if '.' in filename else 'unknown'

        embed_kwargs = dict(
            filename=filename,
            doc_id=doc_id,
            metadata=metadata,
            chunking_method=chunking_method,
            source_ext=source_ext,
            ingested_at=ingested_at,
            total_chunks=total_chunks,
            gemini_client=gemini_client,
        )

        embed_tasks = [
            _embed_and_save(
                i // _EMBED_BATCH_SIZE + 1,
                i,
                all_chunks_to_embed[i: i + _EMBED_BATCH_SIZE],
                **embed_kwargs,
            )
            for i in range(0, total_chunks, _EMBED_BATCH_SIZE)
        ]
        await asyncio.gather(*embed_tasks)

        logger.info(
            f"Ingestion complete: {filename} "
            f"({total_chunks} chunks, method={chunking_method})"
        )

    except Exception as e:
        logger.error(f"Ingestion pipeline failed for {filename}: {e}", exc_info=True)
