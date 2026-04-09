<!--
파일: REF_EVAL.md
설명: QA 평가 파이프라인 기준 정리. 최종 점수 계산식(구문·통계·RAG Triad·완전성), 등급 기준, Layer별 평가 지표(관련성·근거성·맥락성·완전성) 및 평가 모델 설정 포함.
업데이트: 2026-04-09
-->
# 평가 기준 (Evaluation Criteria)

> 마지막 업데이트: 2026-04-09

## 최종 점수 계산

```
final_score = 0.05 × syntax_score
            + 0.05 × stats_score
            + 0.65 × rag_score          ← RAG Triad (Relevance · Groundedness · Context Relevance)
            + 0.25 × completeness       ← 품질 평가 (완전성 단일 지표)
```

> **RAG Triad 내부 가중치**
> `rag_score = relevance×0.3 + groundedness×0.5 + context_relevance×0.2`

## 등급 기준

| 등급 | 범위 | 의미 |
|------|------|------|
| A+ | ≥ 0.95 | 최우수 — 전 레이어 강함, 문제 없음 |
| A  | ≥ 0.85 | 우수 — 대부분 강함, 경미한 이슈 |
| B+ | ≥ 0.75 | 양호 — 전 레이어 수용 가능 |
| B  | ≥ 0.65 | 보통 — 혼재, 일부 우려 |
| C  | ≥ 0.50 | 미흡 — 복수 약점 존재 |
| F  | < 0.50 | 실패 — 치명적 결함 |

---

## Layer 1-A: Syntax Validator

**목적**: 기본 형식 유효성 검사 (필드 존재, 타입, 길이)

**검사 항목**

| 필드 | 최소 | 최대 |
|------|------|------|
| `q` (질문) | 5자 | 500자 |
| `a` (답변) | 10자 | 2000자 |
| `context` | 50자 | 50000자 |

- 필수 필드(`q`, `a`, `context`) 누락 → invalid
- 타입이 문자열이 아님 → invalid

**점수 계산**
```
syntax_score = valid_count / total_count   (0–1)
```

---

## Layer 1-B: Dataset Statistics

**목적**: 데이터셋 전체 구조 품질 측정 (0–10 스케일, `/10`으로 정규화)

### 다양성 (Diversity)
- 의도 유형 커버리지 (`intent_type_count`)
- 문서 수 커버리지 (`doc_count`)
- 어휘 다양성 (`unique_words / total_words`)
- 의도 균형 (`min_distribution / max_distribution`)

### 중복률 (Duplication Rate)
- 유사 중복 쌍 탐지 (`SequenceMatcher ratio ≥ 0.75`)
- 점수: `(100 - near_dup_rate%) / 10`, 최대 10
- 생성 단계에서 `_dedup_across_chunks(sim_threshold=0.75)`로 선제 제거 후 평가

### 편향도 (Skewness)
- 문서 집중도 (`max_doc_ratio`):
  - ≤ 50% → 10점 / ≤ 70% → 7점 / > 70% → 3점

### 데이터 충분성 (Sufficiency)
| QA 수 | 점수 |
|-------|------|
| < 5 | 2 |
| 5–10 | 5 |
| 10–30 | 8 |
| > 30 | 10 |

**통합 점수**
```
integrated_score = (diversity + duplication + skewness + sufficiency) / 4
stats_score = integrated_score / 10   (0–1)
```

---

## Layer 2: RAG Triad

**목적**: 개별 QA쌍의 검색 기반 생성 품질 평가 (LLM 기반)
**파일**: `backend/evaluators/rag_triad.py` — `evaluate_all_with_reasons()`

**3가지 차원** (각 0–1)

| 차원 | 설명 |
|------|------|
| **Relevance** (관련성) | 답변이 질문에 직접 응답하는가 |
| **Groundedness** (근거성) | 답변의 모든 주장이 컨텍스트에서 추적 가능한가 (CoT 내부 평가) |
| **Context Relevance** (맥락성) | 검색된 컨텍스트가 질문에 답하기 충분한 정보를 포함하는가 |

> ⚠️ 구 "Clarity(명확성)" 지표는 **Context Relevance(맥락성)** 로 대체됨 (2026-03-x 이전 결과와 비교 시 주의).

**점수 계산**
```
rag_score = relevance×0.3 + groundedness×0.5 + context_relevance×0.2
```

