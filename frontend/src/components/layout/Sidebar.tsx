import { useEffect, useState } from "react";
import { LayoutDashboard, Search, Target, PanelLeftClose, PanelLeftOpen, FilePlus, Database, Settings } from "lucide-react";
import { cn } from "@/src/lib/utils";

interface SidebarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export function Sidebar({ activeTab, setActiveTab }: SidebarProps) {
  // CSS provides the responsive layout before hydration; media events keep
  // manual toggles intact until the viewport crosses the desktop breakpoint.
  const [isCollapsed, setIsCollapsed] = useState<boolean | null>(null);

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 1023px)");
    const updateLayout = () => setIsCollapsed(mobile.matches);
    updateLayout();
    mobile.addEventListener("change", updateLayout);
    return () => mobile.removeEventListener("change", updateLayout);
  }, []);

  function selectTab(tab: string) {
    setActiveTab(tab);
    if (window.matchMedia("(max-width: 1023px)").matches) setIsCollapsed(true);
  }

  const width = isCollapsed === null ? "w-[84px] lg:w-[256px]" : isCollapsed ? "w-[84px]" : "w-[256px]";
  const headerAlignment = isCollapsed === null ? "justify-center lg:justify-between" : isCollapsed ? "justify-center" : "justify-between";
  const brandVisibility = isCollapsed === null ? "w-0 opacity-0 lg:w-[160px] lg:opacity-100" : isCollapsed ? "w-0 opacity-0" : "w-[160px] opacity-100";
  const itemLayout = isCollapsed === null
    ? "w-9 h-9 justify-center px-0 mx-auto lg:w-full lg:h-11 lg:justify-start lg:px-3"
    : isCollapsed ? "w-9 h-9 justify-center px-0 mx-auto" : "w-full h-11 justify-start px-3";
  const labelVisibility = isCollapsed === null ? "w-0 opacity-0 lg:w-[150px] lg:opacity-100 lg:pl-3" : isCollapsed ? "w-0 opacity-0" : "w-[150px] opacity-100 pl-3";

  const menuItems = [
    { id: "overview", label: "Dashboard", icon: LayoutDashboard },
    { id: "standardization", label: "Documents", icon: Database },
    { id: "generation", label: "QA Pipeline", icon: FilePlus },
    { id: "evaluation", label: "Evaluation", icon: Target },
  ];

  return (
    <div className={cn(
      "h-screen p-3 shrink-0 transition-all duration-300 ease-in-out",
      width
    )}>
      {/* 
        내부 폭: 
        Expanded = 256 - 24(p-3) - 24(p-3) = 208px 
        Collapsed = 84 - 24(p-3) - 24(p-3) = 36px 
      */}
      <div className="h-full rounded-3xl bg-white/50 dark:bg-slate-800/60 backdrop-blur-2xl border border-white/60 dark:border-white/8 shadow-2xl shadow-indigo-500/8 dark:shadow-black/30 flex flex-col pt-2 px-3 pb-3 overflow-hidden">

        <div className={cn(
          "flex items-center h-11 mb-2 shrink-0 transition-all duration-300",
          headerAlignment
        )}>

          <div className={cn(
            "overflow-hidden transition-all duration-300 ease-in-out flex items-center",
            brandVisibility
          )}>
            <button
              onClick={() => selectTab("overview")}
              tabIndex={isCollapsed ? -1 : undefined}
              className="flex items-center gap-3 hover:opacity-80 transition-opacity whitespace-nowrap"
            >
              <div className="w-9 h-9 bg-indigo-500 rounded-full flex items-center justify-center shrink-0">
                <Search className="w-5 h-5 text-white/80" strokeWidth={1.25} />
              </div>
              <div className="flex flex-col leading-none">
                <span className="font-black text-base tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-500 to-purple-500 dark:from-indigo-400 dark:to-purple-400">Agen Q</span>
              </div>
            </button>
          </div>

          <button
            onClick={() => setIsCollapsed(current => !(current ?? window.matchMedia("(max-width: 1023px)").matches))}
            aria-label={isCollapsed === null ? "Toggle sidebar" : isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={isCollapsed === null ? undefined : !isCollapsed}
            aria-controls="sidebar-navigation"
            className={cn(
              "w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 ease-in-out",
              "text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white",
              "hover:bg-slate-200/60 dark:hover:bg-white/10 active:scale-95 hover:shadow-sm"
            )}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed === null ? (
              <>
                <PanelLeftOpen className="w-5 h-5 lg:hidden" />
                <PanelLeftClose className="hidden w-5 h-5 lg:block" />
              </>
            ) : isCollapsed ? <PanelLeftOpen className="w-5 h-5" /> : <PanelLeftClose className="w-5 h-5" />}
          </button>
        </div>

        <nav id="sidebar-navigation" aria-label="Main navigation" className="flex-1 flex flex-col gap-1 overflow-y-auto overflow-x-hidden pt-2">
          {menuItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => selectTab(item.id)}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                title={isCollapsed ? item.label : undefined}
                className={cn(
                  "relative flex items-center rounded-2xl text-sm font-semibold transition-all duration-300 ease-out shrink-0 group active:scale-[0.97]",
                  isActive
                    ? "bg-white/80 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 shadow-sm dark:shadow-indigo-500/10"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-white/50 dark:hover:bg-white/8 hover:translate-x-1",
                  itemLayout
                )}
              >
                {/* Active 좌측 인디케이터 (Collapsed 아닐 때만 약간 보이거나 내부 바) */}
                {isActive && !isCollapsed && (
                  <div className={cn("absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-5 bg-indigo-500 rounded-r-md opacity-100 transition-all duration-300", isCollapsed === null && "hidden lg:block")} />
                )}
                
                <item.icon className={cn("w-5 h-5 shrink-0 transition-transform duration-300", isActive && "scale-110")} />
                
                <div className={cn(
                  "overflow-hidden transition-all duration-300 ease-in-out flex items-center",
                  labelVisibility
                )}>
                  <span className="whitespace-nowrap">{item.label}</span>
                </div>
              </button>
            );
          })}
        </nav>

        <div className="pt-3 pb-1 border-t border-slate-200/50 dark:border-white/10">
          <button
            onClick={() => selectTab("settings")}
            aria-label="Settings"
            aria-current={activeTab === "settings" ? "page" : undefined}
            title={isCollapsed ? "Settings" : undefined}
            className={cn(
              "relative flex items-center rounded-2xl text-sm font-semibold transition-all duration-300 ease-out shrink-0 group active:scale-[0.97]",
              activeTab === "settings"
                ? "bg-white/80 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 shadow-sm dark:shadow-indigo-500/10"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-white/50 dark:hover:bg-white/8 hover:translate-x-1",
              itemLayout
            )}
          >
            {activeTab === "settings" && !isCollapsed && (
              <div className={cn("absolute left-0 top-1/2 -translate-y-1/2 w-1.5 h-5 bg-indigo-500 rounded-r-md opacity-100 transition-all duration-300", isCollapsed === null && "hidden lg:block")} />
            )}
            
            <Settings className={cn("w-5 h-5 shrink-0 transition-transform duration-300", activeTab === "settings" && "scale-110")} />
            <div className={cn(
              "overflow-hidden transition-all duration-300 ease-in-out flex items-center",
              labelVisibility
            )}>
              <span className="whitespace-nowrap">Settings</span>
            </div>
          </button>
        </div>

      </div>
    </div>
  );
}
