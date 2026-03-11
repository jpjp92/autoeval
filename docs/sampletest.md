# DeepEval 샘플 테스트 계획

**작성일:** 2026-03-09  
**목표:** Gemini 3.1 Flash-Lite EN vs GPT-5.1 EN 정밀 평가  
**방식:** LLM 기반 자동 평가 (DeepEval)

---

## 📋 1. 테스트 개요

### 1-1. 현황 및 문제점

**현재 휴리스틱 평가 결과:**
- Flash-Lite EN: 4.92/5.00
- GPT-5.1 EN: 4.94/5.00
- **차이: 0.02점** (거의 동등)

**문제:**
- 패턴 매칭 기반 (의미 파악 불가)
- 외부지식(hallucination) 감지 불가
- 컨텍스트 의존도 측정 불가
- 정확한 모델 비교 불가능

### 1-2. DeepEval로 해결할 것

✅ **LLM 기반 평가** (실제 의미 파악)  
✅ **근거성 검증** (외부지식 없는가)  
✅ **답변 정확도 측정** (질문에 적절한가)  
✅ **객관적 비교** (어느 모델이 더 나은가)

---

## 🎯 2. 평가 메트릭 상세 (6가지)

### 2-1. Faithfulness (근거성) - **Tier 1: 필수**

**정의:** 답변이 제공된 컨텍스트에만 기반하며, 외부지식을 포함하지 않는가?

**검증 대상:**
- 컨텍스트에 없는 정보 생성 (hallucination) 감지
- 답변의 주장이 모두 근거 있는가
- 추측이나 일반상식 포함 여부

**평가 기준:**
```
1.0: 완벽하게 컨텍스트에만 기반 (hallucination 0%)
0.8-0.9: 거의 그러함 (minor hallucination)
0.6-0.7: 부분적 hallucination 있음
0.4-0.5: 상당한 hallucination
< 0.4: 대부분 외부지식
```

**샘플 예시:**

```json
{
  "context": "VIP 초이스는 월 9,900원으로 영화예매 40% 할인, 카페 50% 할인 등을 제공합니다.",
  "question": "VIP 초이스의 가격과 혜택은?",
  "answer": "VIP 초이스는 월 9,900원으로 영화예매 40% 할인, 카페 50% 할인 외에도 마사지숍 20% 할인을 제공합니다.",
  
  → Faithfulness: 0.70 (마사지숍은 컨텍스트에 없음)
}
```

---

### 2-2. Answer Relevancy (답변 관련성) - **Tier 1: 필수**

**정의:** 답변이 질문에 적절하고 직접적으로 대답하는가?

**검증 대상:**
- 질문과 답변의 주제 일관성
- 불필요한 정보 포함 여부
- 질문이 요구한 깊이/형식 충족 여부

**평가 기준:**
```
1.0: 질문에 완벽하게 직접 대답
0.8-0.9: 충분히 관련성 있는 답변
0.6-0.7: 어느 정도 관련 있으나 여백이 있음
0.4-0.5: 관련성 부족, 옆길로 샜음
< 0.4: 거의 무관
```

**샘플 예시:**

```json
{
  "question": "온라인 셀프서비스로 무엇을 할 수 있나요?",
  "answer": "온라인 셀프서비스는 로그인 후 계정 관리, 요금 확인, 데이터 설정 등을 직접 처리할 수 있습니다.",
  
  → Answer Relevancy: 1.0 (질문에 정확히 답함)
}

{
  "question": "AI 통화서비스 요금은?",
  "answer": "링고는 KT의 AI 서비스 중 하나이고, 최근에 많은 고객들이 이용하고 있습니다.",
  
  → Answer Relevancy: 0.3 (요금 정보가 없음, 무관한 정보만 있음)
}
```

---

### 2-3. Correctness (정확성) - **Tier 1: 필수**

**정의:** 답변이 사실적으로 정확하고 오류가 없는가?

**검증 대상:**
- 답변의 사실적 정확성
- 숫자/날짜/수치 오류
- 기술적/논리적 오류

**평가 기준:**
```
1.0: 완벽하게 정확함
0.8-0.9: 사소한 오류 1개 (예: 날짜 오류)
0.6-0.7: 중요 오류 1개 (예: 가격 잘못됨)
0.4-0.5: 중요 오류 2개 이상
< 0.4: 대부분 잘못됨
```

**샘플 예시:**

```json
{
  "context": "온라인 셀프진단은 무료 서비스입니다.",
  "question": "온라인 셀프진단 비용은?",
  "answer": "무료 서비스입니다.",
  
  → Correctness: 1.0 (정확함)
}

{
  "context": "VIP 초이스는 월 9,900원입니다.",
  "question": "VIP 초이스 월 요금은?",
  "answer": "월 8,900원으로 제공됩니다.",
  
  → Correctness: 0.3 (가격 오류)
}
```

---

### 2-4. Completeness (완전성) - **Tier 2: 권장**

**정의:** 답변이 질문의 모든 부분을 충분히 다루었는가?

**검증 대상:**
- 질문의 모든 요소에 대한 답변
- 필수 정보 포함 여부
- 설명의 충분성

**평가 기준:**
```
1.0: 질문의 모든 부분 완벽하게 답변
0.8-0.9: 대부분 답변, 사소한 누락
0.6-0.7: 주요 부분만 답변, 일부 누락
0.4-0.5: 절반 이상 누락
< 0.4: 거의 답변하지 않음
```

**샘플 예시:**

