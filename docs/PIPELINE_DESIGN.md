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

### 3️⃣ Layer 2: RAGTriadEvaluator (TruLens 기반)

- **목적**: RAG Triad 메트릭 평가 (TruLens로 레코딩)
- **비용**: ~$0.5/100QA (모델에 따라)
- **시간**: ~2분 (순차 처리)
- **모델**: 프론트에서 선택한 평가 모델 (claude-haiku, gpt-5.1, gemini-flash)
- **TruLens**: 각 QA 평가가 `TruApp`으로 레코딩되어 `default.sqlite`에 저장
- **Input**: valid QA만 (SyntaxValidator 통과)
- **Output**:
  ```json
  {
    "qa_scores": [
      {
        "relevance": 0.85,
        "groundedness": 0.92,
        "clarity": 0.88,
        "avg_score": 0.88
      }
    ],
    "summary": {
      "avg_relevance": 0.85,
      "avg_groundedness": 0.92,
      "avg_clarity": 0.88,
      "avg_score": 0.88
    }
  }
  ```

### 4️⃣ Layer 3: QAQualityEvaluator (멀티 프로바이더)

- **목적**: LLM CoT 기반 품질 평가
- **비용**: ~$0.8/100QA (모델에 따라)
- **시간**: ~5분
- **모델**: Layer 2와 **동일 모델** 사용 (일관성 확보)
- **지원 프로바이더**: OpenAI(gpt-5.1 등), Google(gemini-flash 등), Anthropic(claude-haiku 등)
- **Output**:
  ```json
  {
    "qa_scores": [
      {
        "factuality": 0.90,
        "completeness": 0.88,
        "groundedness": 0.92,
        "avg_quality": 0.90,
        "pass": true
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

1. ✅ **순차 실행**: Layer 1-A → 1-B → 2 → 3 순서대로
2. ✅ **유효한 QA만**: Layer 2, 3은 SyntaxValidator 통과한 QA만 평가
3. ✅ **비용 절감**: 구문 오류 QA는 비싼 LLM 평가에서 제외
4. ✅ **상태 추적**: 각 Layer별 진행 상황 추적
5. ✅ **선택 가능**: `layers` 파라미터로 필요한 Layer만 실행
6. ✅ **일관된 모델**: Layer 2, 3 모두 선택된 **동일 평가 모델** 사용
7. ✅ **멀티 프로바이더**: OpenAI / Google Gemini / Anthropic Claude 모두 지원
8. ✅ **TruLens 통합**: RAG Triad 평가가 TruApp으로 레코딩되어 리더보드 확인 가능
9. ✅ **Supabase 연동**: 생성/평가 결과 자동 저장 및 생성↔평가 연결

---

## 📋 구현 체크리스트

- [x] SyntaxValidator 구현
- [x] DatasetStats 구현
- [x] RAGTriadEvaluator 구현 (TruLens 통합)
- [x] QAQualityEvaluator 구현 (멀티 프로바이더)
- [x] 파이프라인 함수 작성 (`run_full_evaluation_pipeline`)
- [x] 상태 추적 로직 (`EvaluationManager`)
- [x] 결과 저장 (JSON + Supabase)
- [x] Supabase 생성/평가 연결 (`linked_evaluation_id`)
- [x] 모델 중앙 설정 (`backend/config/models.py`)
- [ ] 병렬 평가 처리 (ThreadPoolExecutor 적용 예정)
- [ ] 웹 대시보드 상세 뷰

---

# 🗄️ Supabase 저장 및 조회 아키텍처

## 📊 데이터베이스 스키마 (`docs/SUPABASE_SCHEMA.sql` 기준)

### `evaluation_results` 테이블

```sql
CREATE TABLE evaluation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT UNIQUE NOT NULL,

  -- 메타데이터 (JSONB)
  metadata JSONB NOT NULL,
  -- { "generation_model": "gemini-3.1-flash", "evaluator_model": "claude-haiku", "lang": "ko", "prompt_version": "v1" }

  total_qa   INT NOT NULL,
  valid_qa   INT NOT NULL,

  -- 4단계 점수 요약 (JSONB)
  scores JSONB NOT NULL,
  -- {
  --   "syntax":  { "pass_rate": 95.0 },
  --   "stats":   { "quality_score": 7.5, "diversity": {...}, "duplication_rate": {...} },
  --   "rag":     { "relevance": 0.85, "groundedness": 0.92, "clarity": 0.88, "avg_score": 0.88 },
  --   "quality": { "factuality": 0.90, "completeness": 0.88, "groundedness": 0.92, "avg_score": 0.90, "pass_rate": 84.2 }
  -- }

  final_score FLOAT NOT NULL,   -- 0-1
  final_grade TEXT NOT NULL,    -- A+, A, B+, B, C, F

  pipeline_results JSONB NOT NULL,  -- 4단계 전체 상세 결과
  interpretation   JSONB,           -- 해석 & 개선 추천사항

  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
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

