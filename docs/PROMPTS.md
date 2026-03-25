# PROMPTS.md — 백엔드 프롬프트 목록

> 마지막 업데이트: 2026-03-25 (Pass1+Pass2 통합, analyze-tagging-samples 제거)
> 백엔드에서 LLM을 호출하는 모든 프롬프트를 파이프라인 단계 순서로 정리.

---

## 목차

| # | 단계 | 파일 | 모델 |
|---|------|------|------|
| 1 | Ingestion — Pass1+2 통합 (H1/H2/H3 master) | `ingestion_api.py` | Gemini Flash |
| 2 | Ingestion — Pass3 태깅 (master 있음) | `ingestion_api.py` | Gemini Flash |
| 3 | Ingestion — Pass3 태깅 (master 없음) | `ingestion_api.py` | Gemini Flash |
| 4 | 도메인 분석 | `domain_profiler.py` | 설정 모델 (기본 GPT) |
| 5 | QA 생성 — System (static v1 KO) | `prompts.py` | 생성 모델 |
| 6 | QA 생성 — System (static v1 EN) | `prompts.py` | 생성 모델 |
| 7 | QA 생성 — System (adaptive, domain-aware) | `prompts.py` | 생성 모델 |
| 8 | QA 생성 — User Template (static KO) | `prompts.py` | 생성 모델 |
| 9 | QA 생성 — User Template (static EN) | `prompts.py` | 생성 모델 |
| 10 | QA 생성 — User Template (adaptive) | `prompts.py` | 생성 모델 |
| 11 | 평가 Layer 2 — RAG Triad (통합) | `rag_triad.py` | 평가 모델 (기본 Claude Haiku) |
| 12 | 평가 Layer 2 — Relevance (단독) | `rag_triad.py` | 평가 모델 |
| 13 | 평가 Layer 2 — Groundedness (단독 CoT) | `rag_triad.py` | 평가 모델 |
| 14 | 평가 Layer 2 — Clarity (단독) | `rag_triad.py` | 평가 모델 |
| 15 | 평가 Layer 3 — QA Quality (통합 4지표) | `qa_quality.py` | 평가 모델 |

---

## 1. Pass1+2 통합 — H1/H2/H3 Master 생성

**파일**: `backend/api/ingestion_api.py` (엔드포인트: `POST /analyze-hierarchy`)
**모델**: `gemini-3-flash-preview`
**입력**: anchor 청크 30개 (content[:600]씩, 최대 18,000자)
**출력**: `domain_analysis`, `h1_candidates[]`, `h2_h3_master`

> Pass1(H1)과 Pass2(H2/H3)를 단일 LLM 호출로 통합. anchor 30개 전체를 사용해 H1~H3 완전한 master를 한 번에 생성.

