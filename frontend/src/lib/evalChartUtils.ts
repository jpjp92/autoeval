import { FileText, CheckCircle2, Target, Activity, ShieldAlert } from 'lucide-react';
import type { EvalReport, HistoryItem, V2Validation, V2JudgeSummary } from '@/src/types/evaluation';
import { INTENT_KR, V2_DIMENSIONS, GRADE_WITHHELD_LABEL } from '@/src/types/evaluation';
import { getQAStatus } from '@/src/lib/evalScoreUtils';

export interface TooltipItem { text: string; label?: string; }
export interface SummaryStat {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  bg: string;
  tooltip: { title: string; items: TooltipItem[] };
}

export function formatKST(dateStr: string): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

// ─── eval v2 ──────────────────────────────────────────────────────────────────
export interface V2View {
  validation: V2Validation;
  judge: V2JudgeSummary;
  /** 평가 v2 결과의 요약 카드 (화면·리포트 공용) */
  conclusion: string;
}

export function isV2Report(report?: EvalReport | null, item?: HistoryItem | null): boolean {
  return (report?.metadata?.eval_version ?? item?.metadata?.eval_version) === 'v2';
}

function pct(n: number | null | undefined): string {
  return n == null ? '-' : `${n.toFixed(1)}%`;
}

export function v2Conclusion(total: number, judge: V2JudgeSummary, failureLabel: (k: string) => string): string {
  const grade = judge.grade ?? (judge.grade_withheld ? '보류' : '-');
  const top = Object.entries(judge.failure_counts)
    .sort((a, b) => b[1] - a[1]).slice(0, 2)
    .map(([k, v]) => `${failureLabel(k)} ${v}건`);
  const head = judge.judged_count === total
    ? `${total}개 중 ${judge.pass_count}개 통과(${pct(judge.pass_rate)})`
    : `전체 ${total}개 중 ${judge.judged_count}개 평가, ${judge.pass_count}개 통과(${pct(judge.pass_rate)})`;
  const parts = [`${head}, 등급 ${grade}.`];
  if (judge.hard_fail_count) parts.push(`근거·수치 오류 ${judge.hard_fail_count}건.`);
  if (judge.evaluation_error_count) parts.push(`평가 실패 ${judge.evaluation_error_count}건.`);
  if (top.length) parts.push(`주요 실패: ${top.join(', ')}.`);
  return parts.join(' ');
}

function buildV2(total: number, validation: V2Validation, judge: V2JudgeSummary, failureLabel: (k: string) => string) {
  const gradeValue = judge.grade ?? '보류';
  const summaryStats: SummaryStat[] = [
    { label: '전체 QA', value: total.toLocaleString(), icon: FileText, color: 'text-indigo-600', bg: 'bg-indigo-100',
      tooltip: { title: '전체 QA', items: [{ text: '평가 대상 QA 수입니다.' }, { label: '구문 정상', text: `${validation.valid} / ${validation.total}` }] } },
    { label: '품질 통과', value: `${judge.pass_count} / ${judge.judged_count}`, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100',
      tooltip: { title: '품질 통과', items: [{ text: '근거·수치 오류가 없고, QA 점수 0.70 이상, 질문 품질 0.5 이상인 QA입니다.' }, { label: '통과율', text: pct(judge.pass_rate) }] } },
    { label: '종합 평가 등급', value: gradeValue, icon: Activity, color: 'text-rose-600', bg: 'bg-rose-100',
      tooltip: { title: '종합 평가 등급', items: [
        { text: judge.grade_withheld ? (GRADE_WITHHELD_LABEL[judge.grade_withheld] ?? judge.grade_withheld) : 'QA 점수 평균으로 정합니다. 근거·수치 오류 QA는 0.5배로 반영합니다.' },
        { label: '최종 점수', text: judge.final_score != null ? judge.final_score.toFixed(3) : '-' },
        { label: '구간', text: 'A+ 0.95 · A 0.85 · B+ 0.75 · B 0.65 · C 0.50' },
      ] } },
    { label: '근거·수치 오류', value: `${judge.hard_fail_count}건`, icon: ShieldAlert, color: 'text-amber-600', bg: 'bg-amber-100',
      tooltip: { title: '근거·수치 오류 / 평가 실패', items: [
        { text: '근거성·정확성 0.6 미만이거나 원문과 모순되는 주장이 있는 QA입니다. 점수와 관계없이 불통과입니다.' },
        { label: '평가 실패', text: `${judge.evaluation_error_count}건 (점수 계산에서 제외)` },
      ] } },
  ];
  const intentDistribution = Object.entries(validation.intent_distribution ?? {}).map(([name, value]) => ({
    name, label: name.charAt(0).toUpperCase() + name.slice(1), krLabel: INTENT_KR[name] ?? name, value: value as number,
  }));
  const llmQualityScores = V2_DIMENSIONS.map(d => ({
    name: d.label, nameEn: d.nameEn, score: judge.averages?.[d.key] ?? 0, group: 'quality' as const,
  }));
  const v2: V2View = { validation, judge, conclusion: v2Conclusion(total, judge, failureLabel) };
  return { summaryStats, layer1Stats: [] as any[], intentDistribution, llmQualityScores, v2 };
}

