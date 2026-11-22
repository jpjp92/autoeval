// ─── QA 평가 관련 타입 및 상수 ────────────────────────────────────────────────

export type QAStatus = 'success' | 'hold' | 'fail';

export interface QAPreviewItem {
  qa_index:     number;
  q:            string;
  a?:           string;
  context?:     string;
  intent:       string;
  rag_avg?:     number;
  quality_avg?: number;
  pass:         boolean;
  // individual scores
  relevance?:         number;
  groundedness?:      number;
  context_relevance?: number;
  completeness?:      number;
  // failure
  failure_types?:   string[];
  primary_failure?: string | null;
  failure_reason?:  string;
  // reason — RAG
  relevance_reason?:         string;
  groundedness_reason?:      string;
  context_relevance_reason?: string;
  // reason — Quality
  completeness_reason?: string;
  coverage?:            number;
  missing_aspects?:     string[];
  // ── eval v2 (eval_version === 'v2'일 때만) ──
  eval_version?:      'v2';
  v2_status?:         V2Status;
  correctness?:       number;
  question_quality?:  number;
  qa_score?:          number;
  hard_fail?:         boolean;
  hard_fail_reasons?: string[];
  fail_reasons?:      string[];
  v2_failure_types?:  string[];
  evidence?:          V2Evidence[];
  language_checks?:   Partial<Record<'semantic_equivalence' | 'terminology_consistency' | 'numeric_consistency' | 'modality_preserved', boolean>>;
  language_policy?:   string | null;
  source_language?:   string | null;
  qa_language?:       string | null;
  source_language_from?: 'metadata' | 'inferred' | null;
  reason?:            string;
  evaluation_error?:  string | null;
}

// ─── eval v2 ──────────────────────────────────────────────────────────────────
export type V2Status = 'pass' | 'fail' | 'hard_fail' | 'error' | 'skipped' | 'missing';
export type V2Dimension = 'groundedness' | 'correctness' | 'completeness' | 'question_quality';

export interface V2Evidence { claim: string; source: string; verdict: 'supported' | 'unsupported' | 'contradicted' }

export interface V2Validation {
  total: number; valid: number; invalid: number; pass_rate: number;
  errors_sample?: Record<string, string[]>;
  duplicates: { a: number; b: number; similarity: number; exact: boolean }[];
  /** 중복 의심 쌍에 걸린 QA 수 (쌍 수와 다르다). 이전 결과에는 없을 수 있다 */
  duplicate_qa_count?: number;
  intent_distribution: Record<string, number>;
  doc_distribution: Record<string, number>;
  warnings: { code: string; count?: number; doc?: string; ratio?: number }[];
}

export interface V2JudgeSummary {
  judge_version: string;
  evaluated_count: number; judged_count: number; evaluation_error_count: number;
  pass_count: number; pass_rate: number; hard_fail_count: number;
  averages: Record<V2Dimension, number | null>;
  failure_counts: Record<string, number>;
  by_language_policy: Record<string, { judged: number; pass_rate: number; avg_qa_score: number }>;
  final_score: number | null; grade: string | null; grade_withheld: string | null;
  weights: Record<V2Dimension, number>;
}

export const V2_DIMENSIONS: { key: V2Dimension; label: string; nameEn: string; threshold: number }[] = [
  { key: 'groundedness',     label: '근거성',   nameEn: 'Groundedness',     threshold: 0.6 },
  { key: 'correctness',      label: '정확성',   nameEn: 'Correctness',      threshold: 0.6 },
  { key: 'completeness',     label: '완전성',   nameEn: 'Completeness',     threshold: 0.7 },
  { key: 'question_quality', label: '질문 품질', nameEn: 'Question Quality', threshold: 0.5 },
];

export const LANGUAGE_POLICY_LABEL: Record<string, string> = {
  korean_native:            '한→한',
  english_native:           '영→영',
  cross_language_en_to_ko:  '영→한',
  cross_language_ko_to_en:  '한→영',
};

