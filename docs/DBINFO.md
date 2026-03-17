# 📊 Database Schema (Supabase)

> 최종 업데이트: 2026-03-17 (코드 기반 정확한 스키마)
> 스크립트: `backend/scripts/setup_vector_db.sql` (doc_chunks)
>           `backend/scripts/setup_qa_eval_tables.sql` (qa/eval 테이블)

---

## 테이블 목록

| 테이블 | SQL 정의 | 저장 위치 |
|--------|----------|-----------|
| `doc_chunks` | `setup_vector_db.sql` | `ingestion_api.py → save_doc_chunk()` |
| `evaluation_results` | `setup_qa_eval_tables.sql` | `pipeline.py → save_evaluation_to_supabase()` |
| `qa_generation_results` | `setup_qa_eval_tables.sql` | `generation_api.py → save_qa_generation_to_supabase()` |

뷰: `evaluation_qa_joined` — `evaluation_results` ↔ `qa_generation_results` LEFT JOIN

---

## 테이블 관계도

```
evaluation_results                    qa_generation_results
──────────────────                    ─────────────────────
id (uuid) PK ◄────────────────────── linked_evaluation_id (uuid, FK)
job_id (unique)                       job_id (unique)
metadata (jsonb)                      metadata (jsonb)
total_qa / valid_qa                   hierarchy (jsonb)
scores (jsonb)                        stats (jsonb)
final_score / final_grade             qa_list (jsonb)   ←── 문서결과 배열 (QA 중첩)
pipeline_results (jsonb)              created_at / updated_at
interpretation (jsonb)
created_at / updated_at

                                      qa_list[].docId ──────► doc_chunks.id
                                        (앱 레벨 참조, FK 없음)
doc_chunks
──────────
id (uuid) PK
content = raw_text (prefix 없는 순수 본문)
embedding = vector(1536), L2 정규화
metadata (jsonb)
  ├─ content_hash  ← 앱 레벨 중복 체크 (save_doc_chunk)
  └─ hierarchy_l1/l2/l3  ← apply-granular-tagging 후 추가
created_at
```

**FK**: `qa_generation_results.linked_evaluation_id → evaluation_results(id) ON DELETE SET NULL`
**앱 레벨 참조**: `qa_list[].docId → doc_chunks.id` (FK 없음)

---

## 1. `doc_chunks`

### 컬럼

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | `uuid PK` | `gen_random_uuid()` |
| `content` | `text NOT NULL` | 순수 청크 본문 (`raw_text`, prefix 없음) |
| `metadata` | `jsonb` | 청크 메타데이터 (하단 참조) |
| `embedding` | `vector(1536)` | Gemini Embedding 2, L2 정규화 |
| `created_at` | `timestamptz` | `now()` |

### `metadata` 내부 필드

| 키 | 타입 | 설명 |
|----|------|------|
| `filename` | string | 원본 파일명 |
| `document_id` | string | 파일별 UUID |
| `content_hash` | string | SHA-1 — 앱 레벨 중복 체크 기준 |
| `chunk_type` | string | `Heading` / `List` / `Table` / `Body` |
| `section_title` | string | 소속 섹션 제목 |
| `section_path` | string | 계층 경로 |
| `section_level` | int | 섹션 depth (1~4) |
| `page` | int | 페이지 번호 |
| `keywords` | string[] | top 5 키워드 |
| `char_length` | int | raw_text 문자 수 |
| `chunk_index` | int | 파일 내 순번 |
| `total_chunks` | int | 파일 전체 청크 수 |
| `source` | string | `pdf` / `docx` |
| `ingested_at` | string | ISO8601 |
| `embedding_model` | string | `gemini-embedding-2-preview` |
| `hierarchy_l1` | string | AI 태깅 L1 (tagging 후 추가) |
| `hierarchy_l2` | string | AI 태깅 L2 (tagging 후 추가) |
| `hierarchy_l3` | string | AI 태깅 L3 (선택적) |