export function buildChartData(report: EvalReport, failureLabel: (k: string) => string = k => k) {
  const pr = report.pipeline_results;
  if (isV2Report(report) && pr?.validation && pr?.judge) {
    return buildV2(report.metadata.total_qa, pr.validation, pr.judge, failureLabel);
  }
  const s   = report.pipeline_results?.stats;
  const rag = report.pipeline_results?.rag;
  const qua = report.pipeline_results?.quality;
  const sum = report.summary;

  const successCount = (report.qa_preview ?? [])
    .filter(qa => getQAStatus(qa) === 'success').length;

  const summaryStats = [
    { label: '총 생성된 QA',       value: report.metadata.total_qa.toLocaleString(), icon: FileText,    color: 'text-indigo-600',  bg: 'bg-indigo-100',
      tooltip: { title: '총 생성된 QA', items: [{ text: '문서에서 추출된 전체 질의응답 세트의 수입니다.' }, { label: '기준', text: '의미론적 중복을 제거한 최종본 개수' }] } },
    { label: '성공 QA 수',         value: `${successCount} / ${report.metadata.total_qa.toLocaleString()}`, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100',
      tooltip: { title: '성공 QA 수', items: [{ text: '검증을 통과한 고품질 QA 세트의 수입니다.' }, { label: '기준', text: '전체 지표 통과 및 구조적 오류가 없는 데이터' }] } },
    { label: '통합 품질 평균 점수', value: (sum.final_score ?? 0).toFixed(3), icon: Target,       color: 'text-amber-600',   bg: 'bg-amber-100',
      tooltip: { title: '통합 품질 평균 점수', items: [{ text: '전체 QA 데이터의 평균 종합 점수입니다 (0~1).' }, { label: '구성', text: 'LLM 품질 평가 ×0.9 + 구문·통계 ×0.1' }] } },
    { label: '종합 평가 등급',     value: sum.grade ?? '-', icon: Activity,     color: 'text-rose-600',    bg: 'bg-rose-100',
      tooltip: { title: '종합 평가 등급', items: [{ text: '데이터셋의 최종 활용 가능성을 나타내는 등급입니다.' }, { label: 'A등급', text: '우수 (즉시 상용화 가능)' }, { label: 'B등급', text: '양호 (일부 검토 요망)' }, { label: 'C 이하', text: '미흡 (재생성 권장)' }] } },
  ];

  const layer1Stats = [
    { subject: '다양성', A: s?.metrics?.diversity_score    ?? s?.diversity?.score        ?? 0, fullMark: 10 },
    { subject: '중복성', A: s?.metrics?.duplication_score  ?? s?.duplication_rate?.score ?? 0, fullMark: 10 },
    { subject: '편향성', A: s?.metrics?.skewness_score     ?? s?.skewness?.score         ?? 0, fullMark: 10 },
    { subject: '충족성', A: s?.metrics?.sufficiency_score  ?? s?.data_sufficiency?.score ?? 0, fullMark: 10 },
  ];

  const intentDist = s?.diversity?.intent_distribution ?? {};
  const intentDistribution = Object.entries(intentDist).map(([name, value]) => ({
    name,
    label:   name.charAt(0).toUpperCase() + name.slice(1),
    krLabel: INTENT_KR[name] ?? name,
    value:   value as number,
  }));

  const llmQualityScores = [
    { name: '관련성', nameEn: 'Answer Relevance',  score: rag?.summary?.avg_relevance          ?? 0, group: 'quality' as const },
    { name: '근거성', nameEn: 'Groundedness',       score: rag?.summary?.avg_groundedness       ?? 0, group: 'quality' as const },
    { name: '맥락성', nameEn: 'Context Relevance',  score: rag?.summary?.avg_context_relevance  ?? 0, group: 'quality' as const },
    { name: '완전성', nameEn: 'Completeness',        score: qua?.summary?.avg_completeness       ?? 0, group: 'quality' as const },
  ];

  return { summaryStats, layer1Stats, intentDistribution, llmQualityScores, v2: null as V2View | null };
}

