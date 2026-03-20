# 평가 기준 (Evaluation Criteria)

## 최종 점수 계산

```
final_score = 0.20 × syntax_score
            + 0.20 × stats_score
            + 0.30 × rag_score
            + 0.30 × quality_score
```

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
- 유사 중복 쌍 탐지 (`SequenceMatcher ratio ≥ 0.7`)
- 점수: `(100 - near_dup_rate%) / 10`, 최대 10

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

**3가지 차원** (각 0–1)

| 차원 | 설명 |
|------|------|
| **Relevance** (관련성) | 답변이 질문에 직접 응답하는가 |
| **Groundedness** (근거성) | 답변이 컨텍스트에서 도출 가능한가 |
| **Clarity** (명확성) | Q-A쌍이 명확하고 모호하지 않은가 |

**점수 계산**
```
rag_score = (relevance + groundedness + clarity) / 3   (0–1)
```

**QA별 출력**
```json
{ "qa_index": 0, "relevance": 0.85, "groundedness": 0.92, "clarity": 0.88, "avg_score": 0.88 }
```

---

## Layer 3: Quality Evaluator

**목적**: QA쌍의 내용 품질 심층 평가 (LLM 단일 호출, 4차원)

**4가지 차원** (각 0–10 → /10으로 정규화)

| 차원 | 설명 |
|------|------|
| **Factuality** (사실성) | 답변의 모든 사실이 컨텍스트에서 검증 가능한가 |
| **Completeness** (완전성) | 질문을 빠짐없이 완전히 답변했는가 |
| **Specificity** (구체성) | 구체적 수치/예시가 포함된 충분한 답변인가 |
| **Conciseness** (간결성) | 중복·불필요한 내용 없이 간결한가 |

**점수 계산**
```
avg_quality = (factuality + completeness + specificity + conciseness) / 4
quality_score = avg_quality / 10   (0–1)
pass = avg_quality >= 0.70
```

**QA별 출력**
```json
{
  "qa_index": 0,
  "factuality": 0.90, "completeness": 0.88, "specificity": 0.92, "conciseness": 0.88,
  "avg_quality": 0.89,
  "pass": true
}
```

---

## 의도 유형 분류 (Intent)

| 코드 | 한국어 | 설명 |
|------|--------|------|
| `factual` | 사실형 | 사실 확인 질문 |
| `definition` | 정의형 | 개념·용어 정의 |
| `procedural` | 방법형 | 절차·방법 설명 |
| `list` | 목록형 | 나열·목록 응답 |
| `causal` | 원인형 | 이유·원인 설명 |
| `numerical` | 수치형 | 숫자·통계 응답 |
| `boolean` | 확인형 | 예/아니오 응답 |
| `process` | 방법형 | 프로세스 설명 |

---

## 임계값 요약

| 항목 | 기준값 | 의미 |
|------|--------|------|
| Syntax pass | — | 유효 QA 비율 |
| Stats 우수 | ≥ 8.0 / 10 | 다양성·중복 없음 |
| RAG 우수 | ≥ 0.85 | 신뢰할 수 있는 검색 기반 |
| Quality pass | ≥ 0.70 | QA 개별 통과 기준 |
| Final A등급 | ≥ 0.85 | 서비스 활용 수준 |
