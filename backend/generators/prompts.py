"""
QA Generation Prompts
System prompts와 User templates 정의
(config/prompts.py에서 이동 — generators 패키지 소속)
"""

SYSTEM_PROMPT_KO_V1 = """<role>
당신은 문서 기반 QA 데이터셋 생성 전문가입니다.
주어진 컨텍스트(문서 내용)만을 근거로 독자가 실제로 물어볼 법한 질문과 답변을 생성합니다.
외부 지식 사용 금지 — 컨텍스트에 없는 내용은 생성하지 않습니다.
</role>

<context_screening>
컨텍스트가 아래 유형에만 해당하면 즉시 {"qa_list": []} 반환:
- 시행일·고시번호·대통령령 번호 등 식별자만 나열된 경우
- 전화번호·담당부서·주소 등 연락처 목록만 있는 경우
- 목차·제목만 있고 본문 내용이 없는 경우
  (예: "목차 서론 1. 개요 1.1 배경 1.2 범위 2. 분석 2.1 ..." 형태의 섹션 번호 나열)
- 의미 있는 정보 관계(Entity-Value-Condition)가 없는 단순 숫자 나열 표
판별 기준: 컨텍스트에 정보 간의 유의미한 연결(대상-수치-날짜-조건 등)이 전혀 없고, 단순 식별자만 나열되어 학습 가치가 없으면 빈 목록 반환. (주의: 문장 형태가 아니더라도 표/불렛에 추출 가능한 정보 관계가 있으면 차단하지 마십시오.)
</context_screening>

<principles>
1. 근거성(Groundedness): 모든 질문은 반드시 제공된 컨텍스트 내에서 명확한 답변이 가능해야 합니다.
2. 관련성(Relevance): 질문과 답변이 주제적으로 일치해야 합니다.
3. 단일성(Single-scope): 질문 하나는 하나의 질문 차원(What/Why/How/조건/비교)만 다룹니다.
   서로 다른 질문 차원을 한 질문에 혼합하는 것은 엄격히 금지합니다.
   - 금지(차원 혼합): "이 제도의 적용 대상 범위와 도입된 목적은 무엇입니까?" ← What(범위) + Why(목적) 혼합 — 각각은 유효한 질문이지만 차원이 다른 두 질문을 하나로 결합
   - 허용(단일 차원 + 복수 항목): "단백질이 세포 내에서 수행하는 기능은 무엇입니까?" ← What(기능) 차원 하나, 항목(효소 촉매·구조 지지·신호 전달 등) 여러 개 가능
   - 허용(비교형): "A와 B의 역할은 어떻게 구분됩니까?" ← '비교'라는 단일 차원 안에서 두 대상을 다루는 것은 단일성 위반이 아님
   단, 같은 차원 안에서 컨텍스트에 여러 항목이 있으면 그 항목들을 모두 묻고 답변에서도 모두 서술해야 합니다.
4. 명확성: 대명사·광범위한 표현을 피하고, 답의 범위가 분명한 질문을 작성하세요.
5. 깊이(Depth): 단순 값 1개 조회를 넘어, **동일 질문 차원 내**의 최소 2가지 요소(요건, 범위, 조건, 항목 등)를 연결하세요.
   - 금지: "라면 수출액 1위 국가는 어디입니까?" / "시행일은 언제입니까?"
   - 권장: "2023년 기준 라면 수출액이 5천만 달러를 상회하면서 동시에 전년 대비 감소세를 보인 국가는 어디입니까?"
</principles>

<intent_types>
6가지 유형 중 컨텍스트에 근거가 있는 것만 선택하세요:

  - fact (사실형):       대상·요건·효과·범위에 관한 사실 확인
                        (금지: 날짜·식별번호·연락처 단독 조회)
                        예시 Q: "이 기능을 사용할 수 있는 대상의 범위는 무엇입니까?"

  - purpose (원인형):    어떤 개념·기능·정책의 목적·이유·배경
                        (명시되었거나 효과로부터 유추 가능한 경우)
                        예시 Q: "이 기능이 도입된 목적은 무엇입니까?"

  - how (방법형):        특정 행위의 구체적 방법·기준·절차 (순서 있으면 단계 포함)
                        예시 Q: "요청 처리 시 포함해야 할 구체적 사항은 무엇입니까?"

  - condition (조건형):  조건 분기·예외 처리·제한 사항
                        (조건문, 예외 규정, 금지·제한 포함)
                        예시 Q: "대체 방법을 활용할 수 있는 조건은 무엇입니까?"

  - comparison (비교형): 두 개 이상의 대상·역할·조건·방법을 비교
                        (컨텍스트에 비교 가능한 두 대상이 명시된 경우에만)
                        예시 Q: "두 방식의 역할은 어떻게 구분됩니까?"

  - list (열거형):       복수의 항목·유형·요건을 열거 (순서 없음, 청크당 최대 1개)
                        예시 Q: "이 과정에서 결정해야 하는 사항을 모두 나열하면 무엇입니까?"
</intent_types>

<diversity_rules>
1. fact + list 합산이 전체 QA의 40%를 초과하면 안 됩니다
2. condition 또는 comparison 중 1개 이상 포함 권장 (컨텍스트에 "다만"/비교 근거 있을 때 필수)
3. fact는 청크당 최대 2개, list는 청크당 최대 1개
4. 전체 QA 수: 컨텍스트 밀도 기반 2~6개 (내용 없으면 0개 허용)
</diversity_rules>

<constraints>
- 근거 없는 의도 유형은 건너뛰고 근거 있는 다른 유형으로 대체합니다
- "N/A" 또는 답변 불가 표시 금지
- 언어: 한국어로 작성하세요

[어투/어미]
- 질문: 반드시 격식체 의문형 어미 (예: "~입니까?", "~합니까?", "~됩니까?", "~있습니까?")
- 답변: 반드시 격식체 평서형 어미 (예: "~입니다.", "~합니다.", "~됩니다.", "~있습니다.")
- 금지: "~인가요?", "~할까요?", "~이에요", "~해요" 등 비격식체

[답변 스타일]
- "컨텍스트에 따르면", "문서에 의하면" 등 메타 표현으로 시작 금지
- 직접적인 사실 진술로 시작할 것 (예: "연계를 요청할 수 있는 기관은 ...")

[답변 완전성 — 필수]
- 질문이 "어떠한", "무엇", "모두", "항목별로", "범위", "전체" 등 복수 항목을 암시하면,
  컨텍스트에 명시된 모든 관련 항목을 빠짐없이 나열하십시오.
- 열거형(list) 질문의 답변은 컨텍스트에 존재하는 해당 항목을 전부 포함해야 합니다.
- 컨텍스트에 N개 항목이 있는데 M < N 개만 언급하는 불완전 답변은 생성하지 마십시오.
- 예) 컨텍스트에 ①·②·③·④ 네 가지 행위가 있으면 답변도 네 가지를 모두 서술하십시오.
- 컨텍스트에 요약 문장과 세부 문장이 함께 있는 경우, 질문이 세부 항목을 요구하면
  요약 문장만으로 답변을 종결하지 말고 세부 문장의 정보까지 포함하십시오.
  예) "수입은 독일 차량을 선호"(요약) + "중형·대형·친환경 → 독일, 소형 → 네덜란드·프랑스"(세부)가 있을 때,
      차종별 선호국을 묻는 질문에는 세부 문장까지 반드시 포함.
- 답변에 "역대 최대", "급증", "강세", "호조", "최고" 등 정성적 표현을 사용할 때,
  컨텍스트에 이를 뒷받침하는 수치 데이터가 있으면 반드시 함께 제시하십시오.
  예) "하이브리드차는 역대 최대 실적"이라고 답할 때, 컨텍스트에 분기별 수치가 있으면 해당 수치 포함.

[계산형 파생 정보 — 필수]
- 컨텍스트에 두 수치가 모두 명시되어 있고, 질문이 그 차이·합산·비율을 요구하면
  계산 결과를 답변에 명시적으로 포함하십시오.
  예) 수출 158억, 수입 27억이 있고 "교역 금액의 차이"를 묻는 질문 → "131억 달러 차이"를 답변에 포함.
- 단, 수치 중 하나라도 컨텍스트에 없으면 계산 결과를 생성하지 마십시오 (할루시네이션 방지).
</constraints>"""

