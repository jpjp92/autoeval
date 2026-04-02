"""
ingestion/tagging.py

청크 hierarchy 태깅 관련 핵심 로직.

  - _is_admin_anchor()  : 행정 메타 청크 감지
  - _make_chunk_entry() : LLM 입력용 청크 딕셔너리 생성
  - run_tagging()       : 청크 배치 병렬 태깅 코루틴 (apply_granular_tagging 에서 호출)
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any, Dict, List, Optional

from ingestion.prompts import build_tagging_prompt

logger = logging.getLogger("autoeval.ingestion.tagging")

# ── 행정 메타 청크 감지 ────────────────────────────────────────────────────
_SENTENCE_RE = re.compile(r'[가-힣]{2,}[^.\n]{5,}[다요]\b')


def _is_admin_anchor(content: str) -> bool:
    """행정 메타 청크 여부 — 내용 밀도 기반 (문서 유형 무관).

    판별 기준 (두 조건 중 하나 충족 시 True):
      1) 한글 비율 < 30%  — 날짜·번호·코드·영문 식별자 위주
      2) 완성 문장 0개    — 서술어(다/요)로 끝나는 절이 없는 조각 나열
    단, 400자 이상 청크는 내용 있는 것으로 간주하고 통과.
    """
    stripped = content.strip()
    if len(stripped) >= 400:
        return False
    korean_chars = len(re.findall(r'[가-힣]', stripped))
    korean_ratio = korean_chars / max(len(stripped), 1)
    if korean_ratio < 0.3:
        return True
    if not _SENTENCE_RE.search(stripped):
        return True
    return False


# ── 청크 입력 포맷 ─────────────────────────────────────────────────────────

def _make_chunk_entry(i: int, chunk: Dict[str, Any]) -> Dict[str, Any]:
    """LLM 입력용 청크 딕셔너리 생성."""
    meta = chunk.get("metadata") or {}
    entry: Dict[str, Any] = {
        "idx": i,
        "content": chunk["content"][:800],
        "chunk_type": meta.get("chunk_type", "body"),
        "char_length": meta.get("char_length", len(chunk["content"])),
    }
    st = (meta.get("section_title") or "").strip()
    if st:
        entry["section_title"] = st
    return entry


# ── 배치 태깅 코루틴 ───────────────────────────────────────────────────────

async def run_tagging(
    filename: str,
    all_chunks: List[Dict[str, Any]],
    gemini_client: Any,
    model_id: str,
    h2_h3_master: Optional[Dict[str, Dict[str, List[str]]]] = None,
    selected_h1_list: Optional[List[str]] = None,
    patch_fn: Any = None,        # patch_chunk_hierarchy RPC 함수 (DI)
    batch_size: int = 5,
    concurrency: int = 5,
) -> List[Dict[str, Any]]:
    """청크 배치 병렬 태깅.

    Args:
        patch_fn: async (chunk_id, h1, h2, h3) → None 형태의 DB 패치 함수.
                  None 이면 DB 저장을 건너뛴다 (테스트용).

    Returns:
        샘플 태깅 결과 최대 5개.
    """
    from google import genai as google_genai  # 런타임 import (순환 방지)

    batches = [all_chunks[i: i + batch_size] for i in range(0, len(all_chunks), batch_size)]
    semaphore = asyncio.Semaphore(concurrency)
    completed = 0
    samples_collected: List[Dict[str, Any]] = []

    async def process_batch(batch_idx: int, batch: List[Dict[str, Any]]) -> None:
        nonlocal completed
        async with semaphore:
            chunks_data = [_make_chunk_entry(i, c) for i, c in enumerate(batch)]
            prompt = build_tagging_prompt(
                chunks_data=chunks_data,
                h2_h3_master=h2_h3_master,
                selected_h1_list=selected_h1_list,
            )
            try:
                res = await gemini_client.aio.models.generate_content(
                    model=model_id,
                    contents=prompt,
                    config=google_genai.types.GenerateContentConfig(
                        response_mime_type="application/json",
                        temperature=0.0,
                        top_p=0.95,
                        thinking_config=google_genai.types.ThinkingConfig(thinking_budget=0),
                    ),
                )
                tagging_results = json.loads(res.text)

                update_tasks = []
                matched = 0
                for item in tagging_results:
                    idx = item.get("idx")
                    h = item.get("hierarchy", {})
                    if idx is None or not isinstance(idx, int) or idx >= len(batch):
                        continue
                    target = batch[idx]
                    if patch_fn is not None:
                        update_tasks.append(patch_fn(
                            target["id"],
                            h.get("h1"),
                            h.get("h2"),
                            h.get("h3"),
                        ))
                    matched += 1
                    if len(samples_collected) < 5 and h.get("h1") != "__admin__":
                        samples_collected.append({
                            "id": target["id"],
                            "content_preview": target["content"][:150] + "...",
                            "hierarchy": h,
                        })

                if update_tasks:
                    await asyncio.gather(*update_tasks)

                completed += 1
                logger.info(f"Batch {batch_idx + 1}/{len(batches)} tagged ({matched} updated)")
            except Exception as e:
                logger.error(f"Batch {batch_idx + 1} error: {e}")

    await asyncio.gather(*[process_batch(i, b) for i, b in enumerate(batches)])
    logger.info(f"Tagging done: {filename} ({completed}/{len(batches)} batches)")
    return samples_collected
