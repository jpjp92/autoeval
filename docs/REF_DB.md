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

## 테이블 간 연결 현황 및 설계 방향

### 현재 연결 상태

```
doc_chunks
  metadata->>'document_id'  (text, JSONB 내부) ← FK 불가
  metadata->>'filename'     (text, JSONB 내부)

qa_gen_results
  doc_chunk_ids  text[]     ← doc_chunks 참조, FK 없음
  metadata->>'source_doc'   ← filename 기반, FK 없음
  linked_evaluation_id uuid FK → qa_eval_results.id  ✅

qa_eval_results
  qa_gen_results로의 역방향 FK 없음  ❌
```

**문제점 요약**
| 연결 | 현황 | 문제 |
|------|------|------|
| `doc_chunks` ↔ `doc_metadata` | 없음 (JSONB 내부 text) | document 단위 조회 불가 |
| `qa_gen_results` → `doc_chunks` | `doc_chunk_ids text[]` | FK 없음, 무결성 보장 안 됨 |
| `qa_gen_results` → `doc_metadata` | `source_doc` filename | FK 없음 |
| `qa_gen_results` → `qa_eval_results` | `linked_evaluation_id` FK | ✅ 존재 |
| `qa_eval_results` → `qa_gen_results` | 없음 | 역방향 탐색 불가 |

---

### `doc_metadata` 신규 테이블 — Option A vs B

`/analyze-hierarchy` 실행 시 H1/H2/H3 master + domain_profile을 함께 저장할 테이블.

#### Option A — 논리적 연결 (현재 채택)

```sql
CREATE TABLE doc_metadata (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    text        NOT NULL UNIQUE,  -- doc_chunks.metadata->>'document_id'와 일치
  filename       text        NOT NULL,
  domain_profile jsonb,      -- { domain, domain_short, target_audience, key_terms, tone, ... }
  h2_h3_master   jsonb,      -- { "H1명": { "H2명": ["H3", ...] } }
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- document_id UNIQUE가 이미 인덱스 생성 → 별도 인덱스 불필요
CREATE INDEX idx_doc_metadata_filename ON doc_metadata(filename);

-- updated_at 자동 갱신 트리거
-- (update_updated_at() 함수가 이미 존재하면 CREATE FUNCTION 부분 스킵)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_doc_metadata_updated_at
  BEFORE UPDATE ON doc_metadata
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS (다른 테이블과 동일 정책)
ALTER TABLE doc_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doc_metadata_select" ON doc_metadata FOR SELECT USING (true);
CREATE POLICY "doc_metadata_insert" ON doc_metadata FOR INSERT WITH CHECK (true);
CREATE POLICY "doc_metadata_update" ON doc_metadata FOR UPDATE USING (true);
```

- `document_id`는 논리적 키 — DB 레벨 FK 없이 애플리케이션에서 일치 보장
- doc_chunks 스키마 변경 없음
- `/analyze-hierarchy` 재실행 시 `ON CONFLICT (document_id) DO UPDATE`로 upsert 처리
- 단점: 무결성 강제 불가, 문서 삭제 시 코드에서 직접 정리 필요

#### Option B — 정식 FK (장기 목표)

```sql
-- 1. doc_chunks에 전용 컬럼 추가 (기존 JSONB에서 추출)
ALTER TABLE doc_chunks ADD COLUMN document_id text;
UPDATE doc_chunks SET document_id = metadata->>'document_id';
CREATE INDEX idx_doc_chunks_document_id ON doc_chunks(document_id);

-- 2. doc_metadata FK 연결
ALTER TABLE doc_chunks
  ADD CONSTRAINT fk_doc_chunks_metadata
  FOREIGN KEY (document_id)
  REFERENCES doc_metadata(document_id)
  ON DELETE CASCADE;

-- 3. qa_gen_results → doc_metadata 연결
ALTER TABLE qa_gen_results ADD COLUMN document_id text;
ALTER TABLE qa_gen_results
  ADD CONSTRAINT fk_qa_gen_doc
  FOREIGN KEY (document_id)
  REFERENCES doc_metadata(document_id);

-- 4. qa_eval_results → qa_gen_results 역방향 FK 추가
ALTER TABLE qa_eval_results ADD COLUMN generation_id uuid;
ALTER TABLE qa_eval_results
  ADD CONSTRAINT fk_qa_eval_gen
  FOREIGN KEY (generation_id)
  REFERENCES qa_gen_results(id)
  ON DELETE SET NULL;
```

**Option A vs B 비교**

| 항목 | Option A | Option B |
|------|----------|----------|
| 구현 난이도 | 낮음 (신규 테이블만) | 높음 (기존 테이블 마이그레이션) |
| 기존 데이터 영향 | 없음 | doc_chunks 전체 UPDATE 필요 |
| DB 무결성 | 애플리케이션 보장 | DB 레벨 강제 |
| 삭제 연쇄 | 수동 처리 | CASCADE 자동 처리 |
| 역방향 탐색 | 불편 | 자연스러운 JOIN |
| 장기 운영 | 기술 부채 누적 | 안정적 |

> **결정 (2026-03-27)**
> - **현재**: Option A 적용 — `doc_metadata` 신규 테이블만 추가, 기존 테이블 변경 없음
> - **장기**: 전체 플로우 안정화 이후 DB 스키마 전면 재설계 (Option B 스타일)
>   - 단순 마이그레이션이 아닌 **테이블 관계 전체 재구성** 수준
>   - 시점: 인제스션 → QA 생성 → 평가 파이프라인 end-to-end 안정화 확인 후

---

### 장기 목표 — 전체 테이블 관계도 (Option B 재설계 시 목표)

```
doc_metadata (document_id PK)
  │
  ├──< doc_chunks (document_id FK, CASCADE)    -- 1:N, 청크 + 벡터
  │
  └──< qa_gen_results (document_id FK)         -- 1:N, 생성 이력
        │
        └──> qa_eval_results (generation_id FK, SET NULL)  -- 1:1, 평가 결과
```

**재설계 시 변경 범위**

| 테이블 | 변경 내용 |
|--------|-----------|
| `doc_chunks` | `document_id text` 전용 컬럼 추출 + FK 추가 |
| `qa_gen_results` | `document_id text FK` 추가, `doc_chunk_ids text[]` 정리 |
| `qa_eval_results` | `generation_id uuid FK` 추가 (역방향 탐색) |
| `doc_metadata` | Option A → B 전환 시 `document_id` PRIMARY KEY로 승격 |

> 재설계 전 기존 데이터 전체 백업 필수. `doc_chunks` UPDATE 작업이 가장 큰 영향 범위.

---

## Supabase RLS

| 테이블 | SELECT | INSERT | UPDATE |
|--------|--------|--------|--------|
| `doc_chunks` | 모두 허용 | 인증 필요 | — |
| `qa_gen_results` | 모두 허용 | 모두 허용 | 모두 허용 |
| `qa_eval_results` | 모두 허용 | 모두 허용 | 모두 허용 |
