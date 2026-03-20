import { useEffect, useState } from "react";
import { StatsGrid } from "./StatsCards";
import { ActivityChart } from "./ActivityChart";
import { getDashboardMetrics } from "@/src/lib/api";
import { Play, FileText, ArrowRight, Database, BarChart3, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/src/lib/utils";

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
    type: string;
    source_doc: string;
    model: string;
    total_qa: number;
    final_score?: number;
    final_grade?: string;
    created_at: string;
  }>;
  grade_distribution: Record<string, number>;
  score_trend: Array<{
    date: string;
    score: number | null;
    grade: string;
    doc: string;
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

export function DashboardOverview({ setActiveTab, isActive }: { setActiveTab: (tab: string) => void; isActive: boolean }) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobPage, setJobPage] = useState(0);
  const [gradeAnimated, setGradeAnimated] = useState(false);

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
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* 1. Key Metrics */}
      <StatsGrid summary={data?.summary} loading={loading} />

      {/* 2. Recent Pipeline Runs & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white/80 backdrop-blur-sm rounded-2xl border border-white/60 shadow-lg shadow-slate-200/40 overflow-hidden">
          <div className="p-6 border-b border-slate-100 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-slate-800">파이프라인 로그</h3>
              <p className="text-sm text-slate-500">DB 생성·평가 기록</p>
            </div>
            <button
              onClick={() => setActiveTab("evaluation")}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
            >
              전체 보기 <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          {(() => {
            const jobs = data?.recent_jobs ?? [];
            const totalPages = Math.max(1, Math.ceil(jobs.length / JOBS_PAGE_SIZE));
            const pagedJobs = jobs.slice(jobPage * JOBS_PAGE_SIZE, (jobPage + 1) * JOBS_PAGE_SIZE);
            return (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-4 py-2.5 font-medium text-xs whitespace-nowrap">작업 ID</th>
                        <th className="px-4 py-2.5 font-medium text-xs whitespace-nowrap">유형</th>
                        <th className="px-4 py-2.5 font-medium text-xs whitespace-nowrap">문서</th>
                        <th className="px-4 py-2.5 font-medium text-xs whitespace-nowrap">모델</th>
                        <th className="px-4 py-2.5 font-medium text-xs text-right whitespace-nowrap">QA 수</th>
                        <th className="px-4 py-2.5 font-medium text-xs text-right whitespace-nowrap">시간</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {loading ? (
                        Array.from({ length: JOBS_PAGE_SIZE }).map((_, i) => (
                          <tr key={i}>
                            {Array.from({ length: 6 }).map((_, j) => (
                              <td key={j} className="px-4 py-2.5">
                                <div className="h-4 bg-slate-100 rounded animate-pulse w-20" />
                              </td>
                            ))}
                          </tr>
                        ))
                      ) : !jobs.length ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">
                            아직 실행 기록이 없습니다
                          </td>
                        </tr>
                      ) : (
                        pagedJobs.map((job) => (
                          <tr key={job.job_id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="px-4 py-2.5 font-mono text-xs text-slate-400 whitespace-nowrap">
                              {job.job_id.length > 22 ? job.job_id.slice(0, 22) + "…" : job.job_id}
                            </td>
                            <td className="px-4 py-2.5 whitespace-nowrap">
                              <span className={cn(
                                "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border",
                                job.type === "generation"
                                  ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                                  : "bg-emerald-50 text-emerald-700 border-emerald-200"
                              )}>
                                {job.type === "generation" ? "생성" : "평가"}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-slate-600 text-xs max-w-[160px] truncate" title={job.source_doc}>
                              {job.source_doc || "—"}
                            </td>
                            <td className="px-4 py-2.5 text-slate-500 text-xs whitespace-nowrap">{job.model || "—"}</td>
                            <td className="px-4 py-2.5 text-right font-medium text-slate-700 text-xs whitespace-nowrap">{job.total_qa}</td>
                            <td className="px-4 py-2.5 text-right text-slate-400 text-xs whitespace-nowrap">
                              {formatRelativeTime(job.created_at)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between">
                    <span className="text-xs text-slate-400">
                      {jobPage * JOBS_PAGE_SIZE + 1}–{Math.min((jobPage + 1) * JOBS_PAGE_SIZE, jobs.length)} / {jobs.length}건
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setJobPage(p => Math.max(0, p - 1))}
                        disabled={jobPage === 0}
                        className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-30 transition-colors"
                      >
                        <ChevronLeft className="w-4 h-4 text-slate-600" />
                      </button>
                      <span className="text-xs font-mono text-slate-600 px-1">{jobPage + 1} / {totalPages}</span>
                      <button
                        onClick={() => setJobPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={jobPage === totalPages - 1}
                        className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-30 transition-colors"
                      >
                        <ChevronRight className="w-4 h-4 text-slate-600" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* Quick Actions */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/60 shadow-lg shadow-slate-200/40 p-6 flex flex-col">
          <h3 className="text-lg font-semibold text-slate-800 mb-2">빠른 실행</h3>
          <p className="text-sm text-slate-500 mb-6">새 작업을 시작하세요.</p>

          <div className="space-y-3 flex-1">
            <button
              onClick={() => setActiveTab("standardization")}
              className="w-full flex items-center gap-3 p-4 min-h-[72px] rounded-xl border border-slate-200 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700 transition-all group text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-amber-100 text-amber-600 flex items-center justify-center group-hover:bg-amber-600 group-hover:text-white transition-colors shrink-0">
                <Database className="w-5 h-5" />
              </div>
              <div>
                <div className="font-semibold text-slate-800 group-hover:text-amber-700">문서 업로드</div>
                <div className="text-xs text-slate-500">PDF/DOCX 인제스션 및 계층 태깅</div>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("generation")}
              className="w-full flex items-center gap-3 p-4 min-h-[72px] rounded-xl border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 transition-all group text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-indigo-100 text-indigo-600 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors shrink-0">
                <Play className="w-5 h-5" />
              </div>
              <div>
                <div className="font-semibold text-slate-800 group-hover:text-indigo-700">QA 생성 및 평가</div>
                <div className="text-xs text-slate-500">데이터 생성 파이프라인 실행</div>
              </div>
            </button>

            <button
              onClick={() => setActiveTab("evaluation")}
              className="w-full flex items-center gap-3 p-4 min-h-[72px] rounded-xl border border-slate-200 hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 transition-all group text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-colors shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <div className="font-semibold text-slate-800 group-hover:text-emerald-700">평가 결과 확인</div>
                <div className="text-xs text-slate-500">품질 점수 및 상세 리포트</div>
              </div>
            </button>
          </div>
        </div>
      </div>

      {/* 3. Score Trend Chart & Grade Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <ActivityChart scoreTrend={data?.score_trend} loading={loading} />
        </div>

        {/* Grade Distribution */}
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl border border-white/60 shadow-lg shadow-slate-200/40 p-6">
          <div className="flex items-center gap-2 mb-6">
            <BarChart3 className="w-5 h-5 text-slate-400" />
            <div>
              <h3 className="text-lg font-semibold text-slate-800">등급 분포</h3>
              <p className="text-sm text-slate-500">전체 평가 결과</p>
            </div>
          </div>

          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-6 bg-slate-100 rounded animate-pulse" />
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
                    <div key={grade} className="group cursor-default">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "text-xs font-bold px-2 py-0.5 rounded border",
                            GRADE_COLORS[grade] || "bg-slate-100 text-slate-600 border-slate-200"
                          )}>
                            {grade}
                          </span>
                          <span className={cn(
                            "text-[10px] text-slate-400 font-mono transition-all duration-200",
                            "opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0"
                          )}>
                            {gradeRanges[grade]}
                          </span>
                        </div>
                        <span className="text-sm font-medium text-slate-700">{count}건</span>
                      </div>
                      <div className="relative h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className={cn("h-full rounded-full", barColors[grade] || "bg-slate-400")}
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