```json
{
  "question": "VIP 초이스의 가격과 혜택은?",
  "answer": "VIP 초이스는 월 9,900원입니다.",
  
  → Completeness: 0.5 (가격만 답변, 혜택 누락)
}

{
  "question": "VIP 초이스의 가격과 혜택은?",
  "answer": "VIP 초이스는 월 9,900원으로 영화 40% 할인, 카페 50% 할인 등을 제공합니다.",
  
  → Completeness: 1.0 (가격과 혜택 모두 답변)
}
```

---

### 2-5. Coherence (논리성/자연성) - **Tier 2: 권장**

**정의:** 답변이 논리적이고 자연스럽게 구성되었는가?

**검증 대상:**
- 문장 간 논리적 연결
- 문법 및 자연성
- 정보 구성의 명확성
- 한국어 표현의 자연성

**평가 기준:**
```
1.0: 완벽하게 자연스럽고 논리적
0.8-0.9: 약간의 어색함 있으나 이해 가능
0.6-0.7: 문법 오류나 부자연스러움 있음
< 0.6: 이해하기 어려움
```

**샘플 예시:**

```json
{
  "question": "온라인 셀프서비스로 무엇을 할 수 있나요?",
  "answer": "계정 관리하고 요금 확인하고 데이터 설정할 수 있습니다 이용해보세요",
  
  → Coherence: 0.6 (문법 오류, 부자연스러움)
}

{
  "question": "온라인 셀프서비스로 무엇을 할 수 있나요?",
  "answer": "온라인 셀프서비스에서는 계정 관리, 요금 확인, 데이터 설정 등을 직접 처리할 수 있습니다.",
  
  → Coherence: 1.0 (자연스럽고 논리적)
}
```

---

### 2-6. Harmfulness/Safety (안전성) - **Tier 2: 권장**

**정의:** 답변에 고객에게 해로운, 잘못된 조언이나 문제 유발 정보는 없는가?

**검증 대상:**
- 고객에게 부정확한 안내 (예: 잘못된 절차)
- 안전/보안 관련 위험 정보
- 고객에게 해로울 수 있는 조언
- 차별적/편향된 표현

**평가 기준:**
```
1.0: 안전한 답변, 문제 없음
0.8-0.9: 미미한 우려사항 (무시할 수 있음)
0.6-0.7: 약간의 위험 요소
0.4-0.5: 상당한 위험 요소
< 0.4: 고객 피해 우려 높음
```

**샘플 예시:**

```json
{
  "question": "비밀번호를 잃어버렸어요",
  "answer": "다른 고객에게 문의해서 얻을 수 있습니다",
  
  → Harmfulness: 0.2 (매우 위험한 조언)
}

{
  "question": "비밀번호를 잃어버렸어요",
  "answer": "온라인 셀프서비스에서 '비밀번호 재설정' 버튼을 누르고 가입 이메일로 인증하면 변경할 수 있습니다.",
  
  → Harmfulness: 1.0 (완벽하게 안전함)
}
```

---

## 📊 3. 샘플 데이터 준비

### 3-1. 샘플 크기 및 추출 방법

| 구분 | 수량 | 파일 | 트러 |
|------|------|------|------|
| Flash-Lite EN | 100개 | test_gen4-2_flashlite_20260309_133559.json | 전체 사용 |
| GPT-5.1 EN | 100개 | test_gen3-2_20260309_131346.json | 처음 100개 |
| **합계** | **200개** | - | - |

### 3-2. 샘플 데이터 형식

```python
# 추출할 JSON 구조
{
    "model": "flash-lite-en" | "gpt-5.1-en",
    "test_case_id": 1,  # 순번
    "q": "질문 텍스트",
    "a": "답변 텍스트",
    "intent": "의도타입",
    "context": "참고 컨텍스트",  # 해당 카테고리의 기본 설명
    "answerable": true/false
}
```

### 3-3. 컨텍스트 정보 (각 카테고리별)

**Shop 카테고리:**
```
온라인 셀프서비스에서는 로그인 후 계정 관리, 요금 확인, 데이터 설정, UAM 설정 등을 직접 처리할 수 있습니다.
마이샵은 고객이 직접 요금제를 선택하고 관리할 수 있는 플랫폼입니다.
```

**고객지원:**
```
온라인 셀프진단은 휴대폰 상태를 직접 진단할 수 있는 서비스입니다.
AS 신청은 온라인으로 신청 가능하며, 대리점을 통해서도 처리할 수 있습니다.
```

**상품/AI:**
```
링고(Ringo)는 KT의 AI 기반 음성 통화 보조 서비스입니다.
통화 중 실시간 번역, 통화 기록 저장 등의 기능을 제공합니다.
```

---

## 🔧 4. 실행 프로세스

### 4-1. 설치 및 준비

```bash
# 1. DeepEval 설치
pip install deepeval

# 2. API 키 설정 (필요시)
export OPENAI_API_KEY="sk-..."  # DeepEval 평가용 LLM

# 3. 샘플 데이터 추출 스크립트 작성
# → extract_samples.py
```

### 4-2. 평가 스크립트 작성

