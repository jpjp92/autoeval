import { Database, Activity, FileText, CheckCircle2 } from "lucide-react";
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

function StatCard({ title, value, subtitle, icon: Icon, accentColor, iconBg, iconColor, loading }: StatCardProps) {
  return (
    <div className={cn(
      "bg-white/80 backdrop-blur-sm rounded-2xl border border-white/60",
      "shadow-lg shadow-slate-200/40 p-6 border-l-4",
      accentColor
    )}>
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap">{title}</p>
          {loading ? (
            <div className="h-8 w-24 bg-slate-100 rounded-lg animate-pulse mt-2" />
          ) : (
            <h3 className="text-2xl font-bold text-slate-900 mt-2 tabular-nums">{value}</h3>
          )}
        </div>
        <div className={cn("p-3 rounded-xl shrink-0 ml-4", iconBg)}>
          <Icon className={cn("w-5 h-5", iconColor)} />
        </div>
      </div>
      {subtitle && !loading && (
        <p className="mt-3 text-[11px] text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis">{subtitle}</p>
      )}
    </div>
  );
}

interface StatsGridProps {
  summary?: {
    total_qa: number;
    avg_final_score: number;
    total_documents: number;
    pass_rate: number;
  };
  loading?: boolean;
}

export function StatsGrid({ summary, loading }: StatsGridProps) {
  const stats: StatCardProps[] = [
    {
      title: "Total QA Generated",
      value: summary ? summary.total_qa.toLocaleString() : "—",
      subtitle: "Supabase 누적 생성 수",
      icon: Database,
      accentColor: "border-l-indigo-500",
      iconBg: "bg-indigo-50",
      iconColor: "text-indigo-600",
    },
    {
      title: "Avg Final Score",
      value: summary ? summary.avg_final_score.toFixed(3) : "—",
      subtitle: "전체 평가 평균 점수",
      icon: Activity,
      accentColor: "border-l-emerald-500",
      iconBg: "bg-emerald-50",
      iconColor: "text-emerald-600",
    },
    {
      title: "Total Documents",
      value: summary ? String(summary.total_documents) : "—",
      subtitle: "업로드 처리 문서 수",
      icon: FileText,
      accentColor: "border-l-amber-500",
      iconBg: "bg-amber-50",
      iconColor: "text-amber-600",
    },
    {
      title: "Quality Pass Rate",
      value: summary ? `${summary.pass_rate}%` : "—",
      subtitle: "valid_qa / total_qa",
      icon: CheckCircle2,
      accentColor: "border-l-rose-500",
      iconBg: "bg-rose-50",
      iconColor: "text-rose-600",
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
      {stats.map((stat, index) => (
        <StatCard key={index} {...stat} loading={loading ?? false} />
      ))}
    </div>
  );
}
