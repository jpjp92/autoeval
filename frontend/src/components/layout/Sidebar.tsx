import { useState } from "react";
import { LayoutDashboard, Users, Settings, Zap, Target, PanelLeftClose, PanelLeftOpen, FilePlus, Database } from "lucide-react";
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
      "h-screen bg-slate-900/95 backdrop-blur-xl text-white flex flex-col border-r border-slate-700/50 transition-all duration-300 relative shrink-0",
      isCollapsed ? "w-20" : "w-64"
    )}>
      {/* Header Area */}
      <div className={cn("p-4 flex items-center h-16", isCollapsed ? "justify-center" : "justify-between")}>
        {!isCollapsed && (
          <button
            onClick={() => setActiveTab("overview")}
            className="flex items-center gap-3 overflow-hidden hover:opacity-80 transition-opacity"
          >
            <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center shrink-0">
              <Zap className="w-5 h-5 text-white" fill="currentColor" />
            </div>
            <span className="font-bold text-xl tracking-tight whitespace-nowrap">Auto Eval</span>
          </button>
        )}
        
        {/* Toggle Button */}
        <button 
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors shrink-0"
          title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {isCollapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
        </button>
      </div>

      <div className="flex-1 px-3 py-4 space-y-1 overflow-y-auto overflow-x-hidden">
        {menuItems.map((item) => (
          <button
            key={item.id}
            onClick={() => setActiveTab(item.id)}
            title={isCollapsed ? item.label : undefined}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
              activeTab === item.id
                ? "bg-indigo-500/20 text-white border border-indigo-400/30 shadow-sm"
                : "text-slate-400 hover:text-white hover:bg-white/10",
              isCollapsed ? "justify-center" : ""
            )}
          >
            <item.icon className="w-5 h-5 shrink-0" />
            {!isCollapsed && <span className="whitespace-nowrap">{item.label}</span>}
          </button>
        ))}
      </div>

      <div className="p-4 border-t border-slate-800">
        <button
          onClick={() => setActiveTab("settings")}
          className={cn(
            "w-full flex items-center gap-3 rounded-lg transition-all duration-200",
            isCollapsed ? "justify-center p-2" : "px-3 py-2",
            activeTab === "settings"
              ? "bg-indigo-600/20 ring-1 ring-indigo-500/40"
              : "bg-slate-800/50 hover:bg-slate-800"
          )}
          title={isCollapsed ? "Settings" : undefined}
        >
          <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
            <Users className="w-4 h-4 text-slate-300" />
          </div>
          {!isCollapsed && (
            <>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-sm font-medium text-white truncate">Admin User</p>
                <p className="text-xs text-slate-400 truncate">admin@autoeval.ai</p>
              </div>
              <Settings className="w-4 h-4 text-slate-500 shrink-0" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}