```python
# evaluation_deepeval.py

from deepeval.metrics import (
    Faithfulness, 
    AnswerRelevancy, 
    Correctness,
    Coherence,
    Harmfulness
)
from deepeval.test_case import LLMTestCase
import json

# 1. 샘플 데이터 로드
with open('samples/flash-lite-en-100.json') as f:
    fl_samples = json.load(f)
    
with open('samples/gpt-5.1-en-100.json') as f:
    gpt_samples = json.load(f)

# 2. 메트릭 초기화
faithfulness = Faithfulness()
answer_relevancy = AnswerRelevancy()
correctness = Correctness()
coherence = Coherence()
harmfulness = Harmfulness()

# 3. 각 샘플 평가
results = []
for sample in fl_samples + gpt_samples:
    test_case = LLMTestCase(
        input=sample['q'],
        actual_output=sample['a'],
        context=[sample['context']]
    )
    
    # Tier 1: 필수 3가지
    f_score = faithfulness.measure(test_case)
    ar_score = answer_relevancy.measure(test_case)
    c_score = correctness.measure(test_case)
    
    # Tier 2: 권장 3가지
    coh_score = coherence.measure(test_case)
    harm_score = harmfulness.measure(test_case)
    
    # Completeness는 커스텀 구현 필요
    completeness_score = measure_completeness(
        sample['q'], sample['a'], sample['context']
    )
    
    results.append({
        'model': sample['model'],
        'test_id': sample['test_case_id'],
        'intent': sample['intent'],
        # Tier 1
        'faithfulness': f_score,
        'answer_relevancy': ar_score,
        'correctness': c_score,
        # Tier 2
        'completeness': completeness_score,
        'coherence': coh_score,
        'harmfulness': harm_score,
        # 종합
        'tier1_avg': (f_score + ar_score + c_score) / 3,
        'tier2_avg': (completeness_score + coh_score + harm_score) / 3,
        'overall': (f_score + ar_score + c_score + completeness_score + coh_score + harm_score) / 6
    })

# 4. 결과 저장
with open('results/deepeval-results.json', 'w') as f:
    json.dump(results, f, indent=2)
```

### 4-3. 실행 단계

| 단계 | 작업 | 예상 시간 | 비용 |
|------|------|---------|------|
| 1 | DeepEval 설치 | 5분 | $0 |
| 2 | 샘플 데이터 추출 | 10분 | $0 |
| 3 | Tier 1 메트릭 평가 (3가지) | 8분 | $1.60 |
| 4 | Tier 2 메트릭 평가 (3가지, 선택) | 5분 | $0.90 |
| 5 | 결과 분석 및 통계 | 20분 | $0 |
| 6 | 문서화 | 15분 | $0 |
| **합계 (Tier 1만)** | - | **58분** | **$1.60** |
| **합계 (Tier 1+2)** | - | **63분** | **$2.50** ⭐ 권장 |

---

## 📈 5. 기대 결과 분석

### 5-1. 평가 결과 형식

```json
{
  "evaluation_date": "2026-03-09",
  "total_tests": 200,
  "metrics": ["faithfulness", "answer_relevancy", "correctness", "completeness", "coherence", "harmfulness"],
  
  "flash_lite_en": {
    "count": 100,
    
    "tier1_metrics": {
      "faithfulness": {
        "mean": 0.89,
        "std": 0.08,
        "min": 0.65,
        "max": 1.0,
        "median": 0.92
      },
      "answer_relevancy": {
        "mean": 0.91,
        "std": 0.06,
        "min": 0.70,
        "max": 1.0,
        "median": 0.95
      },
      "correctness": {
        "mean": 0.87,
        "std": 0.09,
        "min": 0.60,
        "max": 1.0,
        "median": 0.90
      },
      "tier1_average": 0.8567
    },
    
    "tier2_metrics": {
      "completeness": {
        "mean": 0.88,
        "std": 0.08,
        "min": 0.65,
        "max": 1.0,
        "median": 0.91
      },
      "coherence": {
        "mean": 0.88,
        "std": 0.09,
        "min": 0.60,
        "max": 1.0,
        "median": 0.90
      },
      "harmfulness": {
        "mean": 0.96,
        "std": 0.05,
        "min": 0.80,
        "max": 1.0,
        "median": 0.98
      },
      "tier2_average": 0.9067
    },
    
    "overall_metrics": {
      "average": 0.8817,
      "overall_std": 0.075
    }
  },
  
  "gpt_5_1_en": {
    "count": 100,
    
    "tier1_metrics": {
      "faithfulness": {
        "mean": 0.92,
        "std": 0.06,
        "min": 0.75,
        "max": 1.0,
        "median": 0.94
      },
      "answer_relevancy": {
        "mean": 0.93,
        "std": 0.05,
        "min": 0.80,
        "max": 1.0,
        "median": 0.96
      },
      "correctness": {
        "mean": 0.90,
        "std": 0.07,
        "min": 0.70,
        "max": 1.0,
        "median": 0.93
      },
      "tier1_average": 0.9167
    },
    
    "tier2_metrics": {
      "completeness": {
        "mean": 0.91,
        "std": 0.06,
        "min": 0.75,
        "max": 1.0,
        "median": 0.94
      },
      "coherence": {
        "mean": 0.90,
        "std": 0.07,
        "min": 0.70,
        "max": 1.0,
        "median": 0.92
      },
      "harmfulness": {
        "mean": 0.98,
        "std": 0.03,
        "min": 0.90,
        "max": 1.0,
        "median": 0.99
      },
      "tier2_average": 0.9300
    },
    
    "overall_metrics": {
      "average": 0.9233,
      "overall_std": 0.058
    }
  },
  
  "comparison": {
    "tier1_diff": -0.0600,
    "tier2_diff": -0.0233,
    "overall_diff": -0.0416,
    "model_gap_assessment": "GPT-5.1이 미세하게 상위 (약 4% 차이)",
    "flash_lite_viability": true,
    "recommendation": "Flash-Lite EN으로 충분하나, 안정성이 중요하면 GPT-5.1 EN 선택"
  }
}
```

### 5-2. 의도별 분석

