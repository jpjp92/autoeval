import { MoreHorizontal, Play, Pause, Edit3, Trash2, Cpu, Database, Network } from "lucide-react";
import { cn } from "@/src/lib/utils";

const models = [
  {
    id: 1,
    name: "GPT-5.1",
    provider: "OpenAI",
    role: "품질 평가기",
    costInput: "$1.25",
    costOutput: "$10.00",
    status: "active",
    icon: Network,
    color: "text-emerald-600",
    bg: "bg-emerald-100"
  },
  {
    id: 2,
    name: "Gemini 2.5 Flash",
    provider: "Google",
    role: "RAG Triad Judge (TruLens)",
    costInput: "$0.075",
    costOutput: "$0.30",
    status: "active",
    icon: Cpu,
    color: "text-indigo-600",
    bg: "bg-indigo-100"
  },
  {
    id: 3,
    name: "Gemini 3.1 Flash-Lite",
    provider: "Google",
    role: "QA Generator (v2 Prompt)",
    costInput: "$0.25",
    costOutput: "$1.50",
    status: "active",
    icon: Database,
    color: "text-blue-600",
    bg: "bg-blue-100"
  },
  {
    id: 4,
    name: "Claude Sonnet 4.5",
    provider: "Anthropic",
    role: "QA Generator (Standby)",
    costInput: "$3.00",
    costOutput: "$15.00",
    status: "paused",
    icon: Database,
    color: "text-amber-600",
    bg: "bg-amber-100"
  },
];

export function AgentTable() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in duration-500">
      <div className="p-6 border-b border-slate-200 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Models & Evaluators</h3>
          <p className="text-sm text-slate-500">Manage LLMs used for QA generation and quality evaluation</p>
        </div>
        <button className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors shadow-sm">
          + Add Model Configuration
        </button>
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-6 py-4 font-medium">Model Name</th>
              <th className="px-6 py-4 font-medium">Provider</th>
              <th className="px-6 py-4 font-medium">Assigned Role</th>
              <th className="px-6 py-4 font-medium">Cost (In/Out per 1M)</th>
              <th className="px-6 py-4 font-medium">Status</th>
              <th className="px-6 py-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {models.map((model) => (
              <tr key={model.id} className="hover:bg-slate-50/80 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", model.bg, model.color)}>
                      <model.icon className="w-4 h-4" />
                    </div>
                    <span className="font-medium text-slate-900">{model.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-slate-600">
                  <span className="px-2.5 py-1 bg-slate-100 rounded-md text-xs font-medium border border-slate-200">
                    {model.provider}
                  </span>
                </td>
                <td className="px-6 py-4 text-slate-700 font-medium">
                  {model.role}
                </td>
                <td className="px-6 py-4 text-slate-600 font-mono text-xs">
                  <span className="text-slate-400">In:</span> {model.costInput} <br/>
                  <span className="text-slate-400">Out:</span> {model.costOutput}
                </td>
                <td className="px-6 py-4">
                  <span className={cn(
                    "inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border",
                    model.status === 'active' 
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                      : 'bg-slate-100 text-slate-600 border-slate-200'
                  )}>
                    {model.status === 'active' && <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full mr-1.5"></span>}
                    {model.status.charAt(0).toUpperCase() + model.status.slice(1)}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors" title="Edit Configuration">
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors" title={model.status === 'active' ? 'Pause' : 'Activate'}>
                      {model.status === 'active' ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>
                    <button className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors" title="Remove Model">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
