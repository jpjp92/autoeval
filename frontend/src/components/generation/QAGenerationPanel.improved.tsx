/**
 * 개선된 QA Generation Panel
 * - Backend API 실제 연결
 * - Real-time 진행상황 추적
 * - Error handling
 * - Form state 관리
 */

import { useState, useEffect } from "react";
import { Settings, Play, Loader2, ListTree, CheckCircle2, Folder, ChevronRight, Plus, AlertCircle, X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { generateQA } from "@/src/lib/api";
import { API_BASE } from "@/src/lib/api";

interface GenerationStatus {
  job_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  message?: string;
  error?: string;
  result_file?: string;
  timestamp?: string;
}

interface FormValues {
  model: string;
  lang: string;
  samples: number;
  promptVersion: string;
  autoEvaluate: boolean;
}

export function QAGenerationPanelImproved() {
  // Form State
  const [formValues, setFormValues] = useState<FormValues>({
    model: "flashlite",
    lang: "ko",
    samples: 8,
    promptVersion: "v2",
    autoEvaluate: true,
  });

  // Generation State
  const [isGenerating, setIsGenerating] = useState(false);
  const [phase, setPhase] = useState<"idle" | "generating" | "evaluating" | "complete">("idle");
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resultFile, setResultFile] = useState<string | null>(null);

  // Terminal Output
  const [logs, setLogs] = useState<string[]>([]);

  // Custom Hierarchy
  const [customHierarchy, setCustomHierarchy] = useState("");
  const hierarchy = ["Shop", "USIM/eSIM 가입", "선불 USIM 구매/충전"];

  // 진행상황 폴링
  useEffect(() => {
    if (!isGenerating || !jobId) return;

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/api/generate/${jobId}/status`);
        if (!response.ok) throw new Error("Status check failed");

        const data: GenerationStatus = await response.json();

        setPhase(
          data.status === 'pending' ? 'generating' :
          data.status === 'running' ? 'generating' :
          data.status === 'completed' ? 'complete' :
          data.status === 'failed' ? 'complete' : 'generating'
        );

        setProgress(data.progress || 0);
        setStatusMessage(data.message || "");

        if (data.status === 'completed') {
          setIsGenerating(false);
          setResultFile(data.result_file || null);
          addLog(`✓ Generation completed: ${data.result_file}`, 'success');
          clearInterval(pollInterval);

          // Auto-evaluate if enabled
          if (formValues.autoEvaluate) {
            setPhase('evaluating');
            addLog('Starting auto-evaluation...', 'info');
            // TODO: Call evaluation API
          }
        } else if (data.status === 'failed') {
          setIsGenerating(false);
          setError(data.error || "Unknown error");
          addLog(`✗ Generation failed: ${data.error}`, 'error');
          clearInterval(pollInterval);
        }
      } catch (err) {
        console.error("Poll error:", err);
        // Retry on network error
      }
    }, 1000); // Poll every 1 second

    return () => clearInterval(pollInterval);
  }, [isGenerating, jobId, formValues.autoEvaluate]);

  const addLog = (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const prefix = {
      info: '[INFO]',
      success: '[OK]',
      error: '[ERROR]',
      warning: '[WARN]'
    }[type];

    setLogs(prev => [...prev, `${timestamp} ${prefix} ${message}`]);
  };

  const handleStart = async () => {
    setError(null);
    setLogs([]);
    setIsGenerating(true);
    setProgress(0);
    setPhase("generating");
    setResultFile(null);

    addLog(`Starting QA generation (model: ${formValues.model}, lang: ${formValues.lang}, samples: ${formValues.samples})`);

    try {
      const response = await generateQA({
        model: formValues.model,
        lang: formValues.lang,
        samples: formValues.samples,
        prompt_version: formValues.promptVersion,
      });

      if (!response.success || !response.data?.job_id) {
        throw new Error(response.error || "Failed to start generation");
      }

      const newJobId = response.data.job_id;
      setJobId(newJobId);
      addLog(`Job started: ${newJobId}`);

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setError(errorMsg);
      addLog(errorMsg, 'error');
      setIsGenerating(false);
      setPhase("complete");
    }
  };

  const handleCancel = () => {
    setIsGenerating(false);
    setPhase("idle");
    setJobId(null);
    addLog("Generation cancelled by user", 'warning');
  };

  return (
    <div className="max-w-5xl mx-auto animate-in fade-in duration-500 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          {/* Error Display */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-semibold text-red-900">Generation Error</h4>
                <p className="text-sm text-red-800 mt-1">{error}</p>
              </div>
              <button
                onClick={() => setError(null)}
                className="text-red-600 hover:text-red-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Configuration Card */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <h3 className="font-semibold flex items-center gap-2 text-slate-800">
              <Settings className="w-5 h-5 text-indigo-500" /> 설정
            </h3>

            <div className="grid grid-cols-2 gap-4 text-sm">
              {/* Model Selection */}
              <div className="space-y-1.5">
                <label className="text-slate-500 font-medium">생성 모델</label>
                <select
                  value={formValues.model}
                  onChange={(e) => setFormValues({ ...formValues, model: e.target.value })}
                  disabled={isGenerating}
                  className={cn(
                    "w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all",
                    isGenerating && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <option value="flashlite">Gemini 3.1 Flash-Lite</option>
                  <option value="flash">Gemini 3.1 Flash</option>
                  <option value="gpt-5.1">GPT-5.1</option>
                  <option value="gpt-4o">GPT-4o</option>
                </select>
              </div>

              {/* Language Selection */}
              <div className="space-y-1.5">
                <label className="text-slate-500 font-medium">언어</label>
                <select
                  value={formValues.lang}
                  onChange={(e) => setFormValues({ ...formValues, lang: e.target.value })}
                  disabled={isGenerating}
                  className={cn(
                    "w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all",
                    isGenerating && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <option value="ko">한국어 (ko)</option>
                  <option value="en">영어 (en)</option>
                </select>
              </div>

              {/* Samples Count */}
              <div className="space-y-1.5">
                <label className="text-slate-500 font-medium">문서당 샘플 수</label>
                <input
                  type="number"
                  min="1"
                  max="50"
                  value={formValues.samples}
                  onChange={(e) => setFormValues({ ...formValues, samples: parseInt(e.target.value) || 1 })}
                  disabled={isGenerating}
                  className={cn(
                    "w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all",
                    isGenerating && "opacity-50 cursor-not-allowed"
                  )}
                />
              </div>

              {/* Prompt Version */}
              <div className="space-y-1.5">
                <label className="text-slate-500 font-medium">프롬프트 버전</label>
                <select
                  value={formValues.promptVersion}
                  onChange={(e) => setFormValues({ ...formValues, promptVersion: e.target.value })}
                  disabled={isGenerating}
                  className={cn(
                    "w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all",
                    isGenerating && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <option value="v2">v2 (권장)</option>
                  <option value="v1">v1 (기본)</option>
                </select>
              </div>
            </div>

            {/* Auto Evaluate Toggle */}
            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-slate-800">자동 평가 파이프라인</h4>
                <p className="text-xs text-slate-500">생성 후 RAG Triad 평가 자동 실행</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={formValues.autoEvaluate}
                  onChange={(e) => setFormValues({ ...formValues, autoEvaluate: e.target.checked })}
                  disabled={isGenerating}
                />
                <div className={cn(
                  "w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600",
                  isGenerating && "opacity-50 cursor-not-allowed"
                )}></div>
              </label>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4 border-t border-slate-100">
              <button
                onClick={handleStart}
                disabled={isGenerating}
                className={cn(
                  "flex-1 py-3.5 rounded-lg font-semibold flex items-center justify-center space-x-2 transition-all",
                  isGenerating
                    ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                    : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm"
                )}
              >
                {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
                <span>
                  {phase === "generating" ? 'QA 데이터셋 생성 중...' :
                    phase === "evaluating" ? '평가 실행 중...' :
                    formValues.autoEvaluate ? '생성 및 평가 시작' : 'QA 생성 시작'}
                </span>
              </button>

              {isGenerating && (
                <button
                  onClick={handleCancel}
                  className="px-4 py-3.5 rounded-lg font-semibold bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-all"
                >
                  취소
                </button>
              )}
            </div>

            {/* Progress Bar */}
            {isGenerating && (
              <div className="pt-4 border-t border-slate-100 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">{phase === "generating" ? "생성 중" : "평가 중"}</span>
                  <span className="text-indigo-600 font-semibold">{progress}%</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden">
                  <div
                    className="bg-indigo-600 h-full rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Terminal Output */}
          <div className="bg-slate-900 text-slate-300 p-6 rounded-xl font-mono text-xs h-64 overflow-y-auto shadow-inner border border-slate-800 space-y-1">
            {logs.length === 0 ? (
              <p className="text-slate-500">Terminal output will appear here...</p>
            ) : (
              logs.map((log, i) => (
                <p key={i} className={cn(
                  log.includes('[ERROR]') && "text-red-400",
                  log.includes('[OK]') && "text-emerald-400",
                  log.includes('[WARN]') && "text-amber-400",
                  log.includes('[INFO]') && "text-slate-400"
                )}>
                  {log}
                </p>
              ))
            )}

            {phase === "complete" && resultFile && (
              <div className="mt-4 p-3 bg-indigo-500/10 border border-indigo-500/20 rounded-lg text-indigo-300">
                <p className="font-bold flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4" />
                  {formValues.autoEvaluate ? "파이프라인 완료!" : "생성 완료!"}
                </p>
                <p className="text-sm mt-1">Saved to: {resultFile}</p>
              </div>
            )}
          </div>
        </div>

        {/* Target Hierarchy */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-fit">
          <h3 className="font-semibold flex items-center gap-2 mb-4 text-slate-800">
            <ListTree className="w-5 h-5 text-indigo-500" /> Target Hierarchy
          </h3>
          <div className="space-y-2 text-sm flex-1">
            {hierarchy.map((item, i) => (
              <div key={i} className="flex items-center space-x-2 p-2 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors group">
                <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-500 transition-colors" />
                <Folder className="w-4 h-4 text-blue-400" />
                <span className="text-slate-700 group-hover:text-indigo-600 font-medium transition-colors">{item}</span>
              </div>
            ))}
          </div>

          {/* Custom Hierarchy Box */}
          <div className="mt-6 pt-4 border-t border-slate-100">
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">Custom Target</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. Shop > USIM"
                value={customHierarchy}
                onChange={(e) => setCustomHierarchy(e.target.value)}
                disabled={isGenerating}
                className={cn(
                  "flex-1 p-2 text-sm bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all",
                  isGenerating && "opacity-50 cursor-not-allowed"
                )}
              />
              <button disabled={isGenerating} className="p-2 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors border border-slate-200 disabled:opacity-50">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
