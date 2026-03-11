#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# main.py

"""
QA 생성 통합 스크립트 (Unified QA Generator)
모든 모델, 언어, 프롬프트 버전을 관리하는 통합 생성 도구

📌 프롬프트 버전:
  v2 (권장 ⭐): 8개 질문, 8가지 의도 유형 균형 커버 (현재 버전)

📁 저장경로: output/qa_{model}_{lang}_v2_{timestamp}.json

🚀 사용 예시:

  # uv 사용 (권장)
  uv run main.py --model flashlite --lang en --samples 100
  uv run main.py --model gpt-5.1 --lang ko --samples 50

  # 직접 실행
  python main.py --model flashlite --lang en --samples 100

  # 병렬 실행 (여러 모델 동시)
  uv run main.py --model flashlite --lang en --samples 30 &
  uv run main.py --model gpt-5.1 --lang en --samples 30 &
  wait

  # 전체 1,106개 생성
  uv run main.py --model flashlite --lang en --samples 1106
"""
import json
import os
import time
import argparse
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from rich.console import Console
from rich.panel import Panel
from rich.table import Table
from rich import box
from rich.progress import Progress, SpinnerColumn, TextColumn

load_dotenv()

console = Console()

# ============================================================================
# 모델 및 설정 정의
# ============================================================================