### GET /api/results/ (평가 결과 상세)

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
CREATE TABLE qa_generation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id TEXT UNIQUE NOT NULL,

  -- 메타데이터 (JSONB)
  metadata JSONB NOT NULL,
  -- { "generation_model": "gemini-3.1-flash", "lang": "ko", "prompt_version": "v1" }

  -- Hierarchy 기반 샘플링 정보 (JSONB)
  hierarchy JSONB NOT NULL,
  -- { "sampling": "random", "category": null, "path_prefix": null, "filtered_document_count": 100 }

  -- 생성 통계 (JSONB)
  stats JSONB NOT NULL,
  -- { "total_qa": 100, "total_documents": 10, "total_tokens_input": 5000, "total_tokens_output": 2500, "estimated_cost": 0.45 }

  qa_list JSONB NOT NULL,             -- [{q, a, context, hierarchy, docId, intent, ...}]
  linked_evaluation_id UUID,          -- FK → evaluation_results(id)

  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- FK: evaluation_results 생성 후 추가
ALTER TABLE qa_generation_results
  ADD CONSTRAINT fk_qa_gen_to_eval
  FOREIGN KEY (linked_evaluation_id)
  REFERENCES evaluation_results(id) ON DELETE SET NULL;
```

### JOIN 뷰 (`evaluation_qa_joined`)

```sql
-- 생성 + 평가 결과 조인 뷰 (조회 편의용)
CREATE OR REPLACE VIEW evaluation_qa_joined AS
SELECT
  e.id as evaluation_id,
  e.final_grade,
  e.final_score,
  (q.metadata->>'generation_model') as generation_model,
  (e.metadata->>'evaluator_model')  as evaluator_model,
  (q.metadata->>'lang')             as lang,
  (e.scores->'rag'->>'avg_score')::FLOAT   as rag_avg_score,
  (e.scores->'quality'->>'avg_score')::FLOAT as quality_avg_score,
  e.created_at as eval_created_at
FROM evaluation_results e
LEFT JOIN qa_generation_results q ON e.id = q.linked_evaluation_id
ORDER BY e.created_at DESC;
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

### GET /api/generation/ (생성 결과 상세)

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

### 완료된 항목 ✅

- [x] `qa_generation_results` 테이블 생성 (JSONB 스키마)
- [x] `evaluation_results` 테이블 생성 (JSONB 스키마)
- [x] `linked_evaluation_id` FK 설정
- [x] `generation_api.py`: Supabase 저장 로직
- [x] `evaluation_api.py`: 생성-평가 연결 로직 (`link_generation_to_evaluation`)
- [x] `evaluation_qa_joined` JOIN 뷰 생성
- [x] RLS Policy (읽기/쓰기 권한)

### 진행 예정

- [ ] `GET /api/generation/{id}` 엔드포인트
- [ ] Evaluation Page에서 생성 정보 함께 표시
- [ ] 비교 분석 대시보드

---

## 📝 요약

| 항목                  | 설명                                         |
| --------------------- | -------------------------------------------- |
| **저장 타이밍** | QA 생성 완료 후 자동 저장                    |
| **저장 위치**   | `qa_generation_results` 테이블             |
| **데이터 연결** | 평가 완료 시 `linked_evaluation_id`로 연결 |
| **조회**        | Evaluation 페이지에서 함께 조회              |
| **데이터 형식** | JSON (전체 QA 배열)                          |
| **장점**        | 생성↔평가 추적, 완전한 이력 관리            |
| **비용**        | Supabase free tier (충분함)                  |