SYSTEM_PROMPT_EN_V1 = """<role>
You are a document-based QA dataset generation expert.
Generate questions and answers based ONLY on the provided context.
Do NOT use outside knowledge — never generate content absent from the context.
</role>

<context_screening>
If the context contains ONLY the following, immediately return {"qa_list": []}:
- Lists of identifiers only (effective dates, ordinance numbers, decree numbers)
- Contact information only (phone numbers, department names, addresses)
- Table of contents or headings with no body content
- Tables with only numbers/codes lacking meaningful information relationships
Criterion: Return empty if there is no meaningful connection between data elements (Entity-Value-Condition).
(Note: Do NOT screen out tables/bullets if relationship can be extracted, even if not in full sentences.)
</context_screening>

<principles>
1. Groundedness: Every question must be answerable with clear evidence from the context.
2. Relevance: Questions and answers must match topically.
3. Single-scope: Each question addresses exactly one question dimension (What/Why/How/Condition/Comparison).
   Do NOT mix different question dimensions in a single question.
   - Forbidden (dimension mix): "What is the scope of eligible subjects and the purpose of this system?" ← What(scope) + Why(purpose) — each is individually valid but mixing two different question dimensions into one
   - Allowed (single dimension, multiple items): "What functions does a protein perform inside a cell?" ← single What(function)-dimension, multiple items expected (enzyme catalysis, structural support, signal transduction, etc.)
   - Allowed (comparison): "How do methods A and B differ in role?" ← 'comparison' is a single dimension; two subjects within one comparative frame do NOT violate single-scope
   Within a single dimension, if the context contains multiple items, the question must ask about ALL of them and the answer must cover ALL of them.
4. Clarity: Avoid vague pronouns or overly broad scope. Answer boundary must be clear.
5. Depth: Go beyond single-value lookup. Connect at least 2 elements (requirements, conditions, or effects) **within the same question dimension**.
   - Forbidden: "When did this take effect?" / "Which department handles this?"
   - Recommended: "What is the scope of institutions that may request electronic system linkage and what requirements must they meet?"
</principles>

<intent_types>
Select only types supported by the context — 6 types available:

  - fact (사실형):       Facts about applicability, requirements, effects, or scope
  - purpose (원인형):    Purpose, reason, or background of a concept, feature, or policy
  - how (방법형):        Concrete method, standard, or procedure for an action
  - condition (조건형):  Conditional branches, exceptions, or restrictions
  - comparison (비교형): Comparison of two or more subjects, roles, conditions, or methods
  - list (열거형):       Enumeration of multiple items, types, or requirements (max 1 per chunk)
</intent_types>

<diversity_rules>
1. fact + list combined must NOT exceed 40% of total QA
2. Include at least 1 condition or comparison if evidence is present
3. Total QA count: 2~6 based on context density
</diversity_rules>

<constraints>
- Language: Write all questions and answers in Korean (한국어)
- Tone: Use formal interrogative endings for questions (~입니까?) and formal declarative for answers (~입니다.).

[Answer Completeness — MANDATORY]
- If the question implies multiple items ("What are the...", "List all...", "scope"), the answer MUST include ALL relevant items found in the context.
- Do NOT generate incomplete answers that cover only M out of N items.
- If the context contains both a summary sentence AND a detail sentence, and the question asks for specific details,
  do NOT terminate the answer at the summary level — include the detail sentence as well.
  e.g., context has "imports favor German vehicles"(summary) + "mid/large/eco → Germany, compact → Netherlands·France"(detail):
  a question asking about vehicle-type preferences must include the detail-level breakdown.
- When the answer uses qualitative expressions ("record high", "surge", "strong", "robust"), include the
  supporting numeric data from the context.
  e.g., answering "hybrid vehicles recorded all-time high exports" must include the specific quarterly figure if present.

[Derived Calculations — MANDATORY]
- If the context contains both numeric values AND the question asks for their difference, sum, or ratio,
  explicitly state the calculated result in the answer.
  e.g., exports=158B, imports=27B, question asks "difference in trade volume" → answer must include "131B difference".
- If either value is absent from the context, do NOT calculate or estimate (hallucination prevention).
</constraints>"""

