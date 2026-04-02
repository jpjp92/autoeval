-- ============================================================
-- AutoEval QA/Evaluation Tables
-- 코드 기반 정확한 스키마 (2026-03-17)
-- 실행 순서: qa_eval_results → qa_gen_results (FK 순서)
-- ============================================================


-- ============================================================
-- 0. 공통 updated_at 자동 갱신 트리거 함수
-- ============================================================
CREATE OR REPLACE FUNCTION fn_update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 1. qa_eval_results
-- 저장 위치: evaluators/pipeline.py → save_evaluation_to_supabase()
-- ============================================================
CREATE TABLE IF NOT EXISTS qa_eval_results (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      TEXT UNIQUE NOT NULL,   -- "eval_20260317_100155_623791"
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),

  -- save_evaluation_to_supabase() metadata 인자
  -- {"evaluator_model": "gpt-5.1", "lang": "ko", "prompt_version": "v1"}
  -- 주의: generation_model은 현재 코드에서 전달하지 않음
  metadata    JSONB NOT NULL,

  -- 집계 카운트
  total_qa    INT NOT NULL,
  valid_qa    INT NOT NULL,

  -- scores: 4레이어 요약 점수 (v_eval_summary 뷰 참조)
  -- {
  --   "syntax":      {"score": 1.0,  ...},   -- float 0-1
  --   "statistical": {"score": 0.80, ...},   -- float 0-1
  --   "rag":         {"score": 0.88, ...},   -- float 0-1
  --   "quality":     {"score": 0.90, ...}    -- float 0-1
  -- }
  scores      JSONB NOT NULL,

  -- 최종 점수 (자주 쿼리 → 별도 컬럼)
  -- 가중치: syntax*0.05 + statistical*0.05 + rag*0.65 + quality*0.25
  final_score FLOAT NOT NULL,
  final_grade TEXT  NOT NULL,

  -- pipeline_results: run_full_evaluation_pipeline() 전체 반환값
  -- {
  --   "metadata": {"total_qa", "evaluator_model", "layers", "timestamp"},
  --   "layers": {
  --     "syntax":  {"total", "valid", "invalid", "pass_rate", "errors_sample": {0: [...]}},
  --     "stats":   {"diversity":{...}, "duplication_rate":{...},
  --                 "skewness":{...}, "data_sufficiency":{...}, "integrated_score": 8.04},
  --     "rag":     {"evaluated_count", "qa_scores":[{qa_index, relevance, groundedness, clarity, avg_score}],
  --                 "summary":{avg_relevance, avg_groundedness, avg_clarity, avg_score}},
  --     "quality": {"evaluated_count", "pass_count", "pass_rate",
  --                 "qa_scores":[{qa_index, factuality, completeness, groundedness, avg_quality, pass}],
  --                 "summary":{avg_factuality, avg_completeness, avg_groundedness, avg_quality}}
  --   },
  --   "overall_score": {"status": "completed", "valid_qa_count", "timestamp"}
  -- }
  pipeline_results JSONB NOT NULL,

  -- interpretation: 등급 설명 + 개선 권고
  -- {
  --   "grade_meaning": {"A+": "매우 우수...", "A": ..., "B+": ..., "B": ..., "C": ..., "F": ...},
  --   "recommendations": ["권고사항1", ...]
  -- }
  interpretation JSONB,

  CONSTRAINT chk_grade       CHECK (final_grade IN ('A+', 'A', 'B+', 'B', 'C', 'F')),
  CONSTRAINT chk_final_score CHECK (final_score BETWEEN 0 AND 1),
  CONSTRAINT chk_valid_qa    CHECK (valid_qa <= total_qa)
);

COMMENT ON TABLE qa_eval_results IS '4레이어 평가 파이프라인 결과 (pipeline.py → save_evaluation_to_supabase)';
COMMENT ON COLUMN qa_eval_results.scores IS '4레이어 요약 점수: syntax.score / statistical.score / rag.score / quality.score (v_eval_summary 기준)';
COMMENT ON COLUMN qa_eval_results.pipeline_results IS 'run_full_evaluation_pipeline() 전체 반환값 (레이어별 qa_scores 포함)';
COMMENT ON COLUMN qa_eval_results.final_score IS '0-1 종합 점수 (syntax*0.05 + statistical*0.05 + rag*0.65 + quality*0.25)';

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_eval_created_at   ON qa_eval_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_final_grade  ON qa_eval_results(final_grade);
CREATE INDEX IF NOT EXISTS idx_eval_final_score  ON qa_eval_results(final_score DESC);
CREATE INDEX IF NOT EXISTS idx_eval_metadata_gin ON qa_eval_results USING GIN (metadata);

-- updated_at 트리거
CREATE TRIGGER trg_eval_updated_at
BEFORE UPDATE ON qa_eval_results
FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- RLS
ALTER TABLE qa_eval_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "eval_select" ON qa_eval_results FOR SELECT USING (true);
CREATE POLICY "eval_insert" ON qa_eval_results FOR INSERT WITH CHECK (true);
CREATE POLICY "eval_update" ON qa_eval_results FOR UPDATE USING (true) WITH CHECK (true);


