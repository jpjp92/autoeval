import { useState } from "react";
import { LayoutDashboard, Zap, Target, PanelLeftClose, PanelLeftOpen, FilePlus, Database, Settings } from "lucide-react";
import { cn } from "@/src/lib/utils";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  const menuItems = [
    { id: "overview", label: "Dashboard", icon: LayoutDashboard },
    { id: "standardization", label: "Standardization", icon: Database },
    { id: "generation", label: "Data Generation", icon: FilePlus },
    { id: "evaluation", label: "Evaluation", icon: Target },
  ];

  return (
    /* 바깥 래퍼: 여백만 담당 */
    <div className={cn(
      "h-screen p-3 shrink-0 transition-all duration-300",
      isCollapsed ? "w-[84px]" : "w-[256px]"
    )}>
      {/* 내부 글래스 카드 */}
      <div className="h-full rounded-3xl bg-white/50 dark:bg-slate-800/60 backdrop-blur-2xl border border-white/60 dark:border-white/8 shadow-2xl shadow-indigo-500/8 dark:shadow-black/30 flex flex-col p-3">

        {/* 로고 + 토글 */}
        <div className={cn("flex items-center h-14 px-2 mb-2", isCollapsed ? "justify-center" : "justify-between")}>
          {!isCollapsed && (
            <button
              onClick={() => setActiveTab("overview")}
              className="flex items-center gap-3 overflow-hidden hover:opacity-80 transition-opacity"
            >
              <div className="w-9 h-9 bg-indigo-500 rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-indigo-500/30">
                <Zap className="w-5 h-5 text-white" fill="currentColor" />
              </div>
              <div className="flex flex-col leading-none">
                <span className="font-black text-base tracking-tight text-slate-800 dark:text-white">Auto Eval</span>
                {/* <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mt-0.5">System v2.4</span> */}
              </div>
            </button>
          )}

          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors shrink-0"
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {/* 메인 메뉴 */}
        <nav className="flex-1 flex flex-col gap-0.5 overflow-y-auto overflow-x-hidden">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              title={isCollapsed ? item.label : undefined}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-semibold transition-all duration-200",
                activeTab === item.id
                  ? "bg-white/80 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 shadow-sm dark:shadow-indigo-500/10"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-white/50 dark:hover:bg-white/8",
                isCollapsed ? "justify-center" : ""
              )}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {!isCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* 하단 Settings */}
        <div className="pt-2 border-t border-white/20 dark:border-white/10">
          <button
            onClick={() => setActiveTab("settings")}
            title={isCollapsed ? "Settings" : undefined}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-sm font-semibold transition-all duration-200",
              activeTab === "settings"
                ? "bg-white/80 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 shadow-sm dark:shadow-indigo-500/10"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-white/50 dark:hover:bg-white/8",
              isCollapsed ? "justify-center" : ""
            )}
          >
            <Settings className="w-5 h-5 shrink-0" />
            {!isCollapsed && <span className="whitespace-nowrap">Settings</span>}
          </button>
        </div>

      </div>
    </div>
  );
}
