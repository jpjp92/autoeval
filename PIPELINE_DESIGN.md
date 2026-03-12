# Evaluation Pipeline 설계 (4단계 순차 실행)

## 📊 파이프라인 구조

### 1️⃣ Layer 1-A: SyntaxValidator
- **목적**: 구문 정확성 검증
- **비용**: $0
- **시간**: 빠름 (≈1초/100QA)
- **Input**: QA 리스트
- **Output**: 
  ```json
  {
    "total": 100,
    "valid": 95,
    "invalid": 5,
    "pass_rate": 95.0,
    "errors": [...]
  }
  ```

### 2️⃣ Layer 1-B: DatasetStats
- **목적**: 데이터셋 전체 통계
- **비용**: $0
- **시간**: 빠름 (≈1초)
- **Input**: QA 리스트
- **Output**:
  ```json
  {
    "diversity": {...},
    "duplication_rate": {...},
    "skewness": {...},
    "data_sufficiency": {...},
    "integrated_score": 7.5
  }
  ```

### 3️⃣ Layer 2: RAGTriadEvaluator (기존)
- **목적**: RAG Triad 메트릭 평가
- **비용**: ~$0.5/100QA (모델에 따라)
- **시간**: ~2분
- **Input**: QA 리스트 (valid QA만)
- **Output**:
  ```json
  {
    "qa_scores": [
      {
        "q": "...",
        "a": "...",
        "relevance": 0.85,      # 0-1
        "groundedness": 0.92,
        "clarity": 0.88,
        "avg_score": 0.88
      }
    ],
    "summary": {
      "avg_relevance": 0.85,
      "avg_groundedness": 0.92,
      "avg_clarity": 0.88
    }
  }
  ```

### 4️⃣ Layer 3: QAQualityEvaluator (NEW - CoT)
- **목적**: LLM CoT 기반 품질 평가
- **비용**: ~$0.8/100QA (GPT-5.1 기준)
- **시간**: ~5분
- **Input**: QA 리스트 (valid QA만)
- **Model**: GPT-5.1 (선택 가능)
- **Output**:
  ```json
  {
    "qa_scores": [
      {
        "q": "...",
        "a": "...",
        "context": "...",
        "factuality": 0.90,    # 0-1 (CoT 기반)
        "completeness": 0.88,
        "groundedness": 0.92,
        "avg_quality": 0.90,
        "pass": true           # ≥ 0.70이면 pass
      }
    ],
    "summary": {
      "evaluated_count": 95,
      "pass_count": 80,
      "pass_rate": 84.2,
      "avg_factuality": 0.90,
      "avg_completeness": 0.88,
      "avg_groundedness": 0.92,
      "avg_quality": 0.90
    }
  }
  ```

---

## 🔄 엔드포인트 설계

### POST /api/evaluate (통합 평가)

**요청:**
```json
{
  "qa_list": [...],
  "evaluator_model": "gpt-5.1",  // Layer 2, 3용
  "layers": ["syntax", "stats", "rag", "quality"],  // 선택 가능
  "limit": null  // null이면 전체
}
```

**응답:**
```json
{
  "job_id": "eval_20260312_...",
  "status": "completed",
  "timestamp": "2026-03-12T...",
  "metadata": {
    "total_qa": 100,
    "evaluated_qa": 95,
    "evaluator_model": "gpt-5.1",
    "cost_estimate": "$1.30"
  },
  "layers": {
    "syntax": {
      "status": "completed",
      "total": 100,
      "valid": 95,
      "pass_rate": 95.0
    },
    "stats": {
      "status": "completed",
      "diversity": {...},
      "duplication_rate": {...},
      "integrated_score": 7.5
    },
    "rag": {
      "status": "completed",
      "avg_relevance": 0.85,
      "avg_groundedness": 0.92,
      "avg_clarity": 0.88,
      "qa_count": 95
    },
    "quality": {
      "status": "completed",
      "avg_factuality": 0.90,
      "avg_completeness": 0.88,
      "avg_groundedness": 0.92,
      "pass_rate": 84.2,
      "qa_count": 95
    }
  },
  "overall_score": {
    "syntax_pass_rate": 95.0,
    "dataset_quality": 7.5,
    "rag_score": 0.88,
    "qa_quality": 0.90,
    "final_grade": "A-"  // 종합 점수
  }
}
```

---

## 💻 구현 흐름