-- ============================================================
-- 2. qa_gen_results
-- 저장 위치: generation_api.py → save_qa_generation_to_supabase()
-- ============================================================
CREATE TABLE IF NOT EXISTS qa_gen_results (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      TEXT UNIQUE NOT NULL,   -- "gen_20260317_100137_561909"
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),

  -- 원본 문서 파일명 (v_eval_summary, v_db_health 에서 조인 키로 사용)
  source_doc  TEXT,
  -- 생성에 사용된 청크 UUID 배열 (참조 무결성 검사: v_db_health)
  doc_chunk_ids UUID[],
  -- 업로드 버전 식별자 (document_id)
  document_id TEXT,

  -- save_qa_generation_to_supabase() metadata 인자
  -- {"generation_model": "gpt-5.2", "lang": "en", "prompt_version": "v1"}
  metadata    JSONB NOT NULL,

  -- hierarchy 샘플링 정보
  -- {"sampling": "random", "category": null, "path_prefix": null, "filtered_document_count": 1}
  -- 현재 sampling은 항상 "random" (hierarchy 필터 기반 전체 조회)
  hierarchy   JSONB NOT NULL,

  -- 생성 통계
  -- {
  --   "total_qa": 8,
  --   "total_documents": 1,
  --   "total_tokens_input": 2450,
  --   "total_tokens_output": 980,
  --   "estimated_cost": 0.0184
  -- }
  stats       JSONB NOT NULL,

  -- qa_list: output_data["results"] — 문서 결과 객체 배열 (QA 배열이 중첩됨)
  -- [
  --   {
  --     "docId":        "5bdff925-...",        -- doc_chunks.id
  --     "hierarchy":    ["가이드 개요", "품질 전략", null],
  --     "text":         "청크 원문 (raw_text)",
  --     "model":        "gpt-5.2",
  --     "provider":     "openai",
  --     "lang":         "en",
  --     "prompt_version": "v1",
  --     "raw":          "LLM 원본 응답 문자열",
  --     "input_tokens": 1234,
  --     "output_tokens": 567,
  --     "qa_list": [                           -- 실제 QA 쌍 (중첩)
  --       {"q": "...", "a": "...", "intent": "factoid", "answerable": true},
  --       ...
  --     ]
  --   }
  -- ]
  qa_list     JSONB NOT NULL,

  -- link_generation_to_evaluation() UPDATE로 사후 설정
  linked_evaluation_id UUID,

  CONSTRAINT fk_linked_eval
    FOREIGN KEY (linked_evaluation_id)
    REFERENCES qa_eval_results(id)
    ON DELETE SET NULL
);

COMMENT ON TABLE qa_gen_results IS 'QA 생성 결과 (generation_api.py → save_qa_generation_to_supabase)';
COMMENT ON COLUMN qa_gen_results.qa_list IS '문서 결과 배열: 각 원소 = {docId, hierarchy, text, model, provider, lang, raw, input_tokens, output_tokens, qa_list:[{q,a,intent,answerable}]}';
COMMENT ON COLUMN qa_gen_results.linked_evaluation_id IS 'link_generation_to_evaluation() 호출 후 사후 업데이트. FK → qa_eval_results(id) ON DELETE SET NULL';

-- 인덱스
CREATE INDEX IF NOT EXISTS idx_qa_gen_created_at    ON qa_gen_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_gen_linked_eval   ON qa_gen_results(linked_evaluation_id);
CREATE INDEX IF NOT EXISTS idx_qa_gen_source_doc    ON qa_gen_results(source_doc);
CREATE INDEX IF NOT EXISTS idx_qa_gen_document_id   ON qa_gen_results(document_id);
CREATE INDEX IF NOT EXISTS idx_qa_gen_metadata_gin  ON qa_gen_results USING GIN (metadata);
CREATE INDEX IF NOT EXISTS idx_qa_gen_chunk_ids_gin ON qa_gen_results USING GIN (doc_chunk_ids);

-- updated_at 트리거 (linked_evaluation_id UPDATE 시 갱신)
CREATE TRIGGER trg_qa_gen_updated_at
BEFORE UPDATE ON qa_gen_results
FOR EACH ROW EXECUTE FUNCTION fn_update_updated_at();

-- RLS
ALTER TABLE qa_gen_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qa_gen_select" ON qa_gen_results FOR SELECT USING (true);
CREATE POLICY "qa_gen_insert" ON qa_gen_results FOR INSERT WITH CHECK (true);
CREATE POLICY "qa_gen_update" ON qa_gen_results FOR UPDATE USING (true) WITH CHECK (true);



-- ============================================================
-- 3. RPC: get_eval_qa_scores
-- export-by-id 엔드포인트에서 pipeline_results 전체 전송 방지용
-- 반환값: {"rag_qa_scores": [...], "quality_qa_scores": [...]}
-- ============================================================
CREATE OR REPLACE FUNCTION get_eval_qa_scores(p_eval_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'rag_qa_scores',     pipeline_results->'layers'->'rag'->'qa_scores',
    'quality_qa_scores', pipeline_results->'layers'->'quality'->'qa_scores'
  )
  FROM qa_eval_results
  WHERE id = p_eval_id;