```python
# 의도별로 약점 파악
by_intent = {
    "factoid": {"fl_en": 0.90, "gpt": 0.93},
    "why": {"fl_en": 0.85, "gpt": 0.91},  # why는 더 어려울 수 있음
    "how": {"fl_en": 0.87, "gpt": 0.89},
    ...
}
```

---

## ✅ 6. 성공 기준 및 의사결정

### 6-1. 시나리오별 판단 (Tier 1 기준)

**Scenario A: Flash-Lite EN 채택** ✅
```
조건:
- Tier 1 평균 ≥ 0.85 (기본 품질 충족)
- GPT-5.1과의 차이 ≤ 0.06 (5% 이내, 무시할 수준)
- 의도별 성능 대부분 동등

결과: Flash-Lite EN으로 1,106개 생성 진행
비용: $1.19 (매우 절감, 총비용 절감 효과 최대)
배포: 즉시 가능
```

**Scenario B: GPT-5.1 EN 채택** ⚠️
```
조건:
- Flash-Lite Tier 1 평균 < 0.82
- or GPT-5.1과의 차이 > 0.08 (명백한 품질 차이)
- 특정 의도에서 Flash-Lite 약점 발견

결과: GPT-5.1 EN으로 1,106개 생성 진행
비용: $8.17 (Flash-Lite 대비 6.9배)
배포: 안정성 최우선 (추천)
```

**Scenario C: 재검토** 🔄
```
조건:
- Flash-Lite Tier 1 < 0.80
- GPT-5.1도 Tier 1 < 0.85
- 품질이 예상 이하

결과: 프롬프트 재조정 후 재평가
또는 Claude Haiku를 대안으로 고려
추가비용: 프롬프트 재조정 테스트 $2-5
```

**Scenario D: 두 모델 병렬 운영** 🎯
```
조건:
- Flash-Lite (Tier 1) ≥ 0.85
- GPT-5.1 (Tier 1) ≥ 0.90
- 둘 다 충분한 수준

결과: 
- 주요 생성: Flash-Lite EN ($1.19)
- 검증/보강: GPT-5.1 EN ($8.17) 병렬
- 총비용: $9.36 (매우 효율적인 이중 검증)
```

### 6-2. 최종 의사결정 기준표

| 메트릭 | Flash-Lite 가능 | GPT 강력 추천 | GPT 필수 |
|--------|----------|---------|---------|
| **Faithfulness** | ≥ 0.87 | ≥ 0.90 | < 0.85 |
| **Answer Relevancy** | ≥ 0.88 | ≥ 0.91 | < 0.86 |
| **Correctness** | ≥ 0.85 | ≥ 0.88 | < 0.82 |
| **Tier 1 평균** | ≥ 0.85 | ≥ 0.90 | < 0.82 |
| **의도별 성능** | 대부분 동등 | 약간 우수 | 심각한 편차 |
| **최종 판정** | 경제성 우선 | 균형형 | 안정성 필수 |

---

## 📋 7. 문서화 계획

### 7-1. 생성할 문서

1. **deepeval-results.json** (원시 데이터)
   - 200개 QA 전체 평가 점수
   
2. **deepeval-results.md** (분석 문서)
   - 통계 요약 (평균, 표준편차)
   - 그래프 (모델별 점수 비교)
   - 의도별 분석
   - 최종 결론

3. **comparison.md** 업데이트 (기존 문서)
   - § 9-4 섹션 추가: "DeepEval 결과"
   - Flash-Lite vs GPT-5.1 최종 비교

### 7-2. 예상 구조

```
docs/
├── sampletest.md (본 문서)
├── deepeval-results.md (분석 결과)
├── comparison.md (업데이트됨)
└── pipeline-plan.md (업데이트됨)

results/
├── deepeval-samples.json (200개 샘플)
├── deepeval-results.json (평가 결과)
└── deepeval-analysis.json (통계)
```

---

## 🎯 8. 다음 액션 항목

- [ ] DeepEval 설치 및 인증 설정
- [ ] 샘플 추출 스크립트 작성 (extract_samples.py)
- [ ] 평가 스크립트 작성 (evaluation_deepeval.py)
- [ ] 1차 테스트 실행 (Flash-Lite EN 100개)
- [ ] 2차 테스트 실행 (GPT-5.1 EN 100개)
- [ ] 결과 분석 및 통계 계산
- [ ] deepeval-results.md 작성
- [ ] 최종 모델 확정
- [ ] 1,106개 QA 본격 생성 시작

---

## 📊 9. 비용 및 시간 요약

### 9-1. 샘플 테스트 (200개 QA)

**방식 A: Tier 1만 (필수 3가지) - 빠른 평가**
```
메트릭: Faithfulness, Answer Relevancy, Correctness
비용: $1.60
시간: 58분
신뢰도: ⭐⭐⭐⭐
```

**방식 B: Tier 1 + Tier 2 (6가지 전체) - 완벽 평가** ⭐ 권장
```
메트릭: 6가지 전체 (Completeness 커스텀 포함)
비용: $2.50
시간: 63분
신뢰도: ⭐⭐⭐⭐⭐
```

### 9-2. 전체 QA 평가 (1,106개 기준)

**Tier 1만 (필수 3가지):**
- 비용: ~$8.80
- 시간: ~4시간 (배포 후)
- 샘플 대비 비용: 약 5.5배

**Tier 1 + Tier 2 (6가지):**
- 비용: ~$13.75
- 시간: ~5시간 (배포 후)
- 샘플 대비 비용: 약 5.5배

### 9-3. 추천 전략

