import { useEffect, useState } from "react";
import { StatsGrid } from "./StatsCards";
// import { ActivityChart } from "./ActivityChart"; // Phase 8.2: 리더보드로 대체 (필요 시 복구)
import { getDashboardMetrics } from "@/src/lib/api";
import { Play, FileText, ArrowRight, Database, BarChart3, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Trophy, Zap, ScrollText, Rocket } from "lucide-react";
import { cn } from "@/src/lib/utils";

type SortColumn = 'job_id' | 'source_doc' | 'model' | 'total_qa' | 'eval_grade' | 'created_at';

const JOBS_PAGE_SIZE = 5;

interface DashboardData {
  summary: {
    total_qa: number;
    avg_final_score: number;
    total_documents: number;
    total_evaluations: number;
  };
  recent_jobs: Array<{
    job_id: string;
    source_doc: string;
    model: string;
    total_qa: number;
    eval_id?: string | null;
    eval_job_id?: string | null;
    eval_score?: number | null;
    eval_grade?: string | null;
    created_at: string;
  }>;
  grade_distribution: Record<string, number>;
  score_trend: Array<{
    date: string;
    score: number | null;
    grade: string;
    doc: string;
  }>;
  model_benchmarks: Array<{
    model: string;
    avg_score: number;
    pass_rate: number;
    run_count: number;
    total_qa: number;
    valid_qa: number;
  }>;
}

function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return "";
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "방금 전";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}시간 전`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}일 전`;
  return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

const GRADE_COLORS: Record<string, string> = {
  "A+": "bg-indigo-100 text-indigo-700 border-indigo-200",
  "A": "bg-emerald-100 text-emerald-700 border-emerald-200",
  "B+": "bg-sky-100 text-sky-700 border-sky-200",
  "B": "bg-amber-100 text-amber-700 border-amber-200",
  "C": "bg-orange-100 text-orange-700 border-orange-200",
  "F": "bg-rose-100 text-rose-700 border-rose-200",
};

