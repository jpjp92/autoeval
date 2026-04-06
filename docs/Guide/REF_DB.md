<!--
파일: REF_DB.md
설명: Supabase(PostgreSQL + pgvector) DB 스키마 정의. 테이블 구조(doc_metadata·doc_chunks·qa_generation_results·qa_evaluation_scores), FK 관계, 인덱스, RPC 함수 목록 포함.
업데이트: 2026-04-06
-->
# DB Schema

> **최종 업데이트**: 2026-04-06 — Option B FK 마이그레이션 완료 / 스키마 정확도 검증

---

## Tables

### `doc_metadata` — 문서 단위 메타

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid PK | `gen_random_uuid()` |
| `document_id` | text UNIQUE NOT NULL | 인제스션 시 생성된 UUID (논리 키) |
| `filename` | text NOT NULL | 원본 파일명 |
| `domain_profile` | jsonb | `{ domain, domain_short, target_audience, key_terms, tone, intent_hints }` |
| `h2_h3_master` | jsonb | `{ "H1명": { "H2명": ["H3", ...] } }` |
| `created_at` | timestamptz | `now()` |
| `updated_at` | timestamptz | `now()` (트리거 자동 갱신) |

**인덱스**
- `idx_doc_metadata_filename` — filename 조회

**비고**
- `/api/ingestion/upload` 시 `document_id + filename`으로 최소 row 선점 (FK 충족용)
- `/api/ingestion/analyze-hierarchy` 시 `domain_profile`, `h2_h3_master` upsert
- ON CONFLICT (document_id) DO UPDATE 방식

---

### `doc_chunks` — PDF/DOCX 청크 + 벡터

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid PK | `gen_random_uuid()` |
| `content` | text NOT NULL | 청크 텍스트 |
| `metadata` | jsonb DEFAULT '{}' | 구조 메타데이터 (아래 참고) |
| `embedding` | vector(1536) | Gemini Embedding 2 벡터 (`output_dimensionality=1536`) |
| `created_at` | timestamptz | `now()` |
| `document_id` | text FK | → `doc_metadata.document_id` (ON DELETE SET NULL) |

**metadata JSONB 키**

| 키 | 설명 |
|----|------|
| `filename` | 원본 파일명 |
| `document_id` | 인제스션 UUID (전용 컬럼과 동일 값 — 하위 호환용 중복 저장) |
| `page` | 페이지 번호 |
| `chunk_type` | `body` \| `heading` \| `table` \| `list` \| `colophon` |
| `section_path` | 계층 경로 (`"섹션 > 소섹션"`) |
| `content_hash` | SHA-1 중복 제거용 |
| `chunk_index` | 청크 순서 인덱스 |
| `total_chunks` | 해당 문서 전체 청크 수 |
| `chunking_method` | `llm` \| `rule` |
| `ingested_at` | 수집 ISO 타임스탬프 |
| `embedding_model` | 임베딩 모델명 |
| `hierarchy_h1` | H1 대분류 (Pass3 태깅 후 업데이트) |
| `hierarchy_h2` | H2 중분류 |
| `hierarchy_h3` | H3 소분류 |

**인덱스**
- `idx_doc_chunks_hnsw` — HNSW 벡터 인덱스 (cosine ops)
- `idx_doc_chunks_created_at` — 생성일 DESC
- `idx_doc_chunks_metadata` — JSONB GIN 인덱스
- `idx_doc_chunks_document_id` — document_id 전용 컬럼 인덱스

**FK 제약**
- `fk_doc_chunks_metadata` — `document_id` → `doc_metadata.document_id` ON DELETE SET NULL

---

### `qa_gen_results` — QA 생성 결과

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | uuid PK | |
| `job_id` | text UNIQUE | `gen_YYYYMMDD_HHMMSS_μs` |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |
| `source_doc` | text | 파일명 |
| `doc_chunk_ids` | text[] | 생성에 사용된 청크 UUID 배열 |
| `metadata` | jsonb | 생성 설정 정보 |
| `hierarchy` | jsonb | H1/H2/H3 필터 정보 |
| `stats` | jsonb | 토큰/비용 통계 |
| `qa_list` | jsonb | 생성된 QA 배열 |
| `linked_evaluation_id` | uuid FK | → `qa_eval_results.id` |
| `document_id` | text FK | → `doc_metadata.document_id` (ON DELETE SET NULL) |

