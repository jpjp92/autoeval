<!--
파일: REF_DB.md
설명: Supabase(PostgreSQL + pgvector) DB 스키마 정의. 테이블 구조(doc_metadata·doc_chunks·qa_gen_results·qa_eval_results), FK 관계, 인덱스, RPC 함수 목록 포함.
업데이트: 2026-04-09
-->
# DB Schema

> **최종 업데이트**: 2026-04-09 — sample_doc_chunks 실제 Supabase 함수 정리 / NTILE 검토 불채택

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
| `page` | 페이지 번호 (DOCX는 `1` 고정) |
| `chunk_type` | `body` \| `heading` \| `table` \| `list` \| `colophon` |
| `section_title` | LLM 청킹 시 섹션 제목 (rule 청킹은 빈 문자열) |
| `content_hash` | SHA-1 중복 제거용 |
| `char_length` | 청크 원문 바이트 길이 |
| `chunk_index` | 청크 순서 인덱스 (문서 전체 전역 순번: `batch_start + idx`) |
| `total_chunks` | 해당 문서 전체 청크 수 |
| `chunking_method` | `llm` \| `rule` |
| `source` | 파일 확장자 (`pdf` \| `docx`) |
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
  "generation_model": "gemini-3-flash",
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


**인덱스**
- `idx_eval_created_at` — 생성일 DESC
- `idx_eval_final_grade` — 등급 조회
- `idx_eval_final_score` — 점수 DESC
- `idx_eval_metadata_gin` — JSONB GIN

**FK 제약**
- `fk_qa_eval_gen` — `generation_id` → `qa_gen_results.id` ON DELETE SET NULL

---

## 테이블 관계도 (현재 상태 — Option B 완료)

doc_metadata (document_id UNIQUE)
  ├──< doc_chunks       (document_id FK, ON DELETE SET NULL)
  └──< qa_gen_results   (document_id FK, ON DELETE SET NULL)
        ├──> qa_eval_results (generation_id FK, ON DELETE SET NULL)  ← 역방향 (신규)
        └──> qa_eval_results (linked_evaluation_id FK)               ← 기존 단방향

doc_chunks.id
  ← qa_gen_results.doc_chunk_ids[]   (GIN 인덱스)
  ← qa_gen_results.qa_list[*].docId  (JSONB 내부)



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

`doc_chunks`에서 cosine 유사도 기반 K-NN 검색. `filter` JSONB로 metadata 필드 조건 추가 가능 (예: `{"hierarchy_h1": "제1장"}`).

### `patch_chunk_hierarchy(p_chunk_id, p_h1, p_h2, p_h3)` — 계층 태깅 업데이트

Pass3 태깅 시 청크 단위로 `hierarchy_h1/h2/h3` 3개 필드만 metadata에 merge. 전체 metadata 재전송 없이 최소 페이로드로 업데이트.

```sql
UPDATE doc_chunks
SET metadata = metadata || jsonb_build_object(
  'hierarchy_h1', p_h1,
  'hierarchy_h2', p_h2,
  'hierarchy_h3', p_h3
)
WHERE id = p_chunk_id;
```

### `sample_doc_chunks(p_filename, p_n, p_document_id)` — 균등 stride 샘플링

hierarchy 분석(`/analyze-hierarchy`) 시 anchor 청크 수집에 사용. `p_n`개를 문서 전체에서 균등하게 반환.

**반환 컬럼**: `id uuid`, `content text`, `embedding vector(1536)`, `metadata jsonb`, `created_at timestamptz`, `document_id text`

```sql
CREATE OR REPLACE FUNCTION sample_doc_chunks(
  p_filename    TEXT,
  p_n           INT  DEFAULT 30,
  p_document_id TEXT DEFAULT NULL
)
RETURNS TABLE (
  id           uuid,
  content      text,
  embedding    vector(1536),
  metadata     jsonb,
  created_at   timestamptz,
  document_id  text
)
LANGUAGE plpgsql AS $$
DECLARE
    total_count INT;
    step_size   INT;
    v_doc_id    TEXT;
BEGIN
    -- document_id 미지정 시 filename 기준 가장 최근 업로드 버전으로 고정
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
    FROM doc_chunks ch
    WHERE ch.document_id = v_doc_id;

    IF total_count = 0 THEN RETURN; END IF;
    -- 총 청크 수 < p_n 이면 step_size=1 → 전체 반환
    step_size := GREATEST(total_count / p_n, 1);

    RETURN QUERY
    SELECT ch.id, ch.content, ch.embedding, ch.metadata, ch.created_at, ch.document_id
    FROM (
        SELECT ch2.*,
               ROW_NUMBER() OVER (
                 ORDER BY (ch2.metadata->>'chunk_index')::int
               ) AS rn
        FROM doc_chunks ch2
        WHERE ch2.document_id = v_doc_id
    ) ch
    WHERE (ch.rn - 1) % step_size = 0
    LIMIT p_n;
END;
$$;
```

**설계 특성**

| 항목 | 내용 |
|------|------|
| document_id 버전 | `p_document_id` 미지정 시 `created_at DESC` 최신 버전 자동 고정 — 재업로드 버전 혼재 방지 |
| 샘플링 방식 | 등간격 stride: `(rn-1) % step_size = 0` — 완전 결정적, 매 호출 동일 결과 |
| 정렬 기준 | `chunk_index::int` — 문서 전체 전역 순번 (`pipeline.py: batch_start + idx`) |
| 청크 수 < p_n | `step_size = GREATEST(..., 1)` → 전체 반환 |
| 말미 누락 | total이 p_n으로 나누어떨어지지 않으면 마지막 1~2개 청크 탈락 가능 (미미한 영향) |

> **NTILE 대안 검토 (2026-04-09 — 불채택)**  
> LENGTH ≥ 100 필터(heading 제거로 역효과), page 복합 정렬(chunk_index가 이미 전역 순번), heading 우선(LLM 청킹에서 heading 독립 청크 희소)을 검토했으나 실익 없음.  
> document_id 버전 고정·결정적 샘플링이라는 현재 장점을 유지하기로 결정.

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