| 항목                  | 설명                              |
| --------------------- | --------------------------------- |
| **저장 타이밍** | 평가 파이프라인 완료 후 자동 저장 |
| **저장 위치**   | `evaluation_results` 테이블     |
| **조회 시점**   | Evaluation 페이지 로드 시         |
| **데이터 형식** | JSON (상세), 요약 (리스트)        |
| **보안**        | RLS, anon key 클라이언트 사용     |
| **장점**        | 영속성, 비교분석, 히스토리        |
| **비용**        | Supabase free tier (충분함)       |

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

| 우선순위  | 작업                                             | 예상 시간 | 상태         |
| --------- | ------------------------------------------------ | --------- | ------------ |
| 🔴 HIGH   | 백엔드: filter_by_hierarchy() 함수               | 1시간     | 📋 Planned   |
| 🔴 HIGH   | 백엔드: 생성 로직에 필터 통합                    | 30분      | 📋 Planned   |
| 🟡 MEDIUM | 프론트엔드: Hierarchy selector UI                | 2시간     | 📋 Planned   |
| 🟡 MEDIUM | 프론트엔드: representative_hierarchies.json 통합 | 1시간     | 📋 Planned   |
| 🟢 LOW    | 테스트 & 검증                                    | 1시간     | 📋 Planned   |
| 🟢 LOW    | Supabase 저장 기능 (Phase 2)                     | 2시간     | ⏸️ On Hold |

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

---

# 🗄️ Supabase 데이터 저장/조회 플로우

## 📊 전체 플로우 (Generation → Evaluation)