export function buildChartDataFromHistory(item: HistoryItem, failureLabel: (k: string) => string = k => k) {
  const pl  = item.pipeline_results?.layers ?? {};
  if (isV2Report(null, item) && pl.validation && pl.judge) {
    return buildV2(item.total_qa, pl.validation, pl.judge, failureLabel);
  }
  const st  = pl.stats;
  const rag = pl.rag;
  const qua = pl.quality;
  const sc  = item.scores ?? {};

  const passCount = sc.quality?.pass_count ?? sc.syntax?.valid ?? item.total_qa;

  const summaryStats = [
    { label: '총 생성된 QA',       value: item.total_qa.toLocaleString(), icon: FileText,    color: 'text-indigo-600',  bg: 'bg-indigo-100',
      tooltip: { title: '총 생성된 QA', items: [{ text: '문서에서 추출된 전체 질의응답 세트의 수입니다.' }, { label: '기준', text: '의미론적 중복을 제거한 최종본 개수' }] } },
    { label: '성공 QA 수',         value: `${passCount} / ${item.total_qa.toLocaleString()}`, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100',
      tooltip: { title: '성공 QA 수', items: [{ text: '검증을 통과한 고품질 QA 세트의 수입니다.' }, { label: '기준', text: '전체 지표 통과 및 구조적 오류가 없는 데이터' }] } },
    { label: '통합 품질 평균 점수', value: (item.final_score ?? 0).toFixed(3), icon: Target,  color: 'text-amber-600',   bg: 'bg-amber-100',
      tooltip: { title: '통합 품질 평균 점수', items: [{ text: '전체 QA 데이터의 평균 종합 점수입니다 (0~1).' }, { label: '구성', text: 'LLM 품질 평가 ×0.9 + 구문·통계 ×0.1' }] } },
    { label: '종합 평가 등급',     value: item.final_grade ?? '-', icon: Activity,            color: 'text-rose-600',    bg: 'bg-rose-100',
      tooltip: { title: '종합 평가 등급', items: [{ text: '데이터셋의 최종 활용 가능성을 나타내는 등급입니다.' }, { label: 'A등급', text: '우수 (즉시 상용화 가능)' }, { label: 'B등급', text: '양호 (일부 검토 요망)' }, { label: 'C 이하', text: '미흡 (재생성 권장)' }] } },
  ];

  const layer1Stats = [
    { subject: '다양성', A: st?.metrics?.diversity_score    ?? st?.diversity?.score        ?? 0, fullMark: 10 },
    { subject: '중복성', A: st?.metrics?.duplication_score  ?? st?.duplication_rate?.score ?? 0, fullMark: 10 },
    { subject: '편향성', A: st?.metrics?.skewness_score     ?? st?.skewness?.score         ?? 0, fullMark: 10 },
    { subject: '충족성', A: st?.metrics?.sufficiency_score  ?? st?.data_sufficiency?.score ?? 0, fullMark: 10 },
  ];

  const intentDist = st?.diversity?.intent_distribution ?? {};
  const intentDistribution = Object.entries(intentDist).map(([name, value]) => ({
    name, label: name.charAt(0).toUpperCase() + name.slice(1), krLabel: INTENT_KR[name] ?? name, value: value as number,
  }));

  const llmQualityScores = [
    { name: '관련성', nameEn: 'Answer Relevance',  score: rag?.summary?.avg_relevance          ?? 0, group: 'quality' as const },
    { name: '근거성', nameEn: 'Groundedness',       score: rag?.summary?.avg_groundedness       ?? 0, group: 'quality' as const },
    { name: '맥락성', nameEn: 'Context Relevance',  score: rag?.summary?.avg_context_relevance  ?? 0, group: 'quality' as const },
    { name: '완전성', nameEn: 'Completeness',        score: qua?.summary?.avg_completeness       ?? 0, group: 'quality' as const },
  ];

  return { summaryStats, layer1Stats, intentDistribution, llmQualityScores, v2: null as V2View | null };
}
