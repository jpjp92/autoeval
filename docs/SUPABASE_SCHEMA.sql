-- Supabase Schema for QA Generation & Evaluation Pipeline
-- 생성 및 평가 파이프라인 데이터베이스 스키마
-- Last Updated: 2026-03-12

-- ============================================================================
-- TABLE 1: qa_generation_results (QA 생성 결과 저장) - 먼저 생성
-- ============================================================================

CREATE TABLE IF NOT EXISTS qa_generation_results (
  -- Primary Key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 생성 작업 정보
  job_id TEXT UNIQUE NOT NULL,
  
  -- 메타데이터 (JSONB로 통합)
  metadata JSONB NOT NULL,          -- {
                                    --   "generation_model": "gemini-3.1-flash",
                                    --   "lang": "ko",
                                    --   "prompt_version": "v1"
                                    -- }
  
  -- Hierarchy-based Sampling 정보 (JSONB로 통합)
  hierarchy JSONB NOT NULL,         -- {
                                    --   "sampling": "random",
                                    --   "category": null,
                                    --   "path_prefix": null,
                                    --   "filtered_document_count": 100
                                    -- }
  
  -- QA 생성 통계 (JSONB)
  stats JSONB NOT NULL,             -- {
                                    --   "total_qa": 100,
                                    --   "total_documents": 10,
                                    --   "total_tokens_input": 5000,
                                    --   "total_tokens_output": 2500,
                                    --   "estimated_cost": 0.45
                                    -- }
  
  -- QA 데이터 (전체 저장)
  qa_list JSONB NOT NULL,           -- [{q, a, context, hierarchy, docId, ...}]
  
  -- 평가 연결 (나중에 FK 추가 - 아래 참조)
  linked_evaluation_id UUID,
  
  -- 타임스탬프
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 인덱스 (조회 성능)
CREATE INDEX IF NOT EXISTS idx_qa_gen_created_at ON qa_generation_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_gen_linked_eval ON qa_generation_results(linked_evaluation_id);
CREATE INDEX IF NOT EXISTS idx_qa_gen_job_id ON qa_generation_results(job_id);

-- JSONB 경로 인덱스 (메타데이터 및 설정 검색용)
CREATE INDEX IF NOT EXISTS idx_qa_gen_metadata ON qa_generation_results USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_qa_gen_hierarchy ON qa_generation_results USING GIN (hierarchy);

-- 코멘트
COMMENT ON TABLE qa_generation_results IS 'QA 생성 결과 저장 테이블';
COMMENT ON COLUMN qa_generation_results.metadata IS 'QA 생성 메타데이터: generation_model, lang, prompt_version';
COMMENT ON COLUMN qa_generation_results.hierarchy IS 'Hierarchy 기반 샘플링 정보: sampling(무작위/카테고리/경로/균형), category, path_prefix, filtered_document_count';
COMMENT ON COLUMN qa_generation_results.stats IS '생성 통계: total_qa, total_documents, tokens, cost';
COMMENT ON COLUMN qa_generation_results.qa_list IS '전체 QA 배열: [{q, a, context, hierarchy, docId, intent, ...}]';
COMMENT ON COLUMN qa_generation_results.linked_evaluation_id IS '평가 파이프라인으로 평가된 경우 해당 evaluation_results ID (평가 후 업데이트)';

---

-- ============================================================================
-- TABLE 2: evaluation_results (평가 결과 저장)
-- ============================================================================

CREATE TABLE IF NOT EXISTS evaluation_results (
  -- Primary Key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- 평가 작업 정보
  job_id TEXT UNIQUE NOT NULL,
  
  -- 메타데이터 (JSONB로 통합)
  metadata JSONB NOT NULL,          -- {
                                    --   "generation_model": "gemini-3.1-flash",
                                    --   "evaluator_model": "claude-haiku",
                                    --   "lang": "ko",
                                    --   "prompt_version": "v1"
                                    -- }
  
  -- 통계
  total_qa INT NOT NULL,
  valid_qa INT NOT NULL,
  
  -- 4단계 평가 점수 요약 (JSONB)
  scores JSONB NOT NULL,              -- {
                                      --   "syntax": {"pass_rate": 95.0},
                                      --   "stats": {"quality_score": 7.5, "diversity": 0.85, "duplication_rate": 0.1},
                                      --   "rag": {"relevance": 0.85, "groundedness": 0.92, "clarity": 0.88, "avg_score": 0.88},
                                      --   "quality": {"factuality": 0.90, "completeness": 0.88, "groundedness": 0.92, "avg_score": 0.90, "pass_rate": 84.2}
                                      -- }
  
  -- 최종 점수 (자주 쿼리되므로 분리)
  final_score FLOAT NOT NULL,          -- 종합 점수 (0-1)
  final_grade TEXT NOT NULL,           -- A+, A, B+, B, C, F
  
  -- 상세 결과 & 해석 (JSONB)
  pipeline_results JSONB NOT NULL,     -- 4단계 전체 평가 결과 (상세)
  interpretation JSONB,                -- 해석 & 개선 추천사항
  
  -- 타임스탬프
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  
  -- Check Constraints
  CONSTRAINT valid_grade CHECK (final_grade IN ('A+', 'A', 'B+', 'B', 'C', 'F')),
  CONSTRAINT valid_final_score CHECK (final_score BETWEEN 0 AND 1),
  CONSTRAINT valid_valid_qa CHECK (valid_qa <= total_qa)
);

-- 인덱스 (조회 성능)
CREATE INDEX IF NOT EXISTS idx_evaluation_created_at ON evaluation_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_evaluation_final_grade ON evaluation_results(final_grade);
CREATE INDEX IF NOT EXISTS idx_evaluation_job_id ON evaluation_results(job_id);
CREATE INDEX IF NOT EXISTS idx_evaluation_final_score ON evaluation_results(final_score DESC);

-- JSONB 경로 인덱스 (메타데이터 및 점수 검색용)
CREATE INDEX IF NOT EXISTS idx_evaluation_metadata ON evaluation_results USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_evaluation_scores ON evaluation_results USING GIN (scores);

-- 코멘트
COMMENT ON TABLE evaluation_results IS '4단계 평가 파이프라인 결과 저장 테이블';
COMMENT ON COLUMN evaluation_results.metadata IS '평가 메타데이터: generation_model, evaluator_model, lang, prompt_version';
COMMENT ON COLUMN evaluation_results.scores IS '4단계 점수 요약: syntax, stats, rag, quality 각각의 점수 정보';
COMMENT ON COLUMN evaluation_results.pipeline_results IS '4단계 전체 평가 결과 (상세 데이터)';
COMMENT ON COLUMN evaluation_results.final_grade IS '최종 등급: A+/A(우수), B+/B(양호), C(보통), F(미흡)';

---

-- ============================================================================
-- ADD FOREIGN KEY CONSTRAINT (FK 추가)
-- ============================================================================
-- evaluation_results 테이블이 생성된 후, qa_generation_results에 FK 추가
ALTER TABLE qa_generation_results 
ADD CONSTRAINT fk_qa_gen_to_eval FOREIGN KEY (linked_evaluation_id) 
REFERENCES evaluation_results(id) ON DELETE SET NULL;

---

-- ============================================================================
-- RLS (Row Level Security) Policies
-- ============================================================================

-- Enable RLS
ALTER TABLE qa_generation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE evaluation_results ENABLE ROW LEVEL SECURITY;

-- qa_generation_results: 모든 사용자 읽기 가능
CREATE POLICY "Allow read qa_generation_results"
  ON qa_generation_results FOR SELECT
  USING (true);

-- qa_generation_results: 인증된 사용자만 쓰기 가능
CREATE POLICY "Allow insert qa_generation_results"
  ON qa_generation_results FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- evaluation_results: 모든 사용자 읽기 가능
CREATE POLICY "Allow read evaluation_results"
  ON evaluation_results FOR SELECT
  USING (true);

-- evaluation_results: 인증된 사용자만 쓰기 가능
CREATE POLICY "Allow insert evaluation_results"
  ON evaluation_results FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

---

-- ============================================================================
-- VIEW: evaluation_qa_joined (평가-생성 결과 조인 뷰)
-- ============================================================================

CREATE OR REPLACE VIEW evaluation_qa_joined AS
SELECT
  e.id as evaluation_id,
  e.job_id as eval_job_id,
  e.final_grade,
  e.final_score,
  e.created_at as eval_created_at,
  
  q.id as qa_generation_id,
  q.job_id as gen_job_id,
  (q.metadata->>'generation_model') as generation_model,
  (e.metadata->>'evaluator_model') as evaluator_model,
  (q.metadata->>'lang') as lang,
  q.total_qa,
  (q.hierarchy->>'sampling') as sampling,
  (q.hierarchy->>'category') as category,
  (q.hierarchy->>'path_prefix') as path_prefix,
  q.created_at as gen_created_at,
  
  -- 4단계 점수 (JSONB에서 추출)
  (e.scores->'syntax'->>'pass_rate')::FLOAT as syntax_pass_rate,
  (e.scores->'stats'->>'quality_score')::FLOAT as dataset_quality_score,
  (e.scores->'rag'->>'avg_score')::FLOAT as rag_avg_score,
  (e.scores->'quality'->>'avg_score')::FLOAT as quality_avg_score
FROM evaluation_results e
LEFT JOIN qa_generation_results q ON e.id = q.linked_evaluation_id
ORDER BY e.created_at DESC;

COMMENT ON VIEW evaluation_qa_joined IS '평가 결과와 생성 결과를 함께 조회하기 위한 뷰';

---

-- ============================================================================
-- STORED PROCEDURES & FUNCTIONS
-- ============================================================================

-- 함수: 평가 결과 요약 조회
CREATE OR REPLACE FUNCTION get_evaluation_summary(
  p_evaluation_id UUID
)
RETURNS TABLE (
  id UUID,
  job_id TEXT,
  generation_model TEXT,
  evaluator_model TEXT,
  total_qa INT,
  valid_qa INT,
  syntax_pass_rate FLOAT,
  dataset_quality_score FLOAT,
  rag_avg_score FLOAT,
  quality_avg_score FLOAT,
  final_grade TEXT,
  final_score FLOAT,
  created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.job_id,
    (e.metadata->>'generation_model')::TEXT,
    (e.metadata->>'evaluator_model')::TEXT,
    e.total_qa,
    e.valid_qa,
    (e.scores->'syntax'->>'pass_rate')::FLOAT,
    (e.scores->'stats'->>'quality_score')::FLOAT,
    (e.scores->'rag'->>'avg_score')::FLOAT,
    (e.scores->'quality'->>'avg_score')::FLOAT,
    e.final_grade,
    e.final_score,
    e.created_at
  FROM evaluation_results e
  WHERE e.id = p_evaluation_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_evaluation_summary IS '평가 결과 요약 정보 조회 (JSONB metadata & scores 추출 포함)';

---

-- 함수: 최근 평가 결과 목록 조회 (pagination)
CREATE OR REPLACE FUNCTION get_recent_evaluations(
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0,
  p_grade TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  job_id TEXT,
  generation_model TEXT,
  evaluator_model TEXT,
  total_qa INT,
  valid_qa INT,
  final_grade TEXT,
  final_score FLOAT,
  created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.job_id,
    (e.metadata->>'generation_model')::TEXT,
    (e.metadata->>'evaluator_model')::TEXT,
    e.total_qa,
    e.valid_qa,
    e.final_grade,
    e.final_score,
    e.created_at
  FROM evaluation_results e
  WHERE (p_grade IS NULL OR e.final_grade = p_grade)
  ORDER BY e.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_recent_evaluations IS '최근 평가 결과 목록 조회 (페이지네이션 지원)';

--함수: 점수 범위로 평가 결과 검색
CREATE OR REPLACE FUNCTION search_evaluations_by_score(
  p_min_score FLOAT DEFAULT 0.0,
  p_max_score FLOAT DEFAULT 1.0,
  p_limit INT DEFAULT 20,
  p_offset INT DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  job_id TEXT,
  generation_model TEXT,
  evaluator_model TEXT,
  final_score FLOAT,
  final_grade TEXT,
  syntax_pass_rate FLOAT,
  rag_avg_score FLOAT,
  quality_avg_score FLOAT,
  created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    e.id,
    e.job_id,
    (e.metadata->>'generation_model')::TEXT,
    (e.metadata->>'evaluator_model')::TEXT,
    e.final_score,
    e.final_grade,
    (e.scores->'syntax'->>'pass_rate')::FLOAT,
    (e.scores->'rag'->>'avg_score')::FLOAT,
    (e.scores->'quality'->>'avg_score')::FLOAT,
    e.created_at
  FROM evaluation_results e
  WHERE e.final_score BETWEEN p_min_score AND p_max_score
  ORDER BY e.final_score DESC, e.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION search_evaluations_by_score IS '점수 범위로 평가 결과 검색';

---

-- ============================================================================
-- TEST DATA (선택사항: 개발용)
-- ============================================================================

-- INSERT INTO qa_generation_results (
--   job_id, result_filename, generation_model, lang, 
--   sampling, category, filtered_document_count, 
--   total_qa, total_documents, total_tokens_input, total_tokens_output, 
--   estimated_cost, qa_list
-- ) VALUES (
--   'gen_test_20260312_001',
--   'qa_gemini_ko_v1_20260312_120000.json',
--   'gemini-3.1-flash',
--   'ko',
--   'path',
--   NULL,
--   '혜택 > 구매혜택',
--   2,
--   2,
--   1500,
--   800,
--   0.05,
--   '[{"q": "Test Q", "a": "Test A", "hierarchy": ["혜택", "구매혜택"]}]'
-- );

---

-- ============================================================================
-- MIGRATION NOTES
-- ============================================================================

/*
1. Supabase 콘솔에서 SQL Editor에 위 쿼리 붙여넣기
2. 또는 supabase CLI 사용:
   
   supabase db push
   
3. 확인:
   - Tables 탭에서 qa_generation_results, evaluation_results 확인
   - Indexes 확인
   - Policies (RLS) 확인

4. API 자동 생성:
   - Supabase 자동 생성 REST API 사용:
     POST /rest/v1/qa_generation_results
     GET /rest/v1/evaluation_results
     등

5. Python/JavaScript 클라이언트로 사용:
   
   Python:
     from supabase import create_client
     supabase = create_client(url, key)
     response = supabase.table("evaluation_results").select("*").execute()
   
   JavaScript:
     const { data } = await supabase
       .from('evaluation_results')
       .select('*')
       .order('created_at', { ascending: false })
*/
