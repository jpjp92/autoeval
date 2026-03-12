# Supabase Client Implementation Guide

Supabase를 통한 QA 생성 및 평가 결과 저장/조회 구현 가이드

## 📦 설치

### Python
```bash
pip install supabase
```

### JavaScript/TypeScript
```bash
npm install @supabase/supabase-js
```

---

## 🐍 Python Implementation

### 1️⃣ Initialization

```python
from supabase import create_client, Client
import os
from datetime import datetime
import json

# 초기화
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
```

### 2️⃣ QA 생성 결과 저장

```python
async def save_qa_generation_to_supabase(
    job_id: str,
    result_filename: str,
    generation_model: str,
    lang: str,
    qa_list: list,
    sampling: str = "random",
    category: Optional[str] = None,
    path_prefix: Optional[str] = None,
    filtered_document_count: int = 0,
    total_documents: int = 0,
    total_tokens_input: int = 0,
    total_tokens_output: int = 0,
    estimated_cost: float = 0.0
) -> dict:
    """
    QA 생성 결과를 Supabase에 저장
    
    Args:
        job_id: 생성 작업 ID (gen_20260312_...)
        result_filename: 저장 파일명
        generation_model: 사용 모델 (gemini-3.1-flash, etc)
        lang: 언어 (ko, en)
        qa_list: [{q, a, context, hierarchy, docId, ...}]
        sampling: 샘플링 전략
        ... 기타
    
    Returns:
        {success: bool, id: uuid, error: str}
    """
    try:
        data = {
            "job_id": job_id,
            "result_filename": result_filename,
            "generation_model": generation_model,
            "lang": lang,
            "sampling": sampling,
            "category": category,
            "path_prefix": path_prefix,
            "filtered_document_count": filtered_document_count,
            "total_qa": len(qa_list),
            "total_documents": total_documents,
            "total_tokens_input": total_tokens_input,
            "total_tokens_output": total_tokens_output,
            "estimated_cost": estimated_cost,
            "qa_list": qa_list  # JSONB
        }
        
        response = supabase.table("qa_generation_results").insert(data).execute()
        
        logger.info(f"✓ QA generation saved to Supabase: {response.data[0]['id']}")
        return {
            "success": True,
            "id": response.data[0]['id'],
            "data": response.data[0]
        }
    
    except Exception as e:
        logger.error(f"✗ Failed to save QA generation: {e}")
        return {
            "success": False,
            "error": str(e)
        }
```

### 3️⃣ 평가 결과 저장

```python
async def save_evaluation_to_supabase(
    job_id: str,
    result_filename: str,
    generation_model: str,
    evaluator_model: str,
    lang: str,
    total_qa: int,
    valid_qa: int,
    pipeline_results: dict,  # {syntax, stats, rag, quality}
    interpretation: dict = None
) -> dict:
    """
    4단계 평가 결과를 Supabase에 저장
    
    Args:
        job_id: 평가 작업 ID (eval_20260312_...)
        pipeline_results: {
            "syntax": {...},
            "stats": {...},
            "rag": {...},
            "quality": {...}
        }
    
    Returns:
        {success: bool, id: uuid, error: str}
    """
    try:
        # 점수 계산
        syntax_result = pipeline_results.get("syntax", {})
        stats_result = pipeline_results.get("stats", {})
        rag_result = pipeline_results.get("rag", {})
        quality_result = pipeline_results.get("quality", {})
        
        # 최종 등급 결정
        final_score = calculate_final_score(
            syntax_result.get("pass_rate", 0) / 100,
            stats_result.get("integrated_score", 0) / 10,
            rag_result.get("summary", {}).get("avg_clarity", 0),
            quality_result.get("summary", {}).get("avg_quality", 0)
        )
        final_grade = get_grade_from_score(final_score)
        
        data = {
            "job_id": job_id,
            "result_filename": result_filename,
            "generation_model": generation_model,
            "evaluator_model": evaluator_model,
            "lang": lang,
            "total_qa": total_qa,
            "valid_qa": valid_qa,
            
            # Layer 1-A
            "syntax_pass_rate": syntax_result.get("pass_rate", 0),
            
            # Layer 1-B
            "dataset_quality_score": stats_result.get("integrated_score", 0),
            "dataset_diversity": stats_result.get("diversity_score", 0),
            "dataset_duplication_rate": stats_result.get("duplication_rate", 0),
            
            # Layer 2
            "rag_avg_relevance": rag_result.get("summary", {}).get("avg_relevance", 0),
            "rag_avg_groundedness": rag_result.get("summary", {}).get("avg_groundedness", 0),
            "rag_avg_clarity": rag_result.get("summary", {}).get("avg_clarity", 0),
            "rag_avg_score": rag_result.get("summary", {}).get("avg_clarity", 0),
            
            # Layer 3
            "quality_avg_factuality": quality_result.get("summary", {}).get("avg_factuality", 0),
            "quality_avg_completeness": quality_result.get("summary", {}).get("avg_completeness", 0),
            "quality_avg_groundedness": quality_result.get("summary", {}).get("avg_groundedness", 0),
            "quality_avg_score": quality_result.get("summary", {}).get("avg_quality", 0),
            "quality_pass_rate": quality_result.get("summary", {}).get("pass_rate", 0),
            
            # Final
            "final_score": final_score,
            "final_grade": final_grade,
            "pipeline_results": pipeline_results,
            "interpretation": interpretation
        }
        
        response = supabase.table("evaluation_results").insert(data).execute()
        
        logger.info(f"✓ Evaluation saved to Supabase: {response.data[0]['id']}")
        return {
            "success": True,
            "id": response.data[0]['id'],
            "data": response.data[0]
        }
    
    except Exception as e:
        logger.error(f"✗ Failed to save evaluation: {e}")
        return {
            "success": False,
            "error": str(e)
        }
```

