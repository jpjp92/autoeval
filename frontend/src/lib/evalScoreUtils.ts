import type { QAPreviewItem, QAStatus } from '@/src/types/evaluation';

export const SCORE_THRESHOLDS = { high: 0.85, mid: 0.7 } as const;

export function getScoreColor(v: number): string {
  return v >= SCORE_THRESHOLDS.high
    ? 'text-emerald-600'
    : v >= SCORE_THRESHOLDS.mid
      ? 'text-amber-500'
      : 'text-rose-600';
}

export function getQAStatus(qa: Partial<QAPreviewItem>): QAStatus {
  if (!qa) return 'fail';
  const { quality_avg, rag_avg, pass, failure_types } = qa;

  const qFail = quality_avg == null || quality_avg < SCORE_THRESHOLDS.mid;
  const rFail = rag_avg    == null || rag_avg    < SCORE_THRESHOLDS.mid;

  if (qFail && rFail) return 'fail';

  const hasError = (pass === false) || (failure_types && failure_types.length > 0);
  if (!qFail && !rFail && hasError) return 'hold';

  if (qFail || rFail) return 'hold';

  return 'success';
}
