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
  // v2: 백엔드 판정을 그대로 쓴다. 평가 실패·구문 제외는 '보류'로 둔다(품질 판정이 없는 QA).
  if (qa.eval_version === 'v2') {
    if (qa.v2_status === 'pass') return 'success';
    if (qa.v2_status === 'fail' || qa.v2_status === 'hard_fail') return 'fail';
    return 'hold';
  }
  const { quality_avg, rag_avg, pass, failure_types } = qa;

  const qFail = quality_avg == null || quality_avg < SCORE_THRESHOLDS.mid;
  const rFail = rag_avg    == null || rag_avg    < SCORE_THRESHOLDS.mid;

  if (qFail && rFail) return 'fail';

  const hasError = (pass === false) || (failure_types && failure_types.length > 0);
  if (!qFail && !rFail && hasError) return 'hold';

  if (qFail || rFail) return 'hold';

  return 'success';
}
