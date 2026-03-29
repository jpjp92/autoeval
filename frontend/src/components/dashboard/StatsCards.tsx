import { Database, Activity, FileText, ClipboardList } from "lucide-react";
import { cn } from "@/src/lib/utils";

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: any;
  accentColor: string;
  iconBg: string;
  iconColor: string;
  loading?: boolean;
}

function StatCard({ title, value, subtitle, icon: Icon, accentColor, iconBg, iconColor, loading, index }: StatCardProps & { index: number }) {
  return (
    <div 
      className={cn(
        "bg-white/80 dark:bg-white/5 backdrop-blur-sm rounded-2xl border border-white/60 dark:border-white/8",
        "shadow-lg shadow-slate-200/40 dark:shadow-black/20 p-6 border-l-4",
        "transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-xl dark:hover:shadow-black/40 group",
        "animate-in fade-in slide-in-from-bottom-4 duration-500",
        accentColor
      )}
      style={{ animationDelay: `${index * 100}ms`, animationFillMode: 'both' }}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">{title}</p>
          {loading ? (
            <div className="h-8 w-24 bg-slate-100 dark:bg-white/10 rounded-lg animate-pulse mt-2" />
          ) : (
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mt-2 tabular-nums">{value}</h3>
          )}
        </div>
        <div className={cn(
          "p-3 rounded-xl shrink-0 ml-4 transition-transform duration-300 ease-out group-hover:scale-110",
          iconBg
        )}>
          <Icon className={cn("w-5 h-5", iconColor)} />
        </div>
      </div>
      {subtitle && !loading && (
        <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap overflow-hidden text-ellipsis">{subtitle}</p>
      )}
    </div>
  );
}

interface StatsGridProps {
  summary?: {
    total_qa: number;
    avg_final_score: number;
    total_documents: number;
    total_evaluations: number;
  };
  loading?: boolean;
}

export function StatsGrid({ summary, loading }: StatsGridProps) {
  const stats: StatCardProps[] = [
    {
      title: "Total QA Generated",
      value: summary ? summary.total_qa.toLocaleString() : "—",
      subtitle: "누적 생성 데이터 수",
      icon: Database,
      accentColor: "border-l-indigo-500 hover:border-l-indigo-400",
      iconBg: "bg-indigo-50 dark:bg-indigo-500/20",
      iconColor: "text-indigo-600 dark:text-indigo-400",
    },
    {
      title: "Avg Final Score",
      value: summary ? summary.avg_final_score.toFixed(3) : "—",
      subtitle: "전체 평가 평균 점수",
      icon: Activity,
      accentColor: "border-l-emerald-500 hover:border-l-emerald-400",
      iconBg: "bg-emerald-50 dark:bg-emerald-500/20",
      iconColor: "text-emerald-600 dark:text-emerald-400",
    },
    {
      title: "Total Documents",
      value: summary ? String(summary.total_documents) : "—",
      subtitle: "업로드 처리 문서 수",
      icon: FileText,
      accentColor: "border-l-amber-500 hover:border-l-amber-400",
      iconBg: "bg-amber-50 dark:bg-amber-500/20",
      iconColor: "text-amber-600 dark:text-amber-400",
    },
    {
      title: "Total Evaluations",
      value: summary?.total_evaluations != null ? String(summary.total_evaluations) : "—",
      subtitle: "누적 평가 실행 건수",
      icon: ClipboardList,
      accentColor: "border-l-sky-500 hover:border-l-sky-400",
      iconBg: "bg-sky-50 dark:bg-sky-500/20",
      iconColor: "text-sky-600 dark:text-sky-400",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
      {stats.map((stat, index) => (
        <StatCard key={index} {...stat} index={index} loading={loading ?? false} />
      ))}
    </div>
  );
}
