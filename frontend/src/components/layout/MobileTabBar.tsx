import { LayoutDashboard, Database, FilePlus, Target } from "lucide-react";
import { cn } from "@/src/lib/utils";

interface MobileTabBarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

const tabs = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard },
  { id: "standardization", label: "Documents", icon: Database },
  { id: "generation", label: "QA Pipeline", icon: FilePlus },
  { id: "evaluation", label: "Evaluation", icon: Target },
];

// Below lg the desktop Sidebar is hidden; this bar is the primary navigation.
export function MobileTabBar({ activeTab, setActiveTab }: MobileTabBarProps) {
  return (
    <nav
      aria-label="Main navigation"
      className="lg:hidden shrink-0 border-t border-slate-200/70 dark:border-white/8 bg-white/85 dark:bg-slate-900/85 backdrop-blur-xl px-2 pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom,0px))]"
    >
      <ul className="grid grid-cols-4">
        {tabs.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;
          return (
            <li key={id} className="min-w-0">
              <button
                onClick={() => setActiveTab(id)}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "w-full min-h-12 flex flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-indigo-500 focus-visible:outline-offset-[-2px]",
                  isActive
                    ? "text-indigo-600 dark:text-indigo-300"
                    : "text-slate-500 dark:text-slate-400 active:bg-slate-100 dark:active:bg-white/5"
                )}
              >
                <span className={cn(
                  "flex items-center justify-center w-11 h-7 rounded-full transition-colors",
                  isActive && "bg-indigo-100 dark:bg-indigo-500/20"
                )}>
                  <Icon className="w-5 h-5" />
                </span>
                <span className="max-w-full truncate px-1">{label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
