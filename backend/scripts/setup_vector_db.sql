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
    created_at timestamptz DEFAULT now()
);

-- 3. 검색 성능 향상을 위한 인덱스 구축
-- 코사인 유사도(vector_cosine_ops) 기반 HNSW 인덱스
CREATE INDEX IF NOT EXISTS idx_doc_chunks_hnsw 
ON doc_chunks USING hnsw (embedding vector_cosine_ops);

-- 생성일자 기준 정렬용 인덱스
CREATE INDEX IF NOT EXISTS idx_doc_chunks_created_at ON doc_chunks(created_at DESC);

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