export function DashboardOverview({
  setActiveTab,
  isActive,
  onEvalSelect,
  onPipelineClick,
}: {
  setActiveTab: (tab: string) => void;
  isActive: boolean;
  onEvalSelect?: (evalJobId: string) => void;
  onPipelineClick?: () => void;
}) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobPage, setJobPage] = useState(0);
  const [gradeAnimated, setGradeAnimated] = useState(false);
  
  const [sortField, setSortField] = useState<SortColumn>('created_at');
  const [sortDesc, setSortDesc] = useState(true);

  const handleSort = (field: SortColumn) => {
    if (sortField === field) setSortDesc(!sortDesc);
    else { setSortField(field); setSortDesc(field === 'created_at' || field === 'total_qa' ? true : false); }
  };

  useEffect(() => {
    if (!isActive) return;
    let cancelled = false;
    setJobPage(0);
    setGradeAnimated(false);
    async function load() {
      setLoading(true);
      const res = await getDashboardMetrics();
      if (!cancelled && res.success && res.data) {
        setData(res.data as DashboardData);
      }
      if (!cancelled) {
        setLoading(false);
        setTimeout(() => setGradeAnimated(true), 100);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [isActive]);

  return (
    <div className="space-y-8">
      {/* 1. Key Metrics */}
      <StatsGrid summary={data?.summary} loading={loading} />

      {/* 2. Recent Pipeline Runs & Quick Actions */}
      <div 
        className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500"
        style={{ animationDelay: '300ms', animationFillMode: 'both' }}
      >
        <div className="lg:col-span-2 bg-white/80 dark:bg-white/5 backdrop-blur-sm rounded-2xl border border-white/60 dark:border-white/8 shadow-lg shadow-slate-200/40 dark:shadow-black/20 overflow-hidden">
          <div className="p-6 border-b border-slate-100 dark:border-white/8 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ScrollText className="w-5 h-5 text-slate-400 dark:text-slate-500" />
              <div>
                <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">파이프라인 로그</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400">DB 생성·평가 기록</p>
              </div>
            </div>
            <button
              onClick={() => setActiveTab("evaluation")}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
            >
              전체 보기 <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          {(() => {
            const rawJobs = data?.recent_jobs ?? [];
            const sortedJobs = [...rawJobs].sort((a, b) => {
              let valA: any = a[sortField as keyof typeof a];
              let valB: any = b[sortField as keyof typeof b];
              
              if (sortField === 'eval_grade') {
                const gradeMap: Record<string, number> = { "A+": 6, "A": 5, "B+": 4, "B": 3, "C": 2, "F": 1 };
                valA = gradeMap[a.eval_grade || ""] || 0;
                valB = gradeMap[b.eval_grade || ""] || 0;
              } else if (sortField === 'created_at') {
                valA = new Date(a.created_at).getTime();
                valB = new Date(b.created_at).getTime();
              } else if (sortField === 'total_qa') {
                valA = Number(valA || 0);
                valB = Number(valB || 0);
              } else {
                valA = String(valA || "").toLowerCase();
                valB = String(valB || "").toLowerCase();
              }
              
              if (valA < valB) return sortDesc ? 1 : -1;
              if (valA > valB) return sortDesc ? -1 : 1;
              return 0;
            });

            const totalPages = Math.max(1, Math.ceil(sortedJobs.length / JOBS_PAGE_SIZE));
            const pagedJobs = sortedJobs.slice(jobPage * JOBS_PAGE_SIZE, (jobPage + 1) * JOBS_PAGE_SIZE);
            
            const SortIcon = ({ field }: { field: SortColumn }) => (
              sortField === field 
                ? (sortDesc ? <ChevronDown className="w-3 h-3 text-indigo-500" /> : <ChevronUp className="w-3 h-3 text-indigo-500" />)
                : <ChevronDown className="w-3 h-3 opacity-0 group-hover:opacity-30 transition-opacity" />
            );

            return (
              <>
                <div className="overflow-x-auto min-h-[300px]">
                  <table className="w-full text-left text-sm table-fixed">
                    <thead className="bg-slate-50 dark:bg-white/5 text-slate-500 dark:text-slate-400 select-none">
                      <tr>
                        <th className="px-4 py-2.5 font-medium text-xs whitespace-nowrap cursor-pointer hover:text-slate-700 dark:hover:text-slate-200 group w-[15%] text-center" onClick={() => handleSort('job_id')}>
                          <div className="flex items-center gap-1 justify-center">작업 ID <SortIcon field="job_id" /></div>
                        </th>
                        <th className="px-4 py-2.5 font-medium text-xs whitespace-nowrap cursor-pointer hover:text-slate-700 dark:hover:text-slate-200 group w-[28%] text-center" onClick={() => handleSort('source_doc')}>
                          <div className="flex items-center gap-1 justify-center">문서 <SortIcon field="source_doc" /></div>
                        </th>
                        <th className="px-4 py-2.5 font-medium text-xs whitespace-nowrap cursor-pointer hover:text-slate-700 dark:hover:text-slate-200 group w-[23%] text-center" onClick={() => handleSort('model')}>
                          <div className="flex items-center gap-1 justify-center">모델 <SortIcon field="model" /></div>
                        </th>
                        <th className="px-4 py-2.5 font-medium text-xs whitespace-nowrap cursor-pointer hover:text-slate-700 dark:hover:text-slate-200 group w-[10%] text-center" onClick={() => handleSort('total_qa')}>
                          <div className="flex items-center gap-1 justify-center">QA 수 <SortIcon field="total_qa" /></div>
                        </th>
                        <th className="px-4 py-2.5 font-medium text-xs whitespace-nowrap cursor-pointer hover:text-slate-700 dark:hover:text-slate-200 group w-[10%] text-center" onClick={() => handleSort('eval_grade')}>
                          <div className="flex items-center gap-1 justify-center">평가 <SortIcon field="eval_grade" /></div>
                        </th>
                        <th className="px-4 py-2.5 font-medium text-xs whitespace-nowrap cursor-pointer hover:text-slate-700 dark:hover:text-slate-200 group w-[12%] text-center" onClick={() => handleSort('created_at')}>
                          <div className="flex items-center gap-1 justify-center">시간 <SortIcon field="created_at" /></div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      {loading ? (
                        Array.from({ length: JOBS_PAGE_SIZE }).map((_, i) => (
                          <tr key={i}>
                            {Array.from({ length: 6 }).map((_, j) => (
                              <td key={j} className="px-4 py-2.5">
                                <div className="h-4 bg-slate-100 dark:bg-white/10 rounded animate-pulse w-full max-w-[80px]" />
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : !rawJobs.length ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">
                            아직 실행 기록이 없습니다
                          </td>
                        </tr>
                      ) : (
                        pagedJobs.map((job) => {
                          const hasEval = !!job.eval_id;
                          
                          // 칩 테마 다이나믹 할당
                          const m = (job.model || "").toLowerCase();
                          let modelColor = 'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-500/10 dark:text-slate-400 dark:border-slate-500/20';
                          if (m.includes('gpt') || m.includes('openai')) {
                            modelColor = 'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:border-emerald-500/20';
                          } else if (m.includes('claude') || m.includes('anthropic')) {
                            modelColor = 'bg-orange-50 text-orange-600 border-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/20';
                          } else if (m.includes('gemini') || m.includes('google')) {
                            modelColor = 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20';
                          }

                          return (
                            <tr
                              key={job.job_id}
                              onClick={hasEval && onEvalSelect ? () => onEvalSelect(job.eval_id!) : undefined}
                              className={cn(
                                "group transition-all duration-200 ease-out border-l-2 border-transparent relative",
                                "hover:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.05)]",
                                hasEval && onEvalSelect 
                                  ? "hover:bg-indigo-50 dark:hover:bg-white/10 hover:border-indigo-500 cursor-pointer" 
                                  : "hover:bg-slate-50 dark:hover:bg-white/5 hover:border-slate-300 dark:hover:border-slate-600 cursor-default"
                              )}
                            >
                              <td className="px-4 py-3 font-mono text-[11px] text-slate-400 dark:text-slate-500 truncate" title={job.job_id}>
                                {job.job_id}
                              </td>
                              <td className="px-4 py-3 text-slate-700 dark:text-slate-200 text-[13px] font-medium truncate" title={job.source_doc}>
                                {job.source_doc || "—"}
                              </td>
                              <td className="px-4 py-3" title={job.model || "—"}>
                                <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded border max-w-[160px] truncate block", modelColor)}>
                                  {job.model || "—"}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-center font-medium text-slate-600 dark:text-slate-300 text-[13px] truncate">
                                {job.total_qa}
                              </td>
                              <td className="px-4 py-3 text-center truncate">
                                {hasEval && job.eval_grade ? (
                                  <span className={cn(
                                    "inline-flex items-center justify-center w-8 py-0.5 rounded font-bold border shadow-sm",
                                    GRADE_COLORS[job.eval_grade] || "bg-slate-100 text-slate-600 border-slate-200"
                                  )}>
                                    <span className={cn("text-[12px] leading-none tracking-tight", job.eval_grade.includes('+') && "translate-x-px")}>
                                      {job.eval_grade}
                                    </span>
                                  </span>
                                ) : (
                                  <span className="text-[12px] text-slate-400">대기</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-center text-slate-400 text-[12px] truncate">
                                {formatRelativeTime(job.created_at)}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div className="px-4 py-2.5 border-t border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/3 flex items-center justify-between">
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      {jobPage * JOBS_PAGE_SIZE + 1}–{Math.min((jobPage + 1) * JOBS_PAGE_SIZE, rawJobs.length)} / {rawJobs.length}건
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setJobPage(p => Math.max(0, p - 1))}
                        disabled={jobPage === 0}
                        className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 disabled:opacity-30 transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                      </button>
                      <span className="text-xs font-mono text-slate-600 dark:text-slate-400 px-1">{jobPage + 1} / {totalPages}</span>
                      <button
                        onClick={() => setJobPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={jobPage === totalPages - 1}
                        className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-white/10 disabled:opacity-30 transition-colors"
                      >
                        <ChevronRight className="w-4 h-4 text-slate-600 dark:text-slate-400" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* Quick Actions */}
        <div className="bg-white/80 dark:bg-white/5 backdrop-blur-sm rounded-2xl border border-white/60 dark:border-white/8 shadow-lg shadow-slate-200/40 dark:shadow-black/20 p-6 flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <Rocket className="w-5 h-5 text-slate-400 dark:text-slate-500" />
            <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">빠른 실행</h3>
          </div>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">새 작업을 시작하세요.</p>

          <div className="space-y-3 flex-1">
            <button
              onClick={() => setActiveTab("standardization")}
              className="w-full flex items-center gap-3 p-4 min-h-[72px] rounded-xl border border-slate-200 dark:border-white/8 hover:border-amber-300 dark:hover:border-amber-500/40 hover:bg-amber-50 dark:hover:bg-amber-500/10 transition-all duration-300 ease-out group text-left hover:scale-[1.02] active:scale-[0.98] hover:shadow-md"
            >
              <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-500/20 text-amber-600 flex items-center justify-center group-hover:bg-amber-600 group-hover:text-white transition-colors duration-300 shrink-0">
                <Database className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-slate-800 dark:text-slate-200 group-hover:text-amber-700 dark:group-hover:text-amber-400 transition-colors">문서 업로드</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 transition-colors">PDF/DOCX 인제스션 및 계층 태깅</div>
              </div>
              <ArrowRight className="w-4 h-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 text-amber-600" />
            </button>

            <button
              onClick={() => setActiveTab("generation")}
              className="w-full flex items-center gap-3 p-4 min-h-[72px] rounded-xl border border-slate-200 dark:border-white/8 hover:border-indigo-300 dark:hover:border-indigo-500/40 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 transition-all duration-300 ease-out group text-left hover:scale-[1.02] active:scale-[0.98] hover:shadow-md"
            >
              <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors duration-300 shrink-0">
                <Play className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-slate-800 dark:text-slate-200 group-hover:text-indigo-700 dark:group-hover:text-indigo-400 transition-colors">QA 생성 및 평가</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 transition-colors">데이터 생성 파이프라인 실행</div>
              </div>
              <ArrowRight className="w-4 h-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 text-indigo-600" />
            </button>

            <button
              onClick={() => setActiveTab("evaluation")}
              className="w-full flex items-center gap-3 p-4 min-h-[72px] rounded-xl border border-slate-200 dark:border-white/8 hover:border-emerald-300 dark:hover:border-emerald-500/40 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-all duration-300 ease-out group text-left hover:scale-[1.02] active:scale-[0.98] hover:shadow-md"
            >
              <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-colors duration-300 shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div className="flex-1">
                <div className="font-semibold text-slate-800 dark:text-slate-200 group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors">평가 결과 확인</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 transition-colors">품질 점수 및 상세 리포트</div>
              </div>
              <ArrowRight className="w-4 h-4 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 text-emerald-600" />
            </button>
          </div>

          <button
            onClick={() => onPipelineClick?.()}
            className="mt-4 flex items-center gap-1 text-xs text-slate-400 hover:text-indigo-500 transition-colors self-start"
          >
            파이프라인 구조 보기 <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* 3. Model Benchmark Leaderboard & Grade Distribution */}
      <div 
        className="grid grid-cols-1 lg:grid-cols-3 gap-8 animate-in fade-in slide-in-from-bottom-4 duration-500"
        style={{ animationDelay: '500ms', animationFillMode: 'both' }}
      >
        {/* Model Benchmark Leaderboard (Phase 8.2 – ActivityChart 대체) */}
        {/*
          [복구 가이드] 아래 주석을 해제하고 ModelBenchmarkBoard 블록을 제거하면 점수 추이 차트로 복구됩니다.
          <div className="lg:col-span-2">
            <ActivityChart scoreTrend={data?.score_trend} loading={loading} />
          </div>
        */}
        <div className="lg:col-span-2 bg-white/80 dark:bg-white/5 backdrop-blur-sm rounded-2xl border border-white/60 dark:border-white/8 shadow-lg shadow-slate-200/40 dark:shadow-black/20 p-6">
          <div className="flex items-center gap-2 mb-6">
            <Trophy className="w-5 h-5 text-amber-500" />
            <div>
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">생성 모델 성능 비교</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">전체 히스토리 기준 누적 평균 점수</p>
            </div>
          </div>

          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-20 bg-slate-100 dark:bg-white/5 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : !data?.model_benchmarks?.length ? (
            <div className="h-48 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 gap-2">
              <Trophy className="w-10 h-10 opacity-30" />
              <p className="text-sm">아직 집계할 데이터가 없습니다</p>
              <p className="text-xs">QA 생성 및 평가를 실행하면 모델별 성능이 표시됩니다</p>
            </div>
          ) : (
            <div className="space-y-3">
              {data.model_benchmarks.map((bench, idx) => {
                const isTop = idx === 0;
                const scorePct = Math.min(bench.avg_score * 100, 100);

                // 모델 브랜드 컬러
                const m = bench.model.toLowerCase();
                let modelColor = 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-white/10';
                let barColor   = 'bg-slate-400';
                if (m.includes('gpt') || m.includes('openai')) {
                  modelColor = 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20';
                  barColor   = 'bg-emerald-500';
                } else if (m.includes('claude') || m.includes('anthropic')) {
                  modelColor = 'bg-orange-50 dark:bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-500/20';
                  barColor   = 'bg-orange-500';
                } else if (m.includes('gemini') || m.includes('google')) {
                  modelColor = 'bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/20';
                  barColor   = 'bg-blue-500';
                }

                return (
                  <div
                    key={bench.model}
                    className={cn(
                      'relative rounded-xl border p-4 transition-all duration-300 hover:-translate-y-0.5',
                      isTop
                        ? 'bg-gradient-to-r from-amber-50/80 to-indigo-50/80 dark:from-amber-500/5 dark:to-indigo-500/5 border-amber-200 dark:border-amber-500/20 shadow-md shadow-amber-100/50 dark:shadow-amber-900/20'
                        : 'bg-white/60 dark:bg-white/3 border-white/60 dark:border-white/8 hover:shadow-sm'
                    )}
                  >
                    {/* 1위 글로우 효과 */}
                    {isTop && (
                      <div className="absolute -top-px left-0 right-0 h-0.5 bg-gradient-to-r from-amber-400 via-indigo-500 to-purple-500 rounded-t-xl" />
                    )}

                    <div className="flex items-center gap-3 mb-3">
                      {/* 순위 */}
                      <div className={cn(
                        'w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black flex-shrink-0',
                        isTop ? 'bg-amber-500 text-white shadow-md shadow-amber-200 dark:shadow-amber-900' : 'bg-slate-100 dark:bg-white/10 text-slate-500 dark:text-slate-400'
                      )}>
                        {isTop ? <Trophy className="w-3.5 h-3.5" /> : idx + 1}
                      </div>

                      {/* 모델명 */}
                      <span className={cn('text-xs font-bold px-2.5 py-1 rounded-lg border', modelColor)}>
                        {bench.model}
                      </span>

                      {isTop && (
                        <span className="ml-auto text-[10px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-500/20 flex items-center gap-1">
                          <Zap className="w-2.5 h-2.5" /> Best
                        </span>
                      )}

                      <div className={cn("ml-auto text-right", !isTop && "")}>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500">{bench.run_count}회 테스트</p>
                      </div>
                    </div>

                    {/* 지표: 평균 점수 바 + QA 통과 수량 텍스트 */}
                    <div className="space-y-2">
                      {/* 평균 점수 바 */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                          <span>평균 점수</span>
                          <span className="font-semibold text-slate-700 dark:text-slate-200">{(bench.avg_score * 100).toFixed(1)}점</span>
                        </div>
                        <div className="relative h-1.5 bg-slate-100 dark:bg-white/8 rounded-full overflow-hidden">
                          <div
                            className={cn('h-full rounded-full', barColor, isTop && 'shadow-sm')}
                            style={{
                              width: `${scorePct}%`,
                              clipPath: gradeAnimated ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)',
                              transition: gradeAnimated
                                ? `clip-path 700ms cubic-bezier(0.4,0,0.2,1) ${idx * 120}ms`
                                : 'none',
                            }}
                          />
                        </div>
                      </div>
                      {/* QA 통과 수량 */}
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-slate-400 dark:text-slate-500">통과 QA</span>
                        <span className="font-mono font-medium text-slate-600 dark:text-slate-300">
                          {bench.valid_qa.toLocaleString()}
                          <span className="text-slate-400 dark:text-slate-500 mx-1">/</span>
                          {bench.total_qa.toLocaleString()}개
                          <span className={cn(
                            "ml-2 text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
                            bench.pass_rate >= 99
                              ? "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                              : bench.pass_rate >= 90
                              ? "bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400"
                              : "bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400"
                          )}>
                            {bench.pass_rate}%
                          </span>
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Grade Distribution */}
        <div className="bg-white/80 dark:bg-white/5 backdrop-blur-sm rounded-2xl border border-white/60 dark:border-white/8 shadow-lg shadow-slate-200/40 dark:shadow-black/20 p-6">
          <div className="flex items-center gap-2 mb-6">
            <BarChart3 className="w-5 h-5 text-slate-400 dark:text-slate-500" />
            <div>
              <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100">평가 등급 분포</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400">전체 평가 결과</p>
            </div>
          </div>

          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-6 bg-slate-100 dark:bg-white/10 rounded animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {(() => {
                const dist = (data?.grade_distribution || {}) as Record<string, number>;
                const total = Object.values(dist).reduce((a, b) => a + b, 0);
                const barColors: Record<string, string> = {
                  "A+": "bg-indigo-500", "A": "bg-emerald-500",
                  "B+": "bg-sky-500", "B": "bg-amber-500",
                  "C": "bg-orange-500", "F": "bg-rose-500",
                };
                const gradeRanges: Record<string, string> = {
                  "A+": "≥ 0.95",
                  "A":  "0.85 – 0.94",
                  "B+": "0.75 – 0.84",
                  "B":  "0.65 – 0.74",
                  "C":  "0.50 – 0.64",
                  "F":  "< 0.50",
                };
                return Object.entries(dist).map(([grade, count], idx) => {
                  const pct = total > 0 ? (count / total) * 100 : 0;
                  return (
                    <div key={grade} className="group cursor-default relative">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-xs font-bold px-2 py-0.5 rounded border transition-transform duration-300 ease-out group-hover:scale-110",
                            GRADE_COLORS[grade] || "bg-slate-100 text-slate-600 border-slate-200"
                          )}>
                            {grade}
                          </span>
                          <span className={cn(
                            "text-[10px] text-slate-400 font-mono transition-all duration-300",
                            "opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0"
                          )}>
                            {gradeRanges[grade]}
                          </span>
                        </div>
                        <span className="text-sm font-medium text-slate-700 dark:text-slate-300 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">{count}건</span>
                      </div>
                      <div className="relative h-2 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-300",
                            barColors[grade] || "bg-slate-400",
                            "group-hover:brightness-110 group-hover:shadow-[0_0_12px_rgba(99,102,241,0.5)]"
                          )}
                          style={{
                            width: `${pct}%`,
                            minWidth: pct > 0 ? '4px' : '0',
                            clipPath: gradeAnimated ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)',
                            transition: gradeAnimated
                              ? `clip-path 600ms ease-out ${idx * 80}ms`
                              : 'none',
                          }}
                        />
                      </div>
                    </div>
                  );
                });
              })()}
              {Object.values(data?.grade_distribution || {}).every(v => v === 0) && (
                <p className="text-sm text-slate-400 text-center py-4">아직 평가 데이터가 없습니다</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
