"""
QA Generator
generate_qa 핵심 함수 및 프로바이더별 API 호출 로직
(main.py에서 분리, generators/ 패키지로 이동)
"""

import os
import json
import logging
import re
from typing import Optional, Dict

from config.models import MODEL_CONFIG, PROMPT_VERSION
from generators.prompts import SYSTEM_PROMPT_KO_V1, USER_TEMPLATE_KO_V1
from generators.prompts_en import SYSTEM_PROMPT_EN_V1, USER_TEMPLATE_EN_V1

logger = logging.getLogger("autoeval.generator")

_clients = {}


def _extract_qa_list(raw: str) -> list:
    """응답 텍스트에서 qa_list를 추출. 전문(前文) 설명이 포함된 경우에도 처리."""
    text = raw.strip()

    # 1) ```json ... ``` 또는 ``` ... ``` 블록 추출
    if text.startswith("```"):
        text = text.split("\n", 1)[-1].rsplit("```", 1)[0].strip()

    # 2) 직접 파싱 시도
    try:
        parsed = json.loads(text)
        if isinstance(parsed, dict):
            return parsed.get("qa_list", [])
        if isinstance(parsed, list):
            return parsed
    except json.JSONDecodeError:
        pass

    # 3) 텍스트 안에 포함된 JSON 객체 추출 (Claude 전문 포함 대응)
    match = re.search(r'\{[\s\S]*"qa_list"[\s\S]*\}', text)
    if match:
        try:
            parsed = json.loads(match.group())
            return parsed.get("qa_list", [])
        except json.JSONDecodeError:
            pass

    logger.warning("JSON 파싱 실패 — 응답 앞 200자: %s", raw[:200])
    return []


def get_client(provider: str):
    """API 클라이언트 반환 (lazy loading)"""
    if provider not in _clients:
        if provider == "anthropic":
            import anthropic
            _clients[provider] = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
        elif provider == "google":
            from google import genai as google_genai
            _clients[provider] = google_genai.Client(api_key=os.environ.get("GOOGLE_API_KEY"))
        elif provider == "openai":
            import openai
            openai.api_key = os.environ.get("OPENAI_API_KEY")
            _clients[provider] = openai
    return _clients[provider]


class APIQuotaExceededError(Exception):
    """API 비용 소진 또는 Rate Limit 초과 시 발생 (job 즉시 중단용)"""
    pass


class APIAuthError(Exception):
    """API 키 인증 실패 시 발생 (job 즉시 중단용)"""
    pass


def generate_qa_anthropic(model_id: str, system_prompt: str, user_prompt: str) -> Dict:
    """Anthropic (Claude) API를 사용한 QA 생성"""
    import anthropic as _anthropic
    client = get_client("anthropic")

    try:
        response = client.messages.create(
            model=model_id,
            max_tokens=8192,
            messages=[{"role": "user", "content": user_prompt}],
            system=system_prompt,
        )
    except _anthropic.RateLimitError as e:
        raise APIQuotaExceededError(f"Anthropic API 한도 초과 (429). API 키 사용량을 확인하세요. ({e})")
    except _anthropic.AuthenticationError as e:
        raise APIAuthError(f"Anthropic API 키 인증 실패. ANTHROPIC_API_KEY를 확인하세요. ({e})")

    if response.stop_reason == "max_tokens":
        logger.warning("Anthropic 응답이 max_tokens 한도로 잘림 — 파싱 실패 가능성 있음 (output_tokens=%d)", response.usage.output_tokens)

    raw = response.content[0].text.strip()
    qa_list = _extract_qa_list(raw)

    return {
        "raw": raw,
        "qa_list": qa_list,
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
    }


def generate_qa_google(model_id: str, system_prompt: str, user_prompt: str) -> Dict:
    """Google Generative AI (Gemini) API를 사용한 QA 생성"""
    client = get_client("google")

    prompt = system_prompt + "\n\n" + user_prompt
    try:
        response = client.models.generate_content(
            model=model_id,
            contents=prompt,
        )
    except Exception as e:
        err_str = str(e)
        if "429" in err_str or "quota" in err_str.lower() or "resource_exhausted" in err_str.lower():
            raise APIQuotaExceededError(f"Google API 한도 초과 (429). API 키 사용량을 확인하세요. ({e})")
        if "401" in err_str or "api_key" in err_str.lower() or "invalid" in err_str.lower():
            raise APIAuthError(f"Google API 키 인증 실패. GOOGLE_API_KEY를 확인하세요. ({e})")
        raise

    raw = response.text.strip()
    qa_list = _extract_qa_list(raw)

    return {
        "raw": raw,
        "qa_list": qa_list,
        "input_tokens": response.usage_metadata.prompt_token_count,
        "output_tokens": response.usage_metadata.candidates_token_count,
    }


def generate_qa_openai(model_id: str, system_prompt: str, user_prompt: str) -> Dict:
    """OpenAI API를 사용한 QA 생성"""
    from openai import OpenAI, RateLimitError, AuthenticationError

    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

    try:
        response = client.chat.completions.create(
            model=model_id,
            max_completion_tokens=2048,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
        )
    except RateLimitError as e:
        raise APIQuotaExceededError(f"OpenAI API 한도 초과 (429). API 키 사용량을 확인하세요. ({e})")
    except AuthenticationError as e:
        raise APIAuthError(f"OpenAI API 키 인증 실패. OPENAI_API_KEY를 확인하세요. ({e})")

    raw = response.choices[0].message.content.strip()
    qa_list = _extract_qa_list(raw)

    return {
        "raw": raw,
        "qa_list": qa_list,
        "input_tokens": response.usage.prompt_tokens,
        "output_tokens": response.usage.completion_tokens,
    }


def generate_qa(
    item: Dict,
    model: str,
    lang: str,
    prompt_version: str,
    system_prompt: Optional[str] = None,
    user_template: Optional[str] = None,
) -> Dict:
    """QA 생성 메인 함수.
    system_prompt, user_template이 주어지면 domain_profile 기반 적응형 프롬프트 사용.
    없으면 기존 정적 상수 사용 (fallback).
    """
    model_info = MODEL_CONFIG[model]
    provider = model_info["provider"]
    model_id = model_info["model_id"]

    # 프롬프트 선택: 외부 주입 우선, 없으면 기존 상수
    if system_prompt is None or user_template is None:
        if lang == "ko":
            if prompt_version == "v1":
                system_prompt = SYSTEM_PROMPT_KO_V1
                user_template = USER_TEMPLATE_KO_V1
        else:  # en
            if prompt_version == "v1":
                system_prompt = SYSTEM_PROMPT_EN_V1
                user_template = USER_TEMPLATE_EN_V1

    hierarchy = " > ".join(h for h in item["hierarchy"] if h) if item.get("hierarchy") else "Uncategorized"
    text = item.get("text", "")[:1500]
    user_prompt = user_template.format(hierarchy=hierarchy, text=text)

    # 프로바이더별 API 호출
    if provider == "anthropic":
        result = generate_qa_anthropic(model_id, system_prompt, user_prompt)
    elif provider == "google":
        result = generate_qa_google(model_id, system_prompt, user_prompt)
    elif provider == "openai":
        result = generate_qa_openai(model_id, system_prompt, user_prompt)

    return {
        "docId": item.get("docId", ""),
        "hierarchy": item.get("hierarchy", []),
        "text": item.get("text", ""),
        "model": model,
        "provider": provider,
        "lang": lang,
        "prompt_version": prompt_version,
        **result,
    }