**metadata JSONB**
```json
{
  "generation_model": "gemini-3.1-flash",
  "lang": "ko",
  "prompt_version": "v1",
  "source_doc": "파일명.pdf",
  "document_id": "uuid"
}
```

**qa_list JSONB 구조** (배열)
```json
[
  {
    "docId": "uuid",
    "hierarchy": ["H1명", "H2명", null],
    "text": "청크 원문",
    "model": "gemini-3.1-flash",
    "qa_list": [
      { "q": "질문", "a": "답변", "intent": "fact", "answerable": true }
    ]
  }
]
```

**인덱스**
- `idx_qa_gen_created_at` — 생성일 DESC
- `idx_qa_gen_linked_eval` — FK 인덱스
- `idx_qa_gen_metadata_gin` — JSONB GIN

**FK 제약**
- `fk_qa_gen_doc` — `document_id` → `doc_metadata.document_id` ON DELETE SET NULL

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
| `generation_id` | uuid FK | → `qa_gen_results.id` (ON DELETE SET NULL) |

**제약 조건**
- `chk_grade`: `final_grade IN ('A+','A','B+','B','C','F')`
- `chk_final_score`: `final_score BETWEEN 0 AND 1`

**scores JSONB 구조**
```json
{
  "syntax":  { "pass_rate": 100.0 },
  "stats":   { "quality_score": 8.04, "diversity": {}, "duplication_rate": {}, "near_duplicate_rate": 0.0 },
  "rag":     {
    "avg_relevance": 0.85,
    "avg_groundedness": 0.92,
    "avg_context_relevance": 0.88,
    "avg_score": 0.89
  },
  "quality": { "avg_completeness": 0.90, "avg_quality": 0.90, "pass_rate": 100.0 }
}
```

> `rag.avg_score` = relevance×0.3 + groundedness×0.5 + context_relevance×0.2
> Layer 3는 completeness 단일 지표 (구 4차원 factuality/specificity/conciseness 제거됨)
```

**인덱스**
- `idx_eval_created_at` — 생성일 DESC
- `idx_eval_final_grade` — 등급 조회
- `idx_eval_final_score` — 점수 DESC
- `idx_eval_metadata_gin` — JSONB GIN

**FK 제약**
- `fk_qa_eval_gen` — `generation_id` → `qa_gen_results.id` ON DELETE SET NULL

---

## 테이블 관계도 (현재 상태 — Option B 완료)

```
doc_metadata (document_id UNIQUE)
  ├──< doc_chunks       (document_id FK, ON DELETE SET NULL)
  └──< qa_gen_results   (document_id FK, ON DELETE SET NULL)
        ├──> qa_eval_results (generation_id FK, ON DELETE SET NULL)  ← 역방향 (신규)
        └──> qa_eval_results (linked_evaluation_id FK)               ← 기존 단방향

doc_chunks.id
  ← qa_gen_results.doc_chunk_ids[]   (GIN 인덱스)
  ← qa_gen_results.qa_list[*].docId  (JSONB 내부)
```

**FK 현황 요약**

| 제약명 | 테이블 | 컬럼 | 참조 | ON DELETE |
|--------|--------|------|------|-----------|
| `fk_doc_chunks_metadata` | `doc_chunks` | `document_id` | `doc_metadata.document_id` | SET NULL |
| `fk_qa_gen_doc` | `qa_gen_results` | `document_id` | `doc_metadata.document_id` | SET NULL |
| `fk_qa_eval_gen` | `qa_eval_results` | `generation_id` | `qa_gen_results.id` | SET NULL |
| (기존) | `qa_gen_results` | `linked_evaluation_id` | `qa_eval_results.id` | — |

> ON DELETE CASCADE 대신 SET NULL 채택 이유: 문서 삭제 시 생성/평가 이력 보존 필요.

---

## RPC Functions

### `match_doc_chunks(query_embedding, match_threshold, match_count, filter)` — 벡터 유사도 검색

`doc_chunks`에서 cosine 유사도 기반 K-NN 검색.

### `sample_doc_chunks(p_filename, p_n, p_document_id)` — 균등 샘플링

`chunk_index` 기준 stride 샘플링으로 문서 전체에서 균등하게 N개 반환.

```sql
CREATE OR REPLACE FUNCTION sample_doc_chunks(
    p_filename    TEXT,
    p_n           INT DEFAULT 30,
    p_document_id TEXT DEFAULT NULL
)
RETURNS TABLE(
    id          uuid,
    content     text,
    embedding   vector(1536),
    metadata    jsonb,
    created_at  timestamptz,
    document_id text
) AS $$
DECLARE
    total_count INT;
    step_size   INT;
    v_doc_id    TEXT;