### 인덱스 / RLS

| 인덱스 | 방식 | 용도 |
|--------|------|------|
| `idx_doc_chunks_hnsw` | HNSW (vector_cosine_ops) | 코사인 유사도 검색 |
| `idx_doc_chunks_created_at` | B-tree DESC | 최신순 정렬 |
| `idx_doc_chunks_metadata` | GIN | JSONB 필터 |

RLS: SELECT 전체 허용 / INSERT `auth.role() = 'authenticated'`

### RPC: `match_doc_chunks`

```sql
match_doc_chunks(query_embedding, match_threshold, match_count, filter jsonb)
RETURNS (id, content, metadata, similarity)
-- similarity = 1 - (embedding <=> query_embedding)
-- 현재 r_query 없는 경우 → get_doc_chunks_by_filter() 직접 select 사용
```

---

## 2. `evaluation_results`

> `pipeline.py:run_evaluation()` → `save_evaluation_to_supabase()` → INSERT

### 컬럼

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | `uuid PK` | |
| `job_id` | `text UNIQUE NOT NULL` | `eval_YYYYMMDD_HHMMSS_xxxxxx` |
| `created_at` | `timestamptz` | `now()` |
| `updated_at` | `timestamptz` | 트리거로 자동 갱신 |
| `metadata` | `jsonb NOT NULL` | 하단 참조 |
| `total_qa` | `int NOT NULL` | 전체 QA 수 |
| `valid_qa` | `int NOT NULL` | Syntax 통과 QA 수 |
| `scores` | `jsonb NOT NULL` | 4레이어 요약 점수 (하단 참조) |
| `final_score` | `float NOT NULL` | 0.0~1.0 종합 점수 |
| `final_grade` | `text NOT NULL` | `A+` / `A` / `B+` / `B` / `C` / `F` |
| `pipeline_results` | `jsonb NOT NULL` | 4레이어 전체 상세 결과 |
| `interpretation` | `jsonb` | 등급 설명 + 개선 권고 |

### `metadata` 구조

```json
{
  "evaluator_model": "gpt-5.1",
  "lang": "ko",
  "prompt_version": "v1"
}
```
> `generation_model`은 현재 코드에서 전달 안 함.  `lang`은 `"ko"` 하드코딩.

### `scores` 구조

```json
{
  "syntax": {
    "pass_rate": 100.0
  },
  "stats": {
    "quality_score": 8.04,
    "diversity": {
      "score": 7.5,
      "intent_type_count": 8,
      "doc_count": 1,
      "vocabulary_diversity": 0.92,
      "intent_balance": 0.8,
      "intent_distribution": {"factoid": 2, "numeric": 1, "...": "..."},
      "question_length": {"avg": 24.5, "std": 3.2},
      "answer_length":   {"avg": 68.1, "std": 12.0}
    },
    "duplication_rate": {
      "score": 10.0,
      "duplicate_count": 0,
      "near_duplicate_rate": 0.0
    }
  },
  "rag": {
    "avg_relevance":    0.85,
    "avg_groundedness": 0.92,
    "avg_clarity":      0.88,
    "avg_score":        0.88
  },
  "quality": {
    "avg_factuality":   0.90,
    "avg_completeness": 0.88,
    "avg_groundedness": 0.92,
    "avg_quality":      0.90
  }
}
```

### `final_score` 가중치 공식

```
final_score = (syntax_pass_rate/100)*0.2
            + (min(dataset_quality,10)/10)*0.2
            + rag_avg*0.3
            + quality_avg*0.3
```

### Check Constraints

```sql
CHECK (final_grade IN ('A+', 'A', 'B+', 'B', 'C', 'F'))
CHECK (final_score BETWEEN 0 AND 1)
CHECK (valid_qa <= total_qa)
```

### 인덱스 / RLS