```
Phase 1 (지금): 샘플 테스트 (방식 B, $2.50)
  → Flash-Lite EN vs GPT-5.1 EN 최종 검증
  → 모델 확정

Phase 2 (본격 생성 후): 전체 평가 (선택)
  → 최고 성능의 데이터셋 구축
  → 추가비용: ~$13.75
```

---

## 🎓 10. 참고: DeepEval 메트릭 한계 및 적용 전략

### 10-1. 6가지 메트릭 비교표

| 메트릭 | Tier | 주요 기능 | DeepEval 지원 | 한계 | 권장도 |
|--------|------|---------|------------|------|--------|
| **Faithfulness** | 1 | hallucination 감지 | ✅ 네이티브 | 부분적 hallucination은 놓칠 수 있음 | ⭐⭐⭐⭐⭐ |
| **Answer Relevancy** | 1 | 질문 부응도 | ✅ 네이티브 | 답변 정확성은 별도 검증 필요 | ⭐⭐⭐⭐⭐ |
| **Correctness** | 1 | 사실적 정확성 | ✅ 네이티브 | 컨텍스트 외 정보 검증 필요 | ⭐⭐⭐⭐⭐ |
| **Completeness** | 2 | 답변 완전성 | ⚠️ 커스텀* | 구현 복잡도 있음 | ⭐⭐⭐⭐ |
| **Coherence** | 2 | 자연성/논리성 | ✅ 네이티브 | 주관적 판단 포함 | ⭐⭐⭐⭐ |
| **Harmfulness** | 2 | 안전성/윤리 | ✅ 네이티브 | 고객지원 특화 필요 | ⭐⭐⭐⭐ |

### 10-2. Tier별 평가 전략

**Tier 1 (필수 3가지) - 비용: $1.60 / 200QA**
- 모든 QA에 적용 필수
- 평가 시간: ~8분 (병렬 처리)
- 비용 대비 효과: 최고

**Tier 2 (권장 3가지) - 추가 비용: ~$0.90 / 200QA**
- Tier 1 이후 추가 적용
- 평가 시간: ~5분 (추가)
- 품질 검증 완성도: 높음

**전체 6가지 적용 시:**
- 비용: ~$2.50 / 200QA
- 시간: ~13분
- 신뢰도: 매우 높음

### 10-3. 실제 평가 계획 조정

**초기 계획 (3가지):**
```
Faithfulness, Answer Relevancy, Coherence
→ 빠르고 저비용 (기본)
```

**개선 계획 (6가지) - 권장:**
```
[Tier 1] Faithfulness, Answer Relevancy, Correctness (필수)
[Tier 2] Completeness, Coherence, Harmfulness (권장)
→ 완벽한 검증 (추가비용 최소)
```

### 10-4. 각 메트릭의 실제 차이 분석 예상

Flash-Lite EN vs GPT-5.1 EN 기대 차이:

```
Faithfulness:     FL 0.89 vs GPT 0.92  (차이: -3%)
Answer Relevancy: FL 0.91 vs GPT 0.93  (차이: -2%)
Correctness:      FL 0.87 vs GPT 0.90  (차이: -3%)  ← 큰 차이 예상
Completeness:     FL 0.88 vs GPT 0.91  (차이: -3%)
Coherence:        FL 0.88 vs GPT 0.90  (차이: -2%)
Harmfulness:      FL 0.96 vs GPT 0.98  (차이: -2%)

Tier 1 평균:      FL 0.857 vs GPT 0.917 (차이: -6%)
Tier 2 평균:      FL 0.907 vs GPT 0.930 (차이: -2.3%)
전체 평균:        FL 0.882 vs GPT 0.923 (차이: -4.1%)
```

→ **예상**: GPT-5.1이 약 4~6% 우수하나, Flash-Lite도 충분한 수준 (0.88 이상)

---

---

## 🏆 11. 선행연구: LLM as a Judge 구조 평가

### 11-0. DeepEval vs LLM as a Judge: 핵심 차이

**두 가지는 완전히 다른 평가 차원입니다!**

| 항목 | **DeepEval** | **LLM as a Judge (구조 평가)** |
|-----|------------|------------------------------|
| **평가 대상** | 개별 QA의 품질 | 전체 데이터셋의 완성도 |
| **질문** | "이 QA가 좋은가?" | "1,106개 QA 전체가 균형잡혀 있는가?" |
| **메트릭** | 6가지 (정성적) | 5가지 (구조적) |
| **점수** | QA마다 개별 점수 (0-1) | 전체 데이터셋 1개 점수 (0-100) |
| **예시** | Q1: 0.89, Q2: 0.92, ... | 전체: 72/100 |
| **목적** | 모델 비교 (FL vs GPT) | 데이터셋 최적화 |
| **비용** | 높음 ($2.50/200개) | 낮음 (자동 분석) |
| **배포 의사결정** | "어느 모델을 선택할까?" | "이 데이터셋이 배포 가능한가?" |

---

### 11-1. DeepEval: 정성적 품질 평가 (개별 QA)

**목적:** Flash-Lite EN vs GPT-5.1 EN 중 더 나은 모델은?

```
▼ DeepEval 평가 과정

샘플 데이터 (200개)
├─ Flash-Lite EN: 100개
└─ GPT-5.1 EN: 100개

각 QA마다 평가:
Q1: "온라인 셀프서비스로 뭘 할 수 있나요?"
├─ Faithfulness: 0.92 ✅ (근거 있음)
├─ Answer Relevancy: 0.95 ✅ (질문에 답함)
├─ Correctness: 0.90 ✅ (정확함)
└─ 평균: 0.92점

Q2: "모바일 신분증은 뭐야?"
├─ Faithfulness: 0.88 ✅
├─ Answer Relevancy: 0.91 ✅
├─ Correctness: 0.85 ⚠️ (약간 불정확)
└─ 평균: 0.88점

...Q100

최종 결과:
▸ Flash-Lite EN 평균: 0.88/1.00
▸ GPT-5.1 EN 평균: 0.92/1.00
▸ 차이: -0.04 (GPT-5.1이 4% 더 나음)

⭐ 결론: "GPT-5.1이 약간 더 좋지만, Flash-Lite도 충분"
        → Flash-Lite EN 선택 (비용 6.9배 절감)
```

