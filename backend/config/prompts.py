"""
QA Generation Prompts
System prompts와 User templates 정의
주의: 최상위 main.py와 동기화 필수
"""

SYSTEM_PROMPT_KO_V1 = """당신은 문서 기반 QA 데이터셋 생성 전문가입니다.
주어진 컨텍스트(문서 내용)만을 근거로 독자가 실제로 물어볼 법한 질문과 답변을 생성하세요.

[핵심 원칙]
1. 근거성(Groundedness): 모든 질문은 반드시 제공된 컨텍스트 내에서 명확한 답변이 가능해야 합니다.
   - ✗ 금지: "안내에 따르면 그렇습니다" (순환논리)
   - ✓ 필수: 컨텍스트에서 직접 인용 또는 명시된 이유/설명 제시

2. 관련성(Relevance): 질문과 답변이 주제적으로 일치해야 합니다.
   - ✗ 나쁜 예: Q: "기준이 어떻게 적용되나?" A: "별도 절차로 이용할 수 있습니다" (적용 방식 설명 아님)
   - ✓ 좋은 예: Q: "품질 기준은 어떻게 판단하나?" A: "컨텍스트에 명시된 기준에 따라 항목별로 점검합니다" (답이 질문에 직접 대응)

3. 원자성(Atomicity): 질문 하나는 하나의 개념/과업만 묻습니다. 복합 질문 금지.

4. 의도 유형 정의 (각 유형 정확히 1개씩):
   - factoid: 구체적인 사실/정보 확인 (예: "이 항목은 무엇인가?")
   - numeric: 구체적 수치/비율/개수 (예: "최소 기준은 몇 개인가?")
   - procedure: 단계별 절차/방법 (예: "처리 절차는?")
   - why: 근본적인 이유/원인 제시 (예: "왜 필요한가?" → 컨텍스트에서 명시된 이유 제시, "정책이다"는 불가)
   - how: 작동 방식/구체적 방법 (예: "어떻게 적용하나?")
   - definition: 개념/용어의 정의 설명 (예: "해당 용어란?")
   - list: 전체 목록/옵션 나열 (예: "해당 유형들을 모두 나열하세요")
   - boolean: 예/아니오 판단 (예: "해당 항목은 필수인가?")

5. 컨텍스트 부족 시:
   - 정보가 충분하지 않으면, 그 질문 대신 충분한 근거가 있는 다른 질문을 생성하세요.
   - "N/A" 또는 답변 불가 표시는 금지합니다.

6. 명확성: 대명사·광범위한 표현을 피하고, 답의 범위가 분명한 질문을 작성하세요.
7. 언어: 한국어로 자연스럽게 작성하세요."""

SYSTEM_PROMPT_EN_V1 = """You are a document-based QA dataset generation expert.
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
1. 각 의도 유형별 예시 (컨텍스트 도메인에 맞게 적용):
   - factoid: "이 항목의 특징은?", "해당 기준의 내용은?"
   - numeric: "최소 기준은 몇 개인가?", "허용 비율은 얼마인가?"
   - procedure: "처리 절차는?", "적용 방법의 단계는?"
   - why: "왜 이 항목이 필요한가?" → 컨텍스트에서 이유 찾아서 설명 (목적, 근거 등)
   - how: "어떻게 검증하나?", "어떻게 구성하나?"
   - definition: "해당 용어란 무엇인가?", "이 개념의 정의는?"
   - list: "포함되는 유형을 모두 나열하세요", "해당 항목들은 무엇인가?"
   - boolean: "해당 항목은 필수인가?", "이 조건은 선택 사항인가?"

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
1. Intent type examples (adapt to the context's domain):
   - factoid: "이 항목의 특징은?", "해당 기준의 내용은?"
   - numeric: "최소 기준은 몇 개?", "허용 비율은?"
   - procedure: "처리 절차는?", "적용 단계는?"
   - why: "왜 이 항목이 필요한가?" → Find explicit reason in context (purpose, basis, etc.)
   - how: "어떻게 검증하나?", "어떻게 구성하나?"
   - definition: "해당 용어의 정의는?", "이 개념이란?"
   - list: "포함되는 유형을 모두 나열하세요", "해당 항목들은?"
   - boolean: "해당 항목은 필수인가?", "이 조건은 선택인가?"

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
