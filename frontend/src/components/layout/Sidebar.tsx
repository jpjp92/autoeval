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
    <div className={cn(
      "h-screen p-3 shrink-0 transition-all duration-300 ease-in-out",
      isCollapsed ? "w-[84px]" : "w-[256px]"
    )}>
      {/* 
        내부 폭: 
        Expanded = 256 - 24(p-3) - 24(p-3) = 208px 
        Collapsed = 84 - 24(p-3) - 24(p-3) = 36px 
      */}
      <div className="h-full rounded-3xl bg-white/50 dark:bg-slate-800/60 backdrop-blur-2xl border border-white/60 dark:border-white/8 shadow-2xl shadow-indigo-500/8 dark:shadow-black/30 flex flex-col p-3 overflow-hidden">

        <div className="relative flex items-center h-14 mb-2 shrink-0">
          
          <div className={cn(
            "overflow-hidden transition-all duration-300 ease-in-out flex items-center",
            isCollapsed ? "w-0 opacity-0" : "w-[160px] opacity-100"
          )}>
            <button
              onClick={() => setActiveTab("overview")}
              className="flex items-center gap-3 hover:opacity-80 transition-opacity whitespace-nowrap"
            >
              <div className="w-9 h-9 bg-indigo-500 rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-indigo-500/30">
                <Zap className="w-5 h-5 text-white" fill="currentColor" />
              </div>
              <div className="flex flex-col leading-none">
                <span className="font-black text-base tracking-tight text-slate-800 dark:text-white">Auto Eval</span>
              </div>
            </button>
          </div>

          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className={cn(
              "absolute right-[2px] top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 ease-in-out",
              "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white",
              "hover:bg-slate-200/60 dark:hover:bg-white/10 active:scale-95 hover:shadow-sm"
            )}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        <nav className="flex-1 flex flex-col gap-1 overflow-y-auto overflow-x-hidden pt-2">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              title={isCollapsed ? item.label : undefined}
              className={cn(
                "flex items-center rounded-2xl text-sm font-semibold transition-all duration-300 ease-in-out shrink-0",
                activeTab === item.id
                  ? "bg-white/80 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 shadow-sm dark:shadow-indigo-500/10"
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-white/50 dark:hover:bg-white/8",
                isCollapsed ? "w-9 h-9 justify-center px-0 mx-auto" : "w-full h-11 justify-start px-3"
              )}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              <div className={cn(
                "overflow-hidden transition-all duration-300 ease-in-out flex items-center",
                isCollapsed ? "w-0 opacity-0" : "w-[150px] opacity-100 pl-3"
              )}>
                <span className="whitespace-nowrap">{item.label}</span>
              </div>
            </button>
          ))}
        </nav>

        <div className="pt-3 pb-1 border-t border-slate-200/50 dark:border-white/10">
          <button
            onClick={() => setActiveTab("settings")}
            title={isCollapsed ? "Settings" : undefined}
            className={cn(
              "flex items-center rounded-2xl text-sm font-semibold transition-all duration-300 ease-in-out shrink-0",
              activeTab === "settings"
                ? "bg-white/80 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 shadow-sm dark:shadow-indigo-500/10"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-white/50 dark:hover:bg-white/8",
              isCollapsed ? "w-9 h-9 justify-center px-0 mx-auto" : "w-full h-11 justify-start px-3"
            )}
          >
            <Settings className="w-5 h-5 shrink-0" />
            <div className={cn(
              "overflow-hidden transition-all duration-300 ease-in-out flex items-center",
              isCollapsed ? "w-0 opacity-0" : "w-[150px] opacity-100 pl-3"
            )}>
              <span className="whitespace-nowrap">Settings</span>
            </div>
          </button>
        </div>

      </div>
    </div>
  );
}
