import { 
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar, Legend 
} from 'recharts';
import { Download, Filter, CheckCircle2, AlertCircle, FileText, Activity, Target, Zap, FileJson, Code2 } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import { useState } from 'react';
import { exportToCSV, exportToHTML, exportToJSON } from '@/src/lib/exportUtils';

// --- Mock Data based on Python Scripts ---

const summaryStats = [
  { label: "총 생성된 QA", value: "1,106", icon: FileText, color: "text-indigo-600", bg: "bg-indigo-100" },
  { label: "구문 통과률", value: "98.5%", icon: CheckCircle2, color: "text-emerald-600", bg: "bg-emerald-100" },
  { label: "품질 통과률", value: "82.4%", icon: Target, color: "text-amber-600", bg: "bg-amber-100" },
  { label: "Triad 통과률", value: "79.1%", icon: Activity, color: "text-rose-600", bg: "bg-rose-100" }
];

const layer1Stats = [
  { subject: '다양성', A: 8.5, fullMark: 10 },
  { subject: '중복률', A: 9.2, fullMark: 10 },
  { subject: '편향성', A: 7.8, fullMark: 10 },
  { subject: '충분성', A: 9.9, fullMark: 10 },
];

const intentDistribution = [
  { name: 'factoid', label: 'Factoid', krLabel: '사실형', value: 140 },
  { name: 'numeric', label: 'Numeric', krLabel: '수치형', value: 135 },
  { name: 'procedure', label: 'Procedure', krLabel: '절차형', value: 142 },
  { name: 'why', label: 'Why', krLabel: '원인형', value: 138 },
  { name: 'how', label: 'How', krLabel: '방법형', value: 145 },
  { name: 'definition', label: 'Definition', krLabel: '정의형', value: 130 },
  { name: 'list', label: 'List', krLabel: '목록형', value: 139 },
  { name: 'boolean', label: 'Boolean', krLabel: '예/아니오형', value: 137 },
];

const INTENT_COLORS = {
  factoid: '#06b6d4',      // cyan
  numeric: '#eab308',      // yellow
  procedure: '#3b82f6',    // blue
  why: '#d946ef',          // magenta
  how: '#22c55e',          // green
  definition: '#0ea5e9',   // bright_cyan (sky)
  list: '#f59e0b',         // bright_yellow (amber)
  boolean: '#c026d3',      // bright_magenta (fuchsia)
};

const llmQualityScores = [
  { name: '사실성 (Factuality)', score: 0.88 },
  { name: '완전성 (Completeness)', score: 0.82 },
  { name: '근거성 (Groundedness)', score: 0.85 },
  { name: '관련성 (Relevance)', score: 0.89 },
  { name: '명확성 (Clarity)', score: 0.81 },
];

const detailedQAData = [
  { id: 1, q: "KT 5G 요금제 중 데이터 무제한인 상품은 무엇인가요?", intent: "factoid", l2_avg: 0.92, triad_avg: 0.88, pass: true },
  { id: 2, q: "가족 결합 할인을 받으려면 어떻게 신청해야 하나요?", intent: "procedure", l2_avg: 0.85, triad_avg: 0.82, pass: true },
  { id: 3, q: "이번 달 청구 요금이 왜 지난달보다 5,000원 더 많이 나왔나요?", intent: "why", l2_avg: 0.65, triad_avg: 0.71, pass: false },
  { id: 4, q: "로밍 데이터 차단 부가서비스는 무료인가요?", intent: "boolean", l2_avg: 0.95, triad_avg: 0.94, pass: true },
  { id: 5, q: "선택약정할인 위약금은 얼마인가요?", intent: "numeric", l2_avg: 0.55, triad_avg: 0.60, pass: false },
];

// --- Custom Tooltip for Intent Distribution ---
const IntentTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-white p-2.5 rounded-lg border border-slate-200 shadow-md animate-in fade-in zoom-in-95 duration-200">
        <p className="text-xs font-semibold text-slate-900">{data.label}</p>
        <p className="text-xs text-slate-600 font-medium">{data.krLabel}</p>
        <p className="text-xs text-slate-500 mt-1">수량: {data.value}</p>
      </div>
    );
  }
  return null;
};

