import {
  Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
  Treemap,
} from 'recharts';
import {
  Download, CheckCircle2, AlertCircle, FileText, Activity, Target, Zap,
  Code2, ChevronDown, Clock, History, Loader2, LayoutGrid, Info,
  ArrowLeft, ChevronLeft, ChevronRight, Bot,
  Shuffle, Copy, Scale, ShieldCheck
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
  factoid:      '사실형',
  numeric:      '수치형',
  procedure:    '절차형',
  why:          '원인형',
  definition:   '정의형',
  boolean:      '확인형',
  summary:      '요약형',
  confirmation: '확인형',
};

const INTENT_COLORS: Record<string, string> = {
  // 신규 6종 — 쭄도를 낙춰 세련되게
  fact:       '#3b7dd8',   // 조용한 블루
  purpose:    '#a855b5',   // 춨서멈 퍼플
  how:        '#16a35a',   // 폰 에메랄드
  condition:  '#d97706',   // 헤이저드 오렌지
  comparison: '#4f46e5',   // 인디고
  list:       '#0891b2',   // 다크 시안
  // 구형 8종 (하위 호환)
  factoid:      '#3b7dd8',
  numeric:      '#ca8a04',
  procedure:    '#4f46e5',
  why:          '#a855b5',
  definition:   '#0284c7',
  boolean:      '#9333ea',
  summary:      '#0891b2',
  confirmation: '#9333ea',
};

// ─── Intent 설명 텍스트 ──────────────────────────────────────────────────────
const INTENT_DESCRIPTIONS: Record<string, string> = {
  fact:       '명확한 사실 정보를 확인하는 질문',
  purpose:    '원인, 배경, 이유를 탐색하는 질문',
  how:        '구체적 방법이나 절차를 묻는 질문',
  condition:  '조건·상황별 결과를 확인하는 질문',
  comparison: '두 대상 이상을 비교하는 질문',
  list:       '여러 항목을 나열·열거하는 질문',
  // 구형 하위 호환
  factoid:      '명확한 사실 정보를 확인하는 질문',
  numeric:      '수치나 통계 데이터를 묻는 질문',
  procedure:    '단계적 절차나 방법을 묻는 질문',
  why:          '원인과 이유를 탐색하는 질문',
  definition:   '개념이나 용어의 정의를 묻는 질문',
  boolean:      '참/거짓 여부를 확인하는 질문',
  summary:      '내용을 요약하여 전달하는 질문',
  confirmation: '참/거짓 여부를 확인하는 질문',
};

// ─── 상태 로직 ────────────────────────────────────────────────────────────────
type QAStatus = 'success' | 'hold' | 'fail';

function getQAStatus(qa: Partial<QAPreviewItem>): QAStatus {
  if (!qa) return 'fail';
  const { quality_avg, rag_avg, pass, failure_types } = qa;

  // 1. 기본 점수 기반 판정 (임계값 0.7 미만 시 실패/보류)
  const qFail = quality_avg == null || quality_avg < 0.7;
  const rFail = rag_avg    == null || rag_avg    < 0.7;

  if (qFail && rFail) return 'fail';

  // 2. 예외 처리: 고득점(0.7 이상)이지만 결함이 발견된 경우 -> '보류(Hold)'
  // - 백엔드에서 pass: false를 줬거나 실질적인 failure_types가 존재하는 경우
  const hasError = (pass === false) || (failure_types && failure_types.length > 0);
  if (!qFail && !rFail && hasError) {
    return 'hold';
  }

  // 3. 점수가 하나라도 낮으면 원래대로 '보류'
  if (qFail || rFail) return 'hold';

  // 4. 모든 조건 충족 시 성공
  return 'success';
}

const STATUS_CONFIG: Record<QAStatus, { label: string; className: string; dotColor: string }> = {
  success: { label: '성공', className: 'bg-emerald-50 text-emerald-700 border-emerald-200', dotColor: 'bg-emerald-500' },
  hold:    { label: '보류', className: 'bg-amber-50 text-amber-700 border-amber-200',       dotColor: 'bg-amber-400'  },
  fail:    { label: '실패', className: 'bg-rose-50 text-rose-700 border-rose-200',          dotColor: 'bg-rose-500'   },
};