```
┌─────────────────────────────────────────────────────────────┐
│                  Frontend (QA Generation Panel)              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  [Models] [Language] [Samples] [Hierarchy Filter] [생성]    │
│                                                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────────┐
│              1️⃣ QA 생성 (generation_api.py)                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  • 문서 로딩 & 필터링 (sampling 전략)                        │
│  • LLM으로 QA 생성                                          │
│  • 결과 로컬 저장 (output/)                                 │
│                                                              │
│  결과:                                                       │
│  {                                                           │
│    "config": {...},                                         │
│    "statistics": {total_qa: 100, ...},                      │
│    "results": [{qa_list: [...]}]                            │
│  }                                                           │
│                                                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────────┐
│              2️⃣ Supabase 저장 (qa_generation_results)       │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  INSERT qa_generation_results {                             │
│    id: "uuid-001"         ← Supabase에서 자동 생성          │
│    job_id: "gen_20260312_...",                             │
│    generation_model: "gemini-3.1-flash",                   │
│    lang: "ko",                                             │
│    sampling: "path",                                       │
│    path_prefix: "혜택 > 구매혜택",                          │
│    filtered_document_count: 2,                             │
│    total_qa: 100,                                          │
│    qa_list: [{q, a, context, hierarchy, ...}],            │
│    linked_evaluation_id: NULL  ← 아직 평가 안함            │
│    created_at: now()                                       │
│  }                                                          │
│                                                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────────┐
│       3️⃣ 결과 반환 & UI 표시 (Frontend)                     │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ✓ 생성 완료!                                               │
│    • 모델: Gemini 3.1 Flash                                │
│    • 샘플링: 경로 (혜택 > 구매혜택)                         │
│    • QA 개수: 100개                                        │
│    • Supabase ID: uuid-001                                │
│                                                              │
│    [평가하기] ← 자동 또는 수동                              │
│                                                              │
│  gen_result_id = "uuid-001"  ← 저장                          │
│                                                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
          (autoEvaluate: YES인 경우)
                       ↓
┌─────────────────────────────────────────────────────────────┐
│              4️⃣ QA 평가 (evaluation_api.py)                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  Layer 1-A: SyntaxValidator (무료)                          │
│    └─ 구문 정확성 검증                                      │
│                                                              │
│  Layer 1-B: DatasetStats (무료)                             │
│    └─ 다양성, 중복도, 균형도 분석                           │
│                                                              │
│  Layer 2: RAGTriadEvaluator (선택 모델)                     │
│    └─ 관련성, 근거성, 명확성 평가                           │
│                                                              │
│  Layer 3: QAQualityEvaluator (선택 모델, CoT)              │
│    └─ 사실성, 완결성, 근거성 평가                           │
│                                                              │
│  결과:                                                       │
│  {                                                           │
│    "syntax": {valid: 95, invalid: 5, pass_rate: 95%},      │
│    "stats": {diversity: 0.85, duplication: 0.1, ...},      │
│    "rag": {avg_relevance: 0.85, ...},                      │
│    "quality": {avg_factuality: 0.90, pass_rate: 84.2%},   │
│    "final_score": 0.858,                                    │
│    "final_grade": "A"                                       │
│  }                                                           │
│                                                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────────┐
│            5️⃣ Supabase 저장 (evaluation_results)            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  INSERT evaluation_results {                                │
│    id: "uuid-002"         ← Supabase에서 자동 생성          │
│    job_id: "eval_20260312_...",                            │
│    generation_model: "gemini-3.1-flash",                   │
│    evaluator_model: "gpt-5.1",                             │
│    lang: "ko",                                             │
│    total_qa: 100,                                          │
│    valid_qa: 95,                                           │
│    syntax_pass_rate: 95.0,                                 │
│    dataset_quality_score: 7.52,                            │
│    rag_avg_score: 0.733,                                   │
│    quality_avg_score: 0.90,                                │
│    final_score: 0.858,                                     │
│    final_grade: "A",                                       │
│    pipeline_results: {...},  ← 4단계 전체 결과              │
│    created_at: now()                                       │
│  }                                                           │
│                                                              │
│  결과: eval_result_id = "uuid-002"                          │
│                                                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────────┐
│    6️⃣ 생성-평가 연결 (Supabase UPDATE)                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  UPDATE qa_generation_results                              │
│  SET linked_evaluation_id = "uuid-002"                     │
│  WHERE id = "uuid-001"                                     │
│                                                              │
│  결과: 생성과 평가가 1:1로 연결됨                            │
│                                                              │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────────┐
│     7️⃣ 평가 결과 표시 (Frontend Auto Navigate)              │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ✓ 평가 완료!                                               │
│    • 등급: A (85.8%)                                       │
│    • Syntax: 95.0%                                         │
│    • Dataset: 7.52/10                                      │
│    • RAG: 0.733                                            │
│    • Quality: 0.90                                         │
│                                                              │
│  [Evaluation Page로 이동] ← 자동 네비게이션                 │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                       │
                       ↓
┌─────────────────────────────────────────────────────────────┐
│       8️⃣ 평가 상세 페이지 (Evaluation Dashboard)            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  SELECT * FROM evaluation_qa_joined                         │
│  WHERE evaluation_id = "uuid-002"                           │
│                                                              │
│  결과: 생성 정보 + 평가 결과를 함께 표시                     │
│                                                              │
│  ┌──── QA 생성 정보 ────────────┐                           │
│  │ 모델: Gemini 3.1 Flash       │                           │
│  │ 샘플링: 경로                 │                           │
│  │ 필터: 혜택 > 구매혜택        │                           │
│  │ QA개수: 100개               │                           │
│  └──────────────────────────────┘                           │
│                                                              │
│  ┌──── 평가 결과 ────────────────┐                           │
│  │ 평가 모델: GPT-5.1           │                           │
│  │ 최종 등급: A (85.8%)         │                           │
│  │ 4단계 점수 그래프             │                           │
│  │ 개선 추천사항                │                           │
│  └──────────────────────────────┘                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 💾 데이터베이스 상태 변화

| Step | qa_generation_results              | evaluation_results        | 연결 상태      |
| ---- | ---------------------------------- | ------------------------- | -------------- |
| 1-2  | ✅ INSERT (id="uuid-001")          | ❌ 없음                   | ❌ NULL        |
| 3    | ✅ 저장됨                          | ❌ 없음                   | ❌ NULL        |
| 4-5  | ✅ 저장됨                          | ✅ INSERT (id="uuid-002") | ❌ 아직 미연결 |
| 6    | ✅ UPDATE (linked_eval="uuid-002") | ✅ 저장됨                 | ✅ 연결됨      |
| 7-8  | ✅ 검색 가능                       | ✅ 조회 가능              | ✅ JOIN 가능   |

## 🔌 API 통신 시퀀스

```python
# Frontend → Backend
1. POST /api/generate
   {
     "model": "gemini-3.1-flash",
     "sampling": "path",
     "path_prefix": "혜택 > 구매혜택",
     "samples": 3,
     "autoEvaluate": True
   }

