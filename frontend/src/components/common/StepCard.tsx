import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/src/lib/utils";

export type StepStatus = "pending" | "active" | "done";

interface StepCardProps {
  step: number;
  title: string;
  subtitle: string;
  icon: ReactNode;
  status: StepStatus;
  isLast: boolean;
  /** Clip overflowing content. Leave off when the body hosts dropdowns. */
  clip?: boolean;
  children: ReactNode;
}

function StepBadge({ step, status, className }: { step: number; status: StepStatus; className?: string }) {
  return (
    <div className={cn(
      "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 border-2 transition-all",
      status === "done"   ? "bg-indigo-600 border-indigo-600 text-white" :
      status === "active" ? "bg-white dark:bg-slate-800 border-indigo-500 text-indigo-600" :
                            "bg-white dark:bg-slate-800 border-slate-200 dark:border-white/15 text-slate-400 dark:text-slate-500",
      className
    )}>
      {status === "done" ? <Check className="w-4 h-4" /> : step}
    </div>
  );
}

// Desktop (lg+): vertical timeline rail beside the card.
// Mobile: the rail is dropped so the card gets the full width; the step
// badge moves into the card header in place of the section icon.
export function StepCard({ step, title, subtitle, icon, status, isLast, clip = false, children }: StepCardProps) {
  return (
    <div className="relative flex gap-0" style={{ zIndex: 10 - step }}>
      <div className="hidden lg:flex flex-col items-center pt-6 mr-5">
        <StepBadge step={step} status={status} />
        {!isLast && (
          <div className={cn(
            "w-0.5 flex-1 mt-2 min-h-[2rem]",
            status === "done" ? "bg-indigo-200" : "bg-slate-100"
          )} />
        )}
      </div>
      <div className={cn(
        "flex-1 min-w-0 bg-white/80 dark:bg-white/5 backdrop-blur-sm rounded-2xl border shadow-lg shadow-slate-200/40 dark:shadow-black/20 mb-3 lg:mb-4 transition-all",
        clip ? "overflow-hidden" : "overflow-visible",
        status === "pending" ? "border-white/60 dark:border-white/5 opacity-60" : "border-white/60 dark:border-white/8"
      )}>
        <div className={cn(
          "px-4 py-3 lg:px-6 lg:py-4 border-b border-slate-100 dark:border-white/8 rounded-t-2xl flex items-center gap-3",
          status === "active" ? "bg-slate-50/50 dark:bg-white/5" : "bg-slate-50/30 dark:bg-white/3"
        )}>
          <StepBadge step={step} status={status} className="lg:hidden" />
          <div className={cn(
            "hidden lg:flex w-8 h-8 rounded-lg items-center justify-center flex-shrink-0",
            status === "done"   ? "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400" :
            status === "active" ? "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-500" :
                                  "bg-slate-100 dark:bg-white/8 text-slate-400 dark:text-slate-500"
          )}>
            {icon}
          </div>
          <div className="min-w-0">
            <h3 className={cn("text-sm font-semibold", status === "pending" ? "text-slate-400 dark:text-slate-500" : "text-slate-800 dark:text-slate-100")}>
              {title}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
          </div>
          {status === "done" && (
            <span className="ml-auto px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[11px] font-semibold rounded-full shrink-0 whitespace-nowrap">완료</span>
          )}
        </div>
        <div className="p-4 lg:p-6">{children}</div>
      </div>
    </div>
  );
}
