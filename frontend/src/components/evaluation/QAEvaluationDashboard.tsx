import {
  Download, AlertCircle, FileText, Activity, Target, Zap,
  Code2, ChevronDown, Clock, Loader2, LayoutGrid,
  ChevronLeft, ChevronRight, Bot,
} from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useState, useEffect, useRef } from 'react';
import { exportToCSV, exportToHTML, exportToJSON, exportToZip } from '@/src/lib/exportUtils';
import { getEvalStatus, getEvalHistory, getEvalExport, getEvalExportById } from '@/src/lib/api';
import type { QAStatus, QAPreviewItem, EvalReport, HistoryItem } from '@/src/types/evaluation';
import { INTENT_KR, INTENT_COLORS, STATUS_CONFIG, FAILURE_CONFIG, GRADE_COLOR, QA_PAGE_SIZE } from '@/src/types/evaluation';
import { SCORE_THRESHOLDS, getQAStatus } from '@/src/lib/evalScoreUtils';
import { formatKST, buildChartData, buildChartDataFromHistory } from '@/src/lib/evalChartUtils';
import { ChartInfoTooltip } from '@/src/components/evaluation/shared';
import { MetricRadialGauge } from '@/src/components/evaluation/charts/MetricRadialGauge';
import { IntentTreemap } from '@/src/components/evaluation/charts/IntentTreemap';
import { QualityScoreChart } from '@/src/components/evaluation/charts/QualityScoreChart';
import { QADetailView } from '@/src/components/evaluation/QADetailView';
import { HistoryDropdown } from '@/src/components/evaluation/HistoryDropdown';

