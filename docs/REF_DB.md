# DB Schema

## Tables

### `doc_chunks` — PDF 청크 + 벡터

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid PK | `gen_random_uuid()` |
| `content` | text NOT NULL | 청크 텍스트 |
| `metadata` | jsonb DEFAULT '{}' | 구조 메타데이터 (아래 참고) |
| `embedding` | vector(1536) | Gemini Embedding 2 벡터 (HNSW 2000차원 제한으로 1536 설정) |
| `created_at` | timestamptz | 기본값 `now()` |

**metadata JSONB 키**

| 키 | 설명 |
|----|------|
| `doc_name` | 원본 파일명 |
| `page` | 페이지 번호 |
| `chunk_type` | `body` \| `heading` \| `table` \| `list` \| `colophon` |
| `section_path` | 계층 경로 (`"섹션 > 소섹션"`) |
| `keywords` | 추출 키워드 목록 |
| `content_hash` | SHA-1 중복 제거용 |
| `ingested_at` | 수집 ISO 타임스탬프 |
| `hierarchy_h1` | H1 대분류 (태깅 후 업데이트) |
| `hierarchy_h2` | H2 중분류 |
| `hierarchy_h3` | H3 소분류 |

**인덱스**
- `idx_doc_chunks_hnsw` — HNSW 벡터 인덱스 (cosine ops)
- `idx_doc_chunks_created_at` — 생성일 DESC
- `idx_doc_chunks_metadata` — JSONB GIN 인덱스

---

### `qa_gen_results` — QA 생성 결과

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid PK | |
| `job_id` | text UNIQUE | `gen_YYYYMMDD_HHMMSS_μs` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `metadata` | jsonb | 생성 설정 정보 |
| `hierarchy` | jsonb | H1/H2/H3 필터 정보 |
| `stats` | jsonb | 토큰/비용 통계 |
| `qa_list` | jsonb | 생성된 QA 배열 |
| `linked_evaluation_id` | uuid FK | `qa_eval_results.id` 연결 |

**metadata JSONB**
```json
{
  "generation_model": "gemini-3.1-flash",
  "lang": "ko",
  "prompt_version": "v1",
  "source_doc": "파일명.pdf"
}
```

**stats JSONB**
```json
{
  "total_qa": 8,
  "total_documents": 1,
  "total_tokens_input": 2450,
  "total_tokens_output": 980,
  "estimated_cost": 0.0184
}
```

**qa_list JSONB 구조** (배열)
```json
[
  {
    "docId": "uuid",
    "hierarchy": ["H1명", "H2명", "H3명"],
    "text": "청크 원문",
    "model": "gemini-3.1-flash",
    "provider": "google",
    "input_tokens": 1234,
    "output_tokens": 567,
    "qa_list": [
      { "q": "질문", "a": "답변", "intent": "factual", "answerable": true }
    ]
  }
]
```

**인덱스**
- `idx_qa_gen_created_at` — 생성일 DESC
- `idx_qa_gen_linked_eval` — FK 인덱스
- `idx_qa_gen_metadata_gin` — JSONB GIN

---

### `qa_eval_results` — 4레이어 평가 결과

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid PK | |
| `job_id` | text UNIQUE | `eval_YYYYMMDD_HHMMSS_μs` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `metadata` | jsonb | 평가 설정 |
| `total_qa` | int | 전체 QA 수 |
| `valid_qa` | int | 유효 QA 수 |
| `scores` | jsonb | 레이어별 점수 요약 |
| `final_score` | float | 0–1 최종 점수 |
| `final_grade` | text | `A+` \| `A` \| `B+` \| `B` \| `C` \| `F` |
| `pipeline_results` | jsonb | 레이어별 상세 결과 |
| `interpretation` | jsonb | LLM 생성 개선 권고 |

**제약 조건**
- `chk_grade`: `final_grade IN ('A+','A','B+','B','C','F')`
- `chk_final_score`: `final_score BETWEEN 0 AND 1`

**scores JSONB 구조**
```json
{
  "syntax":  { "pass_rate": 100.0 },
  "stats":   { "quality_score": 8.04, "diversity": {...}, "duplication_rate": {...} },
  "rag":     { "avg_relevance": 0.85, "avg_groundedness": 0.92, "avg_clarity": 0.88, "avg_score": 0.88 },
  "quality": { "avg_factuality": 0.90, "avg_completeness": 0.88, "avg_specificity": 0.92, "avg_conciseness": 0.88, "avg_quality": 0.90 }
}
```

**인덱스**
- `idx_eval_created_at` — 생성일 DESC
- `idx_eval_final_grade` — 등급 조회
- `idx_eval_final_score` — 점수 DESC
- `idx_eval_metadata_gin` — JSONB GIN

---

## RPC Functions

### `get_eval_qa_scores(p_eval_id uuid)` — export 최적화

`pipeline_results` JSONB 전체 전송 없이 `qa_scores`만 추출 반환.
`export-by-id` 엔드포인트에서 사용.

```sql
CREATE OR REPLACE FUNCTION get_eval_qa_scores(p_eval_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'rag_qa_scores',     COALESCE(pipeline_results->'layers'->'rag'->'qa_scores',     '[]'::jsonb),
    'quality_qa_scores', COALESCE(pipeline_results->'layers'->'quality'->'qa_scores', '[]'::jsonb)
  )
  FROM qa_eval_results
  WHERE id = p_eval_id;
$$;
```

---

## Supabase RLS

| 테이블 | SELECT | INSERT | UPDATE |
|--------|--------|--------|--------|
| `doc_chunks` | 모두 허용 | 인증 필요 | — |
| `qa_gen_results` | 모두 허용 | 모두 허용 | 모두 허용 |
| `qa_eval_results` | 모두 허용 | 모두 허용 | 모두 허용 |