### 4️⃣ 평가 결과 조회

```python
# 최근 평가 목록 조회
def get_recent_evaluations(limit: int = 20, offset: int = 0):
    response = supabase.table("evaluation_results").select(
        "id, job_id, generation_model, evaluator_model, total_qa, "
        "valid_qa, final_grade, final_score, created_at"
    ).order("created_at", desc=True).limit(limit).offset(offset).execute()
    return response.data

# 특정 평가 상세 조회
def get_evaluation_detail(evaluation_id: str):
    response = supabase.table("evaluation_results").select("*").eq(
        "id", evaluation_id
    ).single().execute()
    return response.data

# 평가-생성 함께 조회 (뷰 사용)
def get_evaluation_with_qa(evaluation_id: str):
    response = supabase.table("evaluation_qa_joined").select(
        "*"
    ).eq("evaluation_id", evaluation_id).single().execute()
    return response.data
```

### 5️⃣ QA 생성과 평가 연결

```python
async def link_generation_to_evaluation(
    qa_generation_id: str,
    evaluation_id: str
) -> dict:
    """
    생성 결과와 평가 결과를 연결
    """
    try:
        response = supabase.table("qa_generation_results").update({
            "linked_evaluation_id": evaluation_id
        }).eq("id", qa_generation_id).execute()
        
        logger.info(f"✓ Linked generation to evaluation: {qa_generation_id} → {evaluation_id}")
        return {"success": True}
    
    except Exception as e:
        logger.error(f"✗ Failed to link: {e}")
        return {"success": False, "error": str(e)}
```

---

## 🔧 TypeScript Implementation

### 1️⃣ Initialization

```typescript
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.REACT_APP_SUPABASE_ANON_KEY!;

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

### 2️⃣ QA 생성 결과 저장

```typescript
interface QAGenerationData {
  job_id: string;
  result_filename: string;
  generation_model: string;
  lang: 'ko' | 'en';
  sampling: 'random' | 'category' | 'path' | 'balanced';
  category?: string;
  path_prefix?: string;
  filtered_document_count?: number;
  total_qa: number;
  total_documents: number;
  total_tokens_input?: number;
  total_tokens_output?: number;
  estimated_cost?: number;
  qa_list: any[];
}

async function saveQAGenerationToSupabase(data: QAGenerationData) {
  try {
    const { data: result, error } = await supabase
      .from('qa_generation_results')
      .insert([data])
      .select();
    
    if (error) throw error;
    
    console.log('✓ QA generation saved:', result[0].id);
    return { success: true, id: result[0].id, data: result[0] };
  } catch (error) {
    console.error('✗ Failed to save QA generation:', error);
    return { success: false, error: error.message };
  }
}
```

### 3️⃣ 평가 결과 저장

```typescript
interface EvaluationData {
  job_id: string;
  result_filename: string;
  generation_model: string;
  evaluator_model: string;
  lang: 'ko' | 'en';
  total_qa: number;
  valid_qa: number;
  syntax_pass_rate: number;
  dataset_quality_score: number;
  rag_avg_relevance: number;
  rag_avg_groundedness: number;
  rag_avg_clarity: number;
  rag_avg_score: number;
  quality_avg_factuality: number;
  quality_avg_completeness: number;
  quality_avg_groundedness: number;
  quality_avg_score: number;
  quality_pass_rate: number;
  final_score: number;
  final_grade: 'A+' | 'A' | 'B+' | 'B' | 'C' | 'F';
  pipeline_results: object;
  interpretation?: object;
}