```python
async def evaluate_qa(request: EvaluationRequest):
    """통합 평가 파이프라인"""
    
    # 1. 요청 검증
    qa_list = request.qa_list
    evaluator_model = request.evaluator_model
    layers = request.layers
    
    # 2. 결과 저장소 초기화
    results = {
        "syntax": None,
        "stats": None,
        "rag": None,
        "quality": None
    }
    
    # ========== Layer 1-A: SyntaxValidator ==========
    if "syntax" in layers:
        validator = SyntaxValidator()
        valid_qa = []
        syntax_errors = {}
        
        for i, qa in enumerate(qa_list):
            is_valid, errors = validator.validate_qa(qa)
            if is_valid:
                valid_qa.append(qa)
            else:
                syntax_errors[i] = errors
        
        results["syntax"] = {
            "total": len(qa_list),
            "valid": len(valid_qa),
            "invalid": len(qa_list) - len(valid_qa),
            "pass_rate": len(valid_qa) / max(len(qa_list), 1) * 100,
            "errors": syntax_errors
        }
    else:
        valid_qa = qa_list
    
    # ========== Layer 1-B: DatasetStats ==========
    if "stats" in layers:
        stats = DatasetStats(qa_list)
        dataset_stats = stats.analyze_all()
        results["stats"] = dataset_stats
    
    # ========== Layer 2: RAGTriadEvaluator ==========
    if "rag" in layers:
        rag_evaluator = RAGTriadEvaluator(evaluator_model)
        rag_results = {}
        
        for qa in valid_qa:  # ← valid QA만 평가!
            relevance = rag_evaluator.evaluate_relevance(qa["q"], qa["a"])
            groundedness = rag_evaluator.evaluate_groundedness(qa["a"], qa["context"])
            clarity = rag_evaluator.evaluate_clarity(qa["a"])
            
            rag_results["qa_scores"].append({
                "q": qa["q"],
                "relevance": relevance,
                "groundedness": groundedness,
                "clarity": clarity,
                "avg_score": (relevance + groundedness + clarity) / 3
            })
        
        results["rag"] = rag_results
    
    # ========== Layer 3: QAQualityEvaluator ==========
    if "quality" in layers:
        quality_evaluator = QAQualityEvaluator(evaluator_model)
        quality_results = {}
        
        for qa in valid_qa:  # ← valid QA만 평가!
            factuality = quality_evaluator.evaluate_factuality(qa["a"], qa["context"])
            completeness = quality_evaluator.evaluate_completeness(qa["q"], qa["a"])
            groundedness = quality_evaluator.evaluate_groundedness(qa["a"], qa["context"])
            
            quality_results["qa_scores"].append({
                "q": qa["q"],
                "factuality": factuality,
                "completeness": completeness,
                "groundedness": groundedness,
                "avg_quality": (factuality + completeness + groundedness) / 3,
                "pass": (factuality + completeness + groundedness) / 3 >= 0.70
            })
        
        results["quality"] = quality_results
    
    # ========== 결과 통합 ==========
    return {
        "status": "completed",
        "layers": results,
        "overall_score": calculate_overall_score(results)
    }
```

---

## 🎯 핵심 포인트

1. ✅ **순차 실행**: 1️⃣ → 2️⃣ → 3️⃣ → 4️⃣ 순서대로
2. ✅ **유효한 QA만**: Layer 2, 3은 SyntaxValidator 통과한 QA만 평가
3. ✅ **비용 절감**: 구문 오류 QA는 비싼 LLM 평가에서 제외
4. ✅ **상태 추적**: 각 Layer별 진행 상황 추적
5. ✅ **선택 가능**: `layers` 파라미터로 필요한 Layer만 실행
6. ✅ **통합 결과**: 모든 평가 지표 한눈에 확인 가능

---

## 📋 구현 체크리스트

- [ ] QAQualityEvaluator 클래스 추가 (qa_quality_evaluator.py에서)
- [ ] 파이프라인 함수 작성
- [ ] 상태 추적 로직
- [ ] 결과 저장 (JSON)
- [ ] 웹 대시보드 통합
- [ ] 테스트

---

# 🗄️ Supabase 저장 및 조회 아키텍처

## 📊 데이터베이스 스키마

### `evaluation_results` 테이블

```sql
-- 평가 결과 저장소
CREATE TABLE evaluation_results (
  -- Primary Key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 평가 작업 정보
  job_id TEXT UNIQUE NOT NULL,
  result_filename TEXT NOT NULL,
  
  -- 메타데이터
  generation_model TEXT NOT NULL,      -- QA 생성 모델
  evaluator_model TEXT NOT NULL,       -- 평가 모델
  lang TEXT NOT NULL,                  -- 'en', 'ko'
  prompt_version TEXT DEFAULT 'v1',
  
  -- 통계
  total_qa INT NOT NULL,
  valid_qa INT NOT NULL,
  
  -- 4단계 평가 점수 요약
  syntax_pass_rate FLOAT,              -- Layer 1-A
  dataset_quality_score FLOAT,         -- Layer 1-B (0-10)
  rag_avg_relevance FLOAT,             -- Layer 2
  rag_avg_groundedness FLOAT,
  rag_avg_clarity FLOAT,
  quality_avg_factuality FLOAT,        -- Layer 3
  quality_avg_completeness FLOAT,
  quality_avg_groundedness FLOAT,
  quality_pass_rate FLOAT,
  
  -- 최종 점수
  final_score FLOAT,                   -- 종합 점수 (0-1)
  final_grade TEXT,                    -- A+, A, B+, B, C, F
  
  -- 상세 결과 (JSON)
  pipeline_results JSONB NOT NULL,     -- 전체 평가 결과
  interpretation JSONB,                -- 해석 & 추천사항
  
  -- 타임스탐프
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  
  -- 인덱스
  CONSTRAINT valid_grade CHECK (final_grade IN ('A+', 'A', 'B+', 'B', 'C', 'F'))
);

-- 조회 성능을 위한 인덱스
CREATE INDEX idx_evaluation_created_at ON evaluation_results(created_at DESC);
CREATE INDEX idx_evaluation_evaluator_model ON evaluation_results(evaluator_model);
CREATE INDEX idx_evaluation_final_grade ON evaluation_results(final_grade);
CREATE INDEX idx_evaluation_generation_model ON evaluation_results(generation_model);
```