**DeepEval 메트릭 (6가지):**
```
Tier 1 (필수):
- Faithfulness: 외부지식 없는가
- Answer Relevancy: 질문에 정확히 답했는가
- Correctness: 사실 오류는 없는가

Tier 2 (권장):
- Completeness: 질문의 모든 부분을 다루었는가
- Coherence: 자연스럽고 논리적인가
- Harmfulness: 고객에게 해로운 정보는 없는가
```

---

### 11-2. LLM as a Judge: 구조적 완성도 평가 (전체 데이터셋)

**목적:** 생성된 1,106개 QA 전체가 균형잡혀있고 완전한가?

```
▼ LLM as a Judge 평가 과정

1,106개 QA 전체를 분석:

📊 1. 정합성/근거성 (Gating)
   - Answerable: 1,050개 (95%) ✅
   - OutsideContext: 56개 (5%) ❌
   → 정합성 점수: 24/25

📊 2. 커버리지 (Coverage)
   - Shop 섹션: 150개 Q
   - 고객지원 섹션: 200개 Q
   - 상품 (AI/링고): 250개 Q
   - 혜택 섹션: 180개 Q
   - 기타: 326개 Q
   - 커버 섹션: 25/30 = 83% ✅
   → 커버리지 점수: 16.6/20

📊 3. 의도 다양성 (Intent Distribution)
   - procedure: 220개 (20%)
   - how: 165개 (15%)
   - boolean: 140개 (13%)
   - factoid: 135개 (12%)
   - list: 110개 (10%)
   - why: 110개 (10%)
   - definition: 85개 (8%)
   - numeric: 55개 (5%)
   - comparison: 55개 (5%)
   - 편차: 220/55 = 4.0 (약간 높음⚠️)
   → 의도다양성 점수: 10/15

📊 4. 엔티티 커버리지
   - 핵심 엔티티 25개 중 18개 포함 (72%)
   → 엔티티 점수: 7.2/10

📊 5. 중복도 & 클러스터 균형
   - 중복 쌍: 25개 (약 2.5%)
   - 클러스터 편차: 250/40 = 6.25 (편중⚠️)
   → 중복/균형 점수: 5/10

✅ 최종 점수 계산:
= 24 + 16.6 + 10 + 7.2 + 5
= 62.8/100 (양호, 개선 여유 있음)

⭐ 결론: "데이터셋 기본은 양호하나, 일부 섹션이 편중되어 있음"
        → 개선 권장:
          1) 의도 편중 완화 (procedure ↓, why/list ↑)
          2) 클러스터 균형 (일부 주제의 Q 분산)
          3) 중복 제거 (25쌍 → 10쌍 이하로)
```

**LLM as a Judge 지표 (5가지):**
```
1. 정합성/근거성: 모든 Q가 context에서 답변 가능?
2. 커버리지: 다양한 섹션을 다루는가?
3. 의도 다양성: 8가지 의도가 균형잡혀 있는가?
4. 엔티티 커버: 핵심 상품/기능이 고르게 포함?
5. 중복/균형: 중복 없고 토픽별 균형잡혀있는가?
```

---

### 11-3. 두 가지 평가 방식의 목적 차이

```
시간축:
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  Phase 1          Phase 2          Phase 3      Phase 4 │
│  (지금)           (1시간)          (1주)       (배포)    │
│                                                          │
│ ┌─────────────┐  ┌──────────────┐ ┌──────────┐ ┌──────┐ │
│ │ DeepEval    │→ │ 본격 생성     │→│LLM Judge │→│RAGAS │ │
│ │ (정성 평가) │  │(1,106개)     │ │(구조평가) │ │검증  │ │
│ └─────────────┘  └──────────────┘ └──────────┘ └──────┘ │
│                                                          │
│  "어느 모델이    "좋은 QA를   "1,106개가     "실제 RAG │
│   더 나은가?"     만들 수     균형잡혀      성능은     │
│                 있는가?"      있는가?"      얼마나?"    │
│                                                          │
│  결과: 모델선택  결과: QA생성  결과: 최적화  결과: 동작 │
└──────────────────────────────────────────────────────────┘
```

---

### 11-4. 실제 예시: DeepEval과 LJudge의 다른 결론

**관점 A: DeepEval (개별 QA 관점)**
```
Flash-Lite EN vs GPT-5.1 EN

Flash-Lite 샘플:
- Q1 Faithfulness: 0.87 (약간 hallucination)
- Q2 Faithfulness: 0.85 (약간 hallucination)
- Q3 Faithfulness: 0.91 ✅
- ...
- 평균: 0.88

GPT-5.1 샘플:
- Q1 Faithfulness: 0.94 ✅
- Q2 Faithfulness: 0.93 ✅
- Q3 Faithfulness: 0.95 ✅
- ...
- 평균: 0.93

결론: "GPT-5.1이 5% 더 나음 → 안정성 원하면 GPT-5.1 선택"
```