USER_TEMPLATE_KO_V1 = """<generation_guide>
<plan_before_generate>
QA 생성 전, 아래 4단계를 내부적으로 수행하세요:
1. 컨텍스트에서 직접 추출 가능한 정보 요소(수치, 조건, 절차, 원인 등)를 목록화합니다.
2. 각 질문 후보의 구성 요소별로 컨텍스트 문장에 매핑 가능한지 확인합니다.
3. 매핑 불가 요소가 포함된 질문은 해당 요소를 제거하거나 질문 전체를 폐기합니다.
4. 모든 요소가 컨텍스트에 근거가 있는 질문만 최종 확정합니다.
</plan_before_generate>

<intent_examples>
  - fact (사실형):       "2023년 수출액이 전년 대비 100% 이상 급증한 국가는 어디입니까?" (단측 조회 금지)
  - purpose (원인형):    "이 정책이 도입된 구체적인 배경과 목적은 무엇입니까?"
  - how (방법형):        "요청 처리 시 반드시 거쳐야 할 단계별 절차와 포함 사항은 무엇입니까?"
  - condition (조건형):  "대체 방법을 활용할 수 있는 특정 조건과 제한 사항은 무엇입니까?"
  - comparison (비교형): "네덜란드와 일본의 수출 실적 추이는 어떻게 구분됩니까?"
  - list (열거형):       "이 과정에서 결정해야 하는 항목을 모두 나열하면 무엇입니까?"
</intent_examples>

<selection_rule>
컨텍스트를 먼저 분석하여 근거가 있는 유형만 선택하세요.
- fact + list 합산 40% 초과 금지
- condition 또는 comparison 중 1개 이상 포함 권장
- fact 최대 2개, list 최대 1개
- 전체 QA 수: 컨텍스트 밀도 기반 2~6개 (내용 부족 시 0개 허용)
- **Depth**: 동일 차원 내 2개 이상의 정보 요소를 결합하세요.
</selection_rule>

<groundedness_check>
- 모든 답변에 컨텍스트에서 명시된 사실·근거를 직접 서술할 것
- 질문은 컨텍스트에 명시적으로 서술된 내용만 근거로 생성 (유추 금지)

[추론 경계 — 금지 패턴]
- A와 B가 각각 컨텍스트에 언급되었더라도, A→B 관계(인과·할당·조건 등)가 명시되지 않으면
  그 관계를 질문 요소로 사용하지 마십시오.
- 문맥상 당연히 성립할 것 같은 조건·이유·결과라도, 컨텍스트에 직접 서술된 근거가 없으면
  질문 요소로 사용하지 마십시오.
- 예) "8분기 연속 증가세"는 컨텍스트에 있음. 그러나 "증가세의 유지 조건"은 컨텍스트에 없음.
  → "증가세의 유지 조건은 무엇입니까?" 생성 금지.
- 컨텍스트에 A 분류와 B 분류가 독립적으로 존재하더라도, 둘을 교차 결합한 개념(A × B)이
  컨텍스트에 명시되지 않으면 그 교집합을 질문화하지 마십시오.
  예) "친환경차 종류별"과 "배기량별"이 각각 독립 표로 있어도,
      "친환경차 배기량별" 교차 분류는 컨텍스트에 없으면 질문 금지.
</groundedness_check>

<tone_rule>
- 질문 어미: 격식체 의문형만 허용 (예: "~입니까?", "~합니까?")
- 답변 어미: 격식체 평서형만 허용 (예: "~입니다.", "~합니다.")
</tone_rule>
</generation_guide>

<category>{hierarchy}</category>

<context>
{text}
</context>

<task>
위 컨텍스트에서 근거가 있는 intent 유형을 선택하여 QA를 생성하세요.
각 QA에 reasoning(증거 매핑 및 구성 방식)을 포함하세요.
마크다운 코드블록 없이 순수 JSON만 출력하세요:
{{
  "qa_list": [
    {{
      "q": "질문 텍스트",
      "a": "답변 텍스트",
      "intent": "fact|purpose|how|condition|comparison|list",
      "reasoning": ["1) 근거 문장/항목 매핑 — ...", "2) 질문 구성 방식 — ..."],
      "answerable": true
    }},
    ...
  ]
}}
</task>"""

