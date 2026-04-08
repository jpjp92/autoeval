import { useState, useEffect } from "react";
import type { HierarchyTree } from "./types/hierarchy";
import { LayoutDashboard, Database, FilePlus, Target, Settings, Zap } from "lucide-react";
import { Sidebar } from "./components/layout/Sidebar";
import { Header, type Notification } from "./components/layout/Header";
import { DashboardOverview } from "./components/dashboard/DashboardOverview";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { QAEvaluationDashboard } from "./components/evaluation/QAEvaluationDashboard";
import { QAGenerationPanel } from "./components/generation/QAGenerationPanel";
import { DataStandardizationPanel } from "./components/standardization/DataStandardizationPanel";
import { ErrorBoundary } from "./components/ErrorBoundary";

function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [currentFilename, setCurrentFilename] = useState<string | null>(null);
  const [lastEvalJobId, setLastEvalJobId] = useState<string | null>(null); // 세션 in-memory job용
  const [lastEvalDbId, setLastEvalDbId]   = useState<string | null>(null); // DB 히스토리 id용
  // taggingVersion + 완료 시점 treeData를 QAGenerationPanel에 전달
  const [taggingVersion, setTaggingVersion] = useState(0);
  const [taggingTreeData, setTaggingTreeData] = useState<HierarchyTree | null>(null);
  const [settingsSection, setSettingsSection] = useState<string | undefined>(undefined);
  const [theme, setTheme] = useState<'light' | 'dark'>(
    () => (localStorage.getItem('theme') as 'light' | 'dark') ?? 'dark'
  );
  const [notifications, setNotifications] = useState<Notification[]>([]);

  function addNotification(n: Omit<Notification, 'id' | 'time' | 'read'>) {
    setNotifications(prev => [
      { ...n, id: crypto.randomUUID(), time: new Date(), read: false },
      ...prev,
    ]);
  }

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  const getHeaderInfo = () => {
    switch (activeTab) {
      case "overview": return { title: "Dashboard", Icon: LayoutDashboard };
      case "standardization": return { title: "Documents", Icon: Database };
      case "generation": return { title: "QA Pipeline", Icon: FilePlus };
      case "evaluation": return { title: "Evaluation", Icon: Target };
      case "settings": return { title: "Settings", Icon: Settings };
      default: return { title: "Auto Eval", Icon: Zap };
    }
  };
  const { title: headerTitle, Icon: HeaderIcon } = getHeaderInfo();

  const lightBg = "linear-gradient(135deg, #f0f2ff 0%, #eef2ff 40%, #e6fff7 100%)";
  const darkBg  = "linear-gradient(135deg, #0f1117 0%, #13152b 40%, #0e1a2e 70%, #0f1117 100%)";

  return (
    <div className="flex h-screen relative overflow-hidden"
      style={{ background: theme === 'dark' ? darkBg : lightBg }}
    >
      {/* Gradient blobs */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        {theme === 'dark' ? (<>
          <div className="absolute -top-32 right-0 w-[600px] h-[600px] bg-indigo-900/30 rounded-full blur-3xl" />
          <div className="absolute bottom-0 -left-24 w-[500px] h-[500px] bg-blue-900/20 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 w-[400px] h-[400px] bg-purple-900/20 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
        </>) : (<>
          <div className="absolute -top-32 right-0 w-[600px] h-[600px] bg-indigo-100/50 rounded-full blur-3xl" />
          <div className="absolute bottom-0 -left-24 w-[500px] h-[500px] bg-sky-100/40 rounded-full blur-3xl" />
          <div className="absolute top-1/2 left-1/2 w-[400px] h-[400px] bg-violet-100/30 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
        </>)}
      </div>

      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
            title={headerTitle}
            icon={HeaderIcon}
            theme={theme}
            setTheme={setTheme}
            onProfileClick={() => setActiveTab("settings")}
            notifications={notifications}
            onClearAll={() => setNotifications([])}
            onMarkAllRead={() => setNotifications(prev => prev.map(n => ({ ...n, read: true })))}
          />

        <main className={`flex-1 ${activeTab === "settings" ? "overflow-hidden px-4" : "overflow-y-scroll px-4 pb-4 pt-6"}`}>
          <ErrorBoundary>
          {/* 컴포넌트 항상 마운트 유지 — hidden으로 세션 상태 보존 */}
          <div className={activeTab === "overview" ? "max-w-7xl mx-auto" : "hidden"}>
            <DashboardOverview
              setActiveTab={setActiveTab}
              isActive={activeTab === "overview"}
              onEvalSelect={(evalId) => { setLastEvalDbId(evalId); setActiveTab("evaluation"); }}
              onPipelineClick={() => { setSettingsSection("pipeline"); setActiveTab("settings"); }}
            />
          </div>

          <div className={activeTab === "standardization" ? "max-w-7xl mx-auto" : "hidden"}>
            <DataStandardizationPanel
              setActiveTab={setActiveTab}
              onUploadComplete={(filename) => {
                setCurrentFilename(filename);
                addNotification({ title: '문서 분석 완료', sub: filename, type: 'success' });
              }}
              onTaggingComplete={(treeData) => {
                setTaggingTreeData(treeData);
                setTaggingVersion((v: number) => v + 1);
                addNotification({ title: '카테고리 분류 완료', type: 'success' });
              }}
            />
          </div>

          <div className={activeTab === "generation" ? "max-w-7xl mx-auto" : "hidden"}>
            <QAGenerationPanel
              currentFilename={currentFilename}
              taggingVersion={taggingVersion}
              taggingTreeData={taggingTreeData}
              onGenerationComplete={() => {
                addNotification({ title: 'QA 생성 완료', type: 'success' });
              }}
              onEvalComplete={(evalJobId) => {
                setLastEvalJobId(evalJobId);
                addNotification({ title: '평가 완료', type: 'success' });
              }}
              onGoToEvaluation={() => setActiveTab("evaluation")}
            />
          </div>

          <div className={activeTab === "evaluation" ? "max-w-7xl mx-auto" : "hidden"}>
            <QAEvaluationDashboard 
              evalJobId={lastEvalJobId} 
              initialEvalDbId={lastEvalDbId} 
              setActiveTab={setActiveTab}
            />
          </div>

          <div className={activeTab === "settings" ? "h-full" : "hidden"}>
            <SettingsPanel section={settingsSection} />
          </div>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

export default App;
