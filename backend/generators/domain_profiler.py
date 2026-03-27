"""
Domain Profiler — 폴백 전용 (정상 플로우에서는 호출되지 않음)

정상 플로우:
  /analyze-hierarchy 실행 시 domain_profile을 함께 생성 → doc_metadata 저장
  QA 생성 시 doc_metadata에서 조회하여 재사용 (LLM 호출 없음)

폴백 케이스 (이 모듈이 호출되는 경우):
  /analyze-hierarchy를 건너뛰고 바로 QA 생성한 경우,
  또는 doc_metadata에 domain_profile이 없는 경우.
  doc_chunks 샘플 → LLM 분석 → domain_profile 반환.
  실패 시 GENERIC_DOMAIN_PROFILE 반환 (생성 파이프라인 중단 없음)

domain_profile 구조: {domain, domain_short, target_audience, key_terms, tone}
"""

import json
import logging
import os
from typing import Optional

logger = logging.getLogger("autoeval.domain_profiler")

# ============= Generic Fallback =============

GENERIC_DOMAIN_PROFILE = {
    "domain": "문서",
    "domain_short": "문서",
    "target_audience": "독자",
    "key_terms": [],
    "tone": "격식체",
}

# ============= Analysis Prompt =============

_SYSTEM_PROMPT = (
    "You are a document domain analysis expert. "
    "Analyze the provided document chunk samples and return a domain profile as pure JSON. "
    "Output only valid JSON with no markdown. "
    "All string values in the JSON (domain, target_audience, main_topics, key_terms, tone) "
    "must be written in Korean (한국어)."
)


def _build_analysis_prompt(samples: list) -> str:
    lines = ["The following are chunk samples extracted from a document:\n"]
    for i, s in enumerate(samples, 1):
        meta = s.get("metadata", {})
        content = s.get("content", "")[:400]
        lines.append(
            f"[Chunk {i}] "
            f"H1={meta.get('hierarchy_h1', '?')} / "
            f"H2={meta.get('hierarchy_h2', '?')} / "
            f"type={meta.get('chunk_type', '?')}\n"
            f"{content}\n"
        )

    lines.append(
        "\nAnalyze the samples above and return a JSON object with the following structure.\n"
        "IMPORTANT: All string values must be written in Korean (한국어).\n"
        "{\n"
        '  "domain": "문서 분야/유형 — Korean (예: AI 데이터 구축 가이드라인)",\n'
        '  "domain_short": "짧은 도메인명 — Korean, 10 chars max",\n'
        '  "target_audience": "주요 독자층 — Korean (예: 데이터 구축 작업자)",\n'
        '  "key_terms": ["전문용어1 (Korean)", "전문용어2", "전문용어3", "전문용어4", "전문용어5"],\n'
        '  "tone": "문서 문체 — Korean (예: 기술 문서 격식체)"\n'
        "}\n"
        "Output pure JSON only. No markdown, no explanation."
    )
    return "\n".join(lines)


# ============= LLM Call =============

def _resolve_model_id(model: str) -> str:
    """model alias → 실제 model_id"""
    try:
        from config.models import MODEL_CONFIG
        return MODEL_CONFIG.get(model, {}).get("model_id", model)
    except ImportError:
        return model


def _call_llm(model: str, user_prompt: str) -> str:
    """동기 LLM 호출. 모델 provider에 따라 분기."""
    m = model.lower()
    model_id = _resolve_model_id(model)

    if "claude" in m:
        import anthropic
        client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        response = client.messages.create(
            model=model_id,
            max_tokens=2048,
            temperature=0.2,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
        return response.content[0].text.strip()

    if "gemini" in m:
        from google import genai as google_genai
        client = google_genai.Client(api_key=os.environ.get("GOOGLE_API_KEY"))
        response = client.models.generate_content(
            model=model_id,
            contents=_SYSTEM_PROMPT + "\n\n" + user_prompt,
            config=google_genai.types.GenerateContentConfig(temperature=0.2),
        )
        return response.text.strip()

    # OpenAI default
    from openai import OpenAI
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    response = client.chat.completions.create(
        model=model_id,
        max_completion_tokens=2048,
        temperature=0.2,
        messages=[
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ],
    )
    return response.choices[0].message.content.strip()


# ============= Main Entry Point =============

async def analyze_domain(
    hierarchy_h1: Optional[str] = None,
    hierarchy_h2: Optional[str] = None,
    hierarchy_h3: Optional[str] = None,
    model: str = "gpt-5.1",
    anchor_ids: Optional[list] = None,
) -> dict:
    """
    doc_chunks에서 샘플을 조회하고 LLM으로 도메인을 분석한다.
    실패 시 GENERIC_DOMAIN_PROFILE을 반환 (생성 파이프라인 중단 없음).

    Args:
        hierarchy_h1/h2/h3: 현재 job의 hierarchy 필터 (anchor_ids 없을 때 사용)
        model: 도메인 분석에 사용할 LLM
        anchor_ids: analyze-hierarchy에서 고정된 균등 샘플 청크 ID 목록
    Returns:
        domain_profile dict
    """
    from config.supabase_client import get_doc_chunks_by_filter, get_doc_chunks_by_ids, is_supabase_available

    if not is_supabase_available():
        logger.warning("[domain_profiler] Supabase unavailable , using GENERIC fallback")
        return GENERIC_DOMAIN_PROFILE.copy()

    try:
        # anchor_ids 있으면 재사용 (균등 분포 보장), 없으면 h1/h2 필터 조회
        if anchor_ids:
            samples = await get_doc_chunks_by_ids(anchor_ids[:10])
        else:
            samples = await get_doc_chunks_by_filter(
                hierarchy_h1=hierarchy_h1,
                hierarchy_h2=hierarchy_h2,
                hierarchy_h3=hierarchy_h3,
                limit=10,
            )

        if not samples:
            logger.warning("[domain_profiler] No chunks found , using GENERIC fallback")
            return GENERIC_DOMAIN_PROFILE.copy()

        # LLM 분석 프롬프트 구성
        prompt = _build_analysis_prompt(samples)

        # LLM 호출 (동기)
        raw = _call_llm(model, prompt)

        # JSON 파싱
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
        profile = json.loads(raw)

        logger.info(
            f"[domain_profiler] Domain: '{profile.get('domain', '?')}' | "
            f"Audience: {profile.get('target_audience', '?')} | "
            f"Terms: {profile.get('key_terms', [])[:3]}"
        )
        return profile

    except Exception as e:
        logger.warning(f"[domain_profiler] Analysis failed ({e}) , using GENERIC fallback")
        return GENERIC_DOMAIN_PROFILE.copy()