export const LANGUAGE_CHECK_LABEL: Record<string, string> = {
  semantic_equivalence:    '의미 일치',
  terminology_consistency: '용어 일관',
  numeric_consistency:     '수치·단위 보존',
  modality_preserved:      '가능성·단정 보존',
};

export const GRADE_WITHHELD_LABEL: Record<string, string> = {
  too_many_evaluation_errors: '평가 실패 20% 초과 — 등급 보류',
  no_judged_qa:               '평가된 QA 없음 — 등급 보류',
};

export const VALIDATION_WARNING_LABEL: Record<string, string> = {
  syntax_invalid:      '구문 탈락',
  duplicate_questions: '중복 의심 질문',
  doc_skew:            '문서 쏠림',
};

export function isV2Row(qa: Partial<QAPreviewItem> | null | undefined): boolean {
  return qa?.eval_version === 'v2';
}

export interface EvalReport {
  job_id: string;
  result_filename: string;
  timestamp: string;
  metadata: { total_qa: number; valid_qa: number; evaluator_model: string; eval_version?: 'v1' | 'v2'; judge_version?: string; generation_model?: string; source_doc?: string; hierarchy_h1?: string; hierarchy_h2?: string; hierarchy_h3?: string };
  pipeline_results: {
    syntax?:  { total: number; valid: number; invalid: number; pass_rate: number };
    stats?:   {
      integrated_score: number;
      diversity:        { score: number; intent_distribution: Record<string, number> };
      duplication_rate: { score: number };
      skewness:         { score: number };
      data_sufficiency: { score: number };
      metrics?: { diversity_score?: number; duplication_score?: number; skewness_score?: number; sufficiency_score?: number };
    };
    rag?:     { evaluated_count: number; summary: { avg_relevance: number; avg_groundedness: number; avg_context_relevance?: number; avg_score: number } };
    quality?: { pass_count: number; pass_rate: number; summary: { avg_completeness: number; avg_quality: number } };
    validation?: V2Validation;
    judge?:      V2JudgeSummary;
  };
  summary: {
    eval_version?: 'v2';
    grade_withheld?: string | null;
    pass_count?: number;
    pass_rate?: number;
    hard_fail_count?: number;
    evaluation_error_count?: number;
    duplicate_count?: number;
    syntax_pass_rate: number;
    dataset_quality_score?: number;
    rag_average_score?: number;
    quality_average_score?: number;
    quality_pass_rate: number;
    final_score: number | null;
    grade: string | null;
  };
  qa_preview?: QAPreviewItem[];
}

export interface HistoryItem {
  id: string;
  job_id: string;
  metadata: { generation_model?: string; evaluator_model?: string; eval_version?: 'v1' | 'v2'; judge_version?: string; grade_withheld?: string | null; lang?: string; source_doc?: string; hierarchy_h1?: string; hierarchy_h2?: string; hierarchy_h3?: string };
  result_filename?: string;
  total_qa: number;
  final_score: number;
  final_grade: string;
  created_at: string;
  scores?: Record<string, any>;
  pipeline_results?: Record<string, any>;
}

// ─── Intent 레이블 ─────────────────────────────────────────────────────────────
export const INTENT_KR: Record<string, string> = {
  fact:       '사실형',
  purpose:    '원인형',
  how:        '방법형',
  condition:  '조건형',
  comparison: '비교형',
  list:       '열거형',
};

export const INTENT_COLORS: Record<string, string> = {
  fact:       '#3b7dd8',
  purpose:    '#a855b5',
  how:        '#16a35a',
  condition:  '#d97706',
  comparison: '#4f46e5',
  list:       '#0891b2',
};

export const INTENT_DESCRIPTIONS: Record<string, string> = {
  fact:       '명확한 사실 정보를 확인하는 질문',
  purpose:    '원인, 배경, 이유를 탐색하는 질문',
  how:        '구체적 방법이나 절차를 묻는 질문',
  condition:  '조건·상황별 결과를 확인하는 질문',
  comparison: '여러 대상을 비교하는 질문',
  list:       '여러 항목을 나열·열거하는 질문',
};