---

## 🔄 데이터 흐름

### 저장 흐름 (평가 완료 후)

```
평가 파이프라인 완료
       ↓
evaluation_api.py 완료 (평가 보고서 생성)
       ↓
Supabase Insert
  └─ evaluation_results 테이블에 저장
       ↓
프론트엔드에 결과 반환
  └─ eval_report (요약) 전달
       ↓
Generation 페이지 완료 UI
```

### 조회 흐름 (Evaluation 페이지)

```
Evaluation 페이지 로드
       ↓
GET /api/results (쿼리 옵션)
       ↓
Supabase Query
  └─ evaluation_results에서 조회
       ↓
프런트엔드에 데이터 반환
       ↓
시각화 & 비교 분석
```

---

## 🔌 백엔드 API 설계

### GET /api/results (평가 결과 목록)

**요청:**
```json
{
  "limit": 20,
  "offset": 0,
  "sort_by": "created_at",     // created_at, final_score
  "order": "desc",              // asc, desc
  "evaluator_model": null,      // 필터: null이면 전체
  "final_grade": null,          // 필터: null이면 전체
  "generation_model": null
}
```

**응답:**
```json
{
  "success": true,
  "total_count": 150,
  "results": [
    {
      "id": "uuid",
      "job_id": "eval_20260312_...",
      "generation_model": "gemini-3.1-flash",
      "evaluator_model": "gpt-5.1",
      "total_qa": 100,
      "valid_qa": 95,
      "syntax_pass_rate": 95.0,
      "dataset_quality_score": 7.52,
      "rag_avg_score": 0.733,
      "quality_avg_score": 0.90,
      "final_score": 0.858,
      "final_grade": "A",
      "created_at": "2026-03-12T11:16:15",
      "result_filename": "qa_quality_results_20260312_111615.json"
    },
    ...
  ]
}
```

### GET /api/results/{id} (평가 결과 상세)

**응답:**
```json
{
  "success": true,
  "result": {
    "id": "uuid",
    "job_id": "eval_...",
    "metadata": {
      "generation_model": "gemini-3.1-flash",
      "evaluator_model": "gpt-5.1",
      "total_qa": 100,
      "lang": "en",
      "created_at": "2026-03-12T..."
    },
    "pipeline_results": {
      "syntax": {...},
      "stats": {...},
      "rag": {...},
      "quality": {...}
    },
    "summary": {
      "syntax_pass_rate": 95.0,
      "dataset_quality_score": 7.52,
      "rag_average_score": 0.733,
      "quality_average_score": 0.90,
      "final_score": 0.858,
      "grade": "A"
    },
    "interpretation": {
      "grade_meaning": "우수한 QA 품질 (85% 이상)",
      "recommendations": [
        "다양성을 더 높이기 위해 의도 유형 추가 권장",
        "...",
      ]
    }
  }
}
```

### POST /api/results (평가 완료 시 저장 - 내부용)

**호출 시점:** `evaluation_api.py`의 `run_full_evaluation_pipeline()` 완료 시

```python
# backend/evaluation_api.py 내부 호출
async def save_evaluation_to_supabase(eval_report: dict, job_id: str):
    """평가 결과를 Supabase에 저장"""
    from supabase import create_client
    
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    
    # eval_report에서 필요한 데이터 추출
    summary = eval_report.get("summary", {})
    
    data = {
        "job_id": job_id,
        "result_filename": eval_report.get("result_filename"),
        "generation_model": eval_report.get("metadata", {}).get("generation_model"),
        "evaluator_model": eval_report.get("metadata", {}).get("evaluator_model"),
        "lang": eval_report.get("metadata", {}).get("lang", "en"),
        "total_qa": eval_report.get("metadata", {}).get("total_qa"),
        "valid_qa": eval_report.get("metadata", {}).get("valid_qa"),
        
        # 점수 요약
        "syntax_pass_rate": summary.get("syntax_pass_rate"),
        "dataset_quality_score": summary.get("dataset_quality_score"),
        "rag_avg_relevance": summary.get("rag_average_score"),
        "rag_avg_groundedness": summary.get("rag_average_score"),
        "rag_avg_clarity": summary.get("rag_average_score"),
        "quality_avg_factuality": summary.get("quality_average_score"),
        "quality_avg_completeness": summary.get("quality_average_score"),
        "quality_avg_groundedness": summary.get("quality_average_score"),
        "quality_pass_rate": summary.get("quality_pass_rate"),
        
        # 최종 점수
        "final_score": summary.get("final_score"),
        "final_grade": summary.get("grade"),
        
        # 상세 결과
        "pipeline_results": eval_report.get("pipeline_results"),
        "interpretation": eval_report.get("interpretation")
    }
    
    # Supabase 저장
    response = supabase.table("evaluation_results").insert(data).execute()
    logger.info(f"[{job_id}] ✓ Supabase saved: {response.data}")
```

---

## 🎨 프론트엔드 통합

### Generation Page → Evaluation Page 네비게이션

```typescript
// 평가 완료 후 실행
if (formValues.autoEvaluate && evalReport) {
  // 1. Evaluation 페이지로 이동
  navigate("/evaluation", { 
    state: { 
      latestResultId: evalReport.id,  // Supabase ID
      resultSummary: evalReport       // 요약 데이터
    } 
  });
}
```

