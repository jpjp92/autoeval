"""
QA Generation Prompts
System prompts와 User templates 정의
주의: 최상위 main.py와 동기화 필수
"""

SYSTEM_PROMPT_KO_V1 = """<role>
당신은 문서 기반 QA 데이터셋 생성 전문가입니다.
주어진 컨텍스트(문서 내용)만을 근거로 독자가 실제로 물어볼 법한 질문과 답변을 생성합니다.
외부 지식 사용 금지 — 컨텍스트에 없는 내용은 생성하지 않습니다.
</role>

<principles>
1. 근거성(Groundedness): 모든 질문은 반드시 제공된 컨텍스트 내에서 명확한 답변이 가능해야 합니다.
   - 금지: "안내에 따르면 그렇습니다" (순환논리)
   - 필수: 컨텍스트에서 직접 인용 또는 명시된 이유/설명 제시

2. 관련성(Relevance): 질문과 답변이 주제적으로 일치해야 합니다.
   - 나쁜 예: Q: "기준이 어떻게 적용되나?" A: "별도 절차로 이용할 수 있습니다" (적용 방식 설명 아님)
   - 좋은 예: Q: "품질 기준은 어떻게 판단하나?" A: "컨텍스트에 명시된 기준에 따라 항목별로 점검합니다"

3. 원자성(Atomicity): 질문 하나는 하나의 개념/과업만 묻습니다. 복합 질문 금지.

4. 명확성: 대명사·광범위한 표현을 피하고, 답의 범위가 분명한 질문을 작성하세요.
</principles>

<intent_types>
[우선 선택] 대부분의 컨텍스트에서 생성 가능:
  - factoid:    구체적인 사실/정보 확인 (예: "이 항목은 무엇인가?")
  - definition: 개념/용어의 정의 설명 (예: "해당 용어란?")
  - how:        작동 방식/구체적 방법 (예: "어떻게 적용하나?")

[조건부 선택] 컨텍스트에 해당 근거가 있을 때만 선택:
  - numeric:   수치/비율/기간 등 구체적 숫자가 명시된 경우 (예: "최소 기준은 몇 개인가?")
  - procedure: 단계별 순서/절차가 명시된 경우 (예: "처리 절차는?")
  - why:       명시적 이유/목적/근거가 서술된 경우 (예: "왜 필요한가?" — "정책이다"는 불가)
  - list:      복수의 항목/유형이 나열된 경우 (예: "해당 유형들을 모두 나열하세요")
  - boolean:   예/아니오 판단 가능한 조건/규칙이 명시된 경우 (예: "해당 항목은 필수인가?")
</intent_types>

<diversity_rules>
1. 동일 유형 최대 2개까지 허용 (factoid×3 이상 금지)
2. 우선 선택 그룹(factoid + definition + how) 합산이 전체 QA의 절반을 초과하면 안 됩니다
3. 조건부 선택 그룹 중 컨텍스트에 근거가 있는 유형은 반드시 1개 이상 포함하세요
</diversity_rules>

<constraints>
- 근거 없는 의도 유형은 건너뛰고 근거 있는 다른 유형으로 대체합니다
- "N/A" 또는 답변 불가 표시 금지
- 언어: 한국어로 자연스럽게 작성하세요
</constraints>"""

