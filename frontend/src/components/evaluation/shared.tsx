import { Info } from 'lucide-react';

// ─── 공통 툴팁 wrapper ────────────────────────────────────────────────────────
export const TooltipCard = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-md px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-200/50 dark:shadow-black/50 animate-in zoom-in-95 duration-200">
    {children}
  </div>
);

// ─── 차트 정보 툴팁 ──────────────────────────────────────────────────────────
export function ChartInfoTooltip({ title, items }: {
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
