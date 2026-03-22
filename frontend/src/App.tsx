import { useState } from "react";
import { Sidebar } from "./components/layout/Sidebar";
import { Header } from "./components/layout/Header";
import { DashboardOverview } from "./components/dashboard/DashboardOverview";
import { ChatPlayground } from "./components/playground/ChatPlayground";
import { SettingsPanel } from "./components/settings/SettingsPanel";
import { QAEvaluationDashboard } from "./components/evaluation/QAEvaluationDashboard";
import { QAGenerationPanel } from "./components/generation/QAGenerationPanel";
import { DataStandardizationPanel } from "./components/standardization/DataStandardizationPanel";

function App() {
  const [activeTab, setActiveTab] = useState("overview");
  const [currentFilename, setCurrentFilename] = useState<string | null>(null);
  const [lastEvalJobId, setLastEvalJobId] = useState<string | null>(null); // 세션 in-memory job용
  const [lastEvalDbId, setLastEvalDbId]   = useState<string | null>(null); // DB 히스토리 id용
  // taggingVersion 증가 시 QAGenerationPanel에서 hierarchy 재로드
  const [taggingVersion, setTaggingVersion] = useState(0);

  const getHeaderTitle = () => {
    if (activeTab === "evaluation") return "Evaluation";
    if (activeTab === "generation") return "Data Generation";
    if (activeTab === "standardization") return "Data Standardization";
    if (activeTab === "overview") return "Dashboard";
    if (activeTab === "settings") return "Settings";
    return activeTab.charAt(0).toUpperCase() + activeTab.slice(1);
  };

  return (
    <div className="flex h-screen font-sans relative overflow-hidden"
      style={{ background: "linear-gradient(135deg, #f8fafc 0%, #eef2ff 40%, #f0f9ff 70%, #f8fafc 100%)" }}
    >
      {/* Gradient blobs */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-32 right-0 w-[600px] h-[600px] bg-indigo-100/40 rounded-full blur-3xl" />
        <div className="absolute bottom-0 -left-24 w-[500px] h-[500px] bg-sky-100/30 rounded-full blur-3xl" />
      </div>

      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <div className="flex-1 flex flex-col overflow-hidden">
        <Header title={getHeaderTitle()} />

        <main className={`flex-1 ${activeTab === "settings" ? "overflow-hidden" : "overflow-y-scroll p-8"}`}>
          {/* 컴포넌트 항상 마운트 유지 — hidden으로 세션 상태 보존 */}
          <div className={activeTab === "overview" ? "max-w-7xl mx-auto" : "hidden"}>
            <DashboardOverview
              setActiveTab={setActiveTab}
              isActive={activeTab === "overview"}
              onEvalSelect={(evalId) => { setLastEvalDbId(evalId); setActiveTab("evaluation"); }}
            />
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
            <QAEvaluationDashboard evalJobId={lastEvalJobId} initialEvalDbId={lastEvalDbId} />
          </div>

          <div className={activeTab === "playground" ? "max-w-7xl mx-auto" : "hidden"}>
            <ChatPlayground />
          </div>

          <div className={activeTab === "settings" ? "h-full" : "hidden"}>
            <SettingsPanel />
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