// ─── Failure Type ─────────────────────────────────────────────────────────────
const FAILURE_CONFIG: Record<string, { label: string; className: string }> = {
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

interface EvalReport {
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

interface HistoryItem {
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
    .filter(qa => getQAStatus(qa) === 'success').length;
  const summaryStats = [
    { label: '총 생성된 QA',   value: report.metadata.total_qa.toLocaleString(), icon: FileText,    color: 'text-indigo-600',  bg: 'bg-indigo-100',
      tooltip: { title: '총 생성된 QA', items: [{ text: '문서에서 추출된 전체 질의응답 세트의 수입니다.' }, { label: '기준', text: '의미론적 중복을 제거한 최종본 개수' }] } },
    { label: '성공 QA 수',     value: `${successCount} / ${report.metadata.total_qa.toLocaleString()}`, icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100',
      tooltip: { title: '성공 QA 수', items: [{ text: '검증을 통과한 고품질 QA 세트의 수입니다.' }, { label: '기준', text: '전체 지표 통과 및 구조적 오류가 없는 데이터' }] } },
    { label: '통합 품질 평균 점수', value: (sum.final_score ?? 0).toFixed(3), icon: Target,       color: 'text-amber-600',   bg: 'bg-amber-100',
      tooltip: { title: '통합 품질 평균 점수', items: [{ text: '전체 QA 데이터의 평균 종합 점수입니다 (0~1).' }, { label: '구성', text: 'RAG Triad + 품질 평가 + 구조 검증 점수의 가중합' }] } },
    { label: '종합 평가 등급', value: sum.grade ?? '-',    icon: Activity,     color: 'text-rose-600',    bg: 'bg-rose-100',
      tooltip: { title: '종합 평가 등급', items: [{ text: '데이터셋의 최종 활용 가능성을 나타내는 등급입니다.' }, { label: 'A등급', text: '우수 (즉시 상용화 가능)' }, { label: 'B등급', text: '양호 (일부 검토 요망)' }, { label: 'C 이하', text: '미흡 (재생성 권장)' }] } },
  ];

  const layer1Stats = [
    { subject: '다양성', A: s?.metrics?.diversity_score    ?? s?.diversity?.score        ?? 0, fullMark: 10 },
    { subject: '중복성', A: s?.metrics?.duplication_score  ?? s?.duplication_rate?.score ?? 0, fullMark: 10 },
    { subject: '편향성', A: s?.metrics?.skewness_score     ?? s?.skewness?.score         ?? 0, fullMark: 10 },
    { subject: '충족성', A: s?.metrics?.sufficiency_score   ?? s?.data_sufficiency?.score ?? 0, fullMark: 10 },
  ];

  const intentDist = s?.diversity?.intent_distribution ?? {};
  const intentDistribution = Object.entries(intentDist).map(([name, value]) => ({
    name,
    label:   name.charAt(0).toUpperCase() + name.slice(1),
    krLabel: INTENT_KR[name] ?? name,
    value:   value as number,
  }));

  const llmQualityScores = [
    { name: '관련성', nameEn: 'Answer Relevance', score: rag?.summary?.avg_relevance         ?? 0, group: 'rag' as const },
    { name: '근거성', nameEn: 'Groundedness',     score: rag?.summary?.avg_groundedness      ?? 0, group: 'rag' as const },
    { name: '맥락성', nameEn: 'Context Relevance', score: rag?.summary?.avg_context_relevance ?? 0, group: 'rag' as const },
    { name: '완전성', nameEn: 'Completeness',     score: qua?.summary?.avg_completeness      ?? 0, group: 'quality' as const },
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
    { label: '총 생성된 QA',   value: item.total_qa.toLocaleString(),                                          icon: FileText,    color: 'text-indigo-600',  bg: 'bg-indigo-100',
      tooltip: { title: '총 생성된 QA', items: [{ text: '문서에서 추출된 전체 질의응답 세트의 수입니다.' }, { label: '기준', text: '의미론적 중복을 제거한 최종본 개수' }] } },
    { label: '성공 QA 수',     value: `${passCount} / ${item.total_qa.toLocaleString()}`,                      icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100',
      tooltip: { title: '성공 QA 수', items: [{ text: '검증을 통과한 고품질 QA 세트의 수입니다.' }, { label: '기준', text: '전체 지표 통과 및 구조적 오류가 없는 데이터' }] } },
    { label: '통합 품질 평균 점수', value: (item.final_score ?? 0).toFixed(3),                            icon: Target,       color: 'text-amber-600',   bg: 'bg-amber-100',
      tooltip: { title: '통합 품질 평균 점수', items: [{ text: '전체 QA 데이터의 평균 종합 점수입니다 (0~1).' }, { label: '구성', text: 'RAG Triad + 품질 평가 + 구조 검증 점수의 가중합' }] } },
    { label: '종합 평가 등급', value: item.final_grade ?? '-',                            icon: Activity,     color: 'text-rose-600',    bg: 'bg-rose-100',
      tooltip: { title: '종합 평가 등급', items: [{ text: '데이터셋의 최종 활용 가능성을 나타내는 등급입니다.' }, { label: 'A등급', text: '우수 (즉시 상용화 가능)' }, { label: 'B등급', text: '양호 (일부 검토 요망)' }, { label: 'C 이하', text: '미흡 (재생성 권장)' }] } },
  ];

  const layer1Stats = [
    { subject: '다양성', A: st?.metrics?.diversity_score    ?? st?.diversity?.score        ?? 0, fullMark: 10 },
    { subject: '중복성', A: st?.metrics?.duplication_score  ?? st?.duplication_rate?.score ?? 0, fullMark: 10 },
    { subject: '편향성', A: st?.metrics?.skewness_score     ?? st?.skewness?.score         ?? 0, fullMark: 10 },
    { subject: '충족성', A: st?.metrics?.sufficiency_score   ?? st?.data_sufficiency?.score ?? 0, fullMark: 10 },
  ];

  const intentDist = st?.diversity?.intent_distribution ?? {};
  const intentDistribution = Object.entries(intentDist).map(([name, value]) => ({
    name, label: name.charAt(0).toUpperCase() + name.slice(1), krLabel: INTENT_KR[name] ?? name, value: value as number,
  }));

  const llmQualityScores = [
    { name: '관련성', nameEn: 'Answer Relevance', score: rag?.summary?.avg_relevance         ?? 0, group: 'rag' as const },
    { name: '근거성', nameEn: 'Groundedness',     score: rag?.summary?.avg_groundedness      ?? 0, group: 'rag' as const },
    { name: '맥락성', nameEn: 'Context Relevance', score: rag?.summary?.avg_context_relevance ?? 0, group: 'rag' as const },
    { name: '완전성', nameEn: 'Completeness',     score: qua?.summary?.avg_completeness      ?? 0, group: 'quality' as const },
  ];

  return { summaryStats, layer1Stats, intentDistribution, llmQualityScores };
}

// ─── 공통 툴팁 wrapper ────────────────────────────────────────────────────────
const TooltipCard = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-md px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-200/50 dark:shadow-black/50 animate-in zoom-in-95 duration-200">
    {children}
  </div>
);

// ─── 커스텀 툴팁 (Treemap hover) ────────────────────────────────────────────
const IntentTreemapTooltip = ({ active, payload }: any) => {
  if (active && payload?.length) {
    const d = payload[0].payload;
    const total = d.root?.value ?? d.value;
    const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
    const desc = INTENT_DESCRIPTIONS[d.name] ?? '';
    return (
      <TooltipCard>
        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
          {d.krLabel ?? d.name}
          <span className="text-slate-400 dark:text-slate-500 font-normal ml-1">({d.name})</span>
        </p>
        {desc && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{desc}</p>}
        <div className="flex items-center gap-3 mt-1.5 pt-1.5 border-t border-slate-100 dark:border-white/10">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">수량: <span className="font-bold text-slate-700 dark:text-slate-200">{d.value}개</span></span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">비중: <span className="font-bold text-indigo-600 dark:text-indigo-400">{pct}%</span></span>
        </div>
      </TooltipCard>
    );
  }
  return null;
};

// ─── 커스텀 툴팁 (RadarChart) ─────────────────────────────────────────────────
const RadarTooltip = ({ active, payload }: any) => {
  if (active && payload?.length) {
    const d = payload[0].payload;
    return (
      <TooltipCard>
        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">{d.subject}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">점수: <span className="font-bold text-slate-700 dark:text-slate-200">{(d.A as number)?.toFixed(1)} / 10.0</span></p>
      </TooltipCard>
    );
  }
  return null;
};

// ─── 데이터 통계용 Radial Gauge 컴포넌트 ─────────────────────────────────────────
const MetricRadialGauge = ({ stat }: { stat: { subject: string; A: number } }) => {
  const [val, setVal] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    // 10.0점 등 높은 점수에서도 0에서 차오르는 연출을 위해 매번 상태 초기화
    // stat 객체 전체를 감시하여 히스토리 전환 시 값이 같더라도 리셋 유도
    setIsReady(false);
    setVal(0);

    const t1 = setTimeout(() => setIsReady(true), 200);
    
    // 숫자 카운트업 (0 -> stat.A)
    const duration = 1200;
    const steps = 30;
    const increment = stat.A / steps || 0;
    let current = 0;
    
    const timer = setInterval(() => {
      current += increment;
      if (current >= stat.A) {
        setVal(stat.A);
        clearInterval(timer);
      } else {
        setVal(current);
      }
    }, duration / steps);

    return () => {
      clearTimeout(t1);
      clearInterval(timer);
    };
  }, [stat]); // stat.A 대신 stat 전체를 감시하여 히스토리 전환 대응

  const config: Record<string, { icon: any; lightColor: string; darkColor: string; bg: string; desc: string }> = {
    '다양성': { icon: Shuffle,       lightColor: '#0284c7', darkColor: '#38bdf8', bg: 'bg-sky-500/10',     desc: '데이터셋 내 질문 의도와 내용의 고른 분포' },
    '중복성': { icon: Copy,          lightColor: '#e67e22', darkColor: '#fbbf24', bg: 'bg-amber-500/10',   desc: '동일/유사한 의미를 가진 질문의 포함 정도' },
    '편향성': { icon: Scale,         lightColor: '#4f46e5', darkColor: '#a5b4fc', bg: 'bg-indigo-500/10',  desc: '특정 주제나 화자에 대한 편향성 여부' },
    '충족성': { icon: ShieldCheck,   lightColor: '#059669', darkColor: '#34d399', bg: 'bg-emerald-500/10', desc: '답변 도출을 위한 맥락 정보의 충분성'   },
  };
  const cfg = config[stat.subject] || { icon: Zap, lightColor: '#64748b', darkColor: '#94a3b8', bg: 'bg-slate-100', desc: '' };
  
  const r = 42;
  const circ = 2 * Math.PI * r;
  // 초기 로딩 중에는 전체 둘레로 설정하여 비워두고, 준비되면 목표치만큼 차오르게 함
  // 10.0점일 때도 비어있는 상태(circ)에서 목표치(targetOffset)까지 차오르게 함
  const targetOffset = circ * (1 - Math.min(Math.max(stat.A, 0), 10) / 10);
  const currentOffset = isReady ? targetOffset : circ;

  return (
    <div 
      className="flex flex-col items-center justify-center group/gauge relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Hover Tooltip */}
      {isHovered && (
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none w-max">
          <div className="bg-white/95 dark:bg-slate-800/95 backdrop-blur-md px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-200/50 dark:shadow-black/50 animate-in fade-in zoom-in-95 duration-200 flex flex-col items-center">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", cfg.bg, stat.subject === '다양성' && "text-sky-600 dark:text-sky-400", stat.subject === '중복성' && "text-amber-600 dark:text-amber-400", stat.subject === '편향성' && "text-indigo-600 dark:text-indigo-400", stat.subject === '충족성' && "text-emerald-600 dark:text-emerald-400")}>
                {stat.subject}
              </span>
              <span className="text-[10px] font-black text-slate-700 dark:text-slate-200">{stat.A.toFixed(1)} / 10.0</span>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">{cfg.desc}</p>
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white/95 dark:bg-slate-800/95 border-r border-b border-slate-200 dark:border-slate-700 rotate-45 invisible sm:visible" />
          </div>
        </div>
      )}

      <div className="relative w-24 h-24 flex items-center justify-center">
        <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
          <defs>
            <linearGradient id={`grad-${stat.subject}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.85" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
            </linearGradient>
          </defs>
          <circle
            cx="50" cy="50" r={r}
            stroke="currentColor"
            strokeWidth="4"
            fill="transparent"
            className="text-slate-200 dark:text-white/5 opacity-40 dark:opacity-100"
          />
          <circle
            cx="50" cy="50" r={r}
            stroke={`url(#grad-${stat.subject})`}
            strokeWidth="6"
            fill="transparent"
            strokeDasharray={circ}
            strokeDashoffset={currentOffset}
            strokeLinecap="round"
            className={cn(
              "transition-all duration-1000 cubic-bezier(0.34, 1.56, 0.64, 1)",
              stat.subject === '다양성' && "text-sky-500 dark:text-sky-400",
              stat.subject === '중복성' && "text-amber-500 dark:text-amber-400",
              stat.subject === '편향성' && "text-indigo-500 dark:text-indigo-400",
              stat.subject === '충족성' && "text-emerald-500 dark:text-emerald-400"
            )}
            style={{ 
              filter: isReady ? 'drop-shadow(0 0 3px currentColor)' : 'none',
              opacity: isReady ? 1 : 0
            }}
          />
          {/* Light mode 전용 선명한 보정 선 */}
          <circle
            cx="50" cy="50" r={r}
            stroke="currentColor"
            strokeWidth="6"
            fill="transparent"
            strokeDasharray={circ}
            strokeDashoffset={currentOffset}
            strokeLinecap="round"
            className={cn(
              "transition-all duration-1000 cubic-bezier(0.34, 1.56, 0.64, 1) dark:hidden",
              stat.subject === '다양성' && "text-sky-500",
              stat.subject === '중복성' && "text-amber-500",
              stat.subject === '편향성' && "text-indigo-500",
              stat.subject === '충족성' && "text-emerald-500"
            )}
            style={{ opacity: isReady ? 0.9 : 0 }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-black text-slate-800 dark:text-white leading-none tracking-tight">
            {val.toFixed(1)}
          </span>
          <div className={cn(
            "mt-1.5 p-1 rounded-md transform transition-all duration-300 group-hover/gauge:scale-110 group-hover/gauge:rotate-3 shadow-sm",
            cfg.bg,
            stat.subject === '다양성' && "text-sky-600 dark:text-sky-400",
            stat.subject === '중복성' && "text-amber-600 dark:text-amber-400",
            stat.subject === '편향성' && "text-indigo-600 dark:text-indigo-400",
            stat.subject === '충족성' && "text-emerald-600 dark:text-emerald-400"
          )}>
            <cfg.icon className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>
      <div className="mt-2 text-center">
        <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 tracking-tight">{stat.subject}</p>
      </div>
    </div>
  );
};

// ─── 차트 정보 툴팁 ──────────────────────────────────────────────────────────
function ChartInfoTooltip({ title, items }: {
  title: string;
  items: Array<{ label?: string; text: string }>;
}) {
  return (
    <div className="relative group/info flex-shrink-0">
      <Info className="w-3.5 h-3.5 text-slate-300 group-hover/info:text-indigo-400 cursor-default transition-colors" />
      <div className="absolute right-[-8px] top-6 w-64 bg-white/95 dark:bg-slate-800/95 backdrop-blur-md rounded-xl p-3.5 z-50 opacity-0 group-hover/info:opacity-100 transition-all duration-200 pointer-events-none shadow-xl shadow-slate-200/50 dark:shadow-black/50 border border-slate-200/70 dark:border-white/10 scale-95 group-hover/info:scale-100 origin-top-right">
        <div className="absolute -top-[5px] right-[10px] w-3 h-3 bg-white/95 dark:bg-slate-800/95 border-t border-l border-slate-200/70 dark:border-white/10 rotate-45 rounded-sm" />
        <p className="text-[12px] font-bold text-slate-800 dark:text-slate-100 mb-2 relative z-10">{title}</p>
        <div className="space-y-1.5 relative z-10">
          {items.map((item, i) => (
            <div key={i} className="flex gap-2 text-[11px] leading-relaxed">
              {item.label && (
                <span className="font-semibold text-indigo-600 dark:text-indigo-400 shrink-0">{item.label}</span>
              )}
              <span className="text-slate-600 dark:text-slate-300 font-medium">{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Intent Treemap 차트 ────────────────────────────────────────────────────
function IntentTreemap({ data }: { data: Array<{ name: string; krLabel: string; value: number }> }) {
  const [hoveredName, setHoveredName] = useState<string | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0);

  // recharts Treemap 데이터
  const treemapData = [{
    name: 'root',
    children: data.map(d => ({
      name:    d.name,
      krLabel: d.krLabel,
      value:   d.value,
      fill:    INTENT_COLORS[d.name] ?? '#94a3b8',
      root:    { value: total },
    })),
  }];

  const CustomCell = (props: any) => {
    const { x, y, width, height, name, krLabel, value, fill, depth } = props;
    if (depth === 0 || !name || name === 'root') return null;

    const isHovered = hoveredName === name;
    const pct       = total > 0 ? Math.round((value / total) * 100) : 0;
    const area      = width * height;

    const tier = area > 12000 ? 5 : area > 5000 ? 4 : area > 2200 ? 3 : area > 900 ? 2 : 1;

    const showPct   = width > 22 && height > 16;
    const showLabel = tier >= 3 && height > 32; 

    const pctSize   = [0, 8, 10, 12, 16, 18][tier]; 
    const lblSize   = [0, 0,  0, 8.5, 10, 11][tier];
    const sw        = tier <= 2 ? 1.5 : 3;

    const font = "'Inter', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    const textShadow = '0 1px 3px rgba(0,0,0,0.45), 0 0 1px rgba(0,0,0,0.3)';

    return (
      <g
        onMouseEnter={() => setHoveredName(name)}
        onMouseLeave={() => setHoveredName(null)}
        className="cursor-pointer group/cell"
      >
        <rect
          x={x + 1.5} y={y + 1.5}
          width={Math.max(0, width - 3)}
          height={Math.max(0, height - 3)}
          fill={fill}
          rx={8} ry={8}
          className="transition-all duration-300"
          style={{ 
            filter: isHovered
              ? 'brightness(1.12) saturate(1.15) drop-shadow(0 6px 16px rgba(0,0,0,0.22))'
              : 'brightness(1.0)',
            stroke: isHovered ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.15)',
            strokeWidth: isHovered ? 2.5 : 1
          }}
        />

        {showPct && (
          <text
            x={x + width / 2}
            y={y + (showLabel ? height / 2 - (pctSize * 0.4) : height / 2 + (pctSize * 0.4))}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#ffffff"
            fontSize={pctSize}
            fontWeight={800}
            fontFamily={font}
            paintOrder="stroke"
            stroke="rgba(0,0,0,0.25)"
            strokeWidth={sw}
            strokeLinejoin="round"
            className="pointer-events-none select-none transition-opacity duration-500"
            style={{ filter: `drop-shadow(${textShadow})` }}
          >
            {pct}%
          </text>
        )}

        {showLabel && (
          <text
            x={x + width / 2}
            y={y + height / 2 + (showPct ? pctSize * 0.6 : lblSize * 0.5)}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="rgba(255,255,255,0.92)"
            fontSize={lblSize}
            fontWeight={700}
            fontFamily={font}
            paintOrder="stroke"
            stroke="rgba(0,0,0,0.15)"
            strokeWidth="1.5px"
            className="pointer-events-none select-none transition-opacity duration-500"
            style={{ filter: `drop-shadow(${textShadow})` }}
          >
            {krLabel ?? name}
          </text>
        )}
      </g>
    );
  };

  if (data.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-xs text-slate-400">데이터 없음</div>;
  }

  return (
    <div
      className="flex-1 min-h-[240px] mt-1 animate-in fade-in zoom-in-95 duration-500"
      style={{ animationFillMode: 'both' }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={treemapData}
          dataKey="value"
          aspectRatio={4 / 3}
          stroke="transparent"
          content={<CustomCell />}
          isAnimationActive={false}
        >
          <Tooltip content={<IntentTreemapTooltip />} isAnimationActive={false} />
        </Treemap>
      </ResponsiveContainer>
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

  // 애니메이션 트리거
  const triggerFnRef = useRef(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setAnimated(false);
    timerRef.current = setTimeout(() => setAnimated(true), 150);
  });

  // data 실제 값이 바뀔 때 재애니메이션
  useEffect(() => {
    const key = data.map((d) => d.score.toFixed(4)).join(',');
    if (key === '' || prevKeyRef.current === key) return;
    prevKeyRef.current = key;
    triggerFnRef.current();
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // 탭 전환으로 컨테이너가 hidden→visible 될 때 재애니메이션
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

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <div ref={containerRef} className="space-y-3.5 mt-2">
      {data.map((item, i) => {
        const isHigh = item.score >= 0.85;
        const isMid  = item.score >= 0.7;
        const colorClass = isHigh ? 'from-emerald-400 to-teal-500' : isMid ? 'from-amber-400 to-orange-500' : 'from-rose-400 to-red-500';
        const glowClass  = isHigh ? 'shadow-[0_0_12px_rgba(16,185,129,0.3)]' : isMid ? 'shadow-[0_0_12px_rgba(245,158,11,0.3)]' : 'shadow-[0_0_12px_rgba(244,63,94,0.3)]';
        const isRag = item.group === 'rag';
        const targetW = Math.min(item.score * 100, 100);

        return (
          <div 
            key={item.name} 
            className="group/item relative bg-slate-50/50 dark:bg-white/3 border border-slate-100 dark:border-white/5 p-3.5 rounded-xl transition-all duration-300 hover:bg-white dark:hover:bg-white/8 hover:shadow-md hover:-translate-y-0.5 animate-in fade-in slide-in-from-right-4 fill-mode-both"
            style={{ animationDelay: `${i * 100}ms` }}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
          >
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2.5">
                <span className={cn(
                  "px-2 py-0.5 rounded-md text-[9px] font-black tracking-widest uppercase border backdrop-blur-sm shadow-sm",
                  isRag ? "bg-blue-500/10 text-blue-500 border-blue-500/20" : "bg-purple-500/10 text-purple-500 border-purple-500/20"
                )}>
                  {isRag ? 'RAG' : '품질'}
                </span>
                <span className="text-[13px] font-bold text-slate-700 dark:text-slate-200">{item.name}</span>
              </div>
              <span className={cn("font-mono text-sm font-black transition-colors duration-500", isHigh ? 'text-emerald-500' : isMid ? 'text-amber-500' : 'text-rose-500')}>
                {item.score.toFixed(3)}
              </span>
            </div>
            <div className="relative h-2 w-full bg-slate-200/50 dark:bg-white/5 rounded-full overflow-hidden shadow-inner">
              <div 
                className={cn("absolute inset-y-0 left-0 bg-gradient-to-r transition-all duration-1000 ease-out rounded-full ring-1 ring-white/10", colorClass, glowClass)}
                style={{ width: `${(animated ? targetW : 0).toFixed(1)}%` }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-white rounded-full shadow-lg opacity-80 group-hover/item:scale-150 transition-transform duration-500" />
              </div>
            </div>
          </div>
        );
      })}
      <div className="flex items-center justify-end gap-5 pt-2 text-[10px] font-bold tracking-tight text-slate-400 dark:text-slate-500 uppercase">
        <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" /> ≥ 0.85</div>
        <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]" /> ≥ 0.70</div>
        <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.5)]" /> &lt; 0.70</div>
      </div>
    </div>
  );
}

// ─── QA 상세 뷰 ──────────────────────────────────────────────────────────────
function QADetailView({ qa, onBack }: { qa: QAPreviewItem; onBack: () => void }) {
  const status = getQAStatus(qa);
  const cfg    = STATUS_CONFIG[status];

  // RAG 차원
  const ragDimensions = [
    { label: '관련성', score: qa.relevance,         reason: qa.relevance_reason },
    { label: '근거성', score: qa.groundedness,       reason: qa.groundedness_reason },
    { label: '맥락성', score: qa.context_relevance,  reason: qa.context_relevance_reason },
  ].filter(r => r.reason);

  // Quality 차원
  const qualityDimensions = [
    { label: '완전성', score: qa.completeness, reason: qa.completeness_reason },
  ].filter(r => r.reason);

  // 통합 차원 목록
  const allDimensions = [...ragDimensions, ...qualityDimensions];

  const scoreColor = (v: number) =>
    v >= 0.85 ? 'text-emerald-600' : v >= 0.7 ? 'text-amber-500' : 'text-rose-600';

  return (
    <div className="p-5 space-y-4 animate-in fade-in slide-in-from-right-8 duration-300">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-all hover:-translate-x-1 active:scale-[0.98]"
        >
          <ArrowLeft className="w-4 h-4" /> 목록으로
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">#{qa.qa_index + 1}</span>
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
        <div className="rounded-xl border border-rose-200 dark:border-rose-500/20 overflow-hidden relative">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-rose-500/50" />
          <div className="px-4 py-1.5 bg-rose-50/50 dark:bg-rose-950/30 border-b border-rose-100 dark:border-rose-500/10">
            <p className="text-[10px] font-bold uppercase tracking-widest text-rose-600/80 dark:text-rose-400">주요 실패 유형</p>
          </div>
          <div className="p-4 text-xs space-y-1">
            <p className="font-semibold text-rose-700 dark:text-rose-300">{FAILURE_CONFIG[qa.primary_failure]?.label ?? qa.primary_failure}</p>
            {qa.failure_reason && <p className="text-slate-600 dark:text-slate-400 leading-relaxed">{qa.failure_reason}</p>}
            {(qa.failure_types?.length ?? 0) > 1 && (
              <p className="text-slate-400 dark:text-slate-500 text-[10px] pt-1">
                전체 실패 항목: {qa.failure_types!.map(f => FAILURE_CONFIG[f]?.label ?? f).join(', ')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Q / A / Context */}
      <div className="space-y-3">
        {/* 질문 */}
        <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden relative">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-slate-400/50" />
          <div className="px-4 py-1.5 bg-slate-100/50 dark:bg-white/5 border-b border-slate-200 dark:border-white/5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">질문</p>
          </div>
          <div className="p-4">
            <p className="text-sm text-slate-800 dark:text-slate-100 leading-relaxed font-medium">{qa.q}</p>
          </div>
        </div>

        {/* 답변 */}
        {qa.a ? (
          <div className="bg-indigo-50/60 dark:bg-indigo-950/20 rounded-xl border border-indigo-100 dark:border-indigo-500/20 overflow-hidden relative">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500/50" />
            <div className="px-4 py-1.5 bg-indigo-50/50 dark:bg-indigo-950/30 border-b border-indigo-100 dark:border-indigo-500/10">
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 dark:text-indigo-400">답변</p>
            </div>
            <div className="p-4">
              <p className="text-sm text-slate-700 dark:text-indigo-100 leading-relaxed font-medium">{qa.a}</p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl p-4 border border-dashed border-slate-200 dark:border-white/10 text-center text-xs text-slate-400 dark:text-slate-500">
            답변 데이터 없음
          </div>
        )}

        {/* 컨텍스트 */}
        {qa.context && (
          <div className="bg-teal-50/50 dark:bg-teal-950/20 rounded-xl border border-teal-100 dark:border-teal-500/20 overflow-hidden relative">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-teal-500/50" />
            <div className="px-4 py-1.5 bg-teal-50/50 dark:bg-teal-950/30 border-b border-teal-100 dark:border-teal-500/10">
              <p className="text-[10px] font-bold uppercase tracking-widest text-teal-500 dark:text-teal-400">컨텍스트</p>
            </div>
            <div className="p-4">
              <p className="text-sm text-slate-600 dark:text-teal-100/80 leading-relaxed">{qa.context}</p>
            </div>
          </div>
        )}
      </div>

      {/* 품질 평가 — RAG Triad + Quality 통합 섹션 */}
      {(qa.rag_avg != null || qa.quality_avg != null || allDimensions.length > 0) && (
        <div className="bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden relative">
          {/* 포인트 악센트 */}
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-violet-500/50" />
          
          <div className="flex items-center justify-between px-4 py-1.5 bg-slate-100/50 dark:bg-white/5 border-b border-slate-200 dark:border-white/5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">품질 평가 결과</p>
            <div className="flex items-center gap-3">
              {(() => {
                const r = qa.rag_avg ?? 0;
                const q = qa.quality_avg ?? 0;
                const unified = (r * 3 + q) / 4;
                return (
                  <span className={cn('font-black font-mono text-lg', scoreColor(unified))}>
                    {unified.toFixed(3)}
                  </span>
                );
              })()}
            </div>
          </div>
          {allDimensions.length > 0 && (
            <div className="divide-y divide-slate-100 dark:divide-white/5 border-t border-slate-200 dark:border-white/5">
              {/* 테두리 헤더(옵션)가 없으므로 첫 행 패딩 조정 */}
              {allDimensions.map(({ label, score, reason }) => (
                <div key={label} className="flex items-start gap-4 px-4 py-3 text-[12px] group hover:bg-white/40 dark:hover:bg-white/5 transition-colors">
                  <span className="shrink-0 font-bold text-slate-500 dark:text-slate-400 w-16">{label}</span>
                  <span className={cn('shrink-0 font-mono font-bold w-14 text-center', score != null ? scoreColor(score) : 'text-slate-300 dark:text-slate-600')}>
                    {score != null ? score.toFixed(3) : '-'}
                  </span>
                  <span className="flex-1 text-slate-600 dark:text-slate-300 leading-relaxed pl-2 border-l border-slate-100 dark:border-white/5">
                    {reason}
                  </span>
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
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">평가를 실행하거나 히스토리에서 이전 결과를 선택하세요</p>
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
            생성된 데이터셋의 품질 지표가 이곳에 화려하게 요약됩니다.
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
              <div className="flex items-center gap-1.5 px-3 py-1 bg-white/60 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 rounded-full backdrop-blur-sm text-[12px] font-medium text-slate-600 dark:text-slate-400 shadow-sm">
                <Bot className="w-3.5 h-3.5 text-indigo-500" />
                <span>Model: <span className="font-semibold text-slate-800 dark:text-slate-200">{getGenerationModel()}</span></span>
              </div>
              {(activeReport?.metadata.source_doc || activeItem?.metadata?.source_doc) && (
                <div
                  title={activeReport?.metadata.source_doc || activeItem?.metadata?.source_doc}
                  className="flex items-center gap-1.5 px-3 py-1 bg-white/60 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 rounded-full backdrop-blur-sm text-[12px] font-medium text-emerald-600 dark:text-emerald-500 shadow-sm overflow-hidden max-w-[280px]"
                >
                  <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="truncate">
                    원천 문서: <span className="font-semibold">{activeReport?.metadata.source_doc || activeItem?.metadata?.source_doc}</span>
                  </span>
                </div>
              )}
              <div className="flex items-center gap-1.5 px-3 py-1 bg-white/60 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 rounded-full backdrop-blur-sm text-[12px] font-medium text-slate-500 dark:text-slate-400 shadow-sm">
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
                <div className="flex items-center gap-1 px-3 py-1 bg-indigo-50/60 dark:bg-indigo-500/10 border border-indigo-200/60 dark:border-indigo-500/20 rounded-full backdrop-blur-sm text-[12px] font-medium text-indigo-600 dark:text-indigo-400 shadow-sm w-fit max-w-[480px] overflow-hidden">
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
                <Target className="w-4 h-4 text-indigo-500" /> 통합 품질 평가 점수
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">RAG Triad + 품질 평가 통합 점수</p>
            </div>
            <ChartInfoTooltip
              title="통합 품질 평가 점수"
              items={[
                { text: 'LLM 기반 평가 점수입니다 (0–1).' },
                { label: 'RAG Triad', text: '관련성(답변) · 근거성 · 맥락성' },
                { label: '품질 평가', text: '완전성' },
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
                            ? <span className={row.quality_avg >= 0.7 ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-bold'}>{row.quality_avg.toFixed(3)}</span>
                            : <span className="text-slate-300 dark:text-slate-600">-</span>}
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-[11px] align-middle">
                          {row.rag_avg != null
                            ? <span className={row.rag_avg >= 0.7 ? 'text-emerald-600 font-semibold' : 'text-rose-600 font-bold'}>{row.rag_avg.toFixed(3)}</span>
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
        className="flex items-center justify-center gap-1.5 w-28 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 transition-all duration-200 shadow-sm hover:-translate-y-0.5 active:scale-95"
      >
        <History className="w-3.5 h-3.5" />
        History
        <ChevronDown className={cn('w-3 h-3 transition-transform', showMenu && 'rotate-180')} />
      </button>
      {showMenu && (
        <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-[60] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/60">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">평가 히스토리 ({historyList.length})</p>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {historyList.map((item) => (
              <button
                key={item.id}
                onClick={() => onSelect(item)}
                className={cn(
                  'w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-left border-b border-slate-50 dark:border-slate-700 last:border-b-0 transition-colors',
                  selectedHistoryId === item.id && 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-100 dark:border-indigo-500/20'
                )}
              >
                <Clock className="w-4 h-4 text-slate-400 dark:text-slate-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded border', GRADE_COLOR[item.final_grade] ?? 'text-slate-600 bg-slate-50 border-slate-200')}>
                      {item.final_grade}
                    </span>
                    <span className="text-xs font-mono text-slate-600 dark:text-slate-300">{item.final_score != null ? (item.final_score * 100).toFixed(1) + '점' : '-'}</span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">{item.total_qa} QA</span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    {item.metadata?.generation_model ?? '-'}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
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