// --- Components ---

export function QAEvaluationDashboard() {
  const [showExportMenu, setShowExportMenu] = useState(false);

  const evaluationData = {
    summaryStats,
    layer1Stats,
    intentDistribution,
    llmQualityScores,
    detailedQA: detailedQAData,
    metadata: {
      model: 'Gemini 3.1 Flash-Lite',
      prompt: 'v2',
      lang: 'KO',
      timestamp: new Date().toISOString(),
    },
  };

  const handleExport = (format: 'csv' | 'html' | 'json') => {
    switch (format) {
      case 'csv':
        exportToCSV(evaluationData);
        break;
      case 'html':
        exportToHTML(evaluationData);
        break;
      case 'json':
        exportToJSON(evaluationData);
        break;
    }
    setShowExportMenu(false);
  };
  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">QA 평가 결과</h2>
          <p className="text-sm text-slate-500">모델: Gemini 3.1 Flash-Lite | 프롬프트: v2 | 언어: KO</p>
        </div>
        <div className="flex gap-3">
          <button className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            <Filter className="w-4 h-4" /> Filter
          </button>
          <div className="relative">
            <button
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors shadow-sm"
            >
              <Download className="w-4 h-4" /> Export Report
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded-lg shadow-lg z-10 overflow-hidden">
                <button
                  onClick={() => handleExport('csv')}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left text-slate-700 border-b border-slate-100 last:border-b-0"
                >
                  <FileText className="w-4 h-4 text-blue-600" />
                  <div>
                    <div className="font-medium">CSV Format</div>
                    <div className="text-xs text-slate-500">Spreadsheet-compatible</div>
                  </div>
                </button>
                <button
                  onClick={() => handleExport('html')}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left text-slate-700 border-b border-slate-100 last:border-b-0"
                >
                  <Code2 className="w-4 h-4 text-green-600" />
                  <div>
                    <div className="font-medium">HTML Report</div>
                    <div className="text-xs text-slate-500">Formatted document</div>
                  </div>
                </button>
                <button
                  onClick={() => handleExport('json')}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors text-left text-slate-700"
                >
                  <FileJson className="w-4 h-4 text-purple-600" />
                  <div>
                    <div className="font-medium">JSON Data</div>
                    <div className="text-xs text-slate-500">Raw data format</div>
                  </div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {summaryStats.map((stat, i) => (
          <div key={i} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center gap-4">
            <div className={cn("w-12 h-12 rounded-lg flex items-center justify-center", stat.bg, stat.color)}>
              <stat.icon className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-500">{stat.label}</p>
              <p className="text-2xl font-bold text-slate-900">{stat.value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Intent Distribution (Pie) */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
          <div className="mb-2">
            <h3 className="text-base font-semibold text-slate-800">🎯 의도 분류</h3>
            <p className="text-xs text-slate-500">8가지 질문 유형의 균형</p>
          </div>
          <div className="flex-1 min-h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={intentDistribution}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                  isAnimationActive={false}
                >
                  {intentDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={INTENT_COLORS[entry.name as keyof typeof INTENT_COLORS]} />
                  ))}
                </Pie>
                <Tooltip 
                  content={<IntentTooltip />}
                  wrapperStyle={{ transition: 'all 0.2s ease-in-out' }}
                  animationDuration={200}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-2">
            {intentDistribution.map((entry) => (
              <div key={entry.name} className="flex items-center gap-1.5 text-[10px] font-medium text-slate-600 group hover:bg-slate-100 px-1.5 py-0.5 rounded transition-colors cursor-pointer">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: INTENT_COLORS[entry.name as keyof typeof INTENT_COLORS] }}></span>
                <span className="truncate group-hover:hidden">{entry.label}</span>
                <span className="hidden group-hover:block text-slate-700 font-semibold">{entry.krLabel}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Layer 1: Dataset Statistics (Radar) */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
          <div className="mb-2">
            <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" /> 데이터셋 통계
            </h3>
            <p className="text-xs text-slate-500">구조적, 통계적 검증 (0-10)</p>
          </div>
          <div className="flex-1 min-h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart cx="50%" cy="50%" outerRadius="72%" data={layer1Stats}>
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: '#64748b', fontSize: 10 }} />
                <PolarRadiusAxis angle={30} domain={[0, 10]} ticks={[0, 5, 10]} tick={{ fill: '#94a3b8', fontSize: 9 }} />
                <Radar name="Score" dataKey="A" stroke="#6366f1" fill="#6366f1" fillOpacity={0.4} />
                <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Layer 2 & Triad: LLM Quality Scores (Bar) */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col">
          <div className="mb-2">
            <h3 className="text-base font-semibold text-slate-800 flex items-center gap-2">
              <Target className="w-4 h-4 text-indigo-500" /> 품질 점수
            </h3>
            <p className="text-xs text-slate-500">LLM 기반 품질 평가 (0-1)</p>
          </div>
          <div className="flex-1 min-h-[250px] mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={llmQualityScores} layout="vertical" margin={{ top: 0, right: 20, left: 40, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e2e8f0" />
                <XAxis type="number" domain={[0, 1]} tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fill: '#64748b', fontSize: 11 }} width={100} />
                <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Bar dataKey="score" fill="#10b981" radius={[0, 4, 4, 0]} barSize={20}>
                  {llmQualityScores.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.score >= 0.85 ? '#10b981' : entry.score >= 0.7 ? '#f59e0b' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Detailed QA Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50/50">
          <div>
            <h3 className="text-base font-semibold text-slate-900">상세 평가 결과</h3>
            <p className="text-xs text-slate-500">품질 점수 및 평가 상세 정보</p>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="flex items-center gap-1 text-emerald-600 font-medium"><CheckCircle2 className="w-4 h-4"/> 성공 (≥ 0.7)</span>
            <span className="flex items-center gap-1 text-rose-600 font-medium ml-3"><AlertCircle className="w-4 h-4"/> 실패 (&lt; 0.7)</span>
          </div>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-6 py-3 font-medium w-12">ID</th>
                <th className="px-6 py-3 font-medium w-24">의도</th>
                <th className="px-6 py-3 font-medium">생성된 질문</th>
                <th className="px-6 py-3 font-medium text-center w-28">L2 평균</th>
                <th className="px-6 py-3 font-medium text-center w-28">Triad 평균</th>
                <th className="px-6 py-3 font-medium text-center w-24">상태</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {detailedQAData.map((row) => (
                <tr key={row.id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-6 py-4 text-slate-500 font-mono text-xs">{row.id}</td>
                  <td className="px-6 py-4">
                    <div 
                      className="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider border text-center w-24 inline-block"
                      style={{ 
                        backgroundColor: `${INTENT_COLORS[row.intent as keyof typeof INTENT_COLORS]}15`,
                        color: INTENT_COLORS[row.intent as keyof typeof INTENT_COLORS],
                        borderColor: `${INTENT_COLORS[row.intent as keyof typeof INTENT_COLORS]}30`
                      }}
                    >
                      {row.intent}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-slate-700 font-medium">{row.q}</td>
                  <td className="px-6 py-4 text-center">
                    <span className={cn("font-mono", row.l2_avg >= 0.7 ? "text-emerald-600" : "text-rose-600 font-bold")}>
                      {row.l2_avg.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className={cn("font-mono", row.triad_avg >= 0.7 ? "text-emerald-600" : "text-rose-600 font-bold")}>
                      {row.triad_avg.toFixed(2)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    {row.pass ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-md bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-200">
                        성공
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded-md bg-rose-50 text-rose-700 text-xs font-medium border border-rose-200">
                        실패
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-center">
          <button className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
            모든 1,106개 결과 보기 →
          </button>
        </div>
      </div>
    </div>
  );
}