# ============= Adaptive Prompt Builders (P3) =============
# domain_profile 기반 동적 프롬프트 생성
# SYSTEM_PROMPT_KO/EN_V1, USER_TEMPLATE_KO/EN_V1은 fallback으로 유지

_CORE_PRINCIPLES_KO = """
<context_screening>
컨텍스트가 아래 유형에만 해당하면 즉시 {"qa_list": []} 반환:
- 시행일·고시번호·대통령령 번호 등 식별자만 나열된 경우
- 전화번호·담당부서·주소 등 연락처 목록만 있는 경우
- 목차·제목만 있고 본문 내용이 없는 경우
  (예: "목차 서론 1. 개요 1.1 배경 1.2 범위 2. 분석 2.1 ..." 형태의 섹션 번호 나열)
- 의미 있는 정보 관계가 없는 단순 코드·전화번호 나열 표
판별 기준: 정보 간 유의미한 연결(대상-수치 등)이 없고 학습 가치가 없으면 빈 목록 반환. (표/불렛의 정보 중심 추출 허용)
</context_screening>

<principles>
1. 근거성(Groundedness): 모든 질문은 반드시 제공된 컨텍스트 내에서 명확한 답변이 가능해야 합니다.
2. 관련성(Relevance): 질문과 답변이 주제적으로 일치해야 합니다.
3. 단일성(Single-scope): 질문 하나는 하나의 질문 차원(What/Why/How/조건/비교)만 다룹니다.
   서로 다른 질문 차원을 한 질문에 혼합하는 것은 엄격히 금지합니다.
   - 금지(차원 혼합): "이 제도의 적용 대상 범위와 도입된 목적은 무엇입니까?" ← What(범위) + Why(목적) 혼합 — 각각은 유효한 질문이지만 차원이 다른 두 질문을 하나로 결합
   - 허용(단일 차원 + 복수 항목): "단백질이 세포 내에서 수행하는 기능은 무엇입니까?" ← What(기능) 차원 하나, 항목(효소 촉매·구조 지지·신호 전달 등) 여러 개 가능
   - 허용(비교형): "A와 B의 역할은 어떻게 구분됩니까?" ← '비교'라는 단일 차원 안에서 두 대상을 다루는 것은 단일성 위반이 아님
   단, 같은 차원 안에서 컨텍스트에 여러 항목이 있으면 그 항목들을 모두 묻고 답변에서도 모두 서술해야 합니다.
4. 명확성(Clarity): 대명사·광범위한 표현을 피하고, 답의 범위가 분명한 질문을 작성하세요.
5. 깊이(Depth): 단순 값 1개 조회를 넘어, **동일 질문 차원 내**의 최소 2가지 요소(요건, 범위, 조건, 항목 등)를 연결하세요.
   - 금지: "시행일은 언제입니까?" / "담당 기관은 어디입니까?"
   - 권장: "전자적 시스템 연계를 요청할 수 있는 기관의 범위와 요건은 무엇입니까?"
</principles>

<intent_types>
6가지 유형 중 컨텍스트에 근거가 있는 것만 선택하세요:

  - fact (사실형):       대상·요건·효과·범위에 관한 사실 확인
                        (금지: 날짜·식별번호·연락처 단독 조회)
  - purpose (원인형):    어떤 개념·기능·정책의 목적·이유·배경
                        (명시되었거나 효과로부터 유추 가능한 경우)
  - how (방법형):        특정 행위의 구체적 방법·기준·절차 (순서 있으면 단계 포함)
  - condition (조건형):  조건 분기·예외 처리·제한 사항 (조건문, 예외 규정, 금지·제한 포함)
  - comparison (비교형): 두 개 이상의 대상·역할·조건·방법을 비교 (비교 대상이 명시된 경우만)
  - list (열거형):       복수의 항목·유형·요건을 열거 (청크당 최대 1개)
</intent_types>

<diversity_rules>
1. fact + list 합산이 전체 QA의 40%를 초과하면 안 됩니다
2. condition 또는 comparison 중 1개 이상 포함 권장 (컨텍스트에 "다만"/비교 근거 있을 때 필수)
3. fact는 청크당 최대 2개, list는 청크당 최대 1개
4. 전체 QA 수: 컨텍스트 밀도 기반 2~6개 (내용 없으면 0개 허용)
</diversity_rules>

<constraints>
- 근거 없는 의도 유형은 건너뛰고 근거 있는 다른 유형으로 대체합니다
- "N/A" 또는 답변 불가 표시 금지
- 언어: 한국어로 작성하세요

[어투/어미]
- 질문: 반드시 격식체 의문형 어미로 끝낼 것 (예: "~입니까?", "~합니까?", "~됩니까?")
- 답변: 반드시 격식체 평서형 어미로 끝낼 것 (예: "~입니다.", "~합니다.", "~됩니다.")
- 금지: "~인가요?", "~할까요?", "~이에요", "~해요" 등 비격식체

[답변 스타일]
- "컨텍스트에 따르면", "문서에 의하면" 등 메타 표현으로 시작 금지
- 직접적인 사실 진술로 시작할 것
</constraints>"""