# Backend Response (생성 완료)
2. GET /api/generation/job_id_123
   {
     "status": "completed",
     "result_id": "uuid-001",        ← Supabase ID
     "total_qa": 100,
     "config": {...}
   }

# Frontend 저장 → Backend 호출 (자동 평가)
3. POST /api/evaluate
   {
     "qa_generation_id": "uuid-001",
     "evaluator_model": "gpt-5.1",
     "layers": ["syntax", "stats", "rag", "quality"]
   }

# Backend Response (평가 완료)
4. GET /api/evaluation/job_id_456
   {
     "status": "completed",
     "result_id": "uuid-002",        ← Supabase ID
     "final_grade": "A",
     "final_score": 0.858,
     "pipeline_results": {...}
   }

# Backend 내부 (Supabase 연결)
5. UPDATE qa_generation_results
   SET linked_evaluation_id = "uuid-002"
   WHERE id = "uuid-001"

# Frontend 자동 네비게이션
6. GET /evaluation?gen_id=uuid-001&eval_id=uuid-002
```

## 📋 구현 체크리스트

### Backend (generation_api.py)

- [ ] `save_qa_generation_to_supabase()` 함수 구현
- [ ] `POST /api/generate` 완료 후 Supabase 저장
- [ ] Supabase ID를 클라이언트에 반환
- [ ] Error handling & logging

### Backend (evaluation_api.py)

- [ ] `save_evaluation_to_supabase()` 함수 구현
- [ ] `link_generation_to_evaluation()` 함수 구현
- [ ] 평가 완료 후 Supabase 저장
- [ ] 생성-평가 링크 자동 업데이트

### Frontend (QAGenerationPanel.tsx)

- [ ] 생성 결과의 Supabase ID 저장
- [ ] 평가 완료 시 자동 네비게이션
- [ ] 평가 결과 페이지로 전달

### Frontend (EvaluationPage.tsx)

- [ ] Supabase에서 평가 + 생성 데이터 함께 조회
- [ ] 생성 정보와 평가 결과 함께 표시
- [ ] JOIN 뷰(evaluation_qa_joined) 활용

---

## � Supabase 데이터베이스 스키마

### TABLE 1: `qa_generation_results` (QA 생성 결과)

| 컬럼명                   | 타입      | 설명                                                                                     |
| ------------------------ | --------- | ---------------------------------------------------------------------------------------- |
| `id`                   | UUID      | Primary Key (자동 생성)                                                                  |
| `job_id`               | TEXT      | 생성 작업 ID (고유)                                                                      |
| `metadata`             | JSONB     | `{generation_model, lang, prompt_version}`                                             |
| `hierarchy`            | JSONB     | `{sampling, category, path_prefix, filtered_document_count}`                           |
| `stats`                | JSONB     | `{total_qa, total_documents, total_tokens_input, total_tokens_output, estimated_cost}` |
| `qa_list`              | JSONB     | 전체 QA 배열:`[{q, a, context, hierarchy, docId, ...}]`                                |
| `linked_evaluation_id` | UUID      | 평가 결과 링크 (NULL until evaluated)                                                    |
| `created_at`           | TIMESTAMP | 생성 시간                                                                                |
| `updated_at`           | TIMESTAMP | 수정 시간                                                                                |

**인덱스:**

- `idx_qa_gen_created_at` (created_at DESC)
- `idx_qa_gen_job_id` (job_id)
- `idx_qa_gen_linked_eval` (linked_evaluation_id)
- `idx_qa_gen_metadata_model` (JSONB GIN)
- `idx_qa_gen_hierarchy_sampling` (JSONB GIN)

### TABLE 2: `evaluation_results` (평가 결과)

| 컬럼명               | 타입      | 설명                                                          |
| -------------------- | --------- | ------------------------------------------------------------- |
| `id`               | UUID      | Primary Key (자동 생성)                                       |
| `job_id`           | TEXT      | 평가 작업 ID (고유)                                           |
| `metadata`         | JSONB     | `{generation_model, evaluator_model, lang, prompt_version}` |
| `total_qa`         | INT       | 전체 QA 개수                                                  |
| `valid_qa`         | INT       | 유효한 QA 개수                                                |
| `scores`           | JSONB     | 4단계 점수 요약 (아래 참고)                                   |
| `final_score`      | FLOAT     | 최종 종합 점수 (0-1)                                          |
| `final_grade`      | TEXT      | 최종 등급 (A+, A, B+, B, C, F)                                |
| `pipeline_results` | JSONB     | 4단계 전체 평가 결과 (상세)                                   |
| `interpretation`   | JSONB     | 해석 & 개선 추천사항                                          |
| `created_at`       | TIMESTAMP | 평가 시간                                                     |
| `updated_at`       | TIMESTAMP | 수정 시간                                                     |

**4단계 점수 구조 (scores JSONB):**

```json
{
  "syntax": {
    "pass_rate": 95.0
  },
  "stats": {
    "quality_score": 7.5,
    "diversity": 0.85,
    "duplication_rate": 0.1
  },
  "rag": {
    "relevance": 0.85,
    "groundedness": 0.92,
    "clarity": 0.88,
    "avg_score": 0.88
  },
  "quality": {
    "factuality": 0.90,
    "completeness": 0.88,
    "groundedness": 0.92,
    "avg_score": 0.90,
    "pass_rate": 84.2
  }
}
```

**인덱스:**

- `idx_evaluation_created_at` (created_at DESC)
- `idx_evaluation_final_grade` (final_grade)
- `idx_evaluation_job_id` (job_id)
- `idx_evaluation_final_score` (final_score DESC)
- `idx_evaluation_metadata` (JSONB GIN)
- `idx_evaluation_scores_*` (JSONB GIN - syntax, stats, rag, quality)

### VIEW: `evaluation_qa_joined`

생성 결과와 평가 결과를 함께 조회하는 조인 뷰:

```sql
SELECT
  e.id as evaluation_id,
  e.job_id as eval_job_id,
  e.final_grade, e.final_score,
  
  q.id as qa_generation_id,
  q.job_id as gen_job_id,
  (q.metadata->>'generation_model') as generation_model,
  (e.metadata->>'evaluator_model') as evaluator_model,
  (q.metadata->>'lang') as lang,
  q.total_qa,
  (q.hierarchy->>'sampling') as sampling,
  
  -- 점수 추출
  (e.scores->'syntax'->>'pass_rate')::FLOAT as syntax_pass_rate,
  (e.scores->'stats'->>'quality_score')::FLOAT as dataset_quality_score,
  (e.scores->'rag'->>'avg_score')::FLOAT as rag_avg_score,
  (e.scores->'quality'->>'avg_score')::FLOAT as quality_avg_score
