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

  -- scores: 4레이어 요약 점수
  -- {
  --   "syntax": {
  --     "pass_rate": 100.0                          -- float (0-100)
  --   },
  --   "stats": {
  --     "quality_score": 8.04,                      -- integrated_score (0-10)
  --     "diversity": {                              -- _analyze_diversity() 반환 dict
  --       "score": 7.5,
  --       "intent_type_count": 8,
  --       "doc_count": 1,
  --       "vocabulary_diversity": 0.92,
  --       "intent_balance": 0.8,
  --       "intent_distribution": {"factoid": 2, ...},
  --       "question_length": {"avg": 24.5, "std": 3.2},
  --       "answer_length":   {"avg": 68.1, "std": 12.0}
  --     },
  --     "duplication_rate": {                       -- _analyze_duplication_rate() 반환 dict
  --       "score": 10.0,
  --       "duplicate_count": 0,
  --       "near_duplicate_rate": 0.0
  --     }
  --   },
  --   "rag": {                                      -- rag_data["summary"]
  --     "avg_relevance":    0.85,
  --     "avg_groundedness": 0.92,
  --     "avg_clarity":      0.88,
  --     "avg_score":        0.88
  --   },
  --   "quality": {                                  -- quality_data["summary"]
  --     "avg_factuality":   0.90,
  --     "avg_completeness": 0.88,
  --     "avg_groundedness": 0.92,
  --     "avg_quality":      0.90
  --   }
  -- }
  scores      JSONB NOT NULL,

  -- 최종 점수 (자주 쿼리 → 별도 컬럼)
  -- 가중치: syntax*0.2 + stats*0.2 + rag*0.3 + quality*0.3
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
COMMENT ON COLUMN qa_eval_results.scores IS '4레이어 요약 점수: syntax.pass_rate / stats.quality_score+diversity+duplication_rate / rag.avg_* / quality.avg_*';
COMMENT ON COLUMN qa_eval_results.pipeline_results IS 'run_full_evaluation_pipeline() 전체 반환값 (레이어별 qa_scores 포함)';
COMMENT ON COLUMN qa_eval_results.final_score IS '0-1 종합 점수 (syntax*0.2 + stats*0.2 + rag*0.3 + quality*0.3)';

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
CREATE INDEX IF NOT EXISTS idx_qa_gen_metadata_gin  ON qa_gen_results USING GIN (metadata);

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
-- 3. QA 쌍 flat 뷰 (샘플 확인 / 검증용)
-- ============================================================
CREATE OR REPLACE VIEW qa_pairs_view AS
SELECT
  qg.job_id,
  qg.created_at,
  doc->>'docId'                AS doc_id,
  doc->'hierarchy'             AS hierarchy,
  qa->>'q'                     AS question,
  qa->>'a'                     AS answer,
  qa->>'intent'                AS intent,
  (qa->>'answerable')::boolean AS answerable
FROM qa_gen_results qg,
  jsonb_array_elements(qg.qa_list) AS doc,
  jsonb_array_elements(doc->'qa_list') AS qa;

COMMENT ON VIEW qa_pairs_view IS 'qa_gen_results.qa_list 중첩 구조를 flat하게 펼친 QA 샘플 확인용 뷰';


-- ============================================================
-- 4. 조인 뷰 (생성 ↔ 평가)
-- ============================================================
CREATE OR REPLACE VIEW evaluation_qa_joined AS
SELECT
  e.id              AS evaluation_id,
  e.job_id          AS eval_job_id,
  e.final_score,
  e.final_grade,
  e.created_at      AS evaluated_at,
  q.id              AS generation_id,
  q.job_id          AS gen_job_id,
  q.metadata        AS gen_metadata,
  q.stats           AS gen_stats,
  q.qa_list,
  q.created_at      AS generated_at
FROM qa_eval_results e
LEFT JOIN qa_gen_results q
  ON q.linked_evaluation_id = e.id;

COMMENT ON VIEW evaluation_qa_joined IS 'qa_eval_results ↔ qa_gen_results 조인 뷰 (linked_evaluation_id 기준)';


-- ============================================================
-- DB 초기화 (재테스트 시)
-- ============================================================
-- DROP VIEW  IF EXISTS evaluation_qa_joined;
-- DELETE FROM qa_gen_results;
-- DELETE FROM qa_eval_results;
-- DELETE FROM doc_chunks;
