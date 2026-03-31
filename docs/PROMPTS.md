# PROMPTS.md — 백엔드 프롬프트 목록

> 마지막 업데이트: 2026-03-31
> 백엔드에서 LLM을 호출하는 모든 프롬프트를 파이프라인 단계 순서로 정리.

---

## 목차

| # | 단계 | 파일 | 모델 |
|---|------|------|------|
| 1 | Ingestion — Pass1+2 통합 (H1/H2/H3 master + domain_profile) | `ingestion_api.py` | Gemini 3 Flash |
| 2 | Ingestion — Pass3 태깅 (master 있음) | `ingestion_api.py` | Gemini 3 Flash |
| 3 | Ingestion — Pass3 태깅 (master 없음, fallback) | `ingestion_api.py` | Gemini 3 Flash |
| 4 | 도메인 분석 (폴백 전용) | `domain_profiler.py` | 설정 모델 (기본 GPT) |
| 5 | QA 생성 — System Prompt (Static KO v1) | `prompts.py` | 생성 모델 |
| 6 | QA 생성 — System Prompt (Static EN v1) | `prompts.py` | 생성 모델 |
| 7 | QA 생성 — System Prompt (Adaptive, Domain-Aware) | `prompts.py` | 생성 모델 |
| 8 | QA 생성 — User Template (Static KO v1) | `prompts.py` | 생성 모델 |
| 9 | QA 생성 — User Template (Static EN v1) | `prompts.py` | 생성 모델 |
| 10 | QA 생성 — User Template (Adaptive) | `prompts.py` | 생성 모델 |
| 11 | 평가 Layer 2 — RAG Triad (통합, 권장 경로) | `rag_triad.py` | 평가 모델 (기본 Gemini Flash) |
| 12 | 평가 Layer 2 — Relevance (단독, fallback) | `rag_triad.py` | 평가 모델 |
| 13 | 평가 Layer 2 — Groundedness (단독, CoT, fallback) | `rag_triad.py` | 평가 모델 |
| 14 | 평가 Layer 2 — Context Relevance (단독, fallback) | `rag_triad.py` | 평가 모델 |
| 15 | 평가 Layer 3 — QA Quality (Completeness 단일 지표) | `qa_quality.py` | 평가 모델 |

---

## 1. Pass1+2 통합 — H1/H2/H3 Master + domain_profile 생성

**파일**: `backend/api/ingestion_api.py` (엔드포인트: `POST /analyze-hierarchy`)
**모델**: `gemini-3-flash-preview`
**입력**: anchor 청크 30개 (content[:600]씩, 최대 18,000자)
**출력**: `domain_profile`, `h2_h3_master` (→ `h1_candidates`는 서버에서 `list(h2_h3_master.keys())`로 도출)

> Pass1(H1) + Pass2(H2/H3) + domain_profile을 단일 LLM 호출로 동시 생성.
> 결과는 `doc_metadata` 테이블에 upsert. QA 생성 시 LLM 재호출 없이 캐시 사용.

```
<role>
You are an expert document classifier. Build a complete hierarchical taxonomy (H1/H2/H3)
and domain profile for the provided document.
</role>

<constraints>
- Identify exactly 3~5 distinct H1 domain categories covering the full document.
- For each H1, create 2~5 H2 sub-categories covering distinct content themes.
- For each H2, create 2~4 specific H3 leaf labels.
- All names in Korean (한국어), under 15 characters each.
- H1 must represent content themes or domains — NOT section titles or headings.
</constraints>

<context>{concatenated_text[:18000]}</context>

<task>
Return a JSON object:
{
  "domain_profile": {
    "domain":           "문서 분야/유형",
    "domain_short":     "짧은 도메인명 (10자 이하)",
    "target_audience":  "주요 독자층",
    "key_terms":        ["전문용어1", ..., "전문용어5"],
    "tone":             "문서 문체"
  },
  "h2_h3_master": {
    "H1명A": {
      "H2명1": ["H3명1", "H3명2"],
      "H2명2": ["H3명1", "H3명2"]
    },
    "H1명B": {
      "H2명1": ["H3명1", "H3명2"]
    }
  }
}
</task>
```

