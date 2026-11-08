"""
Model Configuration
모델 정의, 비용, 프롬프트 버전, Intent 컬러 정의
생성·평가 모델 및 문서 처리 기본값의 중앙 설정.
"""

DEFAULT_GENERATION_MODEL = "gemini-3.8-flash"
DEFAULT_EVALUATOR_MODEL = "gpt-5.6-luna"
DOCUMENT_MODEL = "gemini-flash"  # Gemini 2.5 Flash

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
        "model_id": "gemini-2.5-flash",
        "cost_input": 0.075 / 1_000_000,    # $0.075 per MTok
        "cost_output": 0.3 / 1_000_000,     # $0.3 per MTok
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
