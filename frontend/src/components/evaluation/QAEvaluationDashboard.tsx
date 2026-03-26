import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts';
import {
  Download, CheckCircle2, AlertCircle, FileText, Activity, Target, Zap,
  Code2, ChevronDown, Clock, History, Loader2, LayoutGrid, Info,
  ArrowLeft, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useState, useEffect, useRef } from 'react';
import { exportToCSV, exportToHTML, exportToJSON, exportToZip } from '@/src/lib/exportUtils';
import { getEvalStatus, getEvalHistory, getEvalExport, getEvalExportById } from '@/src/lib/api';

// ─── Intent 레이블 ────────────────────────────────────────────────────────────
const INTENT_KR: Record<string, string> = {
  // 신규 6종 (2026-03-25~)
  fact:       '사실형',
  purpose:    '원인형',
  how:        '방법형',
  condition:  '조건형',
  comparison: '비교형',
  list:       '열거형',
  // 구형 8종 (하위 호환)
  factoid:    '사실형',
  numeric:    '수치형',
  procedure:  '절차형',
  why:        '원인형',
  definition: '정의형',
  boolean:    '확인형',
};

const INTENT_COLORS: Record<string, string> = {
  // 신규 6종
  fact:       '#3b82f6',
  purpose:    '#d946ef',
  how:        '#22c55e',
  condition:  '#f59e0b',
  comparison: '#6366f1',
  list:       '#06b6d4',
  // 구형 8종 (하위 호환)
  factoid:    '#3b82f6',
  numeric:    '#eab308',
  procedure:  '#6366f1',
  why:        '#d946ef',
  definition: '#0ea5e9',
  boolean:    '#c026d3',
};

// ─── 상태 로직 ────────────────────────────────────────────────────────────────
type QAStatus = 'success' | 'hold' | 'fail';

function getQAStatus(quality_avg?: number | null, rag_avg?: number | null): QAStatus {
  // null/undefined = 미평가 → 임계값 미달로 처리 (export와 동일 기준)
  const qFail = quality_avg == null || quality_avg < 0.7;
  const rFail = rag_avg    == null || rag_avg    < 0.7;
  if (qFail && rFail)    return 'fail';
  if (qFail || rFail)    return 'hold';
  return 'success';
}