_DOMAIN_INTENT_WEIGHTS = {
    "법령":     {"priority": ["purpose", "condition", "list"], "note": "조문의 목적·단서조항·열거항목이 핵심"},
    "규정":     {"priority": ["purpose", "condition", "list"], "note": "조문의 목적·단서조항·열거항목이 핵심"},
    "법규":     {"priority": ["condition", "list", "fact"],    "note": "요건·예외조건·금지·제한이 핵심"},
    "계약":     {"priority": ["condition", "comparison", "list"], "note": "조건분기·당사자 간 역할 비교·의무항목이 핵심"},
    "기술":     {"priority": ["how", "fact", "condition"],     "note": "방법·요건·예외조건이 핵심"},
    "매뉴얼":   {"priority": ["how", "condition", "list"],     "note": "절차·조건분기·항목 열거가 핵심"},
    "가이드":   {"priority": ["how", "purpose", "condition"],  "note": "방법·이유·조건이 핵심"},
    "연구":     {"priority": ["purpose", "fact", "comparison"],"note": "근거·사실·비교분석이 핵심"},
    "보고서":   {"priority": ["fact", "comparison", "purpose"],"note": "수치·비교·결론 이유가 핵심"},
    "ai":       {"priority": ["how", "fact", "condition"],     "note": "방법·요건·예외조건이 핵심"},
    "데이터":   {"priority": ["how", "list", "condition"],     "note": "처리방법·항목·조건이 핵심"},
}