### Evaluation Dashboard 구성

```
┌─────────────────────────────────────────┐
│  📊 Evaluation Dashboard                 │
├─────────────────────────────────────────┤
│                                         │
│  [필터] [정렬]  ← 모델별, 등급별       │
│                                         │
│  ┌─────────────────────────────────┐   │
│  │ 최근 평가 결과                  │   │
│  ├─────────────────────────────────┤   │
│  │ [최신] [2026-03-12 11:16]        │   │
│  │ Gemini 3.1 Flash → GPT-5.1       │   │
│  │ 100 QA | A 등급 | 85.8%          │   │
│  │ [상세 보기]                      │   │
│  │                                  │   │
│  │ [2번째] [2026-03-12 09:30]      │   │
│  │ Claude Sonnet → Claude Haiku    │   │
│  │ 50 QA | A- 등급 | 82.3%         │   │
│  └─────────────────────────────────┘   │
│                                         │
└─────────────────────────────────────────┘

상세 뷰:
┌──────────────────────────────────────────┐
│ 평가 결과 상세 #eval_20260312_...        │
├──────────────────────────────────────────┤
│                                          │
│ 📈 4단계 평가 결과                       │
│  ├─ 1️⃣ Syntax: 95.0% ✅                 │
│  ├─ 2️⃣ Stats: 7.52/10                   │
│  ├─ 3️⃣ RAG Triad: 0.733                 │
│  └─ 4️⃣ Quality: 0.90 (Pass 80%)         │
│                                          │
│ 🎯 최종 결과                             │
│  - 등급: A (85.8%)                      │
│  - 추천: 다양성 개선, ...               │
│                                          │
│ 📊 상세 차트                             │
│  - 모델별 점수 비교                      │
│  - 시간대별 추이                        │
│                                          │
└──────────────────────────────────────────┘
```

---

## 🛠️ 구현 로드맵

### Phase 1: Supabase 초기 설정
- [ ] Supabase 프로젝트 생성
- [ ] `evaluation_results` 테이블 생성
- [ ] 환경변수 설정 (SUPABASE_URL, SUPABASE_KEY)
- [ ] 권한 설정 (RLS)

### Phase 2: 백엔드 API 구현
- [ ] `POST /api/results` - 평가 완료 시 저장
- [ ] `GET /api/results` - 결과 목록 조회
- [ ] `GET /api/results/{id}` - 결과 상세 조회
- [ ] Supabase 클라이언트 통합

### Phase 3: 프론트엔드 통합
- [ ] Evaluation Dashboard 컴포넌트 개선
- [ ] 결과 리스트 표시
- [ ] 상세 뷰 구현
- [ ] 필터 & 정렬 기능

### Phase 4: 고급 기능
- [ ] 모델별 평가 비교 분석
- [ ] 시간대별 추이 차트
- [ ] QA 상세 검토 & 수정
- [ ] 내보내기 (CSV, PDF)

---

## 🔐 보안 고려사항

### Supabase RLS (Row Level Security)

```sql
-- 모든 사용자가 평가 결과를 읽을 수 있음
CREATE POLICY "Allow read all" ON evaluation_results
  FOR SELECT USING (true);

-- 인증된 사용자만 쓸 수 있음
CREATE POLICY "Allow insert authenticated" ON evaluation_results
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- 자신의 결과만 수정/삭제 가능
CREATE POLICY "Allow update own" ON evaluation_results
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

### API 요청 검증
- Supabase API Key는 server-side에서만 사용
- 클라이언트는 anon key 사용 (제한된 권한)
- Rate limiting 적용

---

# 🎯 QA 생성 저장 아키텍처

## 📊 QA 생성 데이터 테이블

### `qa_generation_results` 테이블

```sql
-- QA 생성 결과 저장소
CREATE TABLE qa_generation_results (
  -- Primary Key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 생성 작업 정보
  job_id TEXT UNIQUE NOT NULL,
  result_filename TEXT NOT NULL,
  
  -- 메타데이터
  generation_model TEXT NOT NULL,   -- 생성 모델 (Gemini 3.1 Flash 등)
  lang TEXT NOT NULL,               -- 'en', 'ko'
  prompt_version TEXT DEFAULT 'v1',
  
  -- QA 통계
  total_qa INT NOT NULL,            -- 생성된 총 QA 개수
  total_tokens_input INT,
  total_tokens_output INT,
  estimated_cost FLOAT,             -- 생성 비용 추정치
  
  -- QA 데이터 (전체 저장)
  qa_list JSONB NOT NULL,           -- [{q, a, context, hierarchy, docId, ...}]
  
  -- 타임스탐프
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now(),
  
  -- 평가 연결 (일대일)
  linked_evaluation_id UUID REFERENCES evaluation_results(id) ON DELETE SET NULL
);