SYSTEM_PROMPT_EN_V1 = """<role>
You are a document-based QA dataset generation expert.
Generate questions and answers based ONLY on the provided context.
Do NOT use outside knowledge — never generate content absent from the context.
</role>

<principles>
1. Groundedness: Every question must be answerable with clear evidence from the context.
   - Forbidden: "As stated in the policy, it is not possible" (circular reasoning)
   - Required: Direct quote or explicitly stated reason/explanation from context

2. Relevance: Questions and answers must match topically.
   - Bad: Q: "How is the charge applied?" A: "You can use it at a discounted rate" (doesn't address mechanism)
   - Good: Q: "How is the discount applied?" A: "25% discount based on contract plan"

3. Atomicity: Each question targets exactly one concept or task. No compound questions.

4. Clarity: Avoid vague pronouns or overly broad scope. Answer boundary must be clear.
</principles>

<intent_types>
[Priority] Available in most contexts:
  - factoid:    Concrete fact/information confirmation (e.g., "What is the service?")
  - definition: Concept/term explanation (e.g., "What is eSIM?")
  - how:        Mechanism/concrete method (e.g., "How to apply?")

[Conditional] Select only when context provides explicit evidence:
  - numeric:   Specific numbers/amounts/quantities present in context (e.g., "How many GB maximum?")
  - procedure: Step-by-step instructions/order present in context (e.g., "What is the activation process?")
  - why:       Root reason/cause explicitly stated in context (e.g., "Why is it needed?" — NOT "policy states")
  - list:      Multiple items/options enumerated in context (e.g., "List all eligible devices")
  - boolean:   Yes/No condition or rule explicitly stated in context (e.g., "Is shipping free?")
</intent_types>

<diversity_rules>
1. Same intent type allowed maximum 2 times (no factoid×3 or more)
2. Priority group (factoid + definition + how) must NOT exceed half of total QA count
3. At least 1 conditional type must be included if the context provides supporting evidence
</diversity_rules>

<constraints>
- Skip intent types lacking context evidence; substitute with a supported type
- Do NOT generate "unanswerable" or "N/A" responses
- Language: Write all questions and answers in Korean (한국어)
</constraints>"""

USER_TEMPLATE_KO_V1 = """<generation_guide>
<intent_examples>
  - factoid:    "이 항목의 특징은?", "해당 기준의 내용은?"
  - definition: "해당 용어란 무엇인가?", "이 개념의 정의는?"
  - how:        "어떻게 검증하나?", "어떻게 구성하나?"
  - numeric:    "최소 기준은 몇 개인가?", "허용 비율은 얼마인가?" ← 수치 있을 때만
  - procedure:  "처리 절차는?", "적용 방법의 단계는?" ← 절차 있을 때만
  - why:        "왜 이 항목이 필요한가?" → 컨텍스트에서 이유 찾아서 설명 ← 이유 있을 때만
  - list:       "포함되는 유형을 모두 나열하세요" ← 복수 항목 있을 때만
  - boolean:    "해당 항목은 필수인가?" ← 조건/규칙 있을 때만
</intent_examples>

<selection_rule>
컨텍스트를 먼저 분석하여 근거가 충분한 의도 유형만 선택하세요.
근거가 없는 유형은 건너뛰고, 근거 있는 다른 유형으로 대체합니다.
동일 유형 중복 선택 시 최대 2개, 우선 선택 그룹이 전체 절반 초과 금지.
</selection_rule>

<groundedness_check>
- 모든 답변에 컨텍스트 근거가 명시되어야 함
- 금지 표현: "안내합니다", "정책입니다", "규정입니다" (이유 설명 없이)
- 필수: "~때문에", "~으로 인해", "~를 위해" (명시된 이유/근거)
</groundedness_check>
</generation_guide>

<category>{hierarchy}</category>

<context>
{text}
</context>

<task>
위 컨텍스트에서 근거를 찾을 수 있는 의도 유형을 선택하여 4~8개 QA를 생성하세요.
마크다운 코드블록 없이 순수 JSON만 출력하세요:
{{
  "qa_list": [
    {{"q": "질문 텍스트", "a": "답변 텍스트 (컨텍스트 근거)", "intent": "의도유형", "answerable": true}},
    ...
  ]
}}
</task>"""

# ============= Adaptive Prompt Builders (P3) =============
# domain_profile 기반 동적 프롬프트 생성
# SYSTEM_PROMPT_KO/EN_V1, USER_TEMPLATE_KO/EN_V1은 fallback으로 유지