**QA별 출력**
```json
{
  "qa_index": 0,
  "relevance": 0.85,
  "groundedness": 0.92,
  "context_relevance": 0.88,
  "avg_score": 0.89
}
```

**임계값**

| 차원 | 경보 기준 |
|------|-----------|
| relevance | < 0.7 |
| groundedness | < 0.8 |
| context_relevance | < 0.7 |

---

## Layer 3: Quality Evaluator

**목적**: QA쌍의 완전성 심층 평가 (LLM 단일 호출)
**파일**: `backend/evaluators/qa_quality.py` — `evaluate_all()`

> ⚠️ 구 4차원(Factuality / Completeness / Specificity / Conciseness)에서 **Completeness 단일 지표**로 변경.
> 이유: 4차원 합산이 서로 상쇄되어 실질적 품질 판별력 저하 → 완전성만 집중 측정.

**단일 차원**

| 차원 | 설명 |
|------|------|
| **Completeness** (완전성) | 질문의 모든 세부 요구사항을 답변이 충족하는가 (질문 분해 기반) |

**Intent별 루브릭**

| intent | 10점 기준 |
|--------|-----------|
| list / procedure | 컨텍스트에 있는 모든 항목·단계 열거 |
| how | 구체적 방법·기준·절차 포함 |
| condition | 조건·예외 모두 서술 |
| 기타 | 포괄적이고 누락 없는 답변 |

**점수 계산**
```
avg_quality = completeness   (0–1)
pass = avg_quality >= 0.70
```

**QA별 출력**
```json
{
  "qa_index": 0,
  "completeness": 0.90,
  "coverage": 0.90,
  "missing_aspects": [],
  "completeness_reason": "...",
  "avg_quality": 0.90,
  "pass": true
}
```

---

## 의도 유형 분류 (Intent)

현재 6가지 유형 사용:

| 코드 | 한국어 | 설명 |
|------|--------|------|
| `fact` | 사실형 | 대상·요건·효과·범위에 관한 사실 확인 |
| `purpose` | 원인형 | 목적·이유·배경 (명시적 목적 문구 조건, P3) |
| `how` | 방법형 | 구체적 방법·기준·절차 (순서 있으면 단계 포함) |
| `condition` | 조건형 | 조건 분기·예외·제한 사항 |
| `comparison` | 비교형 | 두 대상·역할·조건·방법의 비교 (대칭 검증, P7) |
| `list` | 열거형 | 복수 항목·유형·요건 열거 (청크당 최대 1개) |

---

## 임계값 요약

| 항목 | 기준값 | 의미 |
|------|--------|------|
| Syntax pass | — | 유효 QA 비율 |
| Stats 우수 | ≥ 8.0 / 10 | 다양성·중복 없음 |
| RAG 우수 | ≥ 0.85 | 신뢰할 수 있는 검색 기반 |
| Quality pass | ≥ 0.70 | QA 개별 통과 기준 |
| Final A등급 | ≥ 0.85 | 서비스 활용 수준 |
| near_dup 목표 | < 5% | 생성 단계 dedup 후 기준 |

---

## 실패 유형 분류

| 키 | 한국어 | 감지 조건 |
|----|--------|-----------|
| `hallucination` | 환각오류 | groundedness < 0.6 |
| `faithfulness_error` | 근거오류 | groundedness < 0.6 AND relevance < 0.6 |
| `poor_context` | 문맥부족 | context_relevance < 0.6 |
| `retrieval_miss` | 검색오류 | relevance < 0.6 AND groundedness < 0.6 |
| `bad_chunk` | 불량청크 | context 길이 < 100자 |
| `evaluation_error` | 평가오류 | LLM 평가 예외 발생 |
| `low_quality` | 품질미달 | failure_types 없음 AND avg_quality < 0.70 |

---

## 평가 모델

기본값: Gemini 2.5 Flash. 요청 시 모델 지정 가능.

| Provider  | 기본 모델        | 최대 workers |
| --------- | ---------------- | :----------: |
| Google    | Gemini 2.5 Flash | 10           |
| OpenAI    | GPT-5.1          | 8            |
| Anthropic | Claude Haiku 4.5 | 2            |

파이프라인: `evaluators/pipeline.py` — Layer 1-A/B 순차, Layer 2/3 병렬 처리