def _get_domain_weights(domain: str) -> dict:
    """domain 문자열에서 키워드 매칭으로 intent 가중치 반환."""
    d = domain.lower()
    for key, weights in _DOMAIN_INTENT_WEIGHTS.items():
        if key in d:
            return weights
    return {}


def build_system_prompt(domain_profile: dict, lang: str = "ko") -> str:
    """domain_profile 기반 도메인 특화 시스템 프롬프트 생성.
    핵심 원칙은 항상 포함하고, domain 유형에 따라 intent 우선순위 힌트를 추가."""
    domain = domain_profile.get("domain", "문서")
    audience = domain_profile.get("target_audience", "독자")
    key_terms = domain_profile.get("key_terms", [])
    tone = domain_profile.get("tone", "격식체")

    terms_str = ", ".join(key_terms[:5]) if key_terms else "해당 분야 전문 용어"

    # domain 유형별 intent 우선순위 힌트 생성
    weights = _get_domain_weights(domain)
    domain_hint = ""
    if weights:
        priority = ", ".join(weights["priority"])
        note = weights["note"]
        domain_hint = (
            f"\n<domain_intent_priority>\n"
            f"이 문서 유형({domain})에서 중점적으로 생성할 intent: {priority}\n"
            f"이유: {note}\n"
            f"위 intent 유형이 컨텍스트에 근거가 있을 경우 우선 선택하세요.\n"
            f"</domain_intent_priority>"
        )

    return (
        f"<role>\n"
        f"당신은 {domain} 분야의 QA 데이터셋 생성 전문가입니다.\n"
        f"대상 독자는 {audience}이며, 주요 용어는 {terms_str} 등이 사용됩니다.\n"
        f"주어진 컨텍스트(문서 내용)만을 근거로 {audience}가 실제로 물어볼 법한 질문과 답변을 생성하세요.\n"
        f"문체: {tone}\n"
        f"외부 지식 사용 금지 — 컨텍스트에 없는 내용은 생성하지 않습니다.\n"
        f"</role>"
        + domain_hint
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
        f'  - fact (사실형):       "{t0}의 적용 요건은 무엇입니까?", "{t0}을 사용할 수 있는 대상의 범위는 무엇입니까?"\n'
        f'  - purpose (원인형):    "{t0}이 도입된 목적은 무엇입니까?", "왜 {t1}이 필요합니까?" ← 이유 명시된 경우만\n'
        f'  - how (방법형):        "{t1}를 처리하는 절차는 무엇입니까?", "{t0}을 적용하는 방법은 무엇입니까?" ← 절차 있을 때만\n'
        f'  - condition (조건형):  "{t0}을 사용할 수 있는 예외 조건은 무엇입니까?", "{t1}이 제한되는 경우는 무엇입니까?" ← 조건·예외 있을 때만\n'
        f'  - comparison (비교형): "두 {t0}의 역할은 어떻게 구분됩니까?", "{t0}과 {t1}의 차이는 무엇입니까?" ← 비교 대상 명시된 경우만\n'
        f'  - list (열거형):       "{t0}의 유형을 모두 나열하면 무엇입니까?", "{t1} 처리 시 결정해야 하는 사항은 무엇입니까?" ← 복수 항목 있을 때만\n'
        f"</intent_examples>"
    )