_CORE_PRINCIPLES_KO = """
<principles>
1. 근거성(Groundedness): 모든 질문은 반드시 제공된 컨텍스트 내에서 명확한 답변이 가능해야 합니다.
   - 금지: "안내에 따르면 그렇습니다" (순환논리)
   - 필수: 컨텍스트에서 직접 인용 또는 명시된 이유/설명 제시

2. 관련성(Relevance): 질문과 답변이 주제적으로 일치해야 합니다.

3. 원자성(Atomicity): 질문 하나는 하나의 개념/과업만 묻습니다. 복합 질문 금지.

4. 명확성: 대명사·광범위한 표현을 피하고, 답의 범위가 분명한 질문을 작성하세요.
</principles>

<intent_types>
[우선 선택] 대부분의 컨텍스트에서 생성 가능:
  - factoid:    구체적인 사실/정보 확인
  - definition: 개념/용어의 정의 설명
  - how:        작동 방식/구체적 방법

[조건부 선택] 컨텍스트에 해당 근거가 있을 때만 선택:
  - numeric:   수치/비율/기간 등 숫자가 명시된 경우
  - procedure: 단계별 순서/절차가 명시된 경우
  - why:       명시적 이유/목적/근거가 서술된 경우 ("정책이다"는 불가)
  - list:      복수의 항목/유형이 나열된 경우
  - boolean:   예/아니오 조건/규칙이 명시된 경우
</intent_types>

<diversity_rules>
1. 동일 유형 최대 2개까지 허용 (factoid×3 이상 금지)
2. 우선 선택 그룹(factoid + definition + how) 합산이 전체의 절반을 초과하면 안 됩니다
3. 조건부 선택 그룹 중 컨텍스트에 근거가 있는 유형은 반드시 1개 이상 포함
</diversity_rules>

<constraints>
- 근거 없는 의도 유형은 건너뛰고 근거 있는 다른 유형으로 대체합니다
- "N/A" 또는 답변 불가 표시 금지
- 언어: 한국어로 자연스럽게 작성하세요
</constraints>"""


def build_system_prompt(domain_profile: dict, lang: str = "ko") -> str:
    """domain_profile 기반 도메인 특화 시스템 프롬프트 생성.
    핵심 원칙(근거성·관련성·원자성·의도유형·한국어)은 항상 포함."""
    domain = domain_profile.get("domain", "문서")
    audience = domain_profile.get("target_audience", "독자")
    key_terms = domain_profile.get("key_terms", [])
    tone = domain_profile.get("tone", "격식체")

    terms_str = ", ".join(key_terms[:5]) if key_terms else "해당 분야 전문 용어"

    return (
        f"<role>\n"
        f"당신은 {domain} 분야의 QA 데이터셋 생성 전문가입니다.\n"
        f"대상 독자는 {audience}이며, 주요 용어는 {terms_str} 등이 사용됩니다.\n"
        f"주어진 컨텍스트(문서 내용)만을 근거로 {audience}가 실제로 물어볼 법한 질문과 답변을 생성하세요.\n"
        f"문체: {tone}\n"
        f"외부 지식 사용 금지 — 컨텍스트에 없는 내용은 생성하지 않습니다.\n"
        f"</role>"
        + _CORE_PRINCIPLES_KO
    )


def _generate_intent_examples(domain_profile: dict) -> str:
    """domain_profile.key_terms 기반 의도 유형 예시 생성 (XML 태그 포함)"""
    terms = domain_profile.get("key_terms", [])
    domain_short = domain_profile.get("domain_short", "문서")
    t0 = terms[0] if len(terms) > 0 else "항목"
    t1 = terms[1] if len(terms) > 1 else "기준"

    return (
        f"<intent_examples domain=\"{domain_short}\">\n"
        f'  - factoid:    "{t0}의 특징은?", "{domain_short}에서 {t0}란?"\n'
        f'  - definition: "{t0}이란 무엇인가?", "{t1}의 정의는?"\n'
        f'  - how:        "어떻게 {t1}를 검증하나?", "어떻게 {t0}을 구성하나?"\n'
        f'  - numeric:    "{t0}의 최소 기준은?", "허용 비율은 얼마인가?" ← 수치 있을 때만\n'
        f'  - procedure:  "{t0} 처리 절차는?", "{t1} 적용 단계는?" ← 절차 있을 때만\n'
        f'  - why:        "왜 {t0}이 필요한가?" → 컨텍스트에서 이유 찾아서 설명 ← 이유 있을 때만\n'
        f'  - list:       "{t0}의 유형을 모두 나열하세요" ← 복수 항목 있을 때만\n'
        f'  - boolean:    "{t0}은 필수인가?", "{t1}은 선택 사항인가?" ← 조건/규칙 있을 때만\n'
        f"</intent_examples>"
    )


