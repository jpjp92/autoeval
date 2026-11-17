import type { QAPreviewItem } from '@/src/types/evaluation';
import type { V2View } from '@/src/lib/evalChartUtils';

export interface EvaluationData {
  summaryStats: Array<{ label: string; value: string; icon?: any; color?: string; bg?: string }>;
  layer1Stats: Array<{ subject: string; A: number; fullMark: number }>;
  intentDistribution: Array<{ name: string; label?: string; krLabel?: string; value: number }>;
  llmQualityScores: Array<{ name: string; nameEn?: string; score: number; group?: 'rag' | 'quality' }>;
  detailedQA: Array<{
    id: number;
    q: string;
    a?: string;
    context?: string;
    intent: string;
    l2_avg: number;
    triad_avg: number;
    pass: boolean;
    primary_failure?: string | null;
    failure_types?: string[];
    relevance_reason?: string;
    groundedness_reason?: string;
    context_relevance_reason?: string;
    completeness_reason?: string;
    failure_reason?: string;
    relevance?:         number;
    groundedness?:      number;
    context_relevance?: number;
    completeness?:      number;
    /** eval v2 행 (있으면 v2 리포트 형식으로 내보낸다) */
    v2?: QAPreviewItem;
  }>;
  /** eval v2 요약 (있으면 v2 리포트) */
  v2?: V2View | null;
  metadata?: {
    qa_model?:   string;
    eval_model?: string;
    lang?:       string;
    timestamp?:  string;
    source?:     string;
    eval_version?: string;
    judge_version?: string;
  };
}
