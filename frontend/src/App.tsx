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
import { motion } from "motion/react";

function App() {
  const [activeTab, setActiveTab] = useState("overview");

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
        
        <main className="flex-1 overflow-y-auto p-8">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="max-w-7xl mx-auto space-y-8"
          >
            {activeTab === "overview" && (
              <DashboardOverview setActiveTab={setActiveTab} />
            )}

            {activeTab === "standardization" && (
              <DataStandardizationPanel />
            )}
            
            {activeTab === "generation" && (
              <QAGenerationPanel />
            )}

            {activeTab === "evaluation" && (
              <QAEvaluationDashboard />
            )}


            {activeTab === "playground" && (
              <ChatPlayground />
            )}

            {activeTab === "settings" && (
              <SettingsPanel />
            )}
            
            {activeTab !== "overview" && activeTab !== "standardization" && activeTab !== "generation" && activeTab !== "evaluation" && activeTab !== "playground" && activeTab !== "settings" && (
              <div className="flex flex-col items-center justify-center h-[60vh] text-slate-400">
                <div className="w-16 h-16 bg-slate-200 rounded-full flex items-center justify-center mb-4">
                  <span className="text-2xl">🚧</span>
                </div>
                <h3 className="text-lg font-medium text-slate-600">Work in Progress</h3>
                <p>The {activeTab} module is currently under development.</p>
              </div>
            )}
          </motion.div>
        </main>
      </div>
    </div>
  );
}

export default App;
