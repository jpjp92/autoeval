import {
  PieChart, Pie, Cell, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts';
import {
  Download, CheckCircle2, AlertCircle, FileText, Activity, Target, Zap,
  FileJson, Code2, ChevronDown, Clock, History, Loader2,
  ArrowLeft, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useState, useEffect, useRef } from 'react';
import { exportToCSV, exportToHTML, exportToJSON } from '@/src/lib/exportUtils';
import { getEvalStatus, getEvalHistory, getEvalExport, getEvalExportById } from '@/src/lib/api';

// ─── Intent 레이블 ────────────────────────────────────────────────────────────
const INTENT_KR: Record<string, string> = {
  factoid:   '사실형',
  numeric:   '수치형',
  procedure: '절차형',
  why:       '원인형',
  how:       '방법형',
  definition:'정의형',
  list:      '목록형',
  boolean:   '확인형',
};

const INTENT_COLORS: Record<string, string> = {
  factoid:   '#06b6d4',
  numeric:   '#eab308',
  procedure: '#3b82f6',
  why:       '#d946ef',
  how:       '#22c55e',
  definition:'#0ea5e9',
  list:      '#f59e0b',
  boolean:   '#c026d3',
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

// ─── 타입 ─────────────────────────────────────────────────────────────────────
interface QAPreviewItem {
  qa_index:    number;
  q:           string;
  a?:          string;
  context?:    string;
  intent:      string;
  rag_avg?:    number;
  quality_avg?: number;
  pass:        boolean;
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
    quality?: { pass_count: number; pass_rate: number; summary: { avg_factuality: number; avg_completeness: number; avg_groundedness: number; avg_quality: number } };
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

// ─── 데이터 변환 ──────────────────────────────────────────────────────────────
function buildChartData(report: EvalReport) {
  const s   = report.pipeline_results?.stats;
  const rag = report.pipeline_results?.rag;
  const qua = report.pipeline_results?.quality;
  const sum = report.summary;

  const summaryStats = [
    { label: '총 생성된 QA',   value: report.metadata.total_qa.toLocaleString(), icon: FileText,    color: 'text-indigo-600',  bg: 'bg-indigo-100' },
    { label: '구문 통과율',     value: `${(sum.syntax_pass_rate ?? 0).toFixed(1)}%`, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100' },
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

  const llmQualityScores = [
    { name: '사실성', nameEn: 'Factuality',   score: qua?.summary?.avg_factuality   ?? 0 },
    { name: '완전성', nameEn: 'Completeness', score: qua?.summary?.avg_completeness  ?? 0 },
    { name: '근거성', nameEn: 'Groundedness', score: qua?.summary?.avg_groundedness  ?? 0 },
    { name: '관련성', nameEn: 'Relevance',    score: rag?.summary?.avg_relevance     ?? 0 },
    { name: '명확성', nameEn: 'Clarity',      score: rag?.summary?.avg_clarity       ?? 0 },
  ];

  return { summaryStats, layer1Stats, intentDistribution, llmQualityScores };
}

function buildChartDataFromHistory(item: HistoryItem) {
  const pl  = item.pipeline_results?.layers ?? {};
  const st  = pl.stats;
  const rag = pl.rag;
  const qua = pl.quality;
  const sc  = item.scores ?? {};

  const summaryStats = [
    { label: '총 생성된 QA',   value: item.total_qa.toLocaleString(),                icon: FileText,    color: 'text-indigo-600',  bg: 'bg-indigo-100' },
    { label: '구문 통과율',     value: `${(sc.syntax?.pass_rate ?? 0).toFixed(1)}%`, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100' },
    { label: 'RAG Triad 평균', value: (rag?.summary?.avg_score   ?? 0).toFixed(3),  icon: Activity,     color: 'text-rose-600',    bg: 'bg-rose-100' },
    { label: '품질 평균 점수', value: (qua?.summary?.avg_quality  ?? 0).toFixed(3),  icon: Target,       color: 'text-amber-600',   bg: 'bg-amber-100' },
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

  const llmQualityScores = [
    { name: '사실성', nameEn: 'Factuality',   score: qua?.summary?.avg_factuality   ?? 0 },
    { name: '완전성', nameEn: 'Completeness', score: qua?.summary?.avg_completeness  ?? 0 },
    { name: '근거성', nameEn: 'Groundedness', score: qua?.summary?.avg_groundedness  ?? 0 },
    { name: '관련성', nameEn: 'Relevance',    score: rag?.summary?.avg_relevance     ?? 0 },
    { name: '명확성', nameEn: 'Clarity',      score: rag?.summary?.avg_clarity       ?? 0 },
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

// ─── 품질 점수 인터랙티브 바 차트 ────────────────────────────────────────────
function QualityScoreChart({ data }: { data: Array<{ name: string; nameEn: string; score: number }> }) {
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
    timerRef.current = window.setTimeout(() => setAnimated(true), 100);
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
    <div ref={containerRef} className="space-y-3 py-1 px-1">
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
              <span className="text-[11px] font-semibold text-slate-600 leading-none flex items-center gap-1">
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
            <div className="relative h-2 bg-slate-100 rounded-full overflow-hidden">
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
      {/* 0.7 기준선 범례 */}
      <div className="flex items-center gap-1.5 pt-7.5 justify-end">
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

      {/* Q / A / Context */}
      <div className="space-y-3">
        <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">질문</p>
          <p className="text-sm text-slate-800 leading-relaxed font-medium">{qa.q}</p>
        </div>

        {qa.a ? (
          <div className="bg-indigo-50/60 rounded-xl p-4 border border-indigo-100">
            <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-2">답변</p>
            <p className="text-sm text-slate-700 leading-relaxed">{qa.a}</p>
          </div>
        ) : (
          <div className="rounded-xl p-4 border border-dashed border-slate-200 text-center text-xs text-slate-400">
            답변 데이터 없음
          </div>
        )}

        {qa.context && (
          <div className="bg-amber-50/50 rounded-xl p-4 border border-amber-100">
            <p className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-2">컨텍스트</p>
            <p className="text-xs text-slate-600 leading-relaxed">{qa.context}</p>
          </div>
        )}
      </div>

      {/* 점수 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">품질 평가</p>
          {qa.quality_avg != null ? (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">평균 점수</span>
              <span className={cn('text-lg font-black font-mono', qa.quality_avg >= 0.7 ? 'text-emerald-600' : 'text-rose-600')}>
                {qa.quality_avg.toFixed(3)}
              </span>
            </div>
          ) : (
            <p className="text-xs text-slate-400">데이터 없음</p>
          )}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-2">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">RAG Triad</p>
          {qa.rag_avg != null ? (
            <div className="flex justify-between items-center">
              <span className="text-xs text-slate-500">평균 점수</span>
              <span className={cn('text-lg font-black font-mono', qa.rag_avg >= 0.7 ? 'text-emerald-600' : 'text-rose-600')}>
                {qa.rag_avg.toFixed(3)}
              </span>
            </div>
          ) : (
            <p className="text-xs text-slate-400">데이터 없음</p>
          )}
        </div>
      </div>
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
export function QAEvaluationDashboard({ evalJobId }: { evalJobId?: string | null } = {}) {
  const [showExportMenu, setShowExportMenu]   = useState(false);
  const [exportLoading, setExportLoading]     = useState(false);
  const [showHistoryMenu, setShowHistoryMenu] = useState(false);
  const [loading, setLoading]                 = useState(false);
  const [error, setError]                     = useState<string | null>(null);
  const [report, setReport]                   = useState<EvalReport | null>(null);
  const [historyList, setHistoryList]         = useState<HistoryItem[]>([]);
  const [historyReport, setHistoryReport]     = useState<{ summaryStats: any[]; layer1Stats: any[]; intentDistribution: any[]; llmQualityScores: any[]; item: HistoryItem } | null>(null);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [qaPage, setQaPage]                   = useState(0);
  const [selectedQA, setSelectedQA]           = useState<QAPreviewItem | null>(null);
  const prevEvalJobId = useRef<string | null>(null);

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

  // 히스토리 항목 선택
  const selectHistory = (item: HistoryItem) => {
    setSelectedHistoryId(item.id);
    setReport(null);
    setHistoryReport({ ...buildChartDataFromHistory(item), item });
    setShowHistoryMenu(false);
    setQaPage(0);
    setSelectedQA(null);
  };

  // 현재 표시할 차트 데이터
  const chartData = report
    ? buildChartData(report)
    : historyReport
      ? { summaryStats: historyReport.summaryStats, layer1Stats: historyReport.layer1Stats, intentDistribution: historyReport.intentDistribution, llmQualityScores: historyReport.llmQualityScores }
      : null;

  const activeReport = report;
  const activeItem   = historyReport?.item;
  const qaPreview    = report?.qa_preview ?? [];
  const totalPages   = Math.max(1, Math.ceil(qaPreview.length / QA_PAGE_SIZE));
  const pagedQA      = qaPreview.slice(qaPage * QA_PAGE_SIZE, (qaPage + 1) * QA_PAGE_SIZE);

  // export용 데이터
  const evaluationData = chartData ? {
    summaryStats:       chartData.summaryStats,
    layer1Stats:        chartData.layer1Stats,
    intentDistribution: chartData.intentDistribution,
    llmQualityScores:   chartData.llmQualityScores,
    detailedQA:         qaPreview.map((q, i) => ({ id: i + 1, q: q.q, a: q.a, context: q.context, intent: q.intent, l2_avg: q.quality_avg ?? 0, triad_avg: q.rag_avg ?? 0, pass: q.pass })),
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

  const handleExport = async (format: 'xlsx' | 'html' | 'json') => {
    if (!evaluationData) return;
    setShowExportMenu(false);

    if (format === 'html') { exportToHTML(evaluationData); return; }
    if (format === 'json') { exportToJSON(evaluationData); return; }

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
    ? `평가 모델: ${activeReport.metadata.evaluator_model} | ${new Date(activeReport.timestamp).toLocaleString('ko-KR')}`
    : activeItem
      ? `평가 모델: ${activeItem.metadata?.evaluator_model ?? '-'} | ${new Date(activeItem.created_at).toLocaleString('ko-KR')}`
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
        <div className="flex flex-col items-center justify-center h-72 bg-white rounded-xl border border-slate-200 shadow-sm text-slate-400 gap-3">
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

  const { summaryStats, layer1Stats, intentDistribution, llmQualityScores } = chartData;

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
                {activeReport.summary.final_score.toFixed(3)}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">{metaStr}</p>
        </div>
        <div className="flex gap-2">
          {historyList.length > 0 && (
            <HistoryDropdown historyList={historyList} selectedHistoryId={selectedHistoryId} showMenu={showHistoryMenu} setShowMenu={setShowHistoryMenu} onSelect={selectHistory} />
          )}
          <div className="relative">
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
                {(['xlsx', 'html', 'json'] as const).map((fmt) => (
                  <button key={fmt} onClick={() => handleExport(fmt)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 text-left text-slate-700 border-b border-slate-100 last:border-b-0">
                    {fmt === 'xlsx' && <FileText className="w-4 h-4 text-blue-600" />}
                    {fmt === 'html' && <Code2    className="w-4 h-4 text-green-600" />}
                    {fmt === 'json' && <FileJson className="w-4 h-4 text-purple-600" />}
                    <div>
                      <div className="font-medium">{fmt.toUpperCase()}</div>
                      <div className="text-xs text-slate-500">{fmt === 'xlsx' ? 'Spreadsheet' : fmt === 'html' ? 'Formatted doc' : 'Raw data'}</div>
                    </div>
                  </button>
                ))}
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
          <div className="mb-2">
            <h3 className="text-base font-semibold text-slate-800">의도 분류</h3>
            <p className="text-xs text-slate-500">질문 유형 분포</p>
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
          <div className="mb-2">
            <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" /> 데이터셋 통계
            </h3>
            <p className="text-xs text-slate-500">구조적·통계적 검증 (0–10)</p>
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
          {activeReport?.pipeline_results?.stats?.integrated_score != null && (
            <p className="text-center text-xs text-slate-500 mt-1">
              통합 점수: <span className="font-semibold text-indigo-600">{activeReport.pipeline_results.stats.integrated_score.toFixed(1)} / 10</span>
            </p>
          )}
        </div>

        {/* 품질 점수 — 커스텀 인터랙티브 바 */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
          <div className="mb-3">
            <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
              <Target className="w-4 h-4 text-indigo-500" /> 품질 점수
            </h3>
            <p className="text-xs text-slate-500">LLM 기반 품질 평가 (0–1)</p>
          </div>
          <div className="flex-1">
            <QualityScoreChart data={llmQualityScores} />
          </div>
        </div>
      </div>

      {/* Detailed QA Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* 테이블 헤더 */}
        {!selectedQA && (
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
            <div>
              <h3 className="text-base font-semibold text-slate-900">상세 평가 결과</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {qaPreview.length > 0
                  ? `총 ${qaPreview.length}개 · 페이지당 ${QA_PAGE_SIZE}개 · 행 클릭 시 상세 보기`
                  : '히스토리 데이터는 QA 상세 미리보기를 제공하지 않습니다'}
              </p>
            </div>
            {/* 상태 범례 — 가로 배치 */}
            <div className="flex items-center gap-4 text-xs font-medium">
              {(Object.keys(STATUS_CONFIG) as QAStatus[]).map((s) => (
                <span key={s} className="flex items-center gap-1.5 text-slate-600">
                  <span className={cn('w-2 h-2 rounded-full', STATUS_CONFIG[s].dotColor)} />
                  {STATUS_CONFIG[s].label}
                </span>
              ))}
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
                    <th className="px-4 py-3 font-medium w-10">#</th>
                    <th className="px-4 py-3 font-medium w-24">의도</th>
                    <th className="px-4 py-3 font-medium">질문</th>
                    <th className="px-4 py-3 font-medium">답변</th>
                    <th className="px-4 py-3 font-medium text-center w-24">품질 점수</th>
                    <th className="px-4 py-3 font-medium text-center w-24">Triad 점수</th>
                    <th className="px-4 py-3 font-medium text-center w-20">상태</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {pagedQA.map((row) => {
                    const st = getQAStatus(row.quality_avg, row.rag_avg);
                    const cfg = STATUS_CONFIG[st];
                    return (
                      <tr
                        key={row.qa_index}
                        onClick={() => setSelectedQA(row)}
                        className="hover:bg-indigo-50/40 transition-colors cursor-pointer group"
                      >
                        <td className="px-4 py-3.5 text-slate-400 font-mono text-xs">{row.qa_index + 1}</td>
                        <td className="px-4 py-3.5">
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
                        <td className="px-4 py-3.5 text-slate-700 font-medium max-w-[200px]">
                          <p className="truncate text-xs" title={row.q}>{row.q}</p>
                        </td>
                        <td className="px-4 py-3.5 text-slate-500 max-w-[200px]">
                          {row.a
                            ? <p className="truncate text-xs" title={row.a}>{row.a}</p>
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
  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center justify-center gap-2 w-32 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
      >
        <History className="w-4 h-4" />
        히스토리
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
                    <span className="text-xs font-mono text-slate-600">{item.final_score?.toFixed(3)}</span>
                    <span className="text-xs text-slate-400">{item.total_qa} QA</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 truncate">
                    {item.metadata?.generation_model ?? '-'} · {item.metadata?.lang ?? '-'}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {new Date(item.created_at).toLocaleString('ko-KR')}
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