async function saveEvaluationToSupabase(data: EvaluationData) {
  try {
    const { data: result, error } = await supabase
      .from('evaluation_results')
      .insert([data])
      .select();
    
    if (error) throw error;
    
    console.log('✓ Evaluation saved:', result[0].id);
    return { success: true, id: result[0].id, data: result[0] };
  } catch (error) {
    console.error('✗ Failed to save evaluation:', error);
    return { success: false, error: error.message };
  }
}
```

### 4️⃣ 평가 결과 조회

```typescript
// 최근 평가 목록
async function getRecentEvaluations(limit = 20, offset = 0) {
  const { data, error } = await supabase
    .from('evaluation_results')
    .select(
      'id, job_id, generation_model, evaluator_model, ' +
      'total_qa, valid_qa, final_grade, final_score, created_at'
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  
  if (error) throw error;
  return data;
}

// 특정 평가 상세
async function getEvaluationDetail(evaluationId: string) {
  const { data, error } = await supabase
    .from('evaluation_results')
    .select('*')
    .eq('id', evaluationId)
    .single();
  
  if (error) throw error;
  return data;
}

// 평가와 생성 함께 조회
async function getEvaluationWithQA(evaluationId: string) {
  const { data, error } = await supabase
    .from('evaluation_qa_joined')
    .select('*')
    .eq('evaluation_id', evaluationId)
    .single();
  
  if (error) throw error;
  return data;
}
```

### 5️⃣ 생성과 평가 연결

```typescript
async function linkGenerationToEvaluation(
  qaGenerationId: string,
  evaluationId: string
) {
  try {
    const { data, error } = await supabase
      .from('qa_generation_results')
      .update({ linked_evaluation_id: evaluationId })
      .eq('id', qaGenerationId)
      .select();
    
    if (error) throw error;
    
    console.log('✓ Linked generation to evaluation');
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('✗ Failed to link:', error);
    return { success: false, error: error.message };
  }
}
```

---

## 📝 Backend Integration Points

### evaluation_api.py에 추가

```python
# 평가 완료 후
eval_result = await run_full_evaluation_pipeline(...)

# Supabase 저장
supabase_result = await save_evaluation_to_supabase(
    job_id=job_id,
    result_filename=eval_result['result_filename'],
    generation_model=...,
    evaluator_model=...,
    lang=...,
    total_qa=eval_result['metadata']['total_qa'],
    valid_qa=eval_result['metadata']['valid_qa'],
    pipeline_results=eval_result['pipeline_results'],
    interpretation=eval_result.get('interpretation')
)

if supabase_result['success']:
    # 생성과 평가 연결
    await link_generation_to_evaluation(
        qa_generation_id=gen_result_id,  # 생성 단계에서 받은 ID
        evaluation_id=supabase_result['id']
    )
```

### generation_api.py에 추가

```python
# QA 생성 완료 후
result = run_qa_generation(...)

# Supabase 저장
gen_result = await save_qa_generation_to_supabase(
    job_id=job_id,
    result_filename=...,
    generation_model=model,
    lang=lang,
    qa_list=qa_list,
    sampling=sampling,
    category=category,
    path_prefix=path_prefix,
    ...
)

# 클라이언트에 ID 반환
return {
    "status": "completed",
    "result_id": gen_result['id'],  # Supabase ID
    "result_file": result_filename
}
```

---

## 🔒 Security Best Practices

1. **API Keys 관리:**
   - SUPABASE_URL, SUPABASE_KEY는 환경변수로
   - Anon key는 클라이언트에서 사용 (제한된 권한)
   - Service role key는 서버에서만 사용

2. **RLS (Row Level Security):**
   - 읽기: 공개 (모든 사용자)
   - 쓰기: 인증된 사용자만
   - 이미 SCHEMA.sql에 정책 설정됨

3. **Rate Limiting:**
   - Supabase free tier: 500,000요청/월
   - 프로덕션: 선택적 rate limiting 미들웨어 추가

---

## 📊 Monitoring

```typescript
// 평가 통계 조회
async function getEvaluationStats() {
  const { data } = await supabase
    .from('evaluation_results')
    .select('final_grade, COUNT(*)')
    .group_by('final_grade');
  
  return data;  // {grade: 'A+', count: 5}, ...
}

// 모델별 성능 비교
async function compareModels() {
  const { data } = await supabase
    .from('evaluation_results')
    .select('generation_model, evaluator_model, AVG(final_score)')
    .group_by('generation_model', 'evaluator_model');
  
  return data;
}
```