```
<role>
You are an expert document classifier. Build a complete hierarchical taxonomy (H1/H2/H3) for the provided document.
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
  "domain_analysis": "한 문장으로 문서 전체 성격 요약",
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

> `h1_candidates`는 `list(h2_h3_master.keys())`로 서버에서 도출.

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

## 4. 도메인 분석 (Domain Profiler)

**파일**: `backend/generators/domain_profiler.py` `:39`
**모델**: 설정 모델 (기본 `gpt-5.1`)
**입력**: anchor 청크 최대 10개 (content[:400] + H1/H2/chunk_type 메타)
**출력**: domain_profile JSON

**System:**
```
You are a document domain analysis expert.
Analyze the provided document chunk samples and return a domain profile as pure JSON.
Output only valid JSON with no markdown.
All string values in the JSON (domain, target_audience, main_topics, key_terms, tone)
must be written in Korean (한국어).
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
  "main_topics": ["토픽1", "토픽2", "토픽3"],
  "key_terms": ["전문용어1", ..., "전문용어5"],
  "chunk_type_dist": {},
  "intent_hints": {
    "table": ["numeric", "list", "boolean"],
    "list": ["procedure", "how", "list"],
    "body": ["factoid", "why", "definition"],
    "heading": "skip"
  },
  "tone": "문서 문체"
}
```

---

## 5. QA 생성 — System Prompt (Static KO v1)

**파일**: `backend/config/prompts.py` — `SYSTEM_PROMPT_KO_V1`
**용도**: domain_profile 없거나 lang=ko일 때 fallback
**모델**: 생성 모델 (Gemini Flash / Claude Sonnet / GPT 등)

**핵심 규칙:**
- 4원칙: 근거성 / 관련성 / 원자성 / 명확성
- Intent 8종: `factoid`, `definition`, `how` (우선) / `numeric`, `procedure`, `why`, `list`, `boolean` (조건부)
- Diversity 규칙: 동일 유형 최대 2개, 우선 그룹 합 < 전체 50%, 조건부 1개 이상 필수
- 답변 시작 금지: "컨텍스트에 따르면", "문서에 의하면" 등 메타 표현

---

## 6. QA 생성 — System Prompt (Static EN v1)

**파일**: `backend/config/prompts.py` — `SYSTEM_PROMPT_EN_V1`
**용도**: lang=en일 때 사용
**내용**: KO v1과 동일한 규칙, 영문 버전. 최종 출력은 한국어(`Write all Q&A in Korean`)

---

## 7. QA 생성 — System Prompt (Adaptive, Domain-Aware)

**파일**: `backend/config/prompts.py` — `build_system_prompt(domain_profile, lang)`
**용도**: domain_profile 존재 시 우선 사용 (현재 기본 경로)

**구성**: `<role>` + `_CORE_PRINCIPLES_KO` 결합
- `<role>`에 domain / target_audience / key_terms / tone 삽입
- 핵심 원칙(`_CORE_PRINCIPLES_KO`)은 static과 동일하게 항상 포함

```
<role>
당신은 {domain} 분야의 QA 데이터셋 생성 전문가입니다.
대상 독자는 {audience}이며, 주요 용어는 {key_terms[:5]} 등이 사용됩니다.
주어진 컨텍스트만을 근거로 {audience}가 실제로 물어볼 법한 질문과 답변을 생성하세요.
문체: {tone}
외부 지식 사용 금지 — 컨텍스트에 없는 내용은 생성하지 않습니다.
</role>
+ _CORE_PRINCIPLES_KO (principles / intent_types / diversity_rules / constraints)
```

---

## 8. QA 생성 — User Template (Static KO v1)

**파일**: `backend/config/prompts.py` — `USER_TEMPLATE_KO_V1`
**변수**: `{hierarchy}`, `{text}`
**출력**: `{ "qa_list": [{ "q", "a", "intent", "answerable" }, ...] }`

**구성:**
```
<generation_guide>
  <intent_examples> ... </intent_examples>
  <selection_rule> 근거 있는 유형만, 동일 최대 2개, 우선그룹 50% 초과 금지 </selection_rule>
  <groundedness_check> 메타 표현 금지, 명시적 근거 필수 </groundedness_check>
</generation_guide>

<category>{hierarchy}</category>

<context>{text}</context>

<task>4~8개 QA 생성, 순수 JSON 출력</task>
```

---

## 9. QA 생성 — User Template (Static EN v1)

**파일**: `backend/config/prompts.py` — `USER_TEMPLATE_EN_V1`
**내용**: KO v1과 동일 구조, intent_examples 영문 혼용. 출력은 한국어 강제.

---

## 10. QA 생성 — User Template (Adaptive)

**파일**: `backend/config/prompts.py` — `build_user_template(domain_profile, chunk_type)`
**용도**: domain_profile + chunk_type 기반 동적 생성 (현재 기본 경로)

**static과의 차이점:**
- `intent_examples`에 `domain_profile.key_terms` 반영 (도메인 특화 예시 문구)
- `<chunk_type_hint>` 추가 — chunk_type별 권장 intent 명시
  - `table` → `["numeric", "list", "boolean"]`
  - `list` → `["procedure", "how", "list"]`
  - `body` → `["factoid", "why", "definition"]`
  - `heading` → skip

---

## 11. 평가 Layer 2 — RAG Triad 통합 (권장 경로)

**파일**: `backend/evaluators/rag_triad.py` — `evaluate_all_with_reasons()`
**모델**: 평가 모델 (기본 `claude-haiku-4-5`)
**입력**: question, answer, context (최대 8,000자)
**출력**: `{ relevance, relevance_reason, groundedness, groundedness_reason, clarity, clarity_reason }`

```
<role>
You are a strict QA data quality auditor. Evaluate the QA pair on three RAG Triad dimensions
based solely on the provided context.
</role>

<context>{ctx[:8000]}</context>
<question>{question}</question>
<answer>{answer}</answer>

<scoring_dimensions>
1. relevance (0-10): 질문에 직접 답하는가?
   - 10: 완벽 / 6-7: 대체로 관련 / 0-3: 무관
2. groundedness (0-10): 모든 주장이 컨텍스트에 근거하는가? (flexible matching)
   - 10: 전부 추적 가능 / 7-9: 대부분 / 5-6: 부분적 / 0-4: 환각
3. clarity (0-10): Q-A 쌍이 명확하고 모호하지 않은가?
   - 10: 명확 / 5-6: 다소 모호 / 0-3: 혼란스러움
