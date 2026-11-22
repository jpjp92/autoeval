"""
Model Configuration
모델 정의, 비용, 프롬프트 버전, Intent 컬러 정의
생성·평가 모델 및 문서 처리 기본값의 중앙 설정.
"""

DEFAULT_GENERATION_MODEL = "gemini-3.8-flash"
DEFAULT_EVALUATOR_MODEL = "gpt-5.6-luna"
import os

# 문서 처리(청킹·계층 분류·태깅·도메인 프로파일) 모델 키.
# gemini-2.5-flash 종료(2026-12-01 예정)로 3.5 Flash-Lite로 교체.
DOCUMENT_MODEL = "gemini-3.5-flash-lite"


def no_thinking_config(model_id: str):
    """thinking을 최소로 끄는 ThinkingConfig.
    Gemini 2.x는 thinking_budget=0, 3.x는 thinking_budget을 받지 않아(400 INVALID_ARGUMENT)
    thinking_level="minimal"을 쓴다. (2026-11-22 3.5 Flash-Lite 실측)"""
    from google.genai import types as genai_types
    if model_id.startswith("gemini-2"):
        return genai_types.ThinkingConfig(thinking_budget=0)
    return genai_types.ThinkingConfig(thinking_level="minimal")

MODEL_CONFIG = {
    # Official model IDs verified 2026-11-08. Gemini introductory pricing
    # below is valid through 2026-12-31; review before 2027-01-01.
    "gemini-3.8-flash": {
        "provider": "google",
        "model_id": "gemini-3.8-flash",
        "cost_input": 0.75 / 1_000_000,
        "cost_output": 3.75 / 1_000_000,
        "name": "Gemini 3.8 Flash",
    },
    "gemini-3.7-flash": {
        "provider": "google",
        "model_id": "gemini-3.7-flash",
        "cost_input": 0.75 / 1_000_000,
        "cost_output": 3.75 / 1_000_000,
        "name": "Gemini 3.7 Flash",
    },
    "gemini-3.5-flash-lite": {
        "provider": "google",
        # DOCUMENT_MODEL_ID로 재배포 없이 교체 가능
        "model_id": os.getenv("DOCUMENT_MODEL_ID", "").strip() or "gemini-3.5-flash-lite",
        "cost_input": 0.30 / 1_000_000,
        "cost_output": 2.50 / 1_000_000,
        "name": "Gemini 3.5 Flash-Lite",
    },
    "gpt-6-luna": {
        "provider": "openai",
        "model_id": "gpt-6-luna",
        "cost_input": 0.10 / 1_000_000,
        "cost_output": 0.50 / 1_000_000,
        "reasoning_effort": "none",
        "name": "GPT-6 Luna",
    },
    "gpt-5.6-luna": {
        "provider": "openai",
        "model_id": "gpt-5.6-luna",
        "cost_input": 0.20 / 1_000_000,
        "cost_output": 1.20 / 1_000_000,
        "reasoning_effort": "none",
        "name": "GPT-5.6 Luna",
    },
    # Legacy entries retained for existing results and explicit API callers.
    "claude-sonnet": {
        "provider": "anthropic",
        "model_id": "claude-sonnet-4-6",
        "cost_input": 3.0 / 1_000_000,      # $3 per MTok
        "cost_output": 15.0 / 1_000_000,    # $15 per MTok
        "name": "Claude Sonnet 4.6",
    },
    "gemini-flash": {
        "provider": "google",
        "model_id": "gemini-2.5-flash",     # 2026-12-01 종료 예정, 지난 결과 표시용
        "cost_input": 0.30 / 1_000_000,     # $0.30 per MTok
        "cost_output": 2.50 / 1_000_000,    # $2.50 per MTok
        "name": "Gemini 2.5 Flash",
    },
    "gpt-5.1": {
        "provider": "openai",
        "model_id": "gpt-5.1-2025-11-13",
        "cost_input": 1.25 / 1_000_000,     # $1.25 per MTok
        "cost_output": 10.0 / 1_000_000,    # $10 per MTok
        "name": "GPT-5.1",
    },
    "gpt-5.2": {
        "provider": "openai",
        "model_id": "gpt-5.2-2025-12-11",
        "cost_input": 1.75 / 1_000_000,     # $1.75 per MTok
        "cost_output": 14.0 / 1_000_000,    # $14 per MTok
        "name": "GPT-5.2",
    },
    "gemini-3-flash": {
        "provider": "google",
        "model_id": "gemini-3-flash-preview",
        "cost_input": 0.3 / 1_000_000,      # $0.3 per MTok
        "cost_output": 1.2 / 1_000_000,     # $1.2 per MTok
        "name": "Gemini 3 Flash",
    },
    "claude-haiku": {
        "provider": "anthropic",
        "model_id": "claude-haiku-4-5",
        "cost_input": 1.0 / 1_000_000,      # $1 per MTok
        "cost_output": 5.0 / 1_000_000,     # $5 per MTok
        "name": "Claude Haiku 4.5",
    },
}

PROMPT_VERSION = {
    "v1": "통일 프롬프트 (권장) - 8개 질문, 8가지 의도 명시",
}

INTENT_COLORS = {
    "factoid": "cyan",
    "numeric": "yellow",
    "procedure": "blue",
    "why": "magenta",
    "how": "green",
    "definition": "bright_cyan",
    "list": "bright_yellow",
    "boolean": "bright_magenta",
    "comparison": "red",
}
