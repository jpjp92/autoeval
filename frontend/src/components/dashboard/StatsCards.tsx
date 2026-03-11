import { ArrowUpRight, ArrowDownRight, Database, FileText, DollarSign, Activity } from "lucide-react";
import { cn } from "@/src/lib/utils";

interface StatCardProps {
  title: string;
  value: string;
  change: string;
  trend: "up" | "down";
  icon: any;
  color: "indigo" | "emerald" | "amber" | "rose";
}

function StatCard({ title, value, change, trend, icon: Icon, color }: StatCardProps) {
  const colorStyles = {
    indigo: "bg-indigo-50 text-indigo-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    rose: "bg-rose-50 text-rose-600",
  };

  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-slate-500">{title}</p>
          <h3 className="text-2xl font-bold text-slate-900 mt-2">{value}</h3>
        </div>
        <div className={cn("p-3 rounded-lg", colorStyles[color])}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <span className={cn(
          "flex items-center text-xs font-medium px-2 py-1 rounded-full",
          trend === "up" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
        )}>
          {trend === "up" ? <ArrowUpRight className="w-3 h-3 mr-1" /> : <ArrowDownRight className="w-3 h-3 mr-1" />}
          {change}
        </span>
        <span className="text-xs text-slate-400">vs last week</span>
      </div>
    </div>
  );
}

export function StatsGrid() {
  const stats: StatCardProps[] = [
    {
      title: "Total QA Generated",
      value: "14,205",
      change: "2,106",
      trend: "up",
      icon: Database,
      color: "indigo"
    },
    {
      title: "Avg Quality Score",
      value: "0.86",
      change: "0.02",
      trend: "up",
      icon: Activity,
      color: "emerald"
    },
    {
      title: "Total API Cost",
      value: "$42.50",
      change: "$12.40",
      trend: "up",
      icon: DollarSign,
      color: "amber"
    },
    {
      title: "Failed Validations",
      value: "142",
      change: "12%",
      trend: "down",
      icon: FileText,
      color: "rose"
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {stats.map((stat, index) => (
        <StatCard key={index} {...stat} />
      ))}
    </div>
  );
}