</scoring_dimensions>

<task>
각 reason은 한국어 1문장. JSON만 출력:
{"relevance": <0-10>, "relevance_reason": "...", "groundedness": <0-10>, ...}
</task>
```

---

## 12. 평가 Layer 2 — Relevance (단독)

**파일**: `backend/evaluators/rag_triad.py` — `evaluate_relevance()`
**용도**: `evaluate_all_with_reasons` 실패 시 fallback 개별 호출

```
<role>You are a strict QA evaluator. Assess relevance in domain context.</role>
<constraints>Score 0-10, return ONLY final integer on last line</constraints>
{context_excerpt 있을 때만}
<question>{question}</question>
<answer>{answer}</answer>
<task>0=completely irrelevant, 10=perfectly relevant</task>
```

---

## 13. 평가 Layer 2 — Groundedness (단독, CoT)

**파일**: `backend/evaluators/rag_triad.py` — `evaluate_groundedness()`

```
<role>Expert at assessing answer groundedness. Use Chain of Thought reasoning.</role>
<constraints>FLEXIBLE MATCHING (not exact). Return ONLY final integer on last line.</constraints>
<context>{context[:10000]}</context>
<answer>{answer}</answer>
<task>
Step 1: IDENTIFY KEY CLAIMS
Step 2: FIND SUPPORTING EVIDENCE (flexible)
Step 3: ASSESS ALIGNMENT — Strong(0.9-1.0) / Medium(0.7-0.8) / Weak(0.5-0.6) / None(0.0)
Step 4: DETERMINE GROUNDING — 10:All strong / 7-9:Mostly / 5-6:Partial / 0-4:Hallucinated
</task>
```

---

## 14. 평가 Layer 2 — Clarity (단독)

**파일**: `backend/evaluators/rag_triad.py` — `evaluate_clarity()`

```
<role>Strict QA evaluator assessing clarity and comprehensibility.</role>
<constraints>Score 0-10, return ONLY final integer on last line</constraints>
<question>{question}</question>
<answer>{answer}</answer>
<task>
- Is the question well-formed?
- Is the answer clearly written without ambiguities?
- Is the answer properly structured?
</task>
```

---

## 15. 평가 Layer 3 — QA Quality 통합 (4지표)

**파일**: `backend/evaluators/qa_quality.py` — `evaluate_all()`
**모델**: 평가 모델 (기본 `claude-haiku-4-5`)
**입력**: question, answer, context (최대 3,500자), intent
**출력**: `{ factuality, completeness, specificity, conciseness }` (각 0-1)

**System:**
```
<role>Strict but fair data quality auditor. Evaluate all four dimensions objectively.</role>
<output_format>
JSON only. Each reason: 1 concise sentence in Korean.
{"factuality": <0-10>, "factuality_reason": "...", "completeness": <0-10>, ...}
</output_format>
```

**User:**
```
<context>{clean_ctx[:3500]}</context>
<question>{question}</question>
<answer>{answer}</answer>
<intent_type>{intent}</intent_type>  ← intent 있을 때만

<scoring_dimensions>
1. factuality (0-10): 컨텍스트와 사실적으로 일치하는가?
2. completeness (0-10): intent 유형별 루브릭 적용
   - list/procedure: 모든 항목/단계 열거 = 10
   - boolean: 명확한 Yes/No + 근거 = 10
   - numeric: 정확한 수치+단위 = 10
   - 기타: 포괄적 답변 = 10
3. specificity (0-10): 구체적인가? 모호한 표현 없는가?
4. conciseness (0-10): 질문 유형에 적합한 길이인가?
   - boolean: 3문장 이내 = 10
   - 기타: 5문장 이내 반복 없음 = 10
</scoring_dimensions>
```

---

## 점수 계산 공식

```
final_score = syntax×0.1 + stats×0.1 + rag×0.4 + quality×0.4
```

| 레이어 | 지표 | 가중치 |
|--------|------|--------|
| Layer 1-A | Syntax (pass_rate) | 0.10 |
| Layer 1-B | Stats (quality_score) | 0.10 |
| Layer 2 | RAG Triad (relevance + groundedness + clarity) | 0.40 |
| Layer 3 | QA Quality (factuality + completeness + specificity + conciseness) | 0.40 |

| 등급 | 점수 |
|------|------|
| A+ | ≥ 0.95 |
| A  | ≥ 0.85 |
| B+ | ≥ 0.75 |
| B  | ≥ 0.65 |
| C  | ≥ 0.50 |
| F  | < 0.50 |