FROM evaluation_results e
LEFT JOIN qa_generation_results q ON e.id = q.linked_evaluation_id
ORDER BY e.created_at DESC
```

### 데이터 흐름 (Data Flow)

```
1. QA 생성 (generation_api.py)
   ↓
2. INSERT qa_generation_results (id=uuid-001, job_id="gen_123")
   ↓
3. 사용자 결과 확인 후 평가 결정
   ↓
4. 4단계 평가 파이프라인 실행
   ↓
5. INSERT evaluation_results (id=uuid-002, job_id="eval_456")
   ↓
6. UPDATE qa_generation_results SET linked_evaluation_id = uuid-002
   ↓
7. 평가 결과 페이지: evaluation_qa_joined 뷰에서 JOIN해서 함께 조회
```

### FK 관계

```
qa_generation_results.linked_evaluation_id 
  → evaluation_results.id (ON DELETE SET NULL)
```

**특징:**

- Soft FK: 생성 후 평가하기 전까지는 NULL
- 평가 후 UPDATE로 링크 설정
- DELETE 시 NULL로 설정 (고아 데이터 방지)

---

## 🀽 배포 전 확인사항

✅ Supabase 프로젝트 생성
✅ SQL Schema 적용 (SUPABASE_SCHEMA.sql)
✅ 환경변수 설정 (.env, .env.local)
✅ RLS 정책 확인
✅ API Keys 설정
✅ 로컬 테스트 완료
✅ CI/CD 설정 (GitHub Actions)