| 인덱스 | 대상 |
|--------|------|
| `idx_eval_created_at` | `created_at DESC` |
| `idx_eval_final_grade` | `final_grade` |
| `idx_eval_final_score` | `final_score DESC` |
| `idx_eval_metadata_gin` | GIN on `metadata` |

RLS: SELECT / INSERT / UPDATE 모두 허용 (`true`)

---

## 3. `qa_generation_results`

> `generation_api.py:run_qa_generation_real()` → `save_qa_generation_to_supabase()` → INSERT
> `link_generation_to_evaluation()` → UPDATE `linked_evaluation_id`

### 컬럼

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | `uuid PK` | |
| `job_id` | `text UNIQUE NOT NULL` | `gen_YYYYMMDD_HHMMSS_xxxxxx` |
| `created_at` | `timestamptz` | `now()` |
| `updated_at` | `timestamptz` | 트리거로 자동 갱신 (`linked_evaluation_id` UPDATE 시) |
| `metadata` | `jsonb NOT NULL` | 하단 참조 |
| `hierarchy` | `jsonb NOT NULL` | 샘플링 정보 |
| `stats` | `jsonb NOT NULL` | 생성 통계 |
| `qa_list` | `jsonb NOT NULL` | 문서 결과 배열 (QA 중첩) |
| `linked_evaluation_id` | `uuid` | FK → `evaluation_results(id)` ON DELETE SET NULL |

### `metadata` 구조

```json
{
  "generation_model": "gpt-5.2",
  "lang": "en",
  "prompt_version": "v1"
}
```

### `hierarchy` 구조

```json
{
  "sampling": "random",
  "category": null,
  "path_prefix": null,
  "filtered_document_count": 1
}
```

### `stats` 구조

```json
{
  "total_qa": 8,
  "total_documents": 1,
  "total_tokens_input": 2450,
  "total_tokens_output": 980,
  "estimated_cost": 0.0184
}
```

### `qa_list` 구조 (중요: 중첩 구조)

```json
[
  {
    "docId":          "5bdff925-9432-45fe-92ec-86568cf72dd4",
    "hierarchy":      ["가이드 개요", "데이터 품질 전략", null],
    "text":           "청크 원문 (raw_text, prefix 없음)",
    "model":          "gpt-5.2",
    "provider":       "openai",
    "lang":           "en",
    "prompt_version": "v1",
    "raw":            "LLM 원본 응답 문자열",
    "input_tokens":   1234,
    "output_tokens":  567,
    "qa_list": [
      {"q": "질문", "a": "답변", "intent": "factoid", "answerable": true},
      {"q": "질문", "a": "답변", "intent": "numeric",  "answerable": true}
    ]
  }
]
```

### 인덱스 / RLS

| 인덱스 | 대상 |
|--------|------|
| `idx_qa_gen_created_at` | `created_at DESC` |
| `idx_qa_gen_linked_eval` | `linked_evaluation_id` |
| `idx_qa_gen_metadata_gin` | GIN on `metadata` |

RLS: SELECT / INSERT / UPDATE 모두 허용 (`true`)

---

## DB 초기화 SQL (재테스트 시)

```sql
DROP VIEW  IF EXISTS evaluation_qa_joined;
DELETE FROM qa_generation_results;
DELETE FROM evaluation_results;
DELETE FROM doc_chunks;
```

---

## 알려진 제약 사항

| 항목 | 현재 상태 | 비고 |
|------|-----------|------|
| `content_hash` 중복 방지 | 앱 레벨 SELECT→skip (`save_doc_chunk`) | DB UNIQUE constraint 없음 |
| `qa_list[].docId → doc_chunks.id` | 앱 레벨 참조만 | FK 없음 |
| `evaluation_results.metadata.generation_model` | 미전달 | 코드에서 추가 필요 시 pipeline.py 수정 |
| `evaluation_results.metadata.lang` | `"ko"` 하드코딩 | 실제 lang 파라미터 전달로 개선 필요 |