---

## 2. Pass3 — 청크 태깅 (h2_h3_master 있음)

**파일**: `backend/api/ingestion_api.py` (엔드포인트: `POST /apply-granular-tagging`)
**모델**: `gemini-3-flash-preview`
**입력**: 배치 청크 (content[:800] + section_path/section_title 조건부) + master_hierarchy
**출력**: `[{ "idx": 0, "hierarchy": { "h1": "...", "h2": "...", "h3": "..." } }]`

```
<role>
You are a strict document taxonomy classifier.
Select H1, H2, H3 values EXCLUSIVELY from master_hierarchy. Do NOT generate new values.
</role>

<constraints>
- H1: select ONE from top-level keys of master_hierarchy
- H2: select ONE from H2 keys under selected H1
- H3: select ONE from H3 list under selected H2
</constraints>

<master_hierarchy>{h2_h3_master}</master_hierarchy>

<chunks>{chunks_data}</chunks>

<task>
Return ONLY a JSON array — no explanation:
[{ "idx": 0, "hierarchy": { "h1": "...", "h2": "...", "h3": "..." } }]
</task>
```

> **chunks_data 구조**: `[{ "idx": i, "content": c["content"][:800], "section_path": "..." (있을 때만), "section_title": "..." (있을 때만) }]`
> **재시도**: `update_chunk_metadata` 실패 시 최대 2회 재시도 (0.5s → 1.0s backoff)

---

## 3. Pass3 — 청크 태깅 (h2_h3_master 없음, fallback)

**파일**: `backend/api/ingestion_api.py`
**모델**: `gemini-3-flash-preview`
**입력**: 배치 청크 + H1 목록만

```
<role>You are a document taxonomy classifier.</role>

<constraints>
- H1: select ONE from h1_master
- H2/H3: Korean, under 15 characters each
</constraints>

<h1_master>{selected_h1_list}</h1_master>

<chunks>{chunks_data}</chunks>

<task>
Return ONLY a JSON array — no explanation:
[{ "idx": 0, "hierarchy": { "h1": "...", "h2": "...", "h3": "..." } }]
</task>
```

---

## 4. 도메인 분석 (Domain Profiler — 폴백 전용)

**파일**: `backend/generators/domain_profiler.py`
**모델**: 설정 모델 (기본 `gpt-5.1`)
**호출 조건**: `/analyze-hierarchy` 미실행으로 `doc_metadata`에 `domain_profile` 없을 때만 호출
**입력**: anchor 청크 최대 10개 (content[:400] + H1/H2/chunk_type 메타)
**출력**: domain_profile JSON

**System:**
```
You are a document domain analysis expert.
Analyze the provided document chunk samples and return a domain profile as pure JSON.
Output only valid JSON with no markdown.
All string values must be written in Korean (한국어).
```

**User:**
```
The following are chunk samples extracted from a document:

[Chunk 1] H1=xxx / H2=yyy / type=body
{content[:400]}
...

Analyze the samples above and return:
{
  "domain": "문서 분야/유형",
  "domain_short": "짧은 도메인명 (10자 이하)",
  "target_audience": "주요 독자층",
  "key_terms": ["전문용어1", ..., "전문용어5"],
  "intent_hints": {
    "table":   ["numeric", "list", "condition"],
    "list":    ["how", "list", "condition"],
    "body":    ["fact", "purpose", "how"],
    "heading": "skip"
  },
  "tone": "문서 문체"
}
```

---

## 5. QA 생성 — System Prompt (Static KO v1)

**파일**: `backend/config/prompts.py` — `SYSTEM_PROMPT_KO_V1`
**용도**: domain_profile 없거나 lang=ko 기본 경로
**모델**: 생성 모델 (Gemini Flash / Claude Sonnet / GPT 등)

**핵심 규칙:**

