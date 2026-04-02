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
}

export interface EvalReport {
  job_id: string;
  result_filename: string;
  timestamp: string;
  metadata: { total_qa: number; valid_qa: number; evaluator_model: string; generation_model?: string; source_doc?: string; hierarchy_h1?: string; hierarchy_h2?: string; hierarchy_h3?: string };
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
  };
  summary: {
    syntax_pass_rate: number;
    dataset_quality_score: number;
    rag_average_score: number;
    quality_average_score: number;
    quality_pass_rate: number;
    final_score: number;
    grade: string;
  };
  qa_preview?: QAPreviewItem[];
}

export interface HistoryItem {
  id: string;
  job_id: string;
  metadata: { generation_model?: string; evaluator_model?: string; lang?: string; source_doc?: string; hierarchy_h1?: string; hierarchy_h2?: string; hierarchy_h3?: string };
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
  comparison: '두 대상 이상을 비교하는 질문',
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