-- 조회 성능을 위한 인덱스
CREATE INDEX idx_qa_gen_created_at ON qa_generation_results(created_at DESC);
CREATE INDEX idx_qa_gen_generation_model ON qa_generation_results(generation_model);
CREATE INDEX idx_qa_gen_linked_eval ON qa_generation_results(linked_evaluation_id);
```

## 🔄 생성 → 평가 통합 데이터 흐름

```
┌──────────────────────────────────────────────────┐
│           Data Generation Phase                  │
├──────────────────────────────────────────────────┤
│                                                  │
│  User selects:                                   │
│  - Generation Model (Gemini 3.1, Claude, GPT)   │
│  - Language (en, ko)                            │
│  - Samples (문서 개수)                           │
│                                                  │
│              ↓                                    │
│                                                  │
│  [QA 생성 실행]                                  │
│  result: qa_gpt-5.2_en_v1_20260312.json         │
│                                                  │
│              ↓                                   │
│                                                  │
│  [Supabase 저장]                                 │
│  INSERT qa_generation_results                   │
│  ├─ job_id: gen_20260312_...                    │
│  ├─ qa_list: [QA 배열]                          │
│  ├─ total_qa: 100                               │
│  └─ created_at: now()                           │
│                                                  │
│              ↓                                   │
│                                                  │
│  프론트엔드 표시:                                 │
│  "생성 완료! 📄 100개 QA"                        │
│                                                  │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│         Evaluation Phase (자동)                   │
├──────────────────────────────────────────────────┤
│                                                  │
│  User selects:                                   │
│  - Evaluator Model (Gemini 2.5, Claude, GPT)   │
│  - Auto Evaluate: YES                           │
│                                                  │
│              ↓                                   │
│                                                  │
│  [평가 4단계 실행]                               │
│  1️⃣ Syntax Validation (유효성)                  │
│  2️⃣ Dataset Statistics (통계)                  │
│  3️⃣ RAG Triad (기존 평가)                       │
│  4️⃣ Quality CoT (품질 평가)                     │
│                                                  │
│              ↓                                   │
│                                                  │
│  [Supabase 저장]                                 │
│  INSERT evaluation_results                      │
│  ├─ job_id: eval_20260312_...                   │
│  ├─ pipeline_results: [모든 평가 결과]          │
│  ├─ final_grade: A                              │
│  └─ linked_evaluation_id: ← 생성 결과 연결      │
│                                                  │
│              ↓                                   │
│                                                  │
│  프론트엔드 표시:                                 │
│  "평가 완료! 📊 등급: A (85.8%)"                │
│  [Evaluation으로 이동] ← 자동 탐색               │
│                                                  │
└──────────────────────────────────────────────────┘
```

## 🔌 백엔드 API 설계 (QA 생성)

### POST /api/generate (QA 생성)

**기존 동작은 동일, 완료 후 Supabase 저장 추가**

```python
# backend/generation_api.py 수정
async def run_qa_generation(...):
    """QA 생성 파이프라인"""
    
    # ... 기존 QA 생성 로직 ...
    
    # 결과를 로컬에 저장 (기존)
    with open(result_filepath, 'w') as f:
        json.dump(result_data, f)
    
    # ✨ NEW: Supabase에도 저장
    save_to_supabase(
        job_id=job_id,
        result_filename=filename,
        generation_model=model,
        lang=lang,
        qa_list=qa_list,
        tokens_info={
            'total_input': total_input_tokens,
            'total_output': total_output_tokens,
            'estimated_cost': calculate_cost(model, tokens)
        }
    )
    
    # 상태 업데이트
    job_manager.update_job(
        job_id,
        status=JobStatus.COMPLETED,
        result_file=filename,
        result_id=supabase_id  # 🆕 Supabase ID 반환
    )
```

### GET /api/generation/{id} (생성 결과 상세)

```json
{
  "success": true,
  "result": {
    "id": "uuid",                    // Supabase ID
    "job_id": "gen_20260312_...",
    "generation_model": "gemini-3.1-flash",
    "lang": "en",
    "total_qa": 100,
    "created_at": "2026-03-12T11:16:15",
    "qa_list": [
      {
        "q": "What is...",
        "a": "...",
        "context": "...",
        "hierarchy": ["category", "subcategory"],
        "docId": "ktcom_3842",
        "intent": "factoid"
      },
      ...
    ],
    "cost_info": {
      "total_input_tokens": 12345,
      "total_output_tokens": 6789,
      "estimated_cost": "$0.45"
    }
  }
}
```

### 생성-평가 연결 API

**평가 완료 시 호출:**

```python
# backend/evaluation_api.py
async def link_generation_to_evaluation(
    generation_id: str,      # QA 생성 Supabase ID
    evaluation_id: str       # 평가 결과 Supabase ID
):
    """생성과 평가 결과를 연결"""
    supabase.table("qa_generation_results").update({
        "linked_evaluation_id": evaluation_id
    }).eq("id", generation_id).execute()
```

## 🎨 프론트엔드 통합 (생성 → 평가)

### Generation Page 완료 UI

```typescript
// 생성 완료 후
setGenResultId(response.result_id);  // Supabase ID 저장