// ─── 메인 컴포넌트 ────────────────────────────────────────────────────────────
export function QAEvaluationDashboard({ 
  evalJobId, 
  initialEvalDbId,
  setActiveTab
}: { 
  evalJobId?: string | null; 
  initialEvalDbId?: string | null;
  setActiveTab?: (tab: string) => void;
} = {}) {
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
    ? qaPreview.filter(qa => getQAStatus(qa) === statusFilter)
    : qaPreview;
  const sortedQA = sortCol ? [...filteredQA].sort((a, b) => {
    let av: any, bv: any;
    if (sortCol === 'id')       { av = a.qa_index; bv = b.qa_index; }
    else if (sortCol === 'intent')  { av = a.intent ?? ''; bv = b.intent ?? ''; }
    else if (sortCol === 'q')       { av = a.q ?? ''; bv = b.q ?? ''; }
    else if (sortCol === 'a')       { av = a.a ?? ''; bv = b.a ?? ''; }
    else if (sortCol === 'quality') { av = a.quality_avg ?? -1; bv = b.quality_avg ?? -1; }
    else if (sortCol === 'triad')   { av = a.rag_avg ?? -1; bv = b.rag_avg ?? -1; }
    else if (sortCol === 'status')  { av = getQAStatus(a); bv = getQAStatus(b); }
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
  const successCount = qaPreview.filter(qa => getQAStatus(qa) === 'success').length;
  const correctedSummaryStats = chartData?.summaryStats.map((stat, i) => {
    // 히스토리 로딩 중이고 상세 데이터가 아직 준비되지 않았다면 모든 지표에 스켈레톤 적용 (일관성)
    if (historyQaLoading && qaPreview.length === 0) {
      return { ...stat, value: 'loading' };
    }

    // 성공 QA 수 보정 (상세 데이터 도착 후)
    if (i === 1 && qaPreview.length > 0) {
      return { ...stat, value: `${successCount} / ${totalQA}` };
    }
    return stat;
  }) ?? [];

  // export용 데이터
  const evaluationData = chartData ? {
    summaryStats:       correctedSummaryStats,
    layer1Stats:        chartData.layer1Stats,
    intentDistribution: chartData.intentDistribution,
    llmQualityScores:   chartData.llmQualityScores,
    detailedQA:         qaPreview.map((q, i) => ({
      id: i + 1, q: q.q, a: q.a, context: q.context, intent: q.intent,
      l2_avg: q.quality_avg ?? 0, triad_avg: q.rag_avg ?? 0, pass: q.pass,
      primary_failure: q.primary_failure, failure_types: q.failure_types,
      relevance_reason: q.relevance_reason, groundedness_reason: q.groundedness_reason,
      context_relevance_reason: q.context_relevance_reason, completeness_reason: q.completeness_reason,
      failure_reason: q.failure_reason,
      relevance: q.relevance, groundedness: q.groundedness,
      context_relevance: q.context_relevance, completeness: q.completeness,
    })),
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
            relevance_reason: r.relevance_reason, groundedness_reason: r.groundedness_reason,
            context_relevance_reason: r.context_relevance_reason, completeness_reason: r.completeness_reason,
            failure_reason: r.failure_reason,
            relevance: r.relevance, groundedness: r.groundedness,
            context_relevance: r.context_relevance, completeness: r.completeness,
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

  const getGenerationModel = () => {
    const fromMeta = activeReport?.metadata?.generation_model || activeItem?.metadata?.generation_model;
    if (fromMeta) return fromMeta;
    const fn = activeReport?.result_filename || activeItem?.result_filename || '';
    const m = fn.match(/^qa_(.+?)_[a-z]{2}_/);
    return m?.[1] || '-';
  };

  // ─── Empty state ───────────────────────────────────────────────────────────
  if (!evalJobId && !historyReport && !loading) {
    return (
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100 italic flex items-center gap-2">
              <span className="w-1.5 h-6 bg-indigo-500 rounded-full" />
              QA Evaluation
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">QA Pipeline에서 평가를 실행하거나 히스토리에서 이전 결과를 선택하세요</p>
          </div>
          {historyList.length > 0 && (
            <HistoryDropdown historyList={historyList} selectedHistoryId={selectedHistoryId} showMenu={showHistoryMenu} setShowMenu={setShowHistoryMenu} onSelect={selectHistory} />
          )}
        </div>

        <div className="relative group overflow-hidden bg-white/40 dark:bg-white/5 backdrop-blur-md rounded-[32px] border border-white/60 dark:border-white/8 shadow-2xl shadow-slate-200/50 dark:shadow-black/40 flex flex-col items-center justify-center py-14 px-6 text-center transition-all duration-500 hover:shadow-indigo-500/10">
          {/* Decorative Background Blob */}
          <div className="absolute -top-24 -right-24 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl group-hover:bg-indigo-500/10 transition-colors duration-700" />
          <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-purple-500/5 rounded-full blur-3xl group-hover:bg-purple-500/10 transition-colors duration-700" />

          <div className="relative flex items-center justify-center w-20 h-20 mb-6">
            <div className="absolute inset-0 bg-indigo-500/20 rounded-full blur-2xl animate-pulse" />
            <div className="relative z-10 w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-[20px] shadow-xl flex items-center justify-center transform transition-transform duration-500 group-hover:rotate-6 group-hover:scale-110">
              <Activity className="w-8 h-8 text-white" strokeWidth={2.5} />
            </div>
          </div>

          <h3 className="text-xl font-bold text-slate-800 dark:text-white mb-2">준비된 평가 결과가 없습니다</h3>
          <p className="text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed mb-8 text-[13px]">
            QA Pipeline에서 질문-답변 세트를 생성하고 평가를 시작해 보세요.<br/>
            생성된 데이터셋의 평가 결과를 확인할 수 있습니다.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => setActiveTab?.('generation')}
              className="w-52 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-bold text-sm shadow-lg shadow-indigo-600/20 transition-all active:scale-95 flex items-center justify-center gap-2 group/btn"
            >
              QA Pipeline 바로가기
              <Zap className="w-3.5 h-3.5 fill-white group-hover/btn:animate-bounce" />
            </button>
            <button
              onClick={() => setShowHistoryMenu(true)}
              className="w-52 py-3 bg-white/80 dark:bg-white/10 hover:bg-white dark:hover:bg-white/15 text-slate-700 dark:text-slate-200 rounded-2xl font-bold text-sm border border-slate-200 dark:border-white/10 transition-all active:scale-95"
            >
              히스토리 살펴보기
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-72 text-slate-400 dark:text-slate-500 gap-3">
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
    <div className="space-y-6">
      {/* Header */}
      <div 
        className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-2 animate-in fade-in slide-in-from-top-4 duration-700 relative z-30"
        style={{ animationFillMode: 'both' }}
      >
        <div className="space-y-4">
          <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white leading-none">
            QA 성능 평가 리포트
          </h2>
          
          <div className="flex flex-col gap-1.5">
            {/* 1행: Model · Dataset · 평가 일시 */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1 bg-white/60 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 rounded-full backdrop-blur-sm text-[12px] font-medium text-slate-600 dark:text-slate-400 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-slate-300 dark:hover:border-white/20 cursor-default">
                <Bot className="w-3.5 h-3.5 text-indigo-500" />
                <span>Model: <span className="font-semibold text-slate-800 dark:text-slate-200">{getGenerationModel()}</span></span>
              </div>
              {(activeReport?.metadata.source_doc || activeItem?.metadata?.source_doc) && (
                <div
                  title={activeReport?.metadata.source_doc || activeItem?.metadata?.source_doc}
                  className="flex items-center gap-1.5 px-3 py-1 bg-white/60 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 rounded-full backdrop-blur-sm text-[12px] font-medium text-emerald-600 dark:text-emerald-500 shadow-sm overflow-hidden max-w-[280px] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-emerald-300 dark:hover:border-emerald-500/40 cursor-default"
                >
                  <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">
                    원천 문서: <span className="font-semibold">{activeReport?.metadata.source_doc || activeItem?.metadata?.source_doc}</span>
                  </span>
                </div>
              )}
              <div className="flex items-center gap-1.5 px-3 py-1 bg-white/60 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 rounded-full backdrop-blur-sm text-[12px] font-medium text-slate-500 dark:text-slate-400 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-slate-300 dark:hover:border-white/20 cursor-default">
                <Clock className="w-3.5 h-3.5" />
                <span>평가 일시: {formatKST(activeReport?.timestamp ?? activeItem?.created_at ?? '')}</span>
              </div>
            </div>
            {/* 2행: Hierarchy breadcrumb (값 있을 때만) */}
            {(() => {
              const activeMeta = activeReport?.metadata ?? activeItem?.metadata;
              if (!activeMeta || !('hierarchy_h1' in activeMeta)) return null;
              const h1 = activeMeta.hierarchy_h1 || '';
              const h2 = activeMeta.hierarchy_h2 || '';
              const h3 = activeMeta.hierarchy_h3 || '';
              const parts = [h1, h2, h3].filter(Boolean);
              if (parts.length === 0) return null;
              return (
                <div className="flex items-center gap-1 px-3 py-1 bg-indigo-50/60 dark:bg-white/5 border border-indigo-200/60 dark:border-white/10 rounded-full backdrop-blur-sm text-[12px] font-medium text-indigo-600 dark:text-indigo-400 shadow-sm w-fit max-w-[480px] overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-500/40 cursor-default">
                  <LayoutGrid className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="flex items-center gap-1 truncate">
                    <span className="opacity-70 mr-0.5">Category:</span>
                    {parts.map((p, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <ChevronRight className="w-3 h-3 opacity-50 flex-shrink-0" />}
                        <span className="font-semibold truncate">{p}</span>
                      </span>
                    ))}
                  </span>
                </div>
              );
            })()}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {historyList.length > 0 && (
            <HistoryDropdown historyList={historyList} selectedHistoryId={selectedHistoryId} showMenu={showHistoryMenu} setShowMenu={setShowHistoryMenu} onSelect={selectHistory} />
          )}
          <div ref={exportMenuRef} className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              disabled={!evaluationData || exportLoading}
              className="flex items-center justify-center gap-2 w-28 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all duration-300 ease-out shadow-md shadow-indigo-600/20 disabled:opacity-40 hover:-translate-y-0.5 active:scale-95"
            >
              {exportLoading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> 준비 중</>
                : (
                  <>
                    <Download className="w-4 h-4" /> 
                    Export
                    <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showExportMenu && 'rotate-180')} />
                  </>
                )}
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg shadow-slate-200/50 dark:shadow-black/50 z-[60] overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                {(['xlsx', 'html', 'zip'] as const).map((fmt) => (
                  <button key={fmt} onClick={() => handleExport(fmt)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700 text-left text-slate-700 dark:text-slate-200 border-b border-slate-100 dark:border-slate-700 last:border-b-0">
                    {fmt === 'xlsx' && <FileText className="w-4 h-4 text-blue-600" />}
                    {fmt === 'html' && <Code2    className="w-4 h-4 text-green-600" />}
                    {fmt === 'zip'  && <Download className="w-4 h-4 text-indigo-600" />}
                    <div>
                      <div className="font-medium">{fmt.toUpperCase()}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {fmt === 'xlsx' ? '스프레드시트' : fmt === 'html' ? 'HTML 리포트' : 'XLSX + HTML Zip'}
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
      <div 
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500 relative z-20"
        style={{ animationDelay: '100ms', animationFillMode: 'both' }}
      >
        {summaryStats.map((stat, i) => (
          <div key={i} className="relative group hover:z-30 bg-white dark:bg-white/5 p-5 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-md dark:hover:shadow-black/40 flex items-center gap-4">
            {(stat as any).tooltip && (
              <div className="absolute top-4 right-4">
                <ChartInfoTooltip title={(stat as any).tooltip.title} items={(stat as any).tooltip.items} />
              </div>
            )}
            <div className={cn('w-12 h-12 shrink-0 rounded-lg flex items-center justify-center transition-transform duration-300 group-hover:scale-110 group-hover:shadow-inner', stat.bg, stat.color)}>
              <stat.icon className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0 pr-6">
              <p className="text-sm font-medium text-slate-500 dark:text-slate-400 truncate mb-0.5">{stat.label}</p>
              <div className="relative h-8 flex items-center">
                {stat.value === 'loading' ? (
                  <div className="w-24 h-6 bg-slate-200 dark:bg-white/10 rounded-md animate-pulse" />
                ) : (
                  <p className={cn(
                    "text-2xl font-bold text-slate-900 dark:text-slate-100 transition-all duration-500",
                    "opacity-100 blur-0 translate-y-0"
                  )}>
                    {stat.value}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div 
        className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in fade-in duration-700"
        style={{ animationDelay: '200ms', animationFillMode: 'both' }}
      >
        {/* Intent Distribution — Treemap */}
        <div className="bg-white dark:bg-white/5 p-6 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm flex flex-col transition-all duration-300 hover:shadow-md dark:hover:shadow-white/5">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <LayoutGrid className="w-4 h-4 text-cyan-500" /> 의도 분포
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">질문 의도 분포</p>
            </div>
            <ChartInfoTooltip
              title="질문 의도 분포"
              items={[
                { text: 'QA 질문을 의도별로 분류한 분포입니다.' },
                { label: '분류', text: '사실·원인·방법·조건·비교·열거' },
                { label: '기준', text: '면적이 클수록 해당 의도의 비중이 높습니다.' },
              ]}
            />
          </div>
          <IntentTreemap data={intentDistribution} />
        </div>

        {/* Radar: Dataset Stats */}
        <div className="bg-white dark:bg-white/5 p-6 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm flex flex-col transition-all duration-300 hover:shadow-md dark:hover:shadow-white/5">
          <div className="mb-2 flex items-start justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Zap className="w-4 h-4 text-amber-500" /> 데이터 통계
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">구조적·통계적 검증</p>
            </div>
            <ChartInfoTooltip
              title="데이터 통계"
              items={[
                { text: 'QA 데이터셋의 통계적 품질을 0–10으로 검증합니다.' },
                { label: '항목', text: '다양성·중복성·편향성·충분성 (4개 지표)' },
                { label: '통합점수', text: '각 지표의 가중 평균값' },
              ]}
            />
          </div>
          <div className="flex-1 mt-4">
            <div className="grid grid-cols-2 gap-4 h-full content-center">
              {layer1Stats.map((stat) => (
                <MetricRadialGauge key={stat.subject} stat={stat} />
              ))}
            </div>
          </div>
        </div>

        {/* 품질 점수 — 커스텀 인터랙티브 바 */}
        <div className="bg-white dark:bg-white/5 p-6 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm flex flex-col">
          <div className="mb-3 flex items-start justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <Target className="w-4 h-4 text-indigo-500" /> 품질 평가
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">관련성 · 근거성 · 맥락성 · 완전성</p>
            </div>
            <ChartInfoTooltip
              title="품질 평가"
              items={[
                { text: '4개 기준으로 QA 품질을 LLM이 직접 평가합니다 (0–1).' },
                { label: '최종 점수', text: 'RAG ×0.65 + 품질 ×0.25 + 구문·통계 ×0.1' },
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
      <div 
        className="bg-white/80 dark:bg-white/5 backdrop-blur-sm rounded-2xl border border-white/60 dark:border-white/8 shadow-lg shadow-slate-200/40 dark:shadow-black/20 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500"
        style={{ animationDelay: '500ms', animationFillMode: 'both' }}
      >
        {/* 테이블 헤더 */}
        {!selectedQA && (
          <div className="px-5 py-4 border-b border-slate-200 dark:border-white/10 flex items-center justify-between bg-slate-50/50 dark:bg-white/3">
            <div>
              <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">상세 평가 결과</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
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
                      'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.98] shadow-sm hover:shadow-md',
                      isActive
                        ? STATUS_CONFIG[s].className
                        : 'bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-slate-300 hover:text-slate-700 dark:hover:bg-white/8'
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
          <div className="p-12 text-center text-slate-400 dark:text-slate-500 text-sm">
            {report ? '평가된 QA 데이터가 없습니다.' : '현재 세션에서 실행된 평가 결과에서만 상세 QA를 확인할 수 있습니다.'}
          </div>
        ) : selectedQA ? (
          /* ── 상세 뷰 ── */
          <QADetailView qa={selectedQA} onBack={() => setSelectedQA(null)} />
        ) : (
          /* ── 테이블 뷰 ── */
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-white/5 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-white/10">
                  <tr>
                    {([
                      { col: 'id',      label: 'ID',       cls: 'w-10'  },
                      { col: 'intent',  label: '의도',      cls: 'w-20'  },
                      { col: 'q',       label: '질문',      cls: ''      },
                      { col: 'a',       label: '답변',      cls: ''      },
                      { col: 'quality', label: '품질 점수',  cls: 'w-24'  },
                      { col: 'triad',   label: 'Triad 점수', cls: 'w-24' },
                      { col: 'status',  label: '상태',      cls: 'w-16'  },
                      { col: 'failure', label: '실패유형',   cls: 'w-24'  },
                    ] as { col: string; label: string; cls: string }[]).map(({ col, label, cls }) => (
                      <th
                        key={col}
                        onClick={() => {
                          if (sortCol === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); setQaPage(0); }
                          else { setSortCol(col); setSortDir('asc'); setQaPage(0); }
                        }}
                        className={cn('px-3 py-2.5 font-medium text-center text-[12px] cursor-pointer select-none whitespace-nowrap hover:bg-slate-100 dark:hover:bg-white/8 transition-colors', cls)}
                      >
                        <span className="inline-flex items-center justify-center gap-1">
                          {label}
                          <span className="text-[9px] text-slate-300 dark:text-slate-600">
                            {sortCol === col ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                          </span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {qaListLoading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 8 }).map((_, j) => (
                          <td key={j} className="px-3 py-2.5">
                            <div className="h-3 bg-slate-100 dark:bg-white/10 rounded animate-pulse w-full" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : pagedQA.map((row) => {
                    const st = getQAStatus(row);
                    const cfg = STATUS_CONFIG[st];
                    return (
                      <tr
                        key={row.qa_index}
                        onClick={() => setSelectedQA(row)}
                        className="group transition-all duration-200 ease-out border-l-2 border-transparent relative hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)] hover:bg-indigo-50 dark:hover:bg-white/10 hover:border-indigo-500 cursor-pointer h-[60px]"
                      >
                        <td className="px-3 py-2 text-slate-400 dark:text-slate-500 font-mono text-[11px] text-center align-middle">{row.qa_index + 1}</td>
                        <td className="px-3 py-2 text-center align-middle">
                          <span
                            className="px-2 py-[2px] rounded text-[10px] font-bold uppercase tracking-wide border inline-block"
                            style={{
                              backgroundColor: `${INTENT_COLORS[row.intent] ?? '#94a3b8'}15`,
                              color:           INTENT_COLORS[row.intent] ?? '#64748b',
                              borderColor:     `${INTENT_COLORS[row.intent] ?? '#94a3b8'}30`,
                            }}
                          >
                            {(INTENT_KR[row.intent] ?? row.intent) || '-'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-slate-700 dark:text-slate-200 font-medium w-[220px] max-w-[220px] align-middle">
                          <div className="h-[36px] overflow-hidden flex items-center">
                            <p className="line-clamp-2 text-[11px] leading-relaxed">{row.q}</p>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-slate-500 dark:text-slate-400 w-[220px] max-w-[220px] align-middle">
                          <div className="h-[36px] overflow-hidden flex items-center">
                            {row.a
                              ? <p className="line-clamp-2 text-[11px] leading-relaxed">{row.a}</p>
                              : <span className="text-slate-300 dark:text-slate-600 text-[11px]">-</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-[11px] align-middle">
                          {row.quality_avg != null
                            ? <span className={row.quality_avg >= SCORE_THRESHOLDS.mid ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-bold'}>{row.quality_avg.toFixed(3)}</span>
                            : <span className="text-slate-300 dark:text-slate-600">-</span>}
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-[11px] align-middle">
                          {row.rag_avg != null
                            ? <span className={row.rag_avg >= SCORE_THRESHOLDS.mid ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-bold'}>{row.rag_avg.toFixed(3)}</span>
                            : <span className="text-slate-300 dark:text-slate-600">-</span>}
                        </td>
                        <td className="px-3 py-2 text-center align-middle">
                          <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold border', cfg.className)}>
                            {cfg.label}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-center align-middle">
                          {row.primary_failure && FAILURE_CONFIG[row.primary_failure] ? (
                            <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-semibold border', FAILURE_CONFIG[row.primary_failure].className)}>
                              {FAILURE_CONFIG[row.primary_failure].label}
                            </span>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600 text-[11px]">-</span>
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
              <div className="px-5 py-3 border-t border-slate-100 dark:border-white/8 bg-slate-50/50 dark:bg-white/3 flex items-center justify-between">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {qaPage * QA_PAGE_SIZE + 1}–{Math.min((qaPage + 1) * QA_PAGE_SIZE, qaPreview.length)} / {qaPreview.length}개
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setQaPage(p => Math.max(0, p - 1))}
                    disabled={qaPage === 0}
                    className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                  </button>
                  <span className="text-xs font-mono text-slate-600 dark:text-slate-300 px-1.5">{qaPage + 1} / {totalPages}</span>
                  <button
                    onClick={() => setQaPage(p => Math.min(totalPages - 1, p + 1))}
                    disabled={qaPage === totalPages - 1}
                    className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4 text-slate-600 dark:text-slate-300" />
                  </button>
                </div>
              </div>
            )}

            {/* 전체 개수 안내 (페이지 없을 때) */}
            {totalPages === 1 && activeReport && activeReport.metadata.total_qa > qaPreview.length && (
              <div className="p-3 border-t border-slate-100 dark:border-white/8 bg-slate-50 dark:bg-white/5 text-center text-xs text-slate-500 dark:text-slate-400">
                총 {activeReport.metadata.total_qa.toLocaleString()}개 중 상위 {qaPreview.length}개 표시
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