const STATUS_CONFIG: Record<QAStatus, { label: string; className: string; dotColor: string }> = {
  success: { label: '성공', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', dotColor: 'bg-emerald-500' },
  hold:    { label: '보류', className: 'bg-amber-50 text-amber-700 border-amber-200',       dotColor: 'bg-amber-400'  },
  fail:    { label: '실패', className: 'bg-rose-50 text-rose-700 border-rose-200',          dotColor: 'bg-rose-500'   },
};

// ─── Failure Type ─────────────────────────────────────────────────────────────
const FAILURE_CONFIG: Record<string, { label: string; className: string }> = {
  hallucination:      { label: '환각오류',   className: 'bg-rose-50 text-rose-700 border-rose-200' },
  faithfulness_error: { label: '근거오류',   className: 'bg-orange-50 text-orange-700 border-orange-200' },
  retrieval_miss:     { label: '검색오류',   className: 'bg-amber-50 text-amber-700 border-amber-200' },
  ambiguous_question: { label: '질문모호',   className: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  bad_chunk:          { label: '불량청크',   className: 'bg-slate-100 text-slate-600 border-slate-200' },
  evaluation_error:   { label: '평가오류',   className: 'bg-purple-50 text-purple-700 border-purple-200' },
  low_quality:        { label: '품질미달',   className: 'bg-pink-50 text-pink-700 border-pink-200' },
  syntax_error:       { label: '구문오류',   className: 'bg-red-50 text-red-700 border-red-200' },
};

// ─── 타입 ─────────────────────────────────────────────────────────────────────
interface QAPreviewItem {
  qa_index:     number;
  q:            string;
  a?:           string;
  context?:     string;
  intent:       string;
  rag_avg?:     number;
  quality_avg?: number;
  pass:         boolean;
  // failure
  failure_types?:   string[];
  primary_failure?: string | null;
  failure_reason?:  string;
  // reason — RAG
  relevance_reason?:    string;
  groundedness_reason?: string;
  clarity_reason?:      string;
  // reason — Quality
  factuality_reason?:   string;
  completeness_reason?: string;
  specificity_reason?:  string;
  conciseness_reason?:  string;
}

interface EvalReport {
  job_id: string;
  result_filename: string;
  timestamp: string;
  metadata: { total_qa: number; valid_qa: number; evaluator_model: string; generation_model?: string; source_doc?: string };
  pipeline_results: {
    syntax?:  { total: number; valid: number; invalid: number; pass_rate: number };
    stats?:   {
      integrated_score: number;
      diversity:        { score: number; intent_distribution: Record<string, number> };
      duplication_rate: { score: number };
      skewness:         { score: number };
      data_sufficiency: { score: number };
    };
    rag?:     { evaluated_count: number; summary: { avg_relevance: number; avg_groundedness: number; avg_clarity: number; avg_score: number } };
    quality?: { pass_count: number; pass_rate: number; summary: { avg_completeness: number; avg_quality: number; avg_factuality?: number; avg_specificity?: number; avg_conciseness?: number } };
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

interface HistoryItem {
  id: string;
  job_id: string;
  metadata: { generation_model?: string; evaluator_model?: string; lang?: string; source_doc?: string };
  result_filename?: string;
  total_qa: number;
  final_score: number;
  final_grade: string;
  created_at: string;
  scores?: Record<string, any>;
  pipeline_results?: Record<string, any>;
}

// ─── 시간 포맷 (KST) ─────────────────────────────────────────────────────────
function formatKST(dateStr: string): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
}

// ─── 데이터 변환 ──────────────────────────────────────────────────────────────
function buildChartData(report: EvalReport) {
  const s   = report.pipeline_results?.stats;
  const rag = report.pipeline_results?.rag;
  const qua = report.pipeline_results?.quality;
  const sum = report.summary;

  const successCount = (report.qa_preview ?? [])
    .filter(qa => getQAStatus(qa.quality_avg, qa.rag_avg) === 'success').length;
  const summaryStats = [
    { label: '총 생성된 QA',   value: report.metadata.total_qa.toLocaleString(), icon: FileText,    color: 'text-indigo-600',  bg: 'bg-indigo-100' },
    { label: '성공 QA 수',     value: `${successCount} / ${report.metadata.total_qa.toLocaleString()}`, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100' },
    { label: 'RAG Triad 평균', value: (sum.rag_average_score ?? 0).toFixed(3),    icon: Activity,     color: 'text-rose-600',    bg: 'bg-rose-100' },
    { label: '품질 평균 점수', value: (sum.quality_average_score ?? 0).toFixed(3), icon: Target,       color: 'text-amber-600',   bg: 'bg-amber-100' },
  ];

  const layer1Stats = [
    { subject: '다양성', A: s?.diversity?.score        ?? 0, fullMark: 10 },
    { subject: '중복성', A: s?.duplication_rate?.score ?? 0, fullMark: 10 },
    { subject: '편향성', A: s?.skewness?.score         ?? 0, fullMark: 10 },
    { subject: '충분성', A: s?.data_sufficiency?.score ?? 0, fullMark: 10 },
  ];

  const intentDist = s?.diversity?.intent_distribution ?? {};
  const intentDistribution = Object.entries(intentDist).map(([name, value]) => ({
    name,
    label:   name.charAt(0).toUpperCase() + name.slice(1),
    krLabel: INTENT_KR[name] ?? name,
    value:   value as number,
  }));

  const isLegacyQuality = !!(qua?.summary?.avg_factuality);
  const llmQualityScores = [
    { name: '관련성', nameEn: 'Relevance',    score: rag?.summary?.avg_relevance    ?? 0, group: 'rag' as const },
    { name: '근거성', nameEn: 'Groundedness', score: rag?.summary?.avg_groundedness ?? 0, group: 'rag' as const },
    { name: '명확성', nameEn: 'Clarity',      score: rag?.summary?.avg_clarity      ?? 0, group: 'rag' as const },
    ...(isLegacyQuality ? [
      { name: '사실성', nameEn: 'Factuality',   score: qua?.summary?.avg_factuality   ?? 0, group: 'quality' as const },
      { name: '완전성', nameEn: 'Completeness', score: qua?.summary?.avg_completeness ?? 0, group: 'quality' as const },
      { name: '구체성', nameEn: 'Specificity',  score: qua?.summary?.avg_specificity  ?? 0, group: 'quality' as const },
      { name: '간결성', nameEn: 'Conciseness',  score: qua?.summary?.avg_conciseness  ?? 0, group: 'quality' as const },
    ] : [
      { name: '완전성', nameEn: 'Completeness', score: qua?.summary?.avg_completeness ?? 0, group: 'quality' as const },
    ]),
  ];

  return { summaryStats, layer1Stats, intentDistribution, llmQualityScores };
}

function buildChartDataFromHistory(item: HistoryItem) {
  const pl  = item.pipeline_results?.layers ?? {};
  const st  = pl.stats;
  const rag = pl.rag;
  const qua = pl.quality;
  const sc  = item.scores ?? {};

  const passCount = sc.quality?.pass_count ?? sc.syntax?.valid ?? item.total_qa;
  const summaryStats = [
    { label: '총 생성된 QA',   value: item.total_qa.toLocaleString(),                                          icon: FileText,    color: 'text-indigo-600',  bg: 'bg-indigo-100' },
    { label: '성공 QA 수',     value: `${passCount} / ${item.total_qa.toLocaleString()}`,                      icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100' },
    { label: 'RAG Triad 평균', value: (rag?.summary?.avg_score   ?? 0).toFixed(3),                            icon: Activity,     color: 'text-rose-600',    bg: 'bg-rose-100' },
    { label: '품질 평균 점수', value: (qua?.summary?.avg_quality  ?? 0).toFixed(3),                            icon: Target,       color: 'text-amber-600',   bg: 'bg-amber-100' },
  ];

  const layer1Stats = [
    { subject: '다양성', A: st?.diversity?.score        ?? 0, fullMark: 10 },
    { subject: '중복성', A: st?.duplication_rate?.score ?? 0, fullMark: 10 },
    { subject: '편향성', A: st?.skewness?.score         ?? 0, fullMark: 10 },
    { subject: '충분성', A: st?.data_sufficiency?.score ?? 0, fullMark: 10 },
  ];

  const intentDist = st?.diversity?.intent_distribution ?? {};
  const intentDistribution = Object.entries(intentDist).map(([name, value]) => ({
    name, label: name.charAt(0).toUpperCase() + name.slice(1), krLabel: INTENT_KR[name] ?? name, value: value as number,
  }));

  const isLegacyQuality = !!(qua?.summary?.avg_factuality);
  const llmQualityScores = [
    { name: '관련성', nameEn: 'Relevance',    score: rag?.summary?.avg_relevance    ?? 0, group: 'rag' as const },
    { name: '근거성', nameEn: 'Groundedness', score: rag?.summary?.avg_groundedness ?? 0, group: 'rag' as const },
    { name: '명확성', nameEn: 'Clarity',      score: rag?.summary?.avg_clarity      ?? 0, group: 'rag' as const },
    ...(isLegacyQuality ? [
      { name: '사실성', nameEn: 'Factuality',   score: qua?.summary?.avg_factuality   ?? 0, group: 'quality' as const },
      { name: '완전성', nameEn: 'Completeness', score: qua?.summary?.avg_completeness ?? 0, group: 'quality' as const },
      { name: '구체성', nameEn: 'Specificity',  score: qua?.summary?.avg_specificity  ?? 0, group: 'quality' as const },
      { name: '간결성', nameEn: 'Conciseness',  score: qua?.summary?.avg_conciseness  ?? 0, group: 'quality' as const },
    ] : [
      { name: '완전성', nameEn: 'Completeness', score: qua?.summary?.avg_completeness ?? 0, group: 'quality' as const },
    ]),
  ];

  return { summaryStats, layer1Stats, intentDistribution, llmQualityScores };
}

// ─── 커스텀 툴팁 (PieChart) ───────────────────────────────────────────────────
const IntentTooltip = ({ active, payload }: any) => {
  if (active && payload?.length) {
    const d = payload[0].payload;
    return (
      <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-md">
        <p className="text-xs font-semibold text-slate-900">{d.krLabel} <span className="text-slate-400 font-normal">({d.label})</span></p>
        <p className="text-xs text-slate-500 mt-1">수량: <span className="font-bold text-slate-700">{d.value}</span></p>
      </div>
    );
  }
  return null;
};

// ─── 차트 정보 툴팁 ──────────────────────────────────────────────────────────
function ChartInfoTooltip({ title, items }: {
  title: string;
  items: Array<{ label?: string; text: string }>;
}) {
  return (
    <div className="relative group flex-shrink-0">
      <Info className="w-3.5 h-3.5 text-slate-300 group-hover:text-slate-400 cursor-default transition-colors" />
      <div className="absolute right-0 top-5 w-60 bg-slate-800 rounded-xl p-3 z-30 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none shadow-xl">
        <p className="text-[11px] font-semibold text-white mb-2">{title}</p>
        <div className="space-y-1.5">
          {items.map((item, i) => (
            <div key={i} className="flex gap-1.5 text-[11px] leading-snug">
              {item.label && (
                <span className="text-slate-300 font-medium shrink-0">{item.label}</span>
              )}
              <span className="text-slate-400">{item.text}</span>
            </div>
          ))}
        </div>
        <div className="absolute -top-1.5 right-2 w-3 h-3 bg-slate-800 rotate-45 rounded-sm" />
      </div>
    </div>
  );
}

// ─── 품질 점수 인터랙티브 바 차트 ────────────────────────────────────────────
function QualityScoreChart({ data }: { data: Array<{ name: string; nameEn: string; score: number; group: 'rag' | 'quality' }> }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [animated, setAnimated]     = useState(false);
  const containerRef  = useRef<HTMLDivElement>(null);
  const timerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevKeyRef    = useRef<string | null>(null);
  const wasHiddenRef  = useRef(true); // hidden 탭에서 시작 가정

  // 애니메이션 트리거 (ref로 저장 → 항상 최신 참조)
  const triggerFnRef = useRef(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setAnimated(false);
    timerRef.current = setTimeout(() => setAnimated(true), 100);
  });

  // data 실제 값이 바뀔 때 재애니메이션 (히스토리 전환 등)
  useEffect(() => {
    const key = data.map((d) => d.score.toFixed(4)).join(',');
    if (key === '' || prevKeyRef.current === key) return;
    prevKeyRef.current = key;
    triggerFnRef.current();
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // 탭 전환으로 컨테이너가 hidden→visible 될 때 재애니메이션 (recharts와 동일 원리)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const visible = el.offsetWidth > 0;
      if (visible && wasHiddenRef.current) {
        wasHiddenRef.current = false;
        triggerFnRef.current();
      } else if (!visible) {
        wasHiddenRef.current = true;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // unmount 시 timer 정리
  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <div ref={containerRef} className={cn("py-1", data.length <= 4 ? "space-y-5" : "space-y-2.5")}>
      {data.map((item, i) => {
        const color = item.score >= 0.85 ? 'bg-emerald-500' : item.score >= 0.7 ? 'bg-amber-400' : 'bg-rose-400';
        const textColor = item.score >= 0.85 ? 'text-emerald-600' : item.score >= 0.7 ? 'text-amber-600' : 'text-rose-500';
        const isHovered = hoveredIdx === i;
        const targetW = Math.min(item.score * 100, 100);
        return (
          <div
            key={i}
            className="group cursor-default select-none"
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-slate-600 leading-none flex items-center gap-1.5">
                {item.group === 'rag' ? (
                  <span className="text-[9px] font-bold text-sky-500 bg-sky-50 border border-sky-200 rounded px-1 py-0.5 leading-none shrink-0">RAG</span>
                ) : (
                  <span className="text-[9px] font-bold text-violet-500 bg-violet-50 border border-violet-200 rounded px-1 py-0.5 leading-none shrink-0">품질</span>
                )}
                {item.name}
                <span className={cn(
                  'text-[10px] font-normal text-slate-400 transition-all duration-200',
                  isHovered ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-1'
                )}>
                  ({item.nameEn})
                </span>
              </span>
              <span className={cn('text-[11px] font-mono font-bold leading-none', textColor)}>
                {item.score.toFixed(3)}
              </span>
            </div>
            <div className="relative h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full', color, isHovered && 'brightness-110')}
                style={{
                  width: `${targetW}%`,
                  clipPath: animated ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)',
                  transition: animated
                    ? `clip-path 700ms ease-out ${i * 100}ms`
                    : 'none',
                }}
              />
            </div>
          </div>
        );
      })}
      {/* 범례 — 우측 정렬 */}
      <div className={cn("flex justify-end", data.length <= 4 ? "pt-16" : "pt-2")}>
        <div className="flex gap-3 text-[9px] text-slate-400 items-center">
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />≥ 0.85</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-amber-400" />≥ 0.70</span>
          <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-rose-400" />&lt; 0.70</span>
        </div>
      </div>
    </div>
  );
}

// ─── QA 상세 뷰 ──────────────────────────────────────────────────────────────
function QADetailView({ qa, onBack }: { qa: QAPreviewItem; onBack: () => void }) {
  const status = getQAStatus(qa.quality_avg, qa.rag_avg);
  const cfg    = STATUS_CONFIG[status];

  // 구형 데이터 판별: factuality_reason / specificity_reason / conciseness_reason 존재 여부
  const isLegacy = !!(qa.factuality_reason || qa.specificity_reason || qa.conciseness_reason);

  // RAG 차원 (신·구 공통)
  const ragDimensions = [
    { label: '관련성', reason: qa.relevance_reason },
    { label: '근거성', reason: qa.groundedness_reason },
    { label: '명확성', reason: qa.clarity_reason },
  ].filter(r => r.reason);

  // 신규: 완전성만 / 구형: 사실성·완전성·구체성·간결성
  const qualityDimensions = isLegacy
    ? [
        { label: '사실성', reason: qa.factuality_reason },
        { label: '완전성', reason: qa.completeness_reason },
        { label: '구체성', reason: qa.specificity_reason },
        { label: '간결성', reason: qa.conciseness_reason },
      ].filter(r => r.reason)
    : [
        { label: '완전성', reason: qa.completeness_reason },
      ].filter(r => r.reason);

  // 통합 차원 목록
  const allDimensions = [...ragDimensions, ...qualityDimensions];

  const scoreColor = (v: number) =>
    v >= 0.85 ? 'text-emerald-600' : v >= 0.7 ? 'text-amber-500' : 'text-rose-600';

  return (
    <div className="p-5 space-y-4 animate-in fade-in slide-in-from-right-4 duration-200">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> 목록으로
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-mono">#{qa.qa_index + 1}</span>
          {qa.intent && (
            <span
              className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border"
              style={{
                backgroundColor: `${INTENT_COLORS[qa.intent] ?? '#94a3b8'}18`,
                color:           INTENT_COLORS[qa.intent] ?? '#64748b',
                borderColor:     `${INTENT_COLORS[qa.intent] ?? '#94a3b8'}35`,
              }}
            >
              {INTENT_KR[qa.intent] ?? qa.intent}
            </span>
          )}
          <span className={cn('px-2.5 py-0.5 text-xs font-semibold rounded-full border', cfg.className)}>
            {cfg.label}
          </span>
        </div>
      </div>

      {/* 실패 유형 callout — primary_failure 있을 때만 */}
      {qa.primary_failure && (
        <div className={cn(
          'rounded-xl p-4 border text-xs space-y-1',
          FAILURE_CONFIG[qa.primary_failure]?.className ?? 'bg-slate-50 border-slate-200'
        )}>
          <p className="font-bold text-[10px] uppercase tracking-widest">주요 실패 유형</p>
          <p className="font-semibold">{FAILURE_CONFIG[qa.primary_failure]?.label ?? qa.primary_failure}</p>
          {qa.failure_reason && <p className="opacity-80 leading-relaxed">{qa.failure_reason}</p>}
          {(qa.failure_types?.length ?? 0) > 1 && (
            <p className="opacity-60 text-[10px]">
              전체: {qa.failure_types!.map(f => FAILURE_CONFIG[f]?.label ?? f).join(', ')}
            </p>
          )}
        </div>
      )}

      {/* Q / A / Context */}
      <div className="space-y-3">
        <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">질문</p>
          <p className="text-sm text-slate-800 leading-relaxed font-medium">{qa.q}</p>
        </div>

        {qa.a ? (
          <div className="bg-indigo-50/60 rounded-xl p-4 border border-indigo-100">
            <p className="text-xs font-semibold text-indigo-400 uppercase tracking-wide mb-2">답변</p>
            <p className="text-sm text-slate-700 leading-relaxed">{qa.a}</p>
          </div>
        ) : (
          <div className="rounded-xl p-4 border border-dashed border-slate-200 text-center text-xs text-slate-400">
            답변 데이터 없음
          </div>
        )}

        {qa.context && (
          <div className="bg-amber-50/50 rounded-xl p-4 border border-amber-100">
            <p className="text-xs font-semibold text-amber-500 uppercase tracking-wide mb-2">컨텍스트</p>
            <p className="text-xs text-slate-600 leading-relaxed">{qa.context}</p>
          </div>
        )}
      </div>

      {/* 품질 평가 — RAG Triad + Quality 통합 섹션 */}
      {(qa.rag_avg != null || qa.quality_avg != null || allDimensions.length > 0) && (
        <div className="bg-violet-50/40 rounded-xl border border-violet-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-violet-100">
            <p className="text-xs font-semibold text-violet-600 uppercase tracking-wide">품질 평가</p>
            <div className="flex items-center gap-3">
              {isLegacy ? (
                // 구형(7개): RAG + 품질 각각 표시
                <>
                  {qa.rag_avg != null && (
                    <span className="flex items-center gap-1 text-[10px]">
                      <span className="text-slate-400 font-medium">RAG</span>
                      <span className={cn('font-black font-mono text-sm', scoreColor(qa.rag_avg))}>
                        {qa.rag_avg.toFixed(3)}
                      </span>
                    </span>
                  )}
                  {qa.quality_avg != null && (
                    <span className="flex items-center gap-1 text-[10px]">
                      <span className="text-slate-400 font-medium">품질</span>
                      <span className={cn('font-black font-mono text-sm', scoreColor(qa.quality_avg))}>
                        {qa.quality_avg.toFixed(3)}
                      </span>
                    </span>
                  )}
                </>
              ) : (
                // 신규(4개): 4지표 단순 평균 단일 표시
                (() => {
                  const r = qa.rag_avg ?? 0;
                  const q = qa.quality_avg ?? 0;
                  const unified = (r * 3 + q) / 4;
                  return (
                    <span className={cn('font-black font-mono text-lg', scoreColor(unified))}>
                      {unified.toFixed(3)}
                    </span>
                  );
                })()
              )}
            </div>
          </div>
          {allDimensions.length > 0 && (
            <div className="divide-y divide-violet-100">
              {allDimensions.map(({ label, reason }) => (
                <div key={label} className="flex gap-3 px-4 py-3 text-xs">
                  <span className="shrink-0 font-semibold text-slate-500 w-14">{label}</span>
                  <span className="text-slate-600 leading-relaxed">{reason}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 등급 색상 ────────────────────────────────────────────────────────────────
const GRADE_COLOR: Record<string, string> = {
  'A+': 'text-emerald-600 bg-emerald-50 border-emerald-200',
  'A':  'text-emerald-600 bg-emerald-50 border-emerald-200',
  'B+': 'text-blue-600 bg-blue-50 border-blue-200',
  'B':  'text-blue-600 bg-blue-50 border-blue-200',
  'C':  'text-amber-600 bg-amber-50 border-amber-200',
  'F':  'text-rose-600 bg-rose-50 border-rose-200',
};

const QA_PAGE_SIZE = 5;

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export function QAEvaluationDashboard({ evalJobId, initialEvalDbId }: { evalJobId?: string | null; initialEvalDbId?: string | null } = {}) {
  const [showExportMenu, setShowExportMenu]   = useState(false);
  const [exportLoading, setExportLoading]     = useState(false);
  const [showHistoryMenu, setShowHistoryMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState<string | null>(null);
  const [report, setReport]                   = useState<EvalReport | null>(null);
  const [historyList, setHistoryList]         = useState<HistoryItem[]>([]);
  const [historyReport, setHistoryReport]     = useState<{ summaryStats: any[]; layer1Stats: any[]; intentDistribution: any[]; llmQualityScores: any[]; item: HistoryItem } | null>(null);
  const [historyQaPreview, setHistoryQaPreview] = useState<QAPreviewItem[]>([]);
  const [historyQaLoading, setHistoryQaLoading] = useState(false);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [qaPage, setQaPage]                   = useState(0);
  const [statusFilter, setStatusFilter]       = useState<QAStatus | null>(null);
  const [sortCol, setSortCol]                 = useState<string | null>(null);
  const [sortDir, setSortDir]                 = useState<'asc' | 'desc'>('asc');
  const [selectedQA, setSelectedQA]           = useState<QAPreviewItem | null>(null);
  const prevEvalJobId = useRef<string | null>(null);

  // Export 메뉴 외부 클릭 시 닫기
  useEffect(() => {
    if (!showExportMenu) return;
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showExportMenu]);

  // evalJobId 변경 시 실제 데이터 fetch
  useEffect(() => {
    if (!evalJobId || evalJobId === prevEvalJobId.current) return;
    prevEvalJobId.current = evalJobId;
    setLoading(true);
    setError(null);
    setHistoryReport(null);
    setSelectedHistoryId(null);
    setQaPage(0);
    setSelectedQA(null);

    const fetchReport = async () => {
      try {
        const res = await getEvalStatus(evalJobId) as any;
        if (res.success && res.eval_report) {
          setReport(res.eval_report as EvalReport);
        } else {
          setError(res.error ?? '평가 결과를 불러오지 못했습니다.');
        }
      } catch {
        setError('네트워크 오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    };
    fetchReport();
  }, [evalJobId]);

  // 히스토리 목록 마운트 시 로드
  useEffect(() => {
    getEvalHistory().then((res) => {
      if (res.success && Array.isArray((res as any).history)) {
        setHistoryList((res as any).history);
      }
    });
  }, []);

  // 대시보드에서 진입 시 해당 히스토리 항목 자동 선택
  // historyList 로드 전에 initialEvalDbId가 설정될 수 있으므로 두 값 모두 준비된 시점에 실행
  useEffect(() => {
    if (!initialEvalDbId || !historyList.length) return;
    const target = historyList.find((h) => h.id === initialEvalDbId);
    if (target) selectHistory(target);
  }, [initialEvalDbId, historyList]); // eslint-disable-line react-hooks/exhaustive-deps

  // 히스토리 항목 선택
  const selectHistory = async (item: HistoryItem) => {
    setSelectedHistoryId(item.id);
    setReport(null);
    setHistoryReport({ ...buildChartDataFromHistory(item), item });
    setHistoryQaPreview([]);
    setShowHistoryMenu(false);
    setQaPage(0);
    setStatusFilter(null);
    setSelectedQA(null);

    setHistoryQaLoading(true);
    try {
      const res = await getEvalExportById(item.id) as any;
      if (res.success && Array.isArray(res.detail)) {
        setHistoryQaPreview(res.detail as QAPreviewItem[]);
      }
    } finally {
      setHistoryQaLoading(false);
    }
  };

  // 현재 표시할 차트 데이터
  const chartData = report
    ? buildChartData(report)
    : historyReport
      ? { summaryStats: historyReport.summaryStats, layer1Stats: historyReport.layer1Stats, intentDistribution: historyReport.intentDistribution, llmQualityScores: historyReport.llmQualityScores }
      : null;

  const activeReport = report;
  const activeItem   = historyReport?.item;
  const qaPreview    = report?.qa_preview ?? historyQaPreview;
  const qaListLoading = historyQaLoading;
  const filteredQA   = statusFilter
    ? qaPreview.filter(qa => getQAStatus(qa.quality_avg, qa.rag_avg) === statusFilter)
    : qaPreview;
  const sortedQA = sortCol ? [...filteredQA].sort((a, b) => {
    let av: any, bv: any;
    if (sortCol === 'id')       { av = a.qa_index; bv = b.qa_index; }
    else if (sortCol === 'intent')  { av = a.intent ?? ''; bv = b.intent ?? ''; }
    else if (sortCol === 'q')       { av = a.q ?? ''; bv = b.q ?? ''; }
    else if (sortCol === 'a')       { av = a.a ?? ''; bv = b.a ?? ''; }
    else if (sortCol === 'quality') { av = a.quality_avg ?? -1; bv = b.quality_avg ?? -1; }
    else if (sortCol === 'triad')   { av = a.rag_avg ?? -1; bv = b.rag_avg ?? -1; }
    else if (sortCol === 'status')  { av = getQAStatus(a.quality_avg, a.rag_avg); bv = getQAStatus(b.quality_avg, b.rag_avg); }
    else if (sortCol === 'failure') { av = a.primary_failure ?? ''; bv = b.primary_failure ?? ''; }
    else return 0;
    if (av < bv) return sortDir === 'asc' ? -1 : 1;
    if (av > bv) return sortDir === 'asc' ? 1 : -1;
    return 0;
  }) : filteredQA;
  const totalPages   = Math.max(1, Math.ceil(sortedQA.length / QA_PAGE_SIZE));
  const pagedQA      = sortedQA.slice(qaPage * QA_PAGE_SIZE, (qaPage + 1) * QA_PAGE_SIZE);

  // 성공 QA 수: 로딩 완료된 qaPreview 기준으로 계산 (HTML export 포함 일관 적용)
  const totalQA      = report?.metadata?.total_qa ?? activeItem?.total_qa ?? 0;
  const successCount = qaPreview.filter(qa => getQAStatus(qa.quality_avg, qa.rag_avg) === 'success').length;
  const correctedSummaryStats = chartData?.summaryStats.map((stat, i) =>
    i === 1 && qaPreview.length > 0
      ? { ...stat, value: `${successCount} / ${totalQA}` }
      : stat
  ) ?? [];

  // export용 데이터
  const evaluationData = chartData ? {
    summaryStats:       correctedSummaryStats,
    layer1Stats:        chartData.layer1Stats,
    intentDistribution: chartData.intentDistribution,
    llmQualityScores:   chartData.llmQualityScores,
    detailedQA:         qaPreview.map((q, i) => ({ id: i + 1, q: q.q, a: q.a, context: q.context, intent: q.intent, l2_avg: q.quality_avg ?? 0, triad_avg: q.rag_avg ?? 0, pass: q.pass, primary_failure: q.primary_failure, failure_types: q.failure_types, relevance_reason: q.relevance_reason, groundedness_reason: q.groundedness_reason, clarity_reason: q.clarity_reason, factuality_reason: q.factuality_reason, completeness_reason: q.completeness_reason, specificity_reason: q.specificity_reason, conciseness_reason: q.conciseness_reason, failure_reason: q.failure_reason })),
    metadata: {
      qa_model: (() => {
        const fromMeta = activeReport?.metadata?.generation_model || activeItem?.metadata?.generation_model;
        if (fromMeta) return fromMeta;
        // fallback: result_filename 패턴 "qa_{model}_{lang}_..." 에서 모델 파싱
        const fn = activeReport?.result_filename || activeItem?.result_filename || '';
        const m = fn.match(/^qa_(.+?)_[a-z]{2}_/);
        return m?.[1] || '-';
      })(),
      eval_model: activeReport?.metadata?.evaluator_model  || activeItem?.metadata?.evaluator_model  || '-',
      source:     activeReport?.metadata?.source_doc || activeItem?.metadata?.source_doc || activeReport?.result_filename || activeItem?.result_filename || '-',
      timestamp:  activeReport?.timestamp ?? activeItem?.created_at ?? new Date().toISOString(),
      model:      activeReport?.metadata?.evaluator_model  || activeItem?.metadata?.evaluator_model  || '-',
    },
  } : null;

  const handleExport = async (format: 'xlsx' | 'html' | 'json' | 'zip') => {
    if (!evaluationData) return;
    setShowExportMenu(false);

    if (format === 'html') { exportToHTML(evaluationData); return; }
    if (format === 'json') { exportToJSON(evaluationData); return; }
    if (format === 'zip')  { await exportToZip(evaluationData); return; }

    setExportLoading(true);
    try {
      let res: any = null;
      if (evalJobId)         res = await getEvalExport(evalJobId) as any;
      else if (selectedHistoryId) res = await getEvalExportById(selectedHistoryId) as any;

      if (res?.success && Array.isArray(res.detail)) {
        exportToCSV({
          ...evaluationData,
          detailedQA: res.detail.map((r: any, i: number) => ({
            id: i + 1, q: r.q, a: r.a ?? '', context: r.context ?? '',
            intent: r.intent, l2_avg: r.quality_avg ?? 0, triad_avg: r.rag_avg ?? 0, pass: r.pass,
            primary_failure: r.primary_failure ?? null, failure_types: r.failure_types ?? [],
          })),
          metadata: { ...evaluationData.metadata, timestamp: res.timestamp ?? evaluationData.metadata?.timestamp },
        });
      } else {
        exportToCSV(evaluationData);
      }
    } catch {
      exportToCSV(evaluationData);
    } finally {
      setExportLoading(false);
    }
  };

  const grade   = activeReport?.summary?.grade ?? activeItem?.final_grade ?? null;
  const metaStr = activeReport
    ? `평가 모델: ${activeReport.metadata.evaluator_model} | ${formatKST(activeReport.timestamp)}`
    : activeItem
      ? `평가 모델: ${activeItem.metadata?.evaluator_model ?? '-'} | ${formatKST(activeItem.created_at)}`
      : '';

  // ─── Empty state ───────────────────────────────────────────────────────────
  if (!evalJobId && !historyReport && !loading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-500">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">QA 평가 결과</h2>
            <p className="text-sm text-slate-500">평가를 실행하거나 히스토리에서 이전 결과를 선택하세요</p>
          </div>
          {historyList.length > 0 && (
            <HistoryDropdown historyList={historyList} selectedHistoryId={selectedHistoryId} showMenu={showHistoryMenu} setShowMenu={setShowHistoryMenu} onSelect={selectHistory} />
          )}
        </div>
        <div className="flex flex-col items-center justify-center h-72 bg-white/80 backdrop-blur-sm rounded-2xl border border-white/60 shadow-lg shadow-slate-200/40 text-slate-400 gap-3">
          <Activity className="w-12 h-12 text-slate-200" />
          <p className="text-sm font-medium">평가 결과가 없습니다</p>
          <p className="text-xs text-slate-400">QA 생성 패널에서 평가를 완료하면 결과가 여기에 표시됩니다.</p>
        </div>
      </div>
    );
  }

  // ─── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-72 text-slate-400 gap-3">
        <Loader2 className="w-10 h-10 animate-spin text-indigo-400" />
        <p className="text-sm">평가 결과 로딩 중...</p>
      </div>
    );
  }

  // ─── Error state ───────────────────────────────────────────────────────────
  if (error && !chartData) {
    return (
      <div className="flex flex-col items-center justify-center h-72 text-rose-400 gap-3">
        <AlertCircle className="w-10 h-10" />
        <p className="text-sm font-medium">{error}</p>
      </div>
    );
  }

  if (!chartData) return null;

  const { layer1Stats, intentDistribution, llmQualityScores } = chartData;
  const summaryStats = correctedSummaryStats;

  // ─── Main Dashboard ────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-slate-900">QA 평가 결과</h2>
            {grade && (
              <span className={cn('px-2.5 py-0.5 rounded-md text-sm font-bold border', GRADE_COLOR[grade] ?? 'text-slate-600 bg-slate-50 border-slate-200')}>
                {grade}
              </span>
            )}
            {activeReport?.summary?.final_score != null && (
              <span className="text-sm text-slate-500 font-mono">
                {(activeReport.summary.final_score * 100).toFixed(1)}점
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{metaStr}</p>
        </div>
        <div className="flex gap-2">
          {historyList.length > 0 && (
            <HistoryDropdown historyList={historyList} selectedHistoryId={selectedHistoryId} showMenu={showHistoryMenu} setShowMenu={setShowHistoryMenu} onSelect={selectHistory} />
          )}
          <div ref={exportMenuRef} className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              disabled={!evaluationData}
              className="flex items-center justify-center gap-2 w-32 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-40"
            >
              {exportLoading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> 준비 중...</>
                : <><Download className="w-4 h-4" /> Export</>}
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-10 overflow-hidden">
                {(['xlsx', 'html', 'zip'] as const).map((fmt) => (
                  <button key={fmt} onClick={() => handleExport(fmt)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left text-slate-700 border-b border-slate-100 last:border-b-0">
                    {fmt === 'xlsx' && <FileText className="w-4 h-4 text-blue-600" />}
                    {fmt === 'html' && <Code2    className="w-4 h-4 text-green-600" />}
                    {fmt === 'zip'  && <Download className="w-4 h-4 text-indigo-600" />}
                    <div>
                      <div className="font-medium">{fmt.toUpperCase()}</div>
                      <div className="text-xs text-slate-500">
                        {fmt === 'xlsx' ? 'Spreadsheet' : fmt === 'html' ? 'HTML Report' : 'XLSX + HTML 묶음'}
                      </div>
                    </div>
                  </button>
                ))}
                {/* JSON export — 추후 활성화
                <button onClick={() => handleExport('json')}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left text-slate-700">
                  <FileJson className="w-4 h-4 text-purple-600" />
                  <div>
                    <div className="font-medium">JSON</div>
                    <div className="text-xs text-slate-500">Raw data</div>
                  </div>
                </button>
                */}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryStats.map((stat, i) => (
          <div key={i} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className={cn('w-12 h-12 rounded-lg flex items-center justify-center', stat.bg, stat.color)}>
              <stat.icon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">{stat.label}</p>
              <p className="text-2xl font-bold text-slate-900">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Intent Distribution */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
          <div className="mb-2 flex items-start justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <LayoutGrid className="w-4 h-4 text-cyan-500" /> 의도 분류
              </h3>
              <p className="text-xs text-slate-500">질문 유형 분포</p>
            </div>
            <ChartInfoTooltip
              title="의도 분류"
              items={[
                { text: 'QA 질문을 8가지 유형으로 분류한 분포입니다.' },
                { label: '유형', text: '사실·수치·절차·이유·방법·정의·목록·확인' },
                { label: '기준', text: '분포가 고를수록 다양한 질문 유형을 포괄합니다.' },
              ]}
            />
          </div>
          {intentDistribution.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-xs text-slate-400">데이터 없음</div>
          ) : (
            <>
              <div className="flex-1 min-h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={intentDistribution} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value"
                      isAnimationActive={true} animationBegin={0} animationDuration={900} animationEasing="ease-out">
                      {intentDistribution.map((entry, i) => (
                        <Cell key={i} fill={INTENT_COLORS[entry.name] ?? '#94a3b8'} />
                      ))}
                    </Pie>
                    <Tooltip content={<IntentTooltip />} isAnimationActive={false} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-4 gap-1 mt-2">
                {intentDistribution.map((e) => (
                  <div key={e.name} className="flex items-center gap-1 text-[10px] font-medium text-slate-600 px-1 py-0.5 rounded cursor-default">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: INTENT_COLORS[e.name] ?? '#94a3b8' }} />
                    <span className="truncate">{e.krLabel}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Radar: Dataset Stats */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
          <div className="mb-2 flex items-start justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" /> 데이터 통계
              </h3>
              <p className="text-xs text-slate-500">구조적·통계적 검증 (0–10)</p>
            </div>
            <ChartInfoTooltip
              title="데이터 통계"
              items={[
                { text: 'QA의 구조적·통계적 품질을 0–10으로 검증합니다.' },
                { label: '항목', text: '문장 길이, 어휘 다양성, 중복률, 완결성 등 6개' },
                { label: '통합점수', text: '각 지표의 가중 평균값' },
              ]}
            />
          </div>
          <div className="flex-1 min-h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="72%" data={layer1Stats}>
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 10 }} />
                <PolarRadiusAxis angle={30} domain={[0, 10]} tick={{ fill: '#94a3b8', fontSize: 9 }} />
                <Radar name="Score" dataKey="A" stroke="#6366f1" fill="#6366f1" fillOpacity={0.4} />
                <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0' }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          {(() => {
            const intScore = activeReport?.pipeline_results?.stats?.integrated_score
              ?? activeItem?.pipeline_results?.layers?.stats?.integrated_score;
            return intScore != null ? (
              <p className="text-center text-xs text-slate-500 mt-1">
                통합 점수: <span className="font-semibold text-indigo-600">{(intScore as number).toFixed(1)} / 10</span>
              </p>
            ) : null;
          })()}
        </div>

        {/* 품질 점수 — 커스텀 인터랙티브 바 */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <Target className="w-4 h-4 text-indigo-500" /> RAG Triad + 품질 평가 점수
              </h3>
              <p className="text-xs text-slate-500">RAG Triad + 품질 평가 통합 점수</p>
            </div>
            <ChartInfoTooltip
              title="RAG Triad + 품질 평가"
              items={[
                { text: 'LLM 기반 평가 점수입니다 (0–1).' },
                { label: 'RAG Triad', text: '관련성 · 근거성 · 명확성' },
                { label: '품질 평가', text: '완전성' },
                { label: '등급', text: '0.85↑ 우수 / 0.70↑ 양호 / 미만 미흡' },
              ]}
            />
          </div>
          <div className="flex-1">
            <QualityScoreChart data={llmQualityScores} />
          </div>
        </div>
      </div>

      {/* Detailed QA Table */}
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/60 shadow-lg shadow-slate-200/40 overflow-hidden">
        {/* 테이블 헤더 */}
        {!selectedQA && (
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
            <div>
              <h3 className="text-base font-semibold text-slate-900">상세 평가 결과</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {qaPreview.length > 0
                  ? `${statusFilter ? `${filteredQA.length}개 표시 중 /` : '총'} ${qaPreview.length}개 · 페이지당 ${QA_PAGE_SIZE}개 · 행 클릭 시 상세 보기`
                  : '히스토리 데이터는 QA 상세 미리보기를 제공하지 않습니다'}
              </p>
            </div>
            {/* 상태 필터 버튼 */}
            <div className="flex items-center gap-1.5">
              {(Object.keys(STATUS_CONFIG) as QAStatus[]).map((s) => {
                const isActive = statusFilter === s;
                return (
                  <button
                    key={s}
                    onClick={() => { setStatusFilter(isActive ? null : s); setQaPage(0); }}
                    className={cn(
                      'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors',
                      isActive
                        ? STATUS_CONFIG[s].className
                        : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'
                    )}
                  >
                    <span className={cn('w-1.5 h-1.5 rounded-full', STATUS_CONFIG[s].dotColor)} />
                    {STATUS_CONFIG[s].label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* 내용 영역 */}
        {qaPreview.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-sm">
            {report ? '평가된 QA 데이터가 없습니다.' : '현재 세션에서 실행된 평가 결과에서만 상세 QA를 확인할 수 있습니다.'}
          </div>
        ) : selectedQA ? (
          /* ── 상세 뷰 ── */
          <QADetailView qa={selectedQA} onBack={() => setSelectedQA(null)} />
        ) : (
          /* ── 테이블 뷰 ── */
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                  <tr>
                    {([
                      { col: 'id',      label: 'ID',       cls: 'w-10'  },
                      { col: 'intent',  label: '의도',      cls: 'w-24'  },
                      { col: 'q',       label: '질문',      cls: ''      },
                      { col: 'a',       label: '답변',      cls: ''      },
                      { col: 'quality', label: '품질 점수',  cls: 'w-24'  },
                      { col: 'triad',   label: 'Triad 점수', cls: 'w-24' },
                      { col: 'status',  label: '상태',      cls: 'w-20'  },
                      { col: 'failure', label: '실패유형',   cls: 'w-24'  },
                    ] as { col: string; label: string; cls: string }[]).map(({ col, label, cls }) => (
                      <th
                        key={col}
                        onClick={() => {
                          if (sortCol === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); setQaPage(0); }
                          else { setSortCol(col); setSortDir('asc'); setQaPage(0); }
                        }}
                        className={cn('px-4 py-3 font-medium text-center cursor-pointer select-none hover:bg-slate-100 transition-colors', cls)}
                      >
                        <span className="inline-flex items-center justify-center gap-1">
                          {label}
                          <span className="text-[10px] text-slate-300">
                            {sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                          </span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {qaListLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 8 }).map((_, j) => (
                          <td key={j} className="px-4 py-3.5">
                            <div className="h-3 bg-slate-100 rounded animate-pulse w-full" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : pagedQA.map((row) => {
                    const st = getQAStatus(row.quality_avg, row.rag_avg);
                    const cfg = STATUS_CONFIG[st];
                    return (
                      <tr
                        key={row.qa_index}
                        onClick={() => setSelectedQA(row)}
                        className="hover:bg-indigo-50/40 transition-colors cursor-pointer group"
                      >
                        <td className="px-4 py-3.5 text-slate-400 font-mono text-xs text-center">{row.qa_index + 1}</td>
                        <td className="px-4 py-3.5 text-center">
                          <span
                            className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border inline-block"
                            style={{
                              backgroundColor: `${INTENT_COLORS[row.intent] ?? '#94a3b8'}15`,
                              color:           INTENT_COLORS[row.intent] ?? '#64748b',
                              borderColor:     `${INTENT_COLORS[row.intent] ?? '#94a3b8'}30`,
                            }}
                          >
                            {(INTENT_KR[row.intent] ?? row.intent) || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-slate-700 font-medium w-[200px] max-w-[200px]">
                          <p className="line-clamp-3 text-xs leading-relaxed">{row.q}</p>
                        </td>
                        <td className="px-4 py-3.5 text-slate-500 w-[200px] max-w-[200px]">
                          {row.a
                            ? <p className="line-clamp-3 text-xs leading-relaxed">{row.a}</p>
                            : <span className="text-slate-300 text-xs">-</span>}
                        </td>
                        <td className="px-4 py-3.5 text-center font-mono text-xs">
                          {row.quality_avg != null
                            ? <span className={row.quality_avg >= 0.7 ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-bold'}>{row.quality_avg.toFixed(3)}</span>
                            : <span className="text-slate-300">-</span>}
                        </td>
                        <td className="px-4 py-3.5 text-center font-mono text-xs">
                          {row.rag_avg != null
                            ? <span className={row.rag_avg >= 0.7 ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-bold'}>{row.rag_avg.toFixed(3)}</span>
                            : <span className="text-slate-300">-</span>}
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border', cfg.className)}>
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          {row.primary_failure && FAILURE_CONFIG[row.primary_failure] ? (
                            <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border', FAILURE_CONFIG[row.primary_failure].className)}>
                              {FAILURE_CONFIG[row.primary_failure].label}
                            </span>
                          ) : (
                            <span className="text-slate-300 text-xs">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 페이지네이션 */}
            {totalPages > 1 && (
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <span className="text-xs text-slate-500">
                  {qaPage * QA_PAGE_SIZE + 1}–{Math.min((qaPage + 1) * QA_PAGE_SIZE, qaPreview.length)} / {qaPreview.length}개
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setQaPage(p => Math.max(0, p - 1))}
                    disabled={qaPage === 0}
                    className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4 text-slate-600" />
                  </button>
                  <span className="text-xs font-mono text-slate-600 px-1.5">{qaPage + 1} / {totalPages}</span>
                  <button
                    onClick={() => setQaPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={qaPage === totalPages - 1}
                    className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4 text-slate-600" />
                  </button>
                </div>
              </div>
            )}

            {/* 전체 개수 안내 (페이지 없을 때) */}
            {totalPages === 1 && activeReport && activeReport.metadata.total_qa > qaPreview.length && (
              <div className="p-3 border-t border-slate-100 bg-slate-50 text-center text-xs text-slate-500">
                총 {activeReport.metadata.total_qa.toLocaleString()}개 중 상위 {qaPreview.length}개 표시
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── History Dropdown ─────────────────────────────────────────────────────────
function HistoryDropdown({
  historyList, selectedHistoryId, showMenu, setShowMenu, onSelect,
}: {
  historyList: HistoryItem[];
  selectedHistoryId: string | null;
  showMenu: boolean;
  setShowMenu: (v: boolean) => void;
  onSelect: (item: HistoryItem) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu, setShowMenu]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center justify-center gap-2 w-32 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
      >
        <History className="w-4 h-4" />
        History
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showMenu && 'rotate-180')} />
      </button>
      {showMenu && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-lg z-20 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50">
            <p className="text-xs font-semibold text-slate-600">평가 히스토리 ({historyList.length})</p>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {historyList.map((item) => (
              <button
                key={item.id}
                onClick={() => onSelect(item)}
                className={cn(
                  'w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-50 text-left border-b border-slate-50 last:border-b-0 transition-colors',
                  selectedHistoryId === item.id && 'bg-indigo-50 border-indigo-100'
                )}
              >
                <Clock className="w-4 h-4 text-slate-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded border', GRADE_COLOR[item.final_grade] ?? 'text-slate-600 bg-slate-50 border-slate-200')}>
                      {item.final_grade}
                    </span>
                    <span className="text-xs font-mono text-slate-600">{item.final_score != null ? (item.final_score * 100).toFixed(1) + '점' : '-'}</span>
                    <span className="text-xs text-slate-400">{item.total_qa} QA</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 truncate">
                    {item.metadata?.generation_model ?? '-'}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {formatKST(item.created_at)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