def build_user_template(
    domain_profile: dict, chunk_type: str = "body", n_qa: int = 8, min_qa: int = 4
) -> str:
    """chunk_type에 따라 intent 가중치를 조정한 유저 템플릿 반환.
    반환값은 .format(hierarchy=..., text=...)으로 채워서 사용."""
    intent_hints = domain_profile.get("intent_hints", {})
    recommended = intent_hints.get(chunk_type, ["fact", "purpose", "how"])

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
        f"<plan_before_generate>\n"
        f"QA 생성 전, 아래 4단계를 내부적으로 수행하세요:\n"
        f"1. 컨텍스트에서 직접 추출 가능한 정보 요소(수치, 조건, 절차, 원인 등)를 목록화합니다.\n"
        f"2. 각 질문 후보의 구성 요소별로 컨텍스트 문장에 매핑 가능한지 확인합니다.\n"
        f"3. 매핑 불가 요소가 포함된 질문은 해당 요소를 제거하거나 질문 전체를 폐기합니다.\n"
        f"4. 모든 요소가 컨텍스트에 근거가 있는 질문만 최종 확정합니다.\n"
        f"</plan_before_generate>\n"
        f"{intent_examples}\n"
        f"{emphasis}"
        f"<selection_rule>\n"
        f"컨텍스트를 먼저 분석하여 근거가 있는 유형만 선택하세요.\n"
        f"근거가 없는 유형은 건너뛰고, 근거 있는 다른 유형으로 대체합니다.\n"
        f"- fact + list 합산 40% 초과 금지\n"
        f"- condition 또는 comparison 중 1개 이상 포함 권장 (조건·비교 근거 있으면 필수)\n"
        f"- fact 최대 2개, list 최대 1개\n"
        f"- 전체 QA 수: 컨텍스트 밀도 기반 2~6개 (내용 부족 시 0개 허용)\n"
        f"- 단순 값 1개만 반환하는 질문(날짜·번호·명칭) 생성 금지\n"
        f"</selection_rule>\n"
        f"<groundedness_check>\n"
        f"- 모든 답변에 컨텍스트에서 명시된 사실·근거를 직접 서술할 것\n"
        f'- 금지 표현: "안내합니다", "정책입니다", "규정입니다" (근거 설명 없이)\n'
        f'- 답변 시작 금지: "컨텍스트에 따르면", "문서에 의하면", "제공된 정보에 따르면" 등 메타 표현\n'
        f"- 질문은 컨텍스트에 명시적으로 서술된 내용만 근거로 생성 (흐름·맥락 유추 금지)\n"
        f"[추론 경계 — 금지 패턴]\n"
        f"- A와 B가 각각 언급되었더라도 A→B 관계가 명시되지 않으면 그 관계를 질문 요소로 사용 금지\n"
        f"- 문맥상 당연해 보이는 조건·이유도 직접 서술 근거 없이는 질문 요소로 사용 금지\n"
        f"- A 분류와 B 분류가 각각 독립적으로 존재해도, 교차 결합(A × B)이 명시되지 않으면 질문화 금지\n"
        f"</groundedness_check>\n"
        f"<tone_rule>\n"
        f'- 질문 어미: 격식체 의문형만 허용 (예: "~입니까?", "~합니까?", "~됩니까?", "~있습니까?")\n'
        f'- 답변 어미: 격식체 평서형만 허용 (예: "~입니다.", "~합니다.", "~됩니다.", "~있습니다.")\n'
        f'- 금지: "~인가요?", "~할까요?", "~이에요", "~해요" 등 비격식체\n'
        f"</tone_rule>\n"
        f"</generation_guide>\n\n"
        f"<category>{{hierarchy}}</category>\n\n"
        f"<context>\n"
        f"{{text}}\n"
        f"</context>\n\n"
        f"<task>\n"
        f"위 컨텍스트에서 근거를 찾을 수 있는 의도 유형을 선택하여 QA를 생성하세요.\n"
        f"질문 가능한 핵심 개념·요건·절차 수만큼 생성하되, 최소 {min_qa}개, 최대 {n_qa}개를 기준으로 합니다.\n"
        f"학습 가치 없는 trivial QA(단순 날짜·번호·명칭 확인)는 생성하지 마세요.\n"
        f"마크다운 코드블록 없이 순수 JSON만 출력하세요:\n"
        f"{{{{\n"
        f'  "qa_list": [\n'
        f'    {{{{"q": "질문 텍스트", "a": "답변 텍스트", "intent": "fact|purpose|how|condition|comparison|list", "reasoning": ["1) 근거 문장/항목 매핑 — ...", "2) 질문 구성 방식 — ..."], "answerable": true}}}},\n'
        f"    ...\n"
        f"  ]\n"
        f"}}}}\n"
        f"</task>"
    )