export const STATUS_CONFIG: Record<QAStatus, { label: string; className: string; dotColor: string }> = {
  success: { label: '성공', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', dotColor: 'bg-emerald-500' },
  hold:    { label: '보류', className: 'bg-amber-50 text-amber-700 border-amber-200',       dotColor: 'bg-amber-400'  },
  fail:    { label: '실패', className: 'bg-rose-50 text-rose-700 border-rose-200',          dotColor: 'bg-rose-500'   },
};

export const FAILURE_CONFIG: Record<string, { label: string; className: string }> = {
  hallucination:      { label: '환각오류',   className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-500/20' },
  faithfulness_error: { label: '근거오류',   className: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-500/20' },
  poor_context:       { label: '문맥부족',   className: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-slate-800/50 dark:text-slate-200 dark:border-slate-700/50' },
  retrieval_miss:     { label: '검색오류',   className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-500/20' },
  ambiguous_question: { label: '질문모호',   className: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-700/50' },
  bad_chunk:          { label: '불량청크',   className: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800/40 dark:text-slate-400 dark:border-slate-700/30' },
  evaluation_error:   { label: '평가오류',   className: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-indigo-950/30 dark:text-indigo-200 dark:border-indigo-500/20' },
  low_quality:        { label: '품질미달',   className: 'bg-pink-50 text-pink-700 border-pink-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-500/20' },
  // eval v2
  low_groundedness:      { label: '근거부족',   className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-500/20' },
  low_correctness:       { label: '수치·사실오류', className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-500/20' },
  contradicted_claim:    { label: '원문모순',   className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-500/20' },
  low_score:             { label: '점수미달',   className: 'bg-pink-50 text-pink-700 border-pink-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-500/20' },
  low_question_quality:  { label: '질문품질미달', className: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-700/50' },
  unsupported_claim:     { label: '근거없는주장', className: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-500/20' },
  numeric_error:         { label: '수치오류',   className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-500/20' },
  incomplete:            { label: '답변누락',   className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-500/20' },
  unanswerable_question: { label: '답변불가질문', className: 'bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-700/50' },
  meaning_shift:         { label: '의미변형',   className: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-500/20' },
  modality_mismatch:     { label: '가능성→단정', className: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-500/20' },
  negation_error:        { label: '부정반전',   className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-500/20' },
  unit_mismatch:         { label: '단위불일치', className: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-500/20' },
  terminology_error:     { label: '용어오류',   className: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-slate-800/50 dark:text-slate-200 dark:border-slate-700/50' },
  condition_omitted:     { label: '조건누락',   className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-200 dark:border-amber-500/20' },
  syntax_error:       { label: '구문오류',   className: 'bg-red-50 text-red-700 border-red-200 dark:bg-rose-950/30 dark:text-rose-200 dark:border-rose-500/20' },
};

export const GRADE_COLOR: Record<string, string> = {
  'A+': 'text-emerald-600 bg-emerald-50 border-emerald-200',
  'A':  'text-emerald-600 bg-emerald-50 border-emerald-200',
  'B+': 'text-blue-600 bg-blue-50 border-blue-200',
  'B':  'text-blue-600 bg-blue-50 border-blue-200',
  'C':  'text-amber-600 bg-amber-50 border-amber-200',
  'F':  'text-rose-600 bg-rose-50 border-rose-200',
};

export const QA_PAGE_SIZE = 5;

// 주장별 근거 판정 표시(화면·HTML·xlsx 공통). RAG 평가 도구의 supported / unsupported / contradicted 3단계를 따른다.
export const VERDICT_LABEL: Record<string, string> = {
  supported: '근거 일치',
  unsupported: '근거 없음',
  contradicted: '원문과 상충',
};