BEGIN
    IF p_document_id IS NULL THEN
        SELECT ch.document_id INTO v_doc_id
        FROM doc_chunks ch
        WHERE ch.metadata->>'filename' = p_filename
        ORDER BY ch.created_at DESC
        LIMIT 1;
    ELSE
        v_doc_id := p_document_id;
    END IF;

    IF v_doc_id IS NULL THEN RETURN; END IF;

    SELECT COUNT(*) INTO total_count
    FROM doc_chunks ch WHERE ch.document_id = v_doc_id;

    IF total_count = 0 THEN RETURN; END IF;
    step_size := GREATEST(total_count / p_n, 1);

    RETURN QUERY
    SELECT ch.id, ch.content, ch.embedding, ch.metadata, ch.created_at, ch.document_id
    FROM (
        SELECT ch2.*, ROW_NUMBER() OVER (
            ORDER BY (ch2.metadata->>'chunk_index')::int
        ) AS rn
        FROM doc_chunks ch2
        WHERE ch2.document_id = v_doc_id
    ) ch
    WHERE (ch.rn - 1) % step_size = 0
    LIMIT p_n;
END;
$$ LANGUAGE plpgsql STABLE;
```

> `RETURNS TABLE(...)` 방식 사용 — `RETURNS SETOF doc_chunks` 대비 테이블 컬럼 변경에 안전.
> 컬럼 추가/순서 변경 시 `DROP FUNCTION` 후 재생성 필요.

### `get_eval_qa_scores(p_eval_id uuid)` — export 최적화

`pipeline_results` JSONB 전체 전송 없이 `qa_scores`만 추출 반환.

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

## 마이그레이션 이력

### 2026-03-31 — Option B FK 마이그레이션 완료

| Step | 내용 | 결과 |
|------|------|------|
| 1 | `doc_chunks.document_id` 전용 컬럼 추가 + JSONB 백필 | 558/558 완료 |
| 2-a | `doc_metadata` 미매핑 document_id 최소 row 삽입 | 14개 보완, total 17개 |
| 2-b | `fk_doc_chunks_metadata` FK 추가 | ✅ |
| 3-b | `qa_gen_results.document_id` 백필 (doc_chunk_ids 역추적) | 15/41 성공 |
| 3-c | `qa_gen_results.document_id` 백필 폴백 (source_doc → doc_metadata) | 41/41 완료 |
| 3-d | `fk_qa_gen_doc` FK 추가 | ✅ |
| 4-a/b | `qa_eval_results.generation_id` 추가 + 역방향 백필 | 41/41 완료 |
| 4-c | `fk_qa_eval_gen` FK 추가 | ✅ |

**백엔드 코드 변경 (신규 데이터부터 적용)**
- `doc_chunk_repo.py` — `save_doc_chunks_batch()`: `document_id` 컬럼 직접 저장
- `qa_generation_repo.py` — `document_id` 컬럼 저장
- `generation_api.py` — metadata에 `document_id` 전달
- `evaluation_repo.py` — `generation_id` 컬럼 저장 (빈 문자열 → None 안전 처리)
- `ingestion_api.py` — 업로드 시 `upsert_doc_metadata` 선점 호출 (FK 충족)

---

## Supabase RLS

| 테이블 | SELECT | INSERT | UPDATE |
|--------|--------|--------|--------|
| `doc_chunks` | 모두 허용 | 모두 허용 | 모두 허용 |
| `doc_metadata` | 모두 허용 | 모두 허용 | 모두 허용 |
| `qa_gen_results` | 모두 허용 | 모두 허용 | 모두 허용 |
| `qa_eval_results` | 모두 허용 | 모두 허용 | 모두 허용 |
