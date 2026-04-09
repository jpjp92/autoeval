-- 1. pgvector 확장 활성화 (이미 활성화되어 있다면 무시됨)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. 문서 청크 및 임베딩 저장을 위한 테이블 생성
-- Gemini Embedding 2 Preview (gemini-embedding-2-preview)는 가변 차원을 지원합니다.
-- HNSW 인덱스의 2000차원 제한을 고려하여 1536차원으로 설정합니다.
CREATE TABLE IF NOT EXISTS doc_chunks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    content text NOT NULL,                    -- 분할된 문서의 텍스트 청크
    metadata jsonb DEFAULT '{}'::jsonb,       -- 파일명, 페이지 번호, 계층 구조(hierarchy) 등
    embedding vector(1536),                   -- 실제 벡터 데이터
    created_at timestamptz DEFAULT now(),
    document_id text                          -- 업로드 단위 식별자 (uuid4, 동일 파일 재업로드 구분)
);

-- 3. 검색 성능 향상을 위한 인덱스 구축
-- 코사인 유사도(vector_cosine_ops) 기반 HNSW 인덱스
CREATE INDEX IF NOT EXISTS idx_doc_chunks_hnsw 
ON doc_chunks USING hnsw (embedding vector_cosine_ops);

-- 생성일자 기준 정렬용 인덱스
CREATE INDEX IF NOT EXISTS idx_doc_chunks_created_at ON doc_chunks(created_at DESC);

-- document_id 필터용 인덱스 (버전별 청크 조회)
CREATE INDEX IF NOT EXISTS idx_doc_chunks_document_id ON doc_chunks(document_id);

-- 메타데이터 필터링 가속화를 위한 GIN 인덱스
CREATE INDEX IF NOT EXISTS idx_doc_chunks_metadata ON doc_chunks USING GIN (metadata);

-- 4. RLS (Row Level Security) 설정
-- 보안을 위해 RLS를 활성화하고 정책을 정의합니다.
ALTER TABLE doc_chunks ENABLE ROW LEVEL SECURITY;

-- 모든 사용자에게 읽기 권한 허용 (RAG 검색용)
CREATE POLICY "Allow read doc_chunks"
  ON doc_chunks FOR SELECT
  USING (true);

-- 인증된 서비스/사용자에게만 쓰기 권한 허용
CREATE POLICY "Allow insert doc_chunks"
  ON doc_chunks FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- 5. 유사도 검색을 위한 RPC 함수 정의 (match_doc_chunks)
-- API(Python SDK 등)에서 직접 호출하여 특정 계층이나 조건에 맞는 문맥을 검색할 수 있습니다.
CREATE OR REPLACE FUNCTION match_doc_chunks (
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  filter jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  id uuid,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    doc_chunks.id,
    doc_chunks.content,
    doc_chunks.metadata,
    1 - (doc_chunks.embedding <=> query_embedding) AS similarity
  FROM doc_chunks
  WHERE (doc_chunks.metadata @> filter) -- 메타데이터 필터링 (예: 특정 계층 검색)
    AND 1 - (doc_chunks.embedding <=> query_embedding) > match_threshold
  ORDER BY doc_chunks.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;


-- 6. hierarchy 3개 필드만 jsonb merge (patch_chunk_hierarchy)
-- 메타데이터 전체를 재전송하지 않아 페이로드를 최소화한다.
CREATE OR REPLACE FUNCTION patch_chunk_hierarchy(
  p_chunk_id UUID,
  p_h1 TEXT,
  p_h2 TEXT,
  p_h3 TEXT
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE doc_chunks
  SET metadata = metadata || jsonb_build_object(
    'hierarchy_h1', p_h1,
    'hierarchy_h2', p_h2,
    'hierarchy_h3', p_h3
  )
  WHERE id = p_chunk_id;
END;
$$;


-- 7. export 최적화 — pipeline_results 전체 전송 없이 qa_scores만 추출 (get_eval_qa_scores)
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


-- 8. 문서 전체에서 균등 stride 샘플링 (sample_doc_chunks)
-- document_id 미지정 시 created_at DESC로 최신 버전 자동 고정.
-- step_size = GREATEST(total / p_n, 1) 등간격으로 결정적 샘플링.
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