$$;

GRANT EXECUTE ON FUNCTION get_eval_qa_scores(UUID) TO anon, authenticated;


-- ============================================================
-- 4. Views
-- ============================================================

-- v_eval_summary: 평가 결과 요약 (평가 목록 화면)
CREATE OR REPLACE VIEW v_eval_summary AS
SELECT
    qg.source_doc                                        AS filename,
    qe.id                                                AS eval_id,
    qe.job_id,
    qe.total_qa,
    qe.valid_qa,
    qe.final_score,
    qe.final_grade,
    qe.created_at::date                                  AS eval_date,
    (qe.scores->'syntax'     ->>'score')::numeric        AS syntax_score,
    (qe.scores->'statistical'->>'score')::numeric        AS stat_score,
    (qe.scores->'rag'        ->>'score')::numeric        AS rag_score,
    (qe.scores->'quality'    ->>'score')::numeric        AS quality_score
FROM qa_eval_results qe
JOIN qa_gen_results qg ON qg.linked_evaluation_id = qe.id
ORDER BY qe.created_at DESC;

-- v_db_health: DB 무결성 점검 뷰 (doc_metadata, doc_chunks, qa_gen_results 교차 검사)
CREATE OR REPLACE VIEW v_db_health AS
SELECT
    'doc_metadata: domain/master null' AS check_item,
    COUNT(*)                           AS count,
    CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'WARN' END AS status,
    CASE WHEN COUNT(*) = 0 THEN NULL
         ELSE string_agg(filename || ' (' || document_id::text || ')', ', ')
    END AS detail
FROM doc_metadata
WHERE domain_profile IS NULL OR h2_h3_master IS NULL

UNION ALL

SELECT
    'doc_chunks: hierarchy_h1 null',
    COUNT(*),
    CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'WARN' END,
    CASE WHEN COUNT(*) = 0 THEN NULL
         ELSE string_agg(DISTINCT
             (metadata->>'filename') || ' / doc_id=' || LEFT(metadata->>'document_id', 8) || '...'
         , ' | ')
    END
FROM doc_chunks
WHERE metadata->>'hierarchy_h1' IS NULL

UNION ALL

SELECT
    'doc_chunks: orphan (no doc_metadata)',
    COUNT(DISTINCT metadata->>'document_id'),
    CASE WHEN COUNT(DISTINCT metadata->>'document_id') = 0 THEN 'OK' ELSE 'WARN' END,
    CASE WHEN COUNT(DISTINCT metadata->>'document_id') = 0 THEN NULL
         ELSE string_agg(DISTINCT
             (metadata->>'filename') || ' / doc_id=' || LEFT(metadata->>'document_id', 8) || '...'
         , ' | ')
    END
FROM doc_chunks dc
WHERE NOT EXISTS (
    SELECT 1 FROM doc_metadata dm
    WHERE dm.document_id::text = dc.metadata->>'document_id'
)

UNION ALL

SELECT
    'qa_gen_results: broken chunk refs',
    COUNT(*),
    CASE WHEN COUNT(*) = 0 THEN 'OK' ELSE 'WARN' END,
    CASE WHEN COUNT(*) = 0 THEN NULL
         ELSE string_agg(source_doc || ' (gen_id=' || LEFT(id::text, 8) || '...)', ' | ')
    END
FROM qa_gen_results qg
WHERE NOT EXISTS (
    SELECT 1 FROM doc_chunks dc
    WHERE dc.id = ANY(qg.doc_chunk_ids)
    LIMIT 1
);

-- v_hierarchy_coverage: 청크 계층 태깅 커버리지 확인
CREATE OR REPLACE VIEW v_hierarchy_coverage AS
SELECT
    metadata->>'filename'      AS filename,
    metadata->>'document_id'   AS document_id,
    metadata->>'hierarchy_h1'  AS h1,
    metadata->>'hierarchy_h2'  AS h2,
    metadata->>'hierarchy_h3'  AS h3,
    COUNT(*)                   AS chunk_count
FROM doc_chunks
WHERE metadata->>'hierarchy_h1' IS NOT NULL
  AND metadata->>'hierarchy_h1' != '__admin__'
GROUP BY
    metadata->>'filename',
    metadata->>'document_id',
    metadata->>'hierarchy_h1',
    metadata->>'hierarchy_h2',
    metadata->>'hierarchy_h3'
ORDER BY filename, h1, h2, h3;


-- ============================================================
-- DB 초기화 (재테스트 시)
-- ============================================================
-- DROP VIEW  IF EXISTS v_eval_summary, v_db_health, v_hierarchy_coverage;
-- DELETE FROM qa_gen_results;
-- DELETE FROM qa_eval_results;
-- DELETE FROM doc_chunks;