| 항목 | 내용 |
|------|------|
| context_screening | 목차·연락처·식별자만인 컨텍스트 → 즉시 `{"qa_list": []}` 반환 |
| 원칙 | 근거성 / 관련성 / 단일성(차원 혼합 금지) / 명확성 / 깊이(단순 값 1개 조회 금지) |
| Intent 6종 | `fact`, `purpose`, `how`, `condition`, `comparison`, `list` |
| 다양성 | fact + list 합산 ≤ 40%, condition 또는 comparison 1개 이상 권장 |
| 수량 | 컨텍스트 밀도 기반 **2~6개** (내용 없으면 0개 허용) |
| 답변 완전성 | 복수 항목 질문 시 컨텍스트에 명시된 모든 항목 필수 서술 |
| 답변 스타일 | "컨텍스트에 따르면", "문서에 의하면" 등 메타 표현 시작 금지 |

---

## 6. QA 생성 — System Prompt (Static EN v1)

**파일**: `backend/config/prompts.py` — `SYSTEM_PROMPT_EN_V1`
**용도**: lang=en일 때 사용
**내용**: KO v1과 동일한 규칙, 영문 버전. 최종 출력은 한국어(`Write all Q&A in Korean`)

---

## 7. QA 생성 — System Prompt (Adaptive, Domain-Aware)

**파일**: `backend/config/prompts.py` — `build_system_prompt(domain_profile, lang)`
**용도**: domain_profile 존재 시 우선 사용 (현재 기본 경로)

**구성**: `<role>` (domain-aware) + `_CORE_PRINCIPLES_KO` (static과 동일 원칙)

```
<role>
당신은 {domain} 분야의 QA 데이터셋 생성 전문가입니다.
대상 독자는 {audience}이며, 주요 용어는 {key_terms[:5]} 등이 사용됩니다.
주어진 컨텍스트만을 근거로 {audience}가 실제로 물어볼 법한 질문과 답변을 생성하세요.
문체: {tone}
외부 지식 사용 금지 — 컨텍스트에 없는 내용은 생성하지 않습니다.
</role>
+ context_screening + principles + intent_types + diversity_rules + constraints
```

> domain 유형별 intent 우선순위 힌트(`<domain_intent_priority>`)도 포함:
> 예) "계약" → condition/comparison/list 우선, "매뉴얼" → how/condition/list 우선

---

## 8. QA 생성 — User Template (Static KO v1)

**파일**: `backend/config/prompts.py` — `USER_TEMPLATE_KO_V1`
**변수**: `{hierarchy}`, `{text}`
**출력**: `{ "qa_list": [{ "q", "a", "intent", "reasoning", "answerable" }, ...] }`

```
<generation_guide>
  <intent_examples>
    - fact (사실형):       "이 기능을 사용할 수 있는 대상의 범위는 무엇입니까?"
    - purpose (원인형):    "이 정책이 도입된 목적은 무엇입니까?"
    - how (방법형):        "요청 처리 시 포함해야 할 구체적 사항은 무엇입니까?"
    - condition (조건형):  "대체 방법을 활용할 수 있는 조건은 무엇입니까?" ← 예외·조건 있을 때만
    - comparison (비교형): "두 방식의 역할은 어떻게 구분됩니까?" ← 비교 대상 명시된 경우만
    - list (열거형):       "이 과정에서 결정해야 하는 사항을 모두 나열하면 무엇입니까?" ← 청크당 최대 1개
  </intent_examples>
  <selection_rule> 근거 있는 유형만, fact+list ≤ 40%, condition/comparison 1개 이상 권장 </selection_rule>
</generation_guide>

<category>{hierarchy}</category>

<context>{text}</context>

<task>
위 컨텍스트에서 근거를 찾을 수 있는 의도 유형을 선택하여 QA를 생성하세요.
최소 {min_qa}개, 최대 {n_qa}개. 순수 JSON만 출력:
{ "qa_list": [{ "q": "...", "a": "...", "intent": "fact|purpose|how|condition|comparison|list",
                "reasoning": ["1) 근거확인 — ...", "2) 해석 — ..."], "answerable": true }] }
</task>
```

---

## 9. QA 생성 — User Template (Static EN v1)

**파일**: `backend/config/prompts.py` — `USER_TEMPLATE_EN_V1`
**내용**: KO v1과 동일 구조, intent_examples 영문 혼용. 수량 min=2/max=6. 출력은 한국어 강제.