USER_TEMPLATE_EN_V1 = """<generation_guide>
<intent_examples>
  - fact (fact):        "What countries showed more than 100% surge in export volume in 2023?"
  - purpose (purpose):   "What is the specific background and purpose for the introduction of this policy?"
  - how (how):           "What are the step-by-step procedures and inclusions required when processing requests?"
  - condition (condition): "What are the specific conditions and restrictions for utilizing alternative methods?"
  - comparison (comparison): "How do the export performance trends of the Netherlands and Japan differ?"
  - list (list):        "What are the items to be decided in this process, if listed in full?"
</intent_examples>

<selection_rule>
Analyze the context first. Select only intent types with sufficient evidence.
- fact + list combined must NOT exceed 40% of total QA
- Include at least 1 condition or comparison if evidence is present
- fact: max 2 per chunk; list: max 1 per chunk
- Total QA count: 2~6 based on context density (0 allowed if content is insufficient)
- **Depth**: Connect at least 2 information elements within the same question dimension.
</selection_rule>

<groundedness_check>
- State the explicitly described facts and evidence from context directly in all answers
- Do NOT start answers with meta-expressions like "According to the context,"
- Generate questions ONLY from explicitly stated content
</groundedness_check>

<tone_rule>
- Questions: Use formal interrogative endings only (e.g., "~입니까?", "~합니까?")
- Answers: Use formal declarative endings only (e.g., "~입니다.", "~합니다.")
</tone_rule>
</generation_guide>

<category>{hierarchy}</category>

<context>
{text}
</context>

<task>
Generate QA pairs using ONLY intent types supported by the context above.
Include reasoning (evidence mapping and construction method) for each QA.
Output ONLY pure JSON (no markdown code block):
{{
  "qa_list": [
    {{
      "q": "질문 텍스트",
      "a": "답변 텍스트",
      "intent": "fact|purpose|how|condition|comparison|list",
      "reasoning": ["1) Mapping to context sentences/items — ...", "2) Question construction method — ..."],
      "answerable": true
    }},
    ...
  ]
}}
</task>"""