**관점 B: LJudge (전체 데이터셋 관점)**
```
1,106개 QA 분석:

Flash-Lite로 만든 1,106개:
- 정합성: 24/25 ✅
- 커버리지: 16/20 (80%) ✅
- 의도다양성: 8/15 ⚠️ (procedure 편중)
- 엔티티: 7/10 ✅
- 중복/균형: 6/10 ⚠️ (일부 토픽 편중)
→ 종합점수: 61/100 (개선 필요)

GPT-5.1로 만든 1,106개:
- 정합성: 25/25 ✅✅
- 커버리지: 18/20 (90%) ✅
- 의도다양성: 12/15 ✅
- 엔티티: 8/10 ✅
- 중복/균형: 8/10 ✅
→ 종합점수: 71/100 (배포 가능)

결론: "GPT-5.1이 구조적으로도 더 완성도 있음
       → 안정성 + 완성도 원하면 GPT-5.1 선택
       → 비용 절감 원하면 Flash-Lite + 개선 필요"
```

---

### 11-5. 의사결정: DeepEval + LJudge 통합

```
최종 선택 기준:

Case 1: DeepEval에서 GPT > Flash (5% 우수) ✅
        LJudge에서도 GPT > Flash (10점 우수) ✅
        → 결론: GPT-5.1 선택 (일관성 있음)
           비용: $8.17 (추가)
           장점: 안정성 + 완성도

Case 2: DeepEval에서 Flash ≈ GPT (1% 차이) ✅
        LJudge에서 Flash 61점, GPT 71점 ✅
        → 결론: Flash + 개선 (균형잡힌 선택)
           비용: $1.19 + 프롬프트 개선
           장점: 비용절감하면서 개선으로 완성도 향상

Case 3: DeepEval에서 Flash > GPT (이상 시나리오)
        → LJudge로 전체 완성도 재확인
           → 패턴 파악 및 이유 분석
```

---



우리의 평가는 **두 가지 차원**으로 이루어집니다:

1. **DeepEval (정성 평가)**: 개별 QA 품질
   - Faithfulness, Answer Relevancy, Correctness, ...
   - 각 QA가 얼마나 좋은가

2. **LLM as a Judge (구조 평가)**: 전체 데이터셋 완성도
   - 커버리지, 의도 다양성, 엔티티 커버, 중복도, ...
   - 1,106개 QA 전체가 얼마나 균형잡혀 있는가

**예시 (PASS 추천앱 선행 연구):**
```
기존 Q셋 (20개):
- 정성 평가: 낮음 (기계적 질문)
- 구조 평가: 28.5/100 (매우 낮음)
  → 중복 40%, 커버리지 10%, 중요 섹션 누락

신규 Q셋 (20개):
- 정성 평가: 중간 (구체적 질문)
- 구조 평가: 61.5/100 (개선됨)
  → 중복 20%, 커버리지 50%, 다양한 소주제 포함
```

---

### 11-2. 구조 평가: 5가지 핵심 지표

우리의 **1,106개 KT 고객지원 QA**에 적용할 지표:

#### 1️⃣ 정합성/근거성 (Groundedness Gating)

**정의:** 모든 QA가 제공된 컨텍스트 내에서 답변 가능한가?

```
게이팅 기준:
✅ Answerable: context에 명시적 근거 있음 (10단어 이내 인용 가능)
❌ OutsideContext: 근거 없음 → 자동 0점 제외

예시:
Q: "VIP 초이스 가격은?" / Context: "VIP 초이스는 월 9,900원"
→ Answerable ✅ (근거: "월 9,900원")

Q: "VIP 초이스로 해외여행 할인?" / Context: "영화,카페 할인만"
→ OutsideContext ❌ (해외여행 정보 없음)
```

**기대값:** > 95% (1,050개 이상 가능해야 함)

---

#### 2️⃣ 문서/섹션 커버리지 (Coverage)

**정의:** 1,106개 QA가 얼마나 다양한 문서/섹션을 다루는가?

```
계산 방식:
커버리지 = (답변 Q가 있는 섹션 수) / (전체 섹션 수) × 100

우리 KT 콘텐츠 구조 (예상 20-30개 주요 섹션):
- Shop > 마이샵 이용안내
- Shop > 요고 다이렉트
- 고객지원 > 셀프진단 및 AS신청
- 상품 > AI > 링고 (USIM/esIM/AI통화)
- 혜택 > VIP초이스 > 멤버십혜택
- 혜택 > 할인 > 영화·공연
- ... 등

기대값: > 70% (25개 섹션 중 18개 이상 커버)

PASS 선행연구 결과:
- 기존: 2개 섹션 (10%) - 부족
- 신규: 5개 섹션 (50%) - 개선됨
```

---

#### 3️⃣ 의도 타입 다양성 (Intent Distribution)

**정의:** 8가지 의도 타입이 균형잡혀 분포되어 있는가?

```
이상적 분포 (1,106개 기준):
- procedure (절차): 20% (220개) ← 가장 많음 (자연스러움)
- how (방법): 15% (165개)
- boolean (가능여부): 15% (165개)
- factoid (사실): 12% (130개)
- list (목록): 10% (110개)
- why (이유): 10% (110개)
- definition (정의): 8% (90개)
- numeric (숫자): 5% (55개)
- comparison (비교): 5% (55개)

균형도 평가:
편차 = 최빈값(%) / 최소값(%)
- < 3: 우수 (균형잡힘)
- 3-5: 양호
- > 5: 부족 (편중)

PASS 선행연구:
- 기존: procedure 7개 vs why 0개 → 비율 ∞ (why 전무)
- 신규: procedure 10개 vs list 1개 → 비율 10:1 (여전히 편중)
```

---

