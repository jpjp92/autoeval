# qa_quality_evaluator.py → backend/evaluation_api.py 통합 계획

## 📊 현재 상황 분석

### 1️⃣ qa_quality_evaluator.py
**위치**: `/home/jpjp92/devs/works/autoeval/qa_quality_evaluator.py`

**기능**:
- **Layer 1**: SyntaxValidator
  - 구문 검증 (필드/타입/길이)
  - 데이터셋 통계 (커버리지, 유형분포, 중복률, 편중도)
  - 자동 검증 (API 미필요)

- **Layer 2**: LLM 품질 평가
  - 모델: GPT-5.1
  - 평가 지표: Factuality, Completeness, Groundedness
  - CoT (Chain of Thought) 기반 추론

**특징**:
- 독립 CLI 스크립트 (`uv run qa_quality_evaluator.py`)
- OpenAI API 사용
- 리치 패널로 결과 출력
- JSON 결과 저장

---

### 2️⃣ backend/evaluation_api.py
**위치**: `/home/jpjp92/devs/works/autoeval/backend/evaluation_api.py`

**기능**:
- FastAPI 엔드포인트 (`/api/evaluate`)
- RAGTriadEvaluator
- 3개 평가 지표: Relevance, Groundedness, Clarity
- 멀티 모델 지원: Claude/Gemini/GPT
- 자동 공급사 감지
- EvaluationManager: 비동기 작업 추적

**특징**:
- 웹 대시보드와 연동
- 실시간 진행률 모니터링
- 구조화된 응답

---

## 🎯 통합 전략

### Phase 1: 계층 분리 & 구조화

```
┌─────────────────────────────────────────────────────┐
│  backend/evaluation_api.py (중앙)                  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [Layer 1] ── SyntaxValidator                       │
│  • 필드 검증                                        │
│  • 통계 분석 (데이터셋 레벨)                       │
│  • 비용: 0 (자동)                                  │
│                                                     │
│  [Layer 2] ── RAGTriadEvaluator                      │
│  • Relevance (현재)                                │
│  • Groundedness (현재)                             │
│  • Clarity (현재)                                  │
│                                                     │
│  [Layer 3] ── QAQualityEvaluator (NEW)             │
│  • Factuality (추가)                              │
│  • Completeness (추가)                            │
│  • Groundedness (RAGTriad와 통합)                  │
│  • 멀티 모델 지원                                 │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 🔧 세부 통합 계획

### 1️⃣ SyntaxValidator 추가
**파일**: `backend/evaluation_api.py`

```python
class SyntaxValidator:
    """QA 데이터 구문 검증 (자동)"""
    
    @staticmethod
    def validate_qa(qa_item: Dict) -> Tuple[bool, List[str]]:
        """QA 항목 검증"""
        pass
    
    @staticmethod
    def analyze_dataset(qa_list: List[Dict]) -> Dict:
        """데이터셋 통계 분석"""
        # 커버리지, 유형분포, 중복률, 편중도 등
        pass
```

**추가 로직**:
- ✅ 필드 검증 (q, a, context)
- ✅ 길이 범위 검증 (q: 5-500, a: 10-2000, context: 50-50000)
- ✅ 타입 검증 (모두 string)
- ✅ 데이터셋 통계 (Counter, SequenceMatcher 사용)

**비용**: **$0** (LLM 미사용)

---

### 2️⃣ QAQualityEvaluator 추가
**파일**: `backend/evaluation_api.py`

```python
class QAQualityEvaluator:
    """LLM 기반 QA 품질 평가"""
    
    def __init__(self, model: str):
        # 평가 모델 (gpt-5.1이 최적)
        self.model = model
    
    async def evaluate(self, qa_list: List[Dict]) -> Dict:
        """QA 평가"""
        # Factuality, Completeness, Groundedness 계산
        pass
```

**평가 지표**:
- **Factuality**: 답변이 컨텍스트 기반 사실인가?
- **Completeness**: 답변이 질문을 완전히 답했는가?
- **Groundedness**: 답변이 컨텍스트에 근거하는가?

**모델**: GPT-5.1 권장 (CoT 기반 추론)

---

### 3️⃣ RAGTriadEvaluator 유지
**현재 상태 유지**:
- Relevance: 질문과 답변의 관련성
- Groundedness: 답변의 근거성
- Clarity: 답변의 명확성

**변경 사항**:
- 옵션으로 `QAQualityEvaluator` 병행 가능
- 통합 리포트 생성

---

## 📈 평가 플로우

### 현재 플로우
```
웹 대시보드
    ↓ (Model 선택: Claude/Gemini/GPT)
/api/evaluate (RAGTriadEvaluator)
    ├─ Relevance
    ├─ Groundedness
    └─ Clarity
    ↓
