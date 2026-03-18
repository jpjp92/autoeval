import { useState } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { Header } from "./components/layout/Header";
import { DashboardOverview } from "./components/dashboard/DashboardOverview";
import { AgentTable } from "./components/agents/AgentTable";
import { ChatPlayground } from "./components/playground/ChatPlayground";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { QAEvaluationDashboard } from "./components/evaluation/QAEvaluationDashboard";
import { QAGenerationPanel } from "./components/generation/QAGenerationPanel";
import { DataStandardizationPanel } from "./components/standardization/DataStandardizationPanel";

function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [currentFilename, setCurrentFilename] = useState<string | null>(null);
  const [lastEvalJobId, setLastEvalJobId] = useState<string | null>(null);
  // taggingVersion 증가 시 QAGenerationPanel에서 hierarchy 재로드
  const [taggingVersion, setTaggingVersion] = useState(0);

  const getHeaderTitle = () => {
    if (activeTab === "evaluation") return "Evaluation";
    if (activeTab === "generation") return "Data Generation";
    if (activeTab === "standardization") return "Data Standardization";
    if (activeTab === "overview") return "Dashboard";
    return activeTab.charAt(0).toUpperCase() + activeTab.slice(1);
  };

  return (
    <div className="flex h-screen bg-slate-50 font-sans">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title={getHeaderTitle()} />
        
        <main className="flex-1 overflow-y-scroll p-8">
          {/* 컴포넌트 항상 마운트 유지 — hidden으로 세션 상태 보존 */}
          <div className={activeTab === "overview" ? "max-w-7xl mx-auto" : "hidden"}>
            <DashboardOverview setActiveTab={setActiveTab} />
          </div>

          <div className={activeTab === "standardization" ? "max-w-7xl mx-auto" : "hidden"}>
            <DataStandardizationPanel
              setActiveTab={setActiveTab}
              onUploadComplete={(filename) => setCurrentFilename(filename)}
              onTaggingComplete={() => setTaggingVersion((v: number) => v + 1)}
            />
          </div>

          <div className={activeTab === "generation" ? "max-w-7xl mx-auto" : "hidden"}>
            <QAGenerationPanel
              currentFilename={currentFilename}
              taggingVersion={taggingVersion}
              onEvalComplete={(evalJobId) => setLastEvalJobId(evalJobId)}
              onGoToEvaluation={() => setActiveTab("evaluation")}
            />
          </div>

          <div className={activeTab === "evaluation" ? "max-w-7xl mx-auto" : "hidden"}>
            <QAEvaluationDashboard evalJobId={lastEvalJobId} />
          </div>

          <div className={activeTab === "playground" ? "max-w-7xl mx-auto" : "hidden"}>
            <ChatPlayground />
          </div>

          <div className={activeTab === "settings" ? "max-w-7xl mx-auto" : "hidden"}>
            <SettingsPanel />
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