// 평가 완료 후
if (formValues.autoEvaluate && evalReport) {
  // 1. 생성-평가 연결
  await linkGenerationToEvaluation(genResultId, evalReport.id);
  
  // 2. Evaluation 페이지로 네비게이션 (데이터 전달)
  navigate("/evaluation", {
    state: {
      generationId: genResultId,        // 생성 Supabase ID
      evaluationId: evalReport.id,      // 평가 Supabase ID
      resultSummary: evalReport.summary // 요약 데이터
    }
  });
}
```

### Evaluation Page - 생성과 평가 함께 표시

```
┌────────────────────────────────────────────┐
│ 📊 Evaluation Dashboard                    │
├────────────────────────────────────────────┤
│                                            │
│ 최근 결과: [2026-03-12 11:16]             │
│                                            │
│ ┌─── QA 생성 ───────────────────────────┐ │
│ │ 생성 모델: Gemini 3.1 Flash           │ │
│ │ 생성된 QA: 100개                      │ │
│ │ 언어: English (en)                    │ │
│ │ 생성 비용: $0.45                      │ │
│ │ [QA 목록 보기] [내보내기]             │ │
│ └─────────────────────────────────────┘ │
│                                            │
│ ┌─── 평가 결과 (4단계) ─────────────────┐ │
│ │ 평가 모델: GPT-5.1                    │ │
│ │                                        │ │
│ │ 1️⃣ Syntax: 100.0% ✅                  │ │
│ │ 2️⃣ Dataset Stats: 7.52/10            │ │
│ │ 3️⃣ RAG Triad: 0.733                   │ │
│ │ 4️⃣ Quality: 0.90 (Pass: 95%)         │ │
│ │                                        │ │
│ │ 최종 등급: A (85.8%)                  │ │
│ │ [상세 보기] [비교 분석]                │ │
│ └─────────────────────────────────────┘ │
│                                            │
└────────────────────────────────────────────┘
```

## 📋 최종 데이터 흐름

```
프론트엔드 (Generation Page)
    ↓
[QA 생성] 
    ↓
Supabase: qa_generation_results (INSERT)
    ↓
[자동 평가] (자동)
    ↓
Supabase: evaluation_results (INSERT)
         + linked_evaluation_id 설정
    ↓
프론트엔드 (자동 네비게이션)
         ↓
[Evaluation Page]
    ↓
Supabase: qa_generation_results + evaluation_results (JOIN 조회)
         ↓
생성과 평가 결과를 함께 시각화
```

## 🛠️ 추가 구현 (QA 생성 저장)

### Phase 1: Supabase 테이블 추가
- [ ] `qa_generation_results` 테이블 생성
- [ ] `linked_evaluation_id` FK 추가

### Phase 2: 백엔드 수정
- [ ] `generation_api.py`: Supabase 저장 로직 추가
- [ ] `evaluation_api.py`: 생성-평가 연결 로직
- [ ] API: `GET /api/generation/{id}` 엔드포인트

### Phase 3: 프론트엔드 개선
- [ ] 생성 결과의 Supabase ID 저장
- [ ] 평가 완료 후 자동 네비게이션
- [ ] Evaluation Page에서 생성 정보 표시

---

## 📝 요약

| 항목 | 설명 |
|------|------|
| **저장 타이밍** | QA 생성 완료 후 자동 저장 |
| **저장 위치** | `qa_generation_results` 테이블 |
| **데이터 연결** | 평가 완료 시 `linked_evaluation_id`로 연결 |
| **조회** | Evaluation 페이지에서 함께 조회 |
| **데이터 형식** | JSON (전체 QA 배열) |
| **장점** | 생성↔평가 추적, 완전한 이력 관리 |
| **비용** | Supabase free tier (충분함) |

| 항목 | 설명 |
|------|------|
| **저장 타이밍** | 평가 파이프라인 완료 후 자동 저장 |
| **저장 위치** | `evaluation_results` 테이블 |
| **조회 시점** | Evaluation 페이지 로드 시 |
| **데이터 형식** | JSON (상세), 요약 (리스트) |
| **보안** | RLS, anon key 클라이언트 사용 |
| **장점** | 영속성, 비교분석, 히스토리 |
| **비용** | Supabase free tier (충분함) |

---

# 🎯 현재 실행 계획 (Hierarchy-Based Selective QA Generation)

## 📋 개요

사용자가 원하는 기능:
- 계층 구조의 **일부만 선별**해서 QA 생성 및 평가 실행
- 예: `혜택 > 구매혜택`에서만 3개 샘플링 생성
- 더 나아가: `상품 > 모바일`의 하위 모든 계층 자동 포함

**현재 데이터 구조:**
```
1,106 documents
├─ Level 1: 5 categories (상품, 고객지원, Shop, 혜택, 마이)
├─ Level 2: 30 categories (모바일, TV, 공지이용안내, 등)
├─ Level 3-7: Progressive granularity
└─ representative_hierarchies.json: 분포 정보 준비됨
```

---

## 🔧 구현 3단계

### Step 1️⃣: 백엔드 Path 필터링 로직 구현

**파일:** `backend/generation_api.py`

**변경사항:**

1. `GenerateRequest` 모델에 필터링 파라미터 추가:
```python
class GenerateRequest(BaseModel):
    model: str = "gemini-3.1-flash"
    lang: str = "ko"
    samples: int = 10
    qa_per_doc: Optional[int] = None
    prompt_version: str = "v1"
    # ✨ NEW: Hierarchy-based sampling
    sampling: str = "random"  # random | balanced | category | path
    category: Optional[str] = None  # e.g., "상품"
    path_prefix: Optional[str] = None  # e.g., "혜택 > 구매혜택"
```

2. `run_qa_generation()` 함수 매개변수 추가:
```python
def run_qa_generation(
    job_id: str,
    model: str,
    lang: str,
    samples: int,
    qa_per_doc: Optional[int],
    prompt_version: str,
    sampling: str = "random",
    category: Optional[str] = None,
    path_prefix: Optional[str] = None
) -> None:
    """지원하는 sampling 옵션:
    - random: 무작위 (기존)
    - category: Level 1 카테고리만 (e.g., "상품" → 536개 중 전수)
    - path: 특정 경로 하위만 (e.g., "혜택 > 구매혜택" → 2개 중 전수)
    - balanced: Level 1 분포 유지하면서 샘플링
    """