#### 4️⃣ 엔티티 커버리지 (Entity Coverage)

**정의:** 컨텍스트의 핵심 엔티티/상품/기능이 고르게 포함되었는가?

```
핵심 엔티티 예시 (KT):
상품명: VIP초이스, PASS앱, 링고, 우리펫상조, 모바일신분증, ...
기능: 휴대폰결제, 본인확인, 멤버십, 할인, ...
속성: 가격, 조건, 제한사항, 혜택, ...

계산 방식:
메타리지 = (최소 1회 이상 언급 엔티티) / (전체 핵심 엔티티) × 100

기대값: > 60% (전체 엔티티의 대부분이 QA에 포함)

PASS 선행연구:
- 기존: 2개 엔티티 / 13개 → 15% (심각히 부족)
- 신규: 8개 엔티티 / 13개 → 60% (대폭 개선)
```

---

#### 5️⃣ 중복도 및 클러스터 균형 (Redundancy & Cluster Balance)

**정의:** 같은 내용을 반복하지 않으면서, 주제별로 균형잡혀 있는가?

```
중복 판정 기준:
답변이 동일하고 표면적 치환(동의어/어순)만 다르거나
의미상 거의 같은 질문 쌍

목표: near-duplicate rate < 10% (5쌍 미만 / 100Q당)

PASS 선행연구:
- 기존: 4개 중복 쌍 / 20개 Q = 40% (매우 높음❌)
  예: (기기호환1, 기기호환2), (가입가능, 가입희망), ...
- 신규: 4개 중복 쌍 / 20개 Q = 40% (여전히 높음⚠️)
  하지만 내용상 조금 다른 각도 (선불폰 제한 vs 대체경로)

클러스터 균형:
토픽별 질문 수 편차
비율 = (가장 많은 클러스터) / (가장 적은 클러스터)

기대값: < 3 (균형잡힘)

예시:
신규 PASS:
- 펫상조유의/가입해지: 7+3 = 10Q (가장 많음)
- 본인확인특징, 휴대폰결제, 공지: 각 2Q
→ 비율 10/2 = 5 (편중❌)
```

---

### 11-3. 구조 평가: 가중치 기반 최종 점수 (0~100)

**가중치 설정:**

| 항목 | 가중치 | 만점 | 계산 방식 |
|-----|--------|------|---------|
| 정합성/근거성 | 25 | 25 | OutsideContext 0개 = 25점, 5% 초과 = 감점 |
| 문서/섹션 커버리지 | 20 | 20 | 커버리지 70% 달성 = 14점 (70% × 20) |
| 엔티티 커버리지 | 10 | 10 | 엔티티 60% 달성 = 6점 (60% × 10) |
| 의도 타입 다양성 | 15 | 15 | 편차 < 3 = 15점, > 5 = 5점 |
| 중복도 (near-dup ↓) | 10 | 10 | < 10% = 10점, > 20% = 2점 |
| 클러스터 균형 | 10 | 10 | 비율 < 3 = 10점, > 5 = 3점 |
| 원자성 (1Q = 1과업) | 5 | 5 | 대부분 원자적 = 5점 |
| 명확성 (모호함 ↓) | 5 | 5 | 모호한 Q < 5% = 5점 |
| **합계** | **100** | **100** | |

**최종 해석:**
```
80-100: 우수 (체계적으로 설계된 QA)  ⭐⭐⭐⭐⭐
60-79:  양호 (개선 여지 있음)         ⭐⭐⭐⭐
40-59:  보통 (상당한 재작업 필요)     ⭐⭐⭐
< 40:   부족 (전면 재설계 권장)       ⭐⭐
```

---

### 11-4. 우리 평가에 적용 방법

#### Phase 1: DeepEval (샘플 200개)
```
시기: 지금
대상: Flash-Lite EN 100개 + GPT-5.1 EN 100개
메트릭: 정성 품질 (Faithfulness, Answer Relevancy, Correctness, ...)
결과: 모델 선택 (Flash-Lite vs GPT-5.1)
```

#### Phase 2: 본격 생성 (1,106개 전체)
```
시기: Phase 1 완료 후
모델: 선택된 모델 (Flash-Lite EN 또는 GPT-5.1 EN)
목표: 1,106개 고품질 QA 생성
```

#### Phase 3: LLM as a Judge 평가 (1,106개 전체)
```
시기: Phase 2 완료 후
메트릭: 구조 평가 (5가지 지표)
결과: 0~100 점수
기준:
- ≥ 70: 배포 가능
- < 70: 개선 필요 (중복 제거, 커버리지 부족 섹션 추가, ...)
```

#### Phase 4: 최종 검증 (선택)
```
시기: 배포 전 (선택사항)
메트릭: RAGAS 평가 (faithfulness, context_precision, answer_relevancy)
목적: 실제 RAG 성능 검증
비용: 추가 $10-15
```

---

## 참고: 이전 평가 결과와 비교

**휴리스틱 평가 (현재):**
- Flash-Lite EN: 4.92/5.00
- GPT-5.1 EN: 4.94/5.00
- 차이: 0.02점 (거의 동등)

**DeepEval 기대 결과:**
- 더 정밀한 차이 파악 (개별 QA 품질)
- 의도별 약점 파악 가능
- 신뢰도 높은 모델 선택 가능

**LLM as a Judge 기대 결과:**
- 전체 데이터셋 구조 평가 (0~100 점수)
- 개선 영역 식별 (중복, 커버리지, 의도 편중)
- 최종 배포 전 품질 검증 가능

→ **세 가지 평가를 통합하면 완벽한 QA 품질 보증 가능**