---

## 10. QA 생성 — User Template (Adaptive)

**파일**: `backend/config/prompts.py` — `build_user_template(domain_profile, chunk_type, n_qa, min_qa)`
**용도**: domain_profile + chunk_type 기반 동적 생성 (현재 기본 경로)

**static과의 차이점:**
- `intent_examples`에 `domain_profile.key_terms` 반영 (도메인 특화 예시 문구)
- `<chunk_type_hint>` 추가 — chunk_type별 권장 intent 명시
  - `table` → `["numeric", "list", "condition"]`
  - `list` → `["how", "list", "condition"]`
  - `body` → `["fact", "purpose", "how"]`
  - `heading` → skip

---

## 11. 평가 Layer 2 — RAG Triad 통합 (권장 경로)

**파일**: `backend/evaluators/rag_triad.py` — `evaluate_all_with_reasons()`
**모델**: 평가 모델 (기본 `gemini-2.5-flash`)
**입력**: question, answer, context (최대 8,000자)
**출력**: `{ relevance, relevance_reason, groundedness, groundedness_reason, context_relevance, context_relevance_reason }`

> 단일 LLM 호출로 3개 차원 동시 평가. 내부 가중 평균: relevance×0.3 + groundedness×0.5 + context_relevance×0.2

```
<role>
You are a strict QA data quality auditor. Evaluate the QA pair on three RAG Triad dimensions
based solely on the provided context.
</role>

<context>{ctx[:8000]}</context>
<question>{question}</question>
<answer>{answer}</answer>

<scoring_dimensions>
1. relevance (0-10): Does the answer directly address the question?
   - 10: perfectly / 6-7: mostly relevant / 0-3: irrelevant

2. groundedness (0-10): Are ALL claims in the answer traceable to the context? (CoT internally)
   - 10: all traceable / 7-9: mostly / 5-6: partial / 0-4: hallucinated

3. context_relevance (0-10): Does the retrieved context contain sufficient info to answer?
   - 10: complete / 7-9: mostly sufficient / 4-6: topically related but missing key facts
   - 0-3: context doesn't contain the needed information
</scoring_dimensions>

<task>
For groundedness, reason through claims step by step internally, then write synthesized reason.
Return ONLY valid JSON:
{"relevance": <0-10>, "relevance_reason": "<1 sentence in Korean>",
 "groundedness": <0-10>, "groundedness_reason": "<1 concise Korean prose sentence>",
 "context_relevance": <0-10>, "context_relevance_reason": "<1 sentence in Korean>"}
</task>
```

---

## 12. 평가 Layer 2 — Relevance (단독, fallback)

**파일**: `backend/evaluators/rag_triad.py` — `evaluate_relevance()`
**용도**: `evaluate_all_with_reasons` 실패 시 fallback

```
<role>You are a strict QA evaluator. Assess relevance in domain context.</role>
<constraints>Score 0-10, return ONLY final integer on last line</constraints>
{context_excerpt — 있을 때만}
<question>{question}</question>
<answer>{answer}</answer>
<task>0=completely irrelevant, 10=perfectly relevant</task>
```

---

## 13. 평가 Layer 2 — Groundedness (단독, CoT, fallback)

**파일**: `backend/evaluators/rag_triad.py` — `evaluate_groundedness()`

```
<role>Expert at assessing answer groundedness. Use Chain of Thought reasoning.</role>
<constraints>FLEXIBLE MATCHING (not exact). Return ONLY final integer on last line.</constraints>
<context>{context[:10000]}</context>
<answer>{answer}</answer>
<task>
Step 1: IDENTIFY KEY CLAIMS
Step 2: FIND SUPPORTING EVIDENCE (flexible matching)
Step 3: ASSESS ALIGNMENT — Strong(0.9-1.0) / Medium(0.7-0.8) / Weak(0.5-0.6) / None(0.0)
Step 4: DETERMINE GROUNDING — 10:All strong / 7-9:Mostly / 5-6:Partial / 0-4:Hallucinated
</task>
```

