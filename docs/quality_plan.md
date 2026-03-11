# QA 품질 평가 계획 (Quality Evaluation Framework)

> **최종 업데이트**: 2026-03-10
> **구현 파일**: `qa_quality_evaluator.py`

---

## 🏗️ 2-Layer 구조

```
[입력] QA 데이터
   │
   ▼
[Layer ①-A] 구문 정확성 (SyntaxValidator)
   → PASS / FAIL per QA
   │
   ▼
[Layer ①-B] 데이터셋 통계 (DatasetStats)
   → 다양성 / 중복률 / 편중도 / 데이터 충족률
   │
   ▼ (Layer ①-A PASS한 QA만)
[Layer ②] LLM 품질 평가 (QualityEvaluator, GPT-5.1 CoT)
   → 사실성 / 완결성 / 근거성 + avg_quality + PASS/FAIL
   │
   ▼
[출력] JSON + 콘솔 리포트
```

---

## 설계 원칙

| 원칙 | 내용 |
|------|------|
| Layer ① | Python 규칙/통계로 자동 평가 |
| Layer ② | LLM이 의미를 판단 (GPT-5.1 CoT 방식) |
| 어휘 분리 | Layer 간 용어 충돌 금지 |

---

## Layer ①-A: 구문 정확성 (SyntaxValidator)

**대상**: 개별 QA | **판정**: PASS / FAIL

| 검증항목 | 기준 | 비고 |
|---------|------|------|
| 필수 필드 | q, a, context 존재 | 없으면 FAIL |
| 필드 타입 | 모두 string | 다른 타입 FAIL |
| 질문 길이 | 5 ~ 500자 | 범위 밖 FAIL |
| 답변 길이 | 10 ~ 2000자 | 범위 밖 FAIL |
| 컨텍스트 길이 | 50 ~ 50000자 | 범위 밖 FAIL |

---

## Layer ①-B: 데이터셋 통계 (DatasetStats)

**대상**: 전체 QA Set | **점수범위**: 0-10

### 지표 목록

| 지표 | JSON 키 | 측정 내용 | 가중치 |
|------|---------|---------|--------|
| **다양성** | `diversity` | intent 커버리지 + doc 커버리지 + 어휘 다양도 + intent 균형도 평균 | 30% |
| **중복률** | `duplication_rate` | Near-duplicate 질문 비율 (SequenceMatcher ≥ 70%) | 25% |
| **편중도** | `skewness` | 특정 docId 집중도 | 35% |
| **데이터 충족률** | `data_sufficiency` | q/a/context/docId/intent 필드 채움율 평균 | 10% |
| **통합점수** | `integrated_score` | 가중치 합산 | - |

### 지표별 계산식

#### 다양성 (diversity)
```
intent_coverage = len(unique_intents) / total_qa
doc_coverage    = len(unique_docIds)  / total_qa
vocabulary_div  = len(unique_words)   / total_words
intent_balance  = min_intent_count    / max_intent_count

score = (intent_coverage + doc_coverage + vocabulary_div + intent_balance) / 4 * 10
```

#### 중복률 (duplication_rate)
```
near_dup_rate = near_duplicate_pairs / total_pairs * 100
score = (100 - near_dup_rate) / 10   # 높을수록 중복 없음 = 좋음
```

#### 편중도 (skewness)
```
doc_max_ratio = max_doc_count / total_qa * 100

if doc_max_ratio ≤ 50%: score = 10
elif doc_max_ratio ≤ 70%: score = 7
else: score = max(0, 10 - (doc_max_ratio - 70) / 10)
```

#### 데이터 충족률 (data_sufficiency)
```
score = 평균_필드_채움율(%) / 10
```

#### 통합점수
```
integrated = diversity×0.30 + duplication_rate×0.25 + skewness×0.35 + data_sufficiency×0.10
```

---

## Layer ②: LLM 품질 평가 (QualityEvaluator)

**대상**: 개별 QA (Layer ①-A PASS만) | **도구**: GPT-5.1 CoT | **점수범위**: 0-1

> CoT 방식 채택 이유: 단답 숫자만 요구 시 모델이 보수적으로 낮게 판정하는 경향 있음

| 지표 | 입력 | 평가 기준 | 방식 |
|------|------|---------|------|
| **사실성** (Factuality) | answer + context | 의미적 일치 (패러프레이징 허용, 정확 매칭 불필요) | CoT |
| **완결성** (Completeness) | question + answer | 질문 핵심을 답변이 충분히 다루는가 | 단답 |
| **근거성** (Groundedness) | answer + context | 답변이 context에서 도출 가능한가 (직접 인용 불필요) | CoT |

- context 입력 최대 **4000자**
- **통과 기준**: avg_quality ≥ 0.70
- **avg_quality** = (factuality + completeness + groundedness) / 3

---

## 출력 JSON 구조

```json
{
  "metadata": {
    "total_qa", "syntax_valid", "llm_evaluated",
    "timestamp", "llm_model", "llm_model_id"
  },
  "layer_1_syntax": {
    "pass_count", "pass_rate"
  },
  "layer_1_stats": {
    "diversity": {
      "score",
      "intent_type_count", "doc_count",
      "vocabulary_diversity", "intent_balance",
      "intent_distribution",
      "question_length": { "avg", "std" },
      "answer_length":   { "avg", "std" }
    },
    "duplication_rate": {
      "score", "duplicate_count", "near_duplicate_rate"
    },
    "skewness": {
      "score", "doc_max_ratio", "doc_distribution", "intent_max_ratio"
    },
    "data_sufficiency": {
      "score",
      "field_fill_rates": { "q", "a", "context", "docId", "intent" }
    },
    "integrated_score"
  },
  "layer_2_quality": {
    "qa_scores": [
      {
        "index", "question", "answer",
        "factuality", "completeness", "groundedness",
        "avg_quality", "pass"
      }
    ],
    "summary": {
      "evaluated_count", "pass_count", "pass_rate",
      "avg_factuality", "avg_completeness",
      "avg_groundedness", "avg_quality"
    }
  }
}
```

---

## 어휘 구분표 (혼동 방지)

| 계층 | 사용 어휘 | 사용 금지 어휘 |
|------|---------|-------------|
| **Layer ①-B** | 다양성, 중복률, 편중도, 데이터 충족률 | 유용성, 완전성, 편향성 |
| **Layer ②** | 사실성, 완결성, 근거성 | 완전성, 인용성, 정확성 |

---

## 참고: TruLens RAG Triad (별도 시스템)

> `trulens_eval_test.py`에서 독립적으로 운영. `qa_quality_evaluator.py`와 별개.

| 평가항목 | 대상 | 점수범위 | 설명 |
|---------|------|---------|------|
| Relevance | 개별 QA | 0-1 | 질문↔답변 적합도 |
| Groundedness | 개별 QA | 0-1 | 답변↔컨텍스트 근거성 |
| Clarity | 개별 QA | 0-1 | 표현 명확도 |

---

## 변경 이력

| 날짜 | 변경 내용 |
|------|---------|
| 2026-03-10 | 최초 3-Layer 설계 |
| 2026-03-10 | Layer 2 단답 평가 → CoT 방식 전환, context 1500→4000자 |
| 2026-03-10 | 3-Layer → 2-Layer 재설계 (Layer 3 제거, 1-A/1-B 분리) |
| 2026-03-10 | coverage + type_distribution → diversity 통합 |
| 2026-03-10 | data_integrity → data_sufficiency (데이터 충족률) 리네임 |
| 2026-03-10 | Layer 2 qa_scores에 answer 필드 추가 |