def build_user_template(
    domain_profile: dict, chunk_type: str = "body", n_qa: int = 8, min_qa: int = 4
) -> str:
    """chunk_type에 따라 intent 가중치를 조정한 유저 템플릿 반환.
    반환값은 .format(hierarchy=..., text=...)으로 채워서 사용."""
    intent_hints = domain_profile.get("intent_hints", {})
    recommended = intent_hints.get(chunk_type, ["factoid", "why", "definition"])

    emphasis = ""
    if isinstance(recommended, list) and recommended:
        emphasis = (
            f"\n<chunk_type_hint>\n"
            f"이 청크 유형({chunk_type})에서 권장 의도 유형: {', '.join(recommended)}\n"
            f"</chunk_type_hint>\n"
        )

    intent_examples = _generate_intent_examples(domain_profile)

    return (
        f"<generation_guide>\n"
        f"{intent_examples}\n"
        f"{emphasis}"
        f"<selection_rule>\n"
        f"컨텍스트를 먼저 분석하여 근거가 충분한 의도 유형만 선택하세요.\n"
        f"근거가 없는 유형은 건너뛰고, 근거 있는 다른 유형으로 대체합니다.\n"
        f"동일 유형 중복 시 최대 2개, 우선 선택 그룹(factoid/definition/how)이 전체 절반 초과 금지.\n"
        f"</selection_rule>\n"
        f"<groundedness_check>\n"
        f"- 모든 답변에 컨텍스트 근거가 명시되어야 함\n"
        f'- 금지 표현: "안내합니다", "정책입니다", "규정입니다" (이유 설명 없이)\n'
        f"- 필수: \"~때문에\", \"~으로 인해\", \"~를 위해\" (명시된 이유/근거)\n"
        f"</groundedness_check>\n"
        f"</generation_guide>\n\n"
        f"<category>{{hierarchy}}</category>\n\n"
        f"<context>\n"
        f"{{text}}\n"
        f"</context>\n\n"
        f"<task>\n"
        f"위 컨텍스트에서 근거를 찾을 수 있는 의도 유형을 선택하여 {min_qa}~{n_qa}개 QA를 생성하세요.\n"
        f"마크다운 코드블록 없이 순수 JSON만 출력하세요:\n"
        f"{{{{\n"
        f'  "qa_list": [\n'
        f'    {{{{"q": "질문 텍스트", "a": "답변 텍스트 (컨텍스트 근거)", "intent": "의도유형", "answerable": true}}}},\n'
        f"    ...\n"
        f"  ]\n"
        f"}}}}\n"
        f"</task>"
    )


USER_TEMPLATE_EN_V1 = """<generation_guide>
<intent_examples>
  - factoid:    "이 항목의 특징은?", "해당 기준의 내용은?"
  - definition: "해당 용어의 정의는?", "이 개념이란?"
  - how:        "어떻게 검증하나?", "어떻게 구성하나?"
  - numeric:    "최소 기준은 몇 개?", "허용 비율은?" ← only when numbers present
  - procedure:  "처리 절차는?", "적용 단계는?" ← only when steps present
  - why:        "왜 이 항목이 필요한가?" → Find explicit reason in context ← only when reason present
  - list:       "포함되는 유형을 모두 나열하세요" ← only when multiple items listed
  - boolean:    "해당 항목은 필수인가?" ← only when condition/rule present
</intent_examples>

<selection_rule>
Analyze the context first. Select only intent types with sufficient evidence.
Skip types without context support; substitute with a supported type instead.
Same type allowed maximum 2 times. Priority group (factoid/definition/how) must not exceed half of total.
</selection_rule>

<groundedness_check>
- Include explicit evidence from context in all answers
- Forbidden: "As policy states", "per guidelines" (no reason provided)
- Required: "because...", "due to...", "in order to..." (explicit reason)
</groundedness_check>
</generation_guide>

<category>{hierarchy}</category>

<context>
{text}
</context>

<task>
Generate 4~8 QA pairs using only intent types supported by the context above.
Output ONLY pure JSON (no markdown code block):
{{
  "qa_list": [
    {{"q": "질문 텍스트", "a": "답변 텍스트 (컨텍스트 근거)", "intent": "intent_type", "answerable": true}},
    ...
  ]
}}
</task>"""