```

3. **필터링 헬퍼 함수 구현:**
```python
def filter_by_hierarchy(
    items: list,
    sampling: str,
    category: Optional[str] = None,
    path_prefix: Optional[str] = None
) -> list:
    """
    데이터를 계층 구조로 필터링
    
    Args:
        items: 원본 문서 리스트
        sampling: 샘플링 전략
        category: Level 1 필터 (e.g., "상품")
        path_prefix: 경로 필터 (e.g., "상품 > 모바일")
    
    Returns:
        필터링된 문서 리스트
    
    구현:
    - items[]에서 hierarchy 필드 확인
    - hierarchy.join(" > ") == path_prefix 또는
      hierarchy[0] == category 로 필터링
    - 일치하는 모든 문서 반환
    """
    if sampling == "random":
        return items  # No filtering
    
    if sampling == "category" and category:
        # Level 1만 매칭 (hierarchy[0] == category)
        return [item for item in items 
                if item.get("hierarchy", [])[0] == category]
    
    if sampling == "path" and path_prefix:
        # 전체 경로가 path_prefix로 시작하는지 확인
        target_path = path_prefix
        return [item for item in items
                if (" > ".join(item.get("hierarchy", [])) == target_path or
                    " > ".join(item.get("hierarchy", [])).startswith(target_path + " >"))]
    
    if sampling == "balanced":
        # representative_hierarchies.json 로드 후 분포유지하며 샘플링
        # TODO: 나중에 구현
        return items
    
    return items
```

**상태 메시지 개선:**
```python
job_manager.update_job(
    job_id,
    progress=10,
    message=f"Loaded {len(items)} documents (sampling={sampling})"
)
```

**config에 필터링 정보 포함:**
```json
{
  "config": {
    "model": "gemini-3.1-flash",
    "sampling": "path",
    "path_prefix": "혜택 > 구매혜택",
    "filtered_docs": 2,
    "samples": 2,
    ...
  }
}
```

---

### Step 2️⃣: 프론트엔드 Hierarchy Selector UI 추가

**파일:** `frontend/src/components/QAGenerationPanel.tsx`

**추가할 UI 섹션:**

```typescript
// QAGenerationPanel 내부, samples 선택 아래에 추가

<section className="border-t pt-4">
  <h3 className="text-sm font-semibold mb-3">📍 Hierarchy 선택 (선택사항)</h3>
  
  {/* Sampling Strategy */}
  <div className="space-y-2 mb-4">
    <label className="block text-xs font-medium">샘플링 전략</label>
    <div className="grid grid-cols-2 gap-2">
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input
          type="radio"
          name="sampling"
          value="random"
          checked={formValues.sampling === "random"}
          onChange={(e) => setFormValues({...formValues, sampling: e.target.value})}
        />
        <span>무작위 (전체)</span>
      </label>
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input
          type="radio"
          name="sampling"
          value="category"
          checked={formValues.sampling === "category"}
          onChange={(e) => setFormValues({...formValues, sampling: e.target.value})}
        />
        <span>카테고리</span>
      </label>
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input
          type="radio"
          name="sampling"
          value="path"
          checked={formValues.sampling === "path"}
          onChange={(e) => setFormValues({...formValues, sampling: e.target.value})}
        />
        <span>경로</span>
      </label>
      <label className="flex items-center gap-2 text-xs cursor-pointer">
        <input
          type="radio"
          name="sampling"
          value="balanced"
          checked={formValues.sampling === "balanced"}
          onChange={(e) => setFormValues({...formValues, sampling: e.target.value})}
        />
        <span>균형있게</span>
      </label>
    </div>
  </div>

  {/* Category Selector (if sampling === "category") */}
  {formValues.sampling === "category" && (
    <div className="space-y-2 mb-4">
      <label className="block text-xs font-medium">Level 1 카테고리</label>
      <select
        value={formValues.category || ""}
        onChange={(e) => setFormValues({...formValues, category: e.target.value})}
        className="w-full px-2 py-1 text-xs border rounded"
      >
        <option value="">선택하세요</option>
        <option value="상품">상품 (536개)</option>
        <option value="고객지원">고객지원 (302개)</option>
        <option value="Shop">Shop (168개)</option>
        <option value="혜택">혜택 (99개)</option>
        <option value="마이">마이 (1개)</option>
      </select>
    </div>
  )}

  {/* Path Selector (if sampling === "path") */}
  {formValues.sampling === "path" && (
    <div className="space-y-2 mb-4">
      <label className="block text-xs font-medium">계층 경로 (Depth 1-4)</label>
      
      {/* Level 1 */}
      <select
        value={selectedPath[0] || ""}
        onChange={(e) => handlePathChange(0, e.target.value)}
        className="w-full px-2 py-1 text-xs border rounded"
      >
        <option value="">Level 1 선택</option>
        <option value="상품">상품</option>
        <option value="고객지원">고객지원</option>
        <option value="Shop">Shop</option>
        <option value="혜택">혜택</option>
        <option value="마이">마이</option>
      </select>

      {/* Level 2 - 동적으로 Level 1 선택에 따라 옵션 결정 */}
      {selectedPath[0] && (
        <select
          value={selectedPath[1] || ""}
          onChange={(e) => handlePathChange(1, e.target.value)}
          className="w-full px-2 py-1 text-xs border rounded"
        >
          <option value="">Level 2 선택 (선택사항)</option>
          {/* getLevel2Options(selectedPath[0]).map(...) */}
        </select>
      )}

      {/* Level 3 */}
      {selectedPath[1] && (
        <select
          value={selectedPath[2] || ""}
          onChange={(e) => handlePathChange(2, e.target.value)}
          className="w-full px-2 py-1 text-xs border rounded"
        >
          <option value="">Level 3 선택 (선택사항)</option>
          {/* getLevel3Options(selectedPath[0], selectedPath[1]).map(...) */}
        </select>
      )}

      {/* Level 4 */}
      {selectedPath[2] && (
        <select
          value={selectedPath[3] || ""}
          onChange={(e) => handlePathChange(3, e.target.value)}
          className="w-full px-2 py-1 text-xs border rounded"
        >
          <option value="">Level 4 선택 (선택사항)</option>
          {/* getLevel4Options(...).map(...) */}
        </select>
      )}

      {/* 선택 경로 표시 */}
      <div className="text-xs bg-gray-50 p-2 rounded border">
        <span className="font-mono text-gray-600">
          {selectedPath.filter(p => p).join(" > ") || "경로 선택 중..."}
        </span>
      </div>
    </div>
  )}
