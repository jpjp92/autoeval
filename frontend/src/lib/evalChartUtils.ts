import { FileText, CheckCircle2, Target, Activity } from 'lucide-react';
import type { EvalReport, HistoryItem } from '@/src/types/evaluation';
import { INTENT_KR } from '@/src/types/evaluation';
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

export function buildChartData(report: EvalReport) {
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
      tooltip: { title: '통합 품질 평균 점수', items: [{ text: '전체 QA 데이터의 평균 종합 점수입니다 (0~1).' }, { label: '구성', text: 'RAG Triad + 품질 평가 + 구조 검증 점수의 가중합' }] } },
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
    { name: '관련성', nameEn: 'Answer Relevance',  score: rag?.summary?.avg_relevance          ?? 0, group: 'rag'     as const },
    { name: '근거성', nameEn: 'Groundedness',       score: rag?.summary?.avg_groundedness       ?? 0, group: 'rag'     as const },
    { name: '맥락성', nameEn: 'Context Relevance',  score: rag?.summary?.avg_context_relevance  ?? 0, group: 'rag'     as const },
    { name: '완전성', nameEn: 'Completeness',        score: qua?.summary?.avg_completeness       ?? 0, group: 'quality' as const },
  ];

  return { summaryStats, layer1Stats, intentDistribution, llmQualityScores };
}

export function buildChartDataFromHistory(item: HistoryItem) {
  const pl  = item.pipeline_results?.layers ?? {};
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
      tooltip: { title: '통합 품질 평균 점수', items: [{ text: '전체 QA 데이터의 평균 종합 점수입니다 (0~1).' }, { label: '구성', text: 'RAG Triad + 품질 평가 + 구조 검증 점수의 가중합' }] } },
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
    { name: '관련성', nameEn: 'Answer Relevance',  score: rag?.summary?.avg_relevance          ?? 0, group: 'rag'     as const },
    { name: '근거성', nameEn: 'Groundedness',       score: rag?.summary?.avg_groundedness       ?? 0, group: 'rag'     as const },
    { name: '맥락성', nameEn: 'Context Relevance',  score: rag?.summary?.avg_context_relevance  ?? 0, group: 'rag'     as const },
    { name: '완전성', nameEn: 'Completeness',        score: qua?.summary?.avg_completeness       ?? 0, group: 'quality' as const },
  ];

  return { summaryStats, layer1Stats, intentDistribution, llmQualityScores };
}