결과 저장 (validated_output/)
```

### 통합 후 플로우
```
웹 대시보드
    ↓ (Model + EvalMode 선택)
/api/evaluate
    ├─ Layer 1: SyntaxValidator
    │  └─ 데이터셋 검증 & 통계 (비용: $0)
    │
    ├─ Layer 2: RAGTriadEvaluator (기존)
    │  ├─ Relevance
    │  ├─ Groundedness
    │  └─ Clarity
    │
    └─ Layer 3: QAQualityEvaluator (선택)
       ├─ Factuality
       ├─ Completeness
       └─ Groundedness
       ↓
통합 리포트 생성
```

---

## 💰 비용 추정

### 비용 비교

| 평가 방식 | 항목 | 비용 | 시간 |
|----------|------|------|------|
| **SyntaxValidator** | 100 QA | **$0** | ~1초 |
| **RAGTriad** | 100 QA | ~$0.50 | ~2분 |
| **QAQuality (GPT-5.1)** | 100 QA | ~$0.80 | ~5분 |
| **병합 평가** | 100 QA | **~$1.30** | ~7분 |

💡 **최적화**: 먼저 SyntaxValidator로 필터링 → 문제 있는 항목만 LLM 평가

---

## 🔄 구현 순서

### Step 1️⃣: SyntaxValidator 추가 (우선순위: 높음)
- [ ] `backend/evaluation_api.py`에 `SyntaxValidator` 클래스 추가
- [ ] `/api/evaluate?mode=syntax` 엔드포인트 추가
- [ ] 테스트 및 검증

**소요 시간**: ~2시간

---

### Step 2️⃣: QAQualityEvaluator 추가 (우선순위: 중간)
- [ ] `backend/evaluation_api.py`에 `QAQualityEvaluator` 클래스 추가
- [ ] `/api/evaluate?mode=quality` 엔드포인트 추가
- [ ] 멀티 모델 지원 (GPT-5.1 기본)
- [ ] 테스트 및 검증

**소요 시간**: ~3시간

---

### Step 3️⃣: 통합 리포트 생성 (우선순위: 낮음)
- [ ] 모든 평가 결과를 통합
- [ ] 리포트 포맷 정의
- [ ] 웹 대시보드에 시각화

**소요 시간**: ~2시간

---

## 📋 코드 통합 체크리스트

### SyntaxValidator 추가
```python
# backend/evaluation_api.py에 추가할 코드
class SyntaxValidator:
    CONFIG = {
        "q_length": (5, 500),
        "a_length": (10, 2000),
        "context_length": (50, 50000),
        "required_fields": ["q", "a", "context"],
    }
    
    @staticmethod
    def validate_qa(qa_item: Dict) -> Tuple[bool, List[str]]:
        """QA 항목 검증"""
        # qa_quality_evaluator.py에서 로직 복사
        pass
    
    @staticmethod
    def analyze_dataset(qa_list: List[Dict]) -> Dict:
        """데이터셋 분석"""
        # 통계 분석 로직
        pass
```

### QAQualityEvaluator 추가
```python
# backend/evaluation_api.py에 추가할 코드
class QAQualityEvaluator:
    """LLM 기반 품질 평가 (qa_quality_evaluator.py 기반)"""
    
    def __init__(self, model: str = "gpt-5.1"):
        self.model = model
        
    async def evaluate(self, qa_list: List[Dict]) -> Dict:
        """평가 실행"""
        # 멀티 모델 지원
        pass
```

---

## 🎯 최종 목표

**통합 후 사용 시나리오**:

```bash
# 웹 대시보드에서
평가 모델: GPT-5.1
평가 방식: [종합평가 ▼]  # Syntax + RAGTriad + Quality

# 결과
├─ Layer 1: 구문 검증
│  ├─ PASS: 95/100 QA
│  └─ 통계: 유형분포, 중복률 등
│
├─ Layer 2: RAGTriad 평가
│  ├─ Relevance: 4.8/5
│  ├─ Groundedness: 4.7/5
│  └─ Clarity: 4.9/5
│
└─ Layer 3: Quality 평가
   ├─ Factuality: 4.9/5
   ├─ Completeness: 4.8/5
   └─ 총점: 4.8/5
```

---

## 📝 다음 단계

1. **사용자 확인**: 이 계획이 맞는지 검증
2. **Phase 1 시작**: SyntaxValidator 추가부터 시작
3. **테스트**: 각 Phase마다 테스트 실행
4. **배포**: GitHub에 순차적으로 커밋

---

**질문**:
1. 이 통합 계획이 방향성이 맞나요?
2. SyntaxValidator부터 시작할까요, 아니면 다른 우선순위가 있나요?
3. 평가 지표의 정의를 조정해야 하나요?