</section>
```

**API 호출 수정:**
```typescript
const handleGenerate = async () => {
  const payload = {
    model: formValues.model,
    lang: formValues.lang,
    samples: formValues.samples,
    qa_per_doc: formValues.qaPerDoc,
    prompt_version: formValues.promptVersion,
    // ✨ NEW: Hierarchy parameters
    sampling: formValues.sampling || "random",
    category: formValues.category || null,
    path_prefix: selectedPath.filter(p => p).join(" > ") || null
  };
  
  // POST /api/generate with payload
};
```

**필요한 State 추가:**
```typescript
const [selectedPath, setSelectedPath] = useState<[string?, string?, string?, string?]>([]);

const handlePathChange = (level: number, value: string) => {
  const newPath = [...selectedPath];
  newPath[level] = value;
  // 더 깊은 레벨 초기화
  for (let i = level + 1; i < 4; i++) {
    newPath[i] = undefined;
  }
  setSelectedPath(newPath);
};
```

**동적 옵션 로딩:**
```typescript
// representative_hierarchies.json 로드 (앱 시작 시)
import hierarchyData from "../data/representative_hierarchies.json";

const getLevel2Options = (level1: string): string[] => {
  const categoryData = hierarchyData.by_level1[level1];
  return categoryData?.level2_distribution?.map(item => item.name) || [];
};
```

---

### Step 3️⃣: PIPELINE_DESIGN.md 하단에 계획 정리

✅ **완료** - 현재 섹션

---

## 📊 구현 우선순위

| 우선순위 | 작업 | 예상 시간 | 상태 |
|---------|------|---------|------|
| 🔴 HIGH | 백엔드: filter_by_hierarchy() 함수 | 1시간 | 📋 Planned |
| 🔴 HIGH | 백엔드: 생성 로직에 필터 통합 | 30분 | 📋 Planned |
| 🟡 MEDIUM | 프론트엔드: Hierarchy selector UI | 2시간 | 📋 Planned |
| 🟡 MEDIUM | 프론트엔드: representative_hierarchies.json 통합 | 1시간 | 📋 Planned |
| 🟢 LOW | 테스트 & 검증 | 1시간 | 📋 Planned |
| 🟢 LOW | Supabase 저장 기능 (Phase 2) | 2시간 | ⏸️ On Hold |

---

## 🎯 다음 액션

**즉시 시작 (Step 1):**
```bash
# 1. filter_by_hierarchy() 함수 구현
# 위치: backend/generation_api.py (154줄 이전)

# 2. 테스트
python3 -c "from backend.generation_api import filter_by_hierarchy; ..."
```

**그 다음 (Step 2):**
```bash
# 1. hierarchy selector UI 추가
# 위치: frontend/src/components/QAGenerationPanel.tsx

# 2. 테스트
npm run dev
```

---

## 📝 Reference Data

**representative_hierarchies.json에서 추출:**
```
혜택 > 구매혜택: 2개 문서
  ├─ 혜택 > 구매혜택 > 핸드폰가입쿠폰혜택 > 액세서리쿠폰
  └─ 혜택 > 구매혜택 > 핸드폰가입쿠폰혜택 > 쿠폰팩

상품 > 모바일: 203개 문서
  └─ 많은 하위 경로들...
```

**API 요청 예시:**
```json
POST /api/generate
{
  "model": "gemini-3.1-flash",
  "lang": "ko",
  "samples": 3,
  "sampling": "path",
  "path_prefix": "혜택 > 구매혜택"
}

응답:
{
  "status": "pending",
  "job_id": "gen_20260312_...",
  "config": {
    "sampling": "path",
    "path_prefix": "혜택 > 구매혜택",
    "filtered_docs": 2,
    "requested_samples": 3,
    "actual_samples": 2
  }
}
```