MODEL_CONFIG = {
    "claude-sonnet": {
        "provider": "anthropic",
        "model_id": "claude-sonnet-4-5",
        "cost_input": 3.0 / 1_000_000,      # $3 per MTok
        "cost_output": 15.0 / 1_000_000,    # $15 per MTok
        "name": "Claude Sonnet 4.5",
    },
    "gemini-pro": {
        "provider": "google",
        "model_id": "gemini-2.5-pro",
        "cost_input": 1.25 / 1_000_000,     # $1.25 per MTok
        "cost_output": 2.5 / 1_000_000,     # $2.5 per MTok
        "name": "Gemini 2.5 Pro",
    },
    "gpt-5.1": {
        "provider": "openai",
        "model_id": "gpt-5.1-2025-11-13",
        "cost_input": 1.25 / 1_000_000,     # $1.25 per MTok
        "cost_output": 10.0 / 1_000_000,    # $10 per MTok
        "name": "GPT-5.1",
    },
    "flashlite": {
        "provider": "google",
        "model_id": "gemini-3.1-flash-lite-preview",
        "cost_input": 0.25 / 1_000_000,     # $0.25 per MTok
        "cost_output": 1.5 / 1_000_000,     # $1.5 per MTok
        "name": "Gemini 3.1 Flash-Lite",
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

# ============================================================================
# 프롬프트 정의
# ============================================================================

SYSTEM_PROMPT_KO_V1 = """당신은 통신사 고객지원 QA 데이터셋 생성 전문가입니다.
주어진 컨텍스트(웹페이지 내용)만을 근거로 고객이 실제로 물어볼 법한 질문과 답변을 생성하세요.

[핵심 원칙]
1. 근거성(Groundedness): 모든 질문은 반드시 제공된 컨텍스트 내에서 명확한 답변이 가능해야 합니다.
   - ✗ 금지: "안내에 따르면 그렇습니다" (순환논리)
   - ✓ 필수: 컨텍스트에서 직접 인용 또는 명시된 이유/설명 제시

2. 관련성(Relevance): 질문과 답변이 주제적으로 일치해야 합니다.
   - ✗ 나쁜 예: Q: "요금이 어떻게 부과되나?" A: "할인 금액으로 이용할 수 있습니다" (부과 방식 설명 아님)
   - ✓ 좋은 예: Q: "할인이 어떻게 적용되나?" A: "계약 요금제에 따라 25% 할인됩니다" (답이 질문에 직접 대응)

3. 원자성(Atomicity): 질문 하나는 하나의 개념/과업만 묻습니다. 복합 질문 금지.

4. 의도 유형 정의 (각 유형 정확히 1개씩):
   - factoid: 구체적인 사실/정보 확인 (예: "서비스는 무엇인가?")
   - numeric: 구체적 수치/금액/개수 (예: "최대 몇 GB인가?")
   - procedure: 단계별 절차/방법 (예: "개통 절차는?")
   - why: 근본적인 이유/원인 제시 (예: "왜 필요한가?" → 컨텍스트에서 명시된 이유 제시, "정책이다"는 불가)
   - how: 작동 방식/구체적 방법 (예: "어떻게 신청하나?")
   - definition: 개념/용어의 정의 설명 (예: "eSIM이란?")
   - list: 전체 목록/옵션 나열 (예: "대상 기기 제품들을 나열하세요")
   - boolean: 예/아니오 판단 (예: "배송료는 무료인가?")

5. 컨텍스트 부족 시:
   - 정보가 충분하지 않으면, 그 질문 대신 충분한 근거가 있는 다른 질문을 생성하세요.
   - "N/A" 또는 답변 불가 표시는 금지합니다.

6. 명확성: 대명사·광범위한 표현을 피하고, 답의 범위가 분명한 질문을 작성하세요.
7. 언어: 한국어로 자연스럽게 작성하세요."""

SYSTEM_PROMPT_EN_V1 = """You are a QA dataset generation expert for Korea telecom (KT) customer support.
Generate questions and answers based ONLY on the provided context. Do not use outside knowledge.

[Core Principles]
1. Groundedness: Every question must be answerable with clear evidence from the context.
   ✗ Forbidden: "As stated in the policy, it is not possible" (circular reasoning)
   ✓ Required: Direct quote or explicitly stated reason/explanation from context

2. Relevance: Questions and answers must match topically.
   ✗ Bad: Q: "How is the charge applied?" A: "You can use it at a discounted rate" (doesn't address billing mechanism)
   ✓ Good: Q: "How is the discount applied?" A: "25% discount based on contract plan" (answer directly addresses the question)

3. Atomicity: Each question targets exactly one concept or task. No compound questions.

4. Intent Type Definitions (one per question):
   - factoid: Concrete fact/information confirmation (e.g., "What is the service?")
   - numeric: Specific numbers/amounts/quantities (e.g., "How many GB maximum?")
   - procedure: Step-by-step instructions/methods (e.g., "What is the activation process?")
   - why: Root reason/cause (e.g., "Why is it needed?" → provide explicit reason from context, NOT "policy states")
   - how: Mechanism/concrete method (e.g., "How to apply?")
   - definition: Concept/term explanation (e.g., "What is eSIM?")
   - list: Complete enumeration/options (e.g., "List all eligible devices")
   - boolean: Yes/No judgment (e.g., "Is shipping free?")

5. Insufficient Context Handling:
   - If information is incomplete, generate a different question with sufficient evidence.
   - Do NOT generate "unanswerable" or "N/A" responses.

6. Clarity: Avoid vague pronouns or overly broad scope. Answer boundary must be clear.
7. Language: Write all questions and answers in Korean (한국어)."""

USER_TEMPLATE_KO_V1 = """다음 컨텍스트를 바탕으로 질문 8개와 각 답변을 JSON 형식으로 생성해주세요.
각 질문은 서로 다른 의도 유형을 사용해야 합니다 (factoid, numeric, procedure, why, how, definition, list, boolean).

[생성 가이드]
1. 각 의도 유형별 예시:
   - factoid: "USIM은 무엇인가?", "선불 USIM의 특징은?"
   - numeric: "USIM 가격은 얼마인가?", "최대 몇 GB 제공하나?"
   - procedure: "USIM 개통 절차는?", "배송 신청 방법은?"
   - why: "왜 개통 후 소액결제가 차단되나?" → 컨텍스트에서 이유 찾아서 설명 (정책 원인, 안전 이유 등)
   - how: "어떻게 충전하나?", "어떻게 신청하나?"
   - definition: "eSIM이란 무엇인가?", "요고 요금제의 정의는?"
   - list: "배송 방법은 모두 무엇인가?", "지원하는 아이폰 모델을 나열하세요"
   - boolean: "배송료는 무료인가?", "재사용 가능한가?"

2. 관련성 체크:
   - 질문과 답변이 주제적으로 직접 대응하는지 확인하세요
   - Q: "A는?" → A: "A의 정의/설명" (O)
   - Q: "A의 비용?" → A: "B의 가격" (X) 무관련

3. 근거 확인:
   - 모든 답변에 컨텍스트 내용이 명시되어야 함
   - 금지 표현: "안내합니다", "정책입니다", "규정입니다" (이유 설명 없이)
   - 필수: "~때문에", "~으로 인해", "~를 위해" (명시된 이유/근거)

4. 컨텍스트 부족 시:
   - 그 유형의 다른 질문을 생성하세요 (같은 의도 유형 내에서 다른 주제)

[카테고리]: {hierarchy}
[컨텍스트]:
{text}

반드시 아래 JSON 형식으로만 출력하세요 (마크다운 코드블록 없이 순수 JSON):
{{
  "qa_list": [
    {{
      "q": "질문 텍스트",
      "a": "답변 텍스트 (컨텍스트 근거)",
      "intent": "의도유형",
      "answerable": true
    }},
    {{
      "q": "질문 텍스트",
      "a": "답변 텍스트 (컨텍스트 근거)",
      "intent": "의도유형",
      "answerable": true
    }},
    {{
      "q": "질문 텍스트",
      "a": "답변 텍스트 (컨텍스트 근거)",
      "intent": "의도유형",
      "answerable": true
    }},
    {{
      "q": "질문 텍스트",
      "a": "답변 텍스트 (컨텍스트 근거)",
      "intent": "의도유형",
      "answerable": true
    }},
    {{
      "q": "질문 텍스트",
      "a": "답변 텍스트 (컨텍스트 근거)",
      "intent": "의도유형",
      "answerable": true
    }},
    {{
      "q": "질문 텍스트",
      "a": "답변 텍스트 (컨텍스트 근거)",
      "intent": "의도유형",
      "answerable": true
    }},
    {{
      "q": "질문 텍스트",
      "a": "답변 텍스트 (컨텍스트 근거)",
      "intent": "의도유형",
      "answerable": true
    }},
    {{
      "q": "질문 텍스트",
      "a": "답변 텍스트 (컨텍스트 근거)",
      "intent": "의도유형",
      "answerable": true
    }}
  ]
}}"""

USER_TEMPLATE_EN_V1 = """Generate 8 questions and answers in Korean from the context below.
Each question must use a different intent type (factoid, numeric, procedure, why, how, definition, list, boolean).

[Generation Guide]
1. Intent type examples:
   - factoid: "USIM이란?", "선불 USIM의 특징은?"
   - numeric: "USIM 가격?", "최대 GB?"
   - procedure: "개통 절차?", "배송 신청 방법?"
   - why: "왜 소액결제가 차단되나?" → Find explicit reason in context (safety, security, etc.)
   - how: "어떻게 충전하나?", "어떻게 신청하나?"
   - definition: "eSIM의 정의?", "요고 요금제란?"
   - list: "배송 방법들?", "지원하는 아이폰 모델?"
   - boolean: "배송 무료?", "재사용 가능?"

2. Relevance Check:
   - Question and answer must match topically
   - Q: "What is A?" → A: "A is..." (✓)
   - Q: "A cost?" → A: "B price..." (✗) Unrelated

3. Groundedness:
   - Include explicit evidence from context in all answers
   - Forbidden: "As policy states", "per guidelines" (no reason provided)
   - Required: "because...", "due to...", "in order to..." (explicit reason)

4. Insufficient Context:
   - Generate a different question within same intent type if needed

[Category]: {hierarchy}
[Context]:
{text}

Output ONLY pure JSON (no markdown code block):
{{
  "qa_list": [
    {{
      "q": "질문 텍스트",
      "a": "답변 텍스트 (컨텍스트 근거)",
      "intent": "intent_type",
      "answerable": true
    }},
    {{
      "q": "질문 텍스트",
      "a": "답변 텍스트 (컨텍스트 근거)",
      "intent": "intent_type",
      "answerable": true
    }},
    {{
      "q": "질문 텍스트",
      "a": "답변 텍스트 (컨텍스트 근거)",
      "intent": "intent_type",
      "answerable": true
    }},
    {{
      "q": "질문 텍스트",
      "a": "답변 텍스트 (컨텍스트 근거)",
      "intent": "intent_type",
      "answerable": true
    }},
    {{
      "q": "질문 텍스트",
      "a": "답변 텍스트 (컨텍스트 근거)",
      "intent": "intent_type",
      "answerable": true
    }},
    {{
      "q": "질문 텍스트",
      "a": "답변 텍스트 (컨텍스트 근거)",
      "intent": "intent_type",
      "answerable": true
    }},
    {{
      "q": "질문 텍스트",
      "a": "답변 텍스트 (컨텍스트 근거)",
      "intent": "intent_type",
      "answerable": true
    }},
    {{
      "q": "질문 텍스트",
      "a": "답변 텍스트 (컨텍스트 근거)",
      "intent": "intent_type",
      "answerable": true
    }}
  ]
}}"""

# ============================================================================
# API 클라이언트 초기화 (Lazy Loading)
# ============================================================================

_clients = {}


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


# ============================================================================
# QA 생성 함수
# ============================================================================

def generate_qa_anthropic(model_id: str, system_prompt: str, user_prompt: str) -> Dict:
    """Anthropic (Claude) API를 사용한 QA 생성"""
    client = get_client("anthropic")
    
    response = client.messages.create(
        model=model_id,
        max_tokens=2048,
        messages=[
            {
                "role": "user",
                "content": user_prompt,
            }
        ],
        system=system_prompt,
    )
    
    raw = response.content[0].text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    
    try:
        qa_list = json.loads(raw).get("qa_list", [])
    except json.JSONDecodeError:
        qa_list = []
    
    return {
        "raw": raw,
        "qa_list": qa_list,
        "input_tokens": response.usage.input_tokens,
        "output_tokens": response.usage.output_tokens,
    }


def generate_qa_google(model_id: str, system_prompt: str, user_prompt: str) -> Dict:
    """Google Generative AI (Gemini) API를 사용한 QA 생성"""
    client = get_client("google")
    
    # system_prompt와 user_prompt를 함께 전달
    prompt = system_prompt + "\n\n" + user_prompt
    response = client.models.generate_content(
        model=model_id,
        contents=prompt,
    )
    
    raw = response.text.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    
    try:
        qa_list = json.loads(raw).get("qa_list", [])
    except json.JSONDecodeError:
        qa_list = []
    
    return {
        "raw": raw,
        "qa_list": qa_list,
        "input_tokens": response.usage_metadata.prompt_token_count,
        "output_tokens": response.usage_metadata.candidates_token_count,
    }


def generate_qa_openai(model_id: str, system_prompt: str, user_prompt: str) -> Dict:
    """OpenAI API를 사용한 QA 생성"""
    from openai import OpenAI
    
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    
    response = client.chat.completions.create(
        model=model_id,
        max_completion_tokens=2048,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    
    raw = response.choices[0].message.content.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    
    try:
        qa_list = json.loads(raw).get("qa_list", [])
    except json.JSONDecodeError:
        qa_list = []
    
    return {
        "raw": raw,
        "qa_list": qa_list,
        "input_tokens": response.usage.prompt_tokens,
        "output_tokens": response.usage.completion_tokens,
    }


def generate_qa(item: Dict, model: str, lang: str, prompt_version: str) -> Dict:
    """QA 생성 메인 함수"""
    model_info = MODEL_CONFIG[model]
    provider = model_info["provider"]
    model_id = model_info["model_id"]
    
    # 프롬프트 선택
    if lang == "ko":
        if prompt_version == "v1":
            system_prompt = SYSTEM_PROMPT_KO_V1
            user_template = USER_TEMPLATE_KO_V1
    else:  # en
        if prompt_version == "v1":
            system_prompt = SYSTEM_PROMPT_EN_V1
            user_template = USER_TEMPLATE_EN_V1
    
    hierarchy = " > ".join(item["hierarchy"]) if item.get("hierarchy") else "Uncategorized"
    text = item.get("text", "")[:2000]
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
        "text": item.get("text", ""),  # 원본 컨텍스트 저장 (평가에 필요)
        "model": model,
        "provider": provider,
        "lang": lang,
        "prompt_version": prompt_version,
        **result,
    }


# ============================================================================
# 유틸리티 함수
# ============================================================================

def print_qa_list(qa_list: List[Dict], raw: str = "") -> None:
    """QA 리스트 출력"""
    if not qa_list:
        console.print(Panel(f"[yellow]JSON 파싱 실패[/yellow]\n{raw[:200]}", border_style="yellow"))
        return
    for i, qa in enumerate(qa_list, 1):
        intent = qa.get("intent", "?")
        color = INTENT_COLORS.get(intent, "white")
        console.print(
            f"  [bold]{i}.[/bold] [{color}]{intent:12}[/{color}] "
            f"[bold white]{qa.get('q', '')}[/bold white]"
        )
        console.print(f"     [dim]{qa.get('a', '')[:100]}...[/dim]")


def calculate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """비용 계산"""
    model_info = MODEL_CONFIG[model]
    return (input_tokens * model_info["cost_input"]) + (output_tokens * model_info["cost_output"])


# ============================================================================
# 메인
# ============================================================================

def main():
    parser = argparse.ArgumentParser(
        description="QA 생성 통합 스크립트",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
📝 예시 (Python):
  python main.py --model flashlite --lang en --prompt-version v2 --samples 20
  python main.py --model gpt-5.1 --lang ko --prompt-version v2
  python main.py --model claude-sonnet --lang ko --samples 4

📝 예시 (uv):
  uv run main.py --model flashlite --lang en --samples 30
  uv run main.py --model gpt-5.1 --lang ko --samples 50

⚡ uv 병렬 실행 (여러 모델 동시 생성):
  uv run main.py --model flashlite --lang en --samples 30 &
  uv run main.py --model gpt-5.1 --lang en --samples 30 &
  wait

🔧 uv 가상환경 활성화 후 실행:
  uv venv && source .venv/bin/activate
  python main.py --model flashlite --lang en --samples 100
        """,
    )
    
    parser.add_argument(
        "--model",
        type=str,
        default="flashlite",
        choices=list(MODEL_CONFIG.keys()),
        help="선택할 모델 (기본값: flashlite)",
    )
    parser.add_argument(
        "--lang",
        type=str,
        default="en",
        choices=["ko", "en"],
        help="프롬프트 언어: ko(한국어) 또는 en(영어) (기본값: en)",
    )
    parser.add_argument(
        "--prompt-version",
        type=str,
        default="v2",
        choices=list(PROMPT_VERSION.keys()),
        help="프롬프트 버전 (기본값: v2)",
    )
    parser.add_argument(
        "--samples",
        type=int,
        default=20,
        help="생성할 샘플 개수 (기본값: 20)",
    )
    parser.add_argument(
        "--qa-per-doc",
        type=int,
        default=None,
        help="문서당 최대 QA 개수 (기본값: LLM 생성 전체 사용)",
    )
    parser.add_argument(
        "--output-dir",
        type=str,
        default="output",
        help="출력 디렉토리 (기본값: output)",
    )
    parser.add_argument(
        "--data-file",
        type=str,
        default="ref/data/data_2026-03-06_normalized.json",
        help="입력 데이터 파일 (기본값: ref/data/data_2026-03-06_normalized.json)",
    )
    
    args = parser.parse_args()
    
    # 입력값 검증
    if args.model not in MODEL_CONFIG:
        console.print(f"[red]오류: 모델 '{args.model}'을 찾을 수 없습니다[/red]")
        return
    
    model_info = MODEL_CONFIG[args.model]
    lang_name = "한국어" if args.lang == "ko" else "English"
    
    # 설정 출력
    console.print(Panel(
        f"[bold]QA 생성 설정[/bold]\n"
        f"모델: {model_info['name']}\n"
        f"언어: {lang_name}\n"
        f"프롬프트: {PROMPT_VERSION[args.prompt_version]}\n"
        f"샘플: {args.samples}개\n"
        f"문서당 QA: {args.qa_per_doc if args.qa_per_doc else '전체 (LLM 생성 기준)'}",
        title="⚙️ 설정",

        border_style="blue",
    ))
    
    # 데이터 로드
    try:
        with open(args.data_file, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        console.print(f"[red]오류: 데이터 파일을 찾을 수 없습니다: {args.data_file}[/red]")
        return
    
    # 데이터 구조 확인 (list 또는 dict with 'documents')
    if isinstance(data, list):
        items = data[:args.samples]
    else:
        items = data.get("documents", [])[:args.samples]
    console.print(f"[green]✓ 데이터 로드 완료: {len(items)}개[/green]\n")
    
    # 출력 디렉토리 확인
    Path(args.output_dir).mkdir(exist_ok=True)
    
    # QA 생성
    results = [None] * len(items)  # 순서 보존용 리스트
    total_input_tokens = 0
    total_output_tokens = 0
    total_cost = 0.0
    result_lock = Lock()  # 스레드 안전성
    
    def generate_qa_worker(idx_item_tuple: Tuple[int, Dict]) -> Tuple[int, Dict]:
        """단일 QA 생성 워커"""
        idx, item = idx_item_tuple
        result = generate_qa(item, args.model, args.lang, args.prompt_version)
        if args.qa_per_doc:
            result["qa_list"] = result["qa_list"][:args.qa_per_doc]
        return idx, result
    
    with ThreadPoolExecutor(max_workers=4) as executor:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            task = progress.add_task(
                f"[cyan]QA 생성 중... ({args.model}, {lang_name})",
                total=len(items),
            )
            
            # 병렬 처리
            for idx, result in executor.map(generate_qa_worker, enumerate(items)):
                results[idx] = result
                
                with result_lock:
                    total_input_tokens += result["input_tokens"]
                    total_output_tokens += result["output_tokens"]
                    cost = calculate_cost(args.model, result["input_tokens"], result["output_tokens"])
                    total_cost += cost
                    
                    progress.update(task, advance=1, description=f"[cyan]QA {idx+1}/{len(items)} 생성 완료")
                    
                    # 샘플 출력 (처음 2개)
                    if idx < 2:
                        console.print(f"\n[bold]샘플 {idx+1}:[/bold]")
                        print_qa_list(result["qa_list"], result["raw"])
    
    # 결과 저장
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    lang_suffix = "ko" if args.lang == "ko" else "en"
    output_file = (
        f"{args.output_dir}/qa_{args.model}_{lang_suffix}_{args.prompt_version}_{timestamp}.json"
    )
    
    output_data = {
        "config": {
            "model": args.model,
            "model_name": model_info["name"],
            "lang": args.lang,
            "prompt_version": args.prompt_version,
            "samples": len(items),
            "qa_per_doc": args.qa_per_doc,
            "timestamp": timestamp,
        },
        "statistics": {
            "total_docs": len(items),
            "total_qa": sum(len(r["qa_list"]) for r in results),
            "total_input_tokens": total_input_tokens,
            "total_output_tokens": total_output_tokens,
            "total_cost_usd": round(total_cost, 4),
        },
        "results": results,
    }
    
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(output_data, f, ensure_ascii=False, indent=2)
    
    # 최종 요약
    table = Table(title="📊 생성 완료", box=box.ROUNDED)
    table.add_column("항목", style="cyan")
    table.add_column("값", style="magenta")
    table.add_row("모델", model_info["name"])
    table.add_row("언어", lang_name)
    table.add_row("문서", f"{len(items)}개")
    table.add_row("생성 QA", f"{output_data['statistics']['total_qa']}개")
    table.add_row("입력 토큰", f"{total_input_tokens:,}")
    table.add_row("출력 토큰", f"{total_output_tokens:,}")
    table.add_row("비용", f"${total_cost:.4f}")
    table.add_row("저장 파일", output_file)
    
    console.print(table)


if __name__ == "__main__":
    main()