---

## 14. 평가 Layer 2 — Context Relevance (단독, fallback)

**파일**: `backend/evaluators/rag_triad.py` — `evaluate_context_relevance()`

> 구 `evaluate_clarity()` (Clarity 지표)를 **Context Relevance (맥락성)** 로 대체.
> Clarity는 Q-A 표현 명확성 측정이었으나, Context Relevance는 검색 품질(컨텍스트가 질문에 답하기 충분한가)을 측정.

```
<role>You are a strict retrieval quality evaluator.</role>
<constraints>Score 0-10, return ONLY final integer on last line.</constraints>
<context>{context}</context>
<question>{question}</question>
<task>
Does the context contain sufficient information to answer the question?
10: complete / 7-9: mostly / 4-6: partial / 0-3: insufficient
</task>
```

---

## 15. 평가 Layer 3 — QA Quality (Completeness 단일 지표)

**파일**: `backend/evaluators/qa_quality.py` — `evaluate_all()`
**모델**: 평가 모델 (기본 `gemini-2.5-flash`)
**입력**: question, answer, context (최대 3,500자), intent
**출력**: `{ completeness, coverage, missing_aspects, completeness_reason }`

> 구 4지표(factuality / completeness / specificity / conciseness)에서 **completeness 단일 지표**로 의도적 축소.
> 질문 분해(Decomposition) 기반 커버리지 계산 방식.

**System:**
```
<role>Strict but fair data quality auditor. Evaluate completeness objectively.</role>
<output_format>
JSON only. reason: 1 concise sentence in Korean.
{"completeness": <0-10>, "coverage": <0.0-1.0>, "missing_aspects": [...], "completeness_reason": "..."}
</output_format>
```

**User:**
```
<context>{clean_ctx[:3500]}</context>
<question>{question}</question>
<answer>{answer}</answer>
<intent_type>{intent}</intent_type>  ← intent 있을 때만

<scoring_dimensions>
completeness (0-10): 질문의 모든 세부 요구사항을 답변이 충족하는가? (질문 분해 기반)
  - intent별 루브릭:
    - list/procedure: 모든 항목/단계 열거 = 10
    - how: 구체적 방법·기준·절차 포함 = 10
    - condition: 조건·예외 모두 서술 = 10
    - 기타: 포괄적이고 누락 없는 답변 = 10
</scoring_dimensions>
```

---

## 점수 계산 공식

```
final_score = syntax×0.05 + stats×0.05 + rag_avg×0.65 + completeness×0.25
```

**RAG Triad 내부 가중 평균:**
```
rag_avg = relevance×0.3 + groundedness×0.5 + context_relevance×0.2
```

| 레이어 | 지표 | 파이프라인 가중치 |
|--------|------|--------|
| Layer 1-A | Syntax (pass_rate) | 5% |
| Layer 1-B | Stats (integrated_score) | 5% |
| Layer 2 | RAG Triad avg (relevance×0.3 + groundedness×0.5 + context_relevance×0.2) | 65% |
| Layer 3 | Completeness | 25% |

| 등급 | 점수 |
|------|------|
| A+ | ≥ 0.95 |
| A  | ≥ 0.85 |
| B+ | ≥ 0.75 |
| B  | ≥ 0.65 |
| C  | ≥ 0.50 |
| F  | < 0.50 |

---

## 실패 유형 분류 (`pipeline.py._classify_failure_types`)

| 키 | 한국어 | 감지 조건 |
|----|--------|-----------|
| `hallucination` | 환각오류 | groundedness < 0.6 |
| `faithfulness_error` | 근거오류 | groundedness < 0.6 AND relevance < 0.6 |
| `poor_context` | 문맥부족 | context_relevance < 0.6 |
| `retrieval_miss` | 검색오류 | relevance < 0.6 AND groundedness < 0.6 |
| `bad_chunk` | 불량청크 | context 길이 < 100자 |
| `evaluation_error` | 평가오류 | LLM 평가 예외 발생 |
| `low_quality` | 품질미달 | failure_types 없음 AND avg_quality < 0.70 |
