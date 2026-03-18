/**
 * 개선된 QA Generation Panel
 * - Backend API 실제 연결
 * - Real-time 진행상황 추적
 * - Error handling
 * - Form state 관리
 */

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Settings, Play, Loader2, ListTree, CheckCircle2, ChevronRight, AlertCircle, X, RefreshCw } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { generateQA, getHierarchyList } from "@/src/lib/api";
import { API_BASE } from "@/src/lib/api";

interface GenerationStatus {
  job_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress?: number;
  message?: string;
  error?: string;
  result_file?: string;
  result_id?: string; // Supabase UUID
  timestamp?: string;
}

interface FormValues {
  model: string;
  lang: string;
  samples: number;
  promptVersion: string;
  autoEvaluate: boolean;
  evaluatorModel: string;
}

interface QAGenerationPanelProps {
  currentFilename?: string | null;
  taggingVersion?: number;
  onEvalComplete?: (evalJobId: string) => void;
  onGoToEvaluation?: () => void;
}

export function QAGenerationPanel({ currentFilename, taggingVersion, onEvalComplete, onGoToEvaluation }: QAGenerationPanelProps = {}) {
  // Form State
  const [formValues, setFormValues] = useState<FormValues>({
    model: "gemini-3.1-flash",
    lang: "en",
    samples: 2,
    promptVersion: "v1",
    autoEvaluate: true,
    evaluatorModel: "gpt-5.1",
  });

  // Generation State
  const [isGenerating, setIsGenerating] = useState(false);
  const [phase, setPhase] = useState<"idle" | "generating" | "evaluating" | "complete">("idle");
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [evalJobId, setEvalJobId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sampleInputValue, setSampleInputValue] = useState(""); // 샘플 수 입력칸용
  const [resultFile, setResultFile] = useState<string | null>(null);
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [evalReport, setEvalReport] = useState<string | null>(null);
  // 4단계 평가 상태 추적
  const prevLayerStatuses = useRef<Record<string, string>>({});
  const [evalLayers, setEvalLayers] = useState<any>({
    syntax: { status: "pending", progress: 0, message: "" },
    stats: { status: "pending", progress: 0, message: "" },
    rag: { status: "pending", progress: 0, message: "" },
    quality: { status: "pending", progress: 0, message: "" },
  });

  // Terminal Output
  const [logs, setLogs] = useState<string[]>([]);

  // Hierarchy (DB 기반)
  const [hierarchyL1List, setHierarchyL1List] = useState<string[]>([]);
  const [hierarchyL2Map, setHierarchyL2Map] = useState<Record<string, string[]>>({});
  const [hierarchyL3Map, setHierarchyL3Map] = useState<Record<string, string[]>>({});
  const [selectedL1, setSelectedL1] = useState<string>("");
  const [selectedL2, setSelectedL2] = useState<string>("");
  const [selectedL3, setSelectedL3] = useState<string>("");
  const [isLoadingHierarchy, setIsLoadingHierarchy] = useState(false);
  const [hierarchyLoaded, setHierarchyLoaded] = useState(false);

  // currentFilename 변경 또는 태깅 완료 시 hierarchy 목록 재로드
  useEffect(() => {
    loadHierarchyList();
  }, [currentFilename, taggingVersion]);

  const loadHierarchyList = async () => {
    setSelectedL1("");
    setSelectedL2("");
    setSelectedL3("");
    if (!currentFilename) {
      setHierarchyL1List([]);
      setHierarchyL2Map({});
      setHierarchyL3Map({});
      setHierarchyLoaded(false);
      return;
    }
    setIsLoadingHierarchy(true);
    const result = await getHierarchyList(currentFilename);
    if (result.success) {
      setHierarchyL1List(result.l1_list);
      setHierarchyL2Map(result.l2_by_l1);
      setHierarchyL3Map(result.l3_by_l1_l2 ?? {});
      setHierarchyLoaded(true);
    }
    setIsLoadingHierarchy(false);
  };

  // L1 변경 시 L2, L3 초기화
  const handleL1Change = (l1: string) => {
    setSelectedL1(l1);
    setSelectedL2("");
    setSelectedL3("");
  };

  // L2 변경 시 L3 초기화
  const handleL2Change = (l2: string) => {
    setSelectedL2(l2);
    setSelectedL3("");
  };

  // 진행상황 폴링
  useEffect(() => {
    if (!isGenerating || !jobId) return;

    console.log(`[Generation Polling] Started for job ${jobId}`);

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/api/generate/${jobId}/status`);
        if (!response.ok) throw new Error("Status check failed");

        const data: GenerationStatus = await response.json();
        console.log(`[Generation Status] ${data.status} - ${data.progress}%`, data);

        setPhase(
          data.status === 'pending' ? 'generating' :
          data.status === 'running' ? 'generating' :
          data.status === 'completed' ? 'complete' :
          data.status === 'failed' ? 'complete' : 'generating'
        );

        setProgress(data.progress || 0);
        setStatusMessage(data.message || "");

        if (data.status === 'completed') {
          console.log(`[Generation Complete]`, { file: data.result_file, result_id: data.result_id });
          setIsGenerating(false);
          setResultFile(data.result_file || null);
          setGenerationId(data.result_id || null);
          addLog(`✓ Generation completed: ${data.result_file}`, 'success');
          if (data.result_id) {
            addLog(`✓ Saved to Supabase: ${data.result_id}`, 'success');
          }
          clearInterval(pollInterval);
          setJobId(null); // 폴링 중지

          // Auto-evaluate if enabled
          if (formValues.autoEvaluate && data.result_file) {
            console.log(`[Auto-Evaluate] Starting evaluation for ${data.result_file}`, { generationId: data.result_id });
            setPhase('evaluating');
            setProgress(0);
            addLog('Starting auto-evaluation...', 'info');
            
            // Start evaluation
            startEvaluation(data.result_file, data.result_id);
          } else {
            setPhase('complete');
          }
        } else if (data.status === 'failed') {
          console.error(`[Generation Failed]`, data.error);
          setIsGenerating(false);
          setError(data.error || "Unknown error");
          addLog(`✗ Generation failed: ${data.error}`, 'error');
          clearInterval(pollInterval);
          setJobId(null); // 폴링 중지
        }
      } catch (err) {
        console.error("[Generation Poll Error]", err);
        // Retry on network error
      }
    }, 1000); // Poll every 1 second

    return () => {
      console.log(`[Generation Polling] Cleanup for job ${jobId}`);
      clearInterval(pollInterval);
    };
  }, [isGenerating, jobId, formValues.autoEvaluate]);

  // 평가 진행상황 폴링
  useEffect(() => {
    if (!evalJobId) return;

    console.log(`[Evaluation Polling] Started for job ${evalJobId}`);

    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/api/evaluate/${evalJobId}/status`);
        if (!response.ok) throw new Error("Status check failed");

        const data = await response.json();
        console.log(`[Evaluation Status] ${data.status} - ${data.progress}%`, data);

        setProgress(data.progress || 0);
        setStatusMessage(data.message || "");
        
        // ========== 4단계 상세 정보 업데이트 ==========
        if (data.layers) {
          setEvalLayers(data.layers);
          
          // 각 단계의 상태 변화를 로그에 기록
          const LAYER_NAMES: Record<string, string> = {
            syntax:  "Layer 1-A  구문 검증",
            stats:   "Layer 1-B  데이터셋 통계",
            rag:     "Layer 2    RAG Triad",
            quality: "Layer 3    품질 평가",
          };
          Object.entries(data.layers).forEach(([layer, info]: [string, any]) => {
            const prev = prevLayerStatuses.current[layer];
            if (info.status === 'completed' && prev !== 'completed') {
              addLog(`${LAYER_NAMES[layer] ?? layer} 완료: ${info.message}`, 'success');
            } else if (info.status === 'running' && prev !== 'running') {
              addLog(`${LAYER_NAMES[layer] ?? layer} 시작중...`, 'info');
            }
            prevLayerStatuses.current[layer] = info.status;
          });
        }

        if (data.status === 'completed') {
          console.log(`[Evaluation Complete]`, { report: data.eval_report });
          setEvalReport(data.eval_report);
          addLog('전체 평가 파이프라인 완료', 'success');
          setPhase('complete');
          clearInterval(pollInterval);
          onEvalComplete?.(evalJobId);
          setEvalJobId(null); // 폴링 중지
        } else if (data.status === 'failed') {
          console.error(`[Evaluation Failed]`, data.error);
          setError(data.error || "Evaluation failed");
          addLog(`✗ 평가 실패: ${data.error}`, 'error');
          setPhase('complete');
          clearInterval(pollInterval);
          setEvalJobId(null); // 폴링 중지
        }
      } catch (err) {
        console.error("[Evaluation Poll Error]", err);
      }
    }, 1000);

    return () => {
      console.log(`[Evaluation Polling] Cleanup for job ${evalJobId}`);
      clearInterval(pollInterval);
    };
  }, [evalJobId]);

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

  const startEvaluation = async (resultFile: string, genId?: string) => {
    console.log(`[Start Evaluation] resultFile: ${resultFile}, generationId: ${genId}`);
    
    try {
      console.log(`[Evaluation API] Sending request to /api/evaluate with model: ${formValues.evaluatorModel}`);
      
      const evalResponse = await fetch(`${API_BASE}/api/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          result_filename: resultFile,
          evaluator_model: formValues.evaluatorModel,
          generation_id: genId,
        })
      });

      if (!evalResponse.ok) throw new Error("Failed to start evaluation");
      
      const evalData = await evalResponse.json();
      console.log(`[Evaluation API Response]`, evalData);
      
      if (evalData.success && evalData.job_id) {
        console.log(`[Evaluation Job Created] job_id: ${evalData.job_id}`);
        setEvalJobId(evalData.job_id);
        addLog(`Evaluation job started: ${evalData.job_id} with model: ${evalData.evaluator_model}`);
      } else {
        throw new Error(evalData.error || "Failed to start evaluation");
      }
    } catch (err) {
      console.error("[Start Evaluation Error]", err);
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setError(errorMsg);
      addLog(errorMsg, 'error');
      setPhase('complete');
    }
  };

  const handleStart = async () => {
    console.log("[Handle Start] User clicked start button", { formValues });
    
    setError(null);
    setLogs([]);
    setIsGenerating(true);
    setProgress(0);
    setPhase("generating");
    setResultFile(null);

    addLog(`Starting QA generation (model: ${formValues.model}, lang: ${formValues.lang}, samples: ${formValues.samples})`);

    try {
      console.log("[Generate QA API] Sending request", { formValues });
      
      const response = await generateQA({
        model: formValues.model,
        lang: formValues.lang,
        samples: formValues.samples,
        prompt_version: formValues.promptVersion,
        ...(currentFilename && { filename: currentFilename }),
        ...(selectedL1 && { hierarchy_l1: selectedL1 }),
        ...(selectedL2 && { hierarchy_l2: selectedL2 }),
        ...(selectedL3 && { hierarchy_l3: selectedL3 }),
      });

      console.log("[Generate QA API Response]", response);

      if (!response.success || !response.job_id) {
        throw new Error(response.error || "Failed to start generation");
      }

      const newJobId = response.job_id;
      console.log(`[Generation Job Created] job_id: ${newJobId}`);
      setJobId(newJobId);
      addLog(`Job started: ${newJobId}`);

    } catch (err) {
      console.error("[Handle Start Error]", err);
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setError(errorMsg);
      addLog(errorMsg, 'error');
      setIsGenerating(false);
      setPhase("complete");
    }
  };

  const handleCancel = () => {
    console.log("[Handle Cancel] User cancelled operation", { jobId, evalJobId });
    setIsGenerating(false);
    setPhase("idle");
    setJobId(null);
    addLog("Generation cancelled by user", 'warning');
  };

  return (
    <div className="max-w-5xl mx-auto animate-in fade-in duration-500 space-y-5">

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <h4 className="font-semibold text-red-900">Generation Error</h4>
            <p className="text-sm text-red-800 mt-1">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-800">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Top row: Settings (2/3) + Hierarchy (1/3) — equal height */}
      <div className="grid grid-cols-3 gap-5 items-stretch">

        {/* Settings */}
        <div className="col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-4">
          <h3 className="font-semibold flex items-center gap-2 text-slate-800">
            <Settings className="w-4 h-4 text-indigo-500" /> 설정
          </h3>

          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="space-y-1.5">
              <label className="text-slate-500 font-medium">생성 모델</label>
              <select
                value={formValues.model}
                onChange={(e) => setFormValues({ ...formValues, model: e.target.value })}
                disabled={isGenerating}
                className={cn("w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all", isGenerating && "opacity-50 cursor-not-allowed")}
              >
                <option value="gemini-3.1-flash">Gemini 3.1 Flash</option>
                <option value="claude-sonnet">Claude Sonnet 4.6</option>
                <option value="gpt-5.2">GPT-5.2</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-500 font-medium">언어</label>
              <select
                value={formValues.lang}
                onChange={(e) => setFormValues({ ...formValues, lang: e.target.value })}
                disabled={isGenerating}
                className={cn("w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all", isGenerating && "opacity-50 cursor-not-allowed")}
              >
                <option value="ko">한국어 (ko)</option>
                <option value="en">영어 (en)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-500 font-medium">문서당 샘플 수</label>
              <input
                type="number" min="1" max="50"
                value={sampleInputValue}
                onChange={(e) => {
                  const val = e.target.value;
                  setSampleInputValue(val);
                  const num = parseInt(val);
                  if (!isNaN(num) && num >= 1 && num <= 50) setFormValues({ ...formValues, samples: num });
                }}
                onBlur={(e) => { if (e.target.value === "") setFormValues({ ...formValues, samples: 1 }); }}
                disabled={isGenerating}
                className={cn("w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all", isGenerating && "opacity-50 cursor-not-allowed")}
                placeholder="1 – 50"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-500 font-medium">프롬프트 버전</label>
              <select
                value={formValues.promptVersion}
                onChange={(e) => setFormValues({ ...formValues, promptVersion: e.target.value })}
                disabled={isGenerating}
                className={cn("w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all", isGenerating && "opacity-50 cursor-not-allowed")}
              >
                <option value="v1">v1 (베타)</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-slate-500 font-medium">평가 모델</label>
              <select
                value={formValues.evaluatorModel}
                onChange={(e) => setFormValues({ ...formValues, evaluatorModel: e.target.value })}
                disabled={isGenerating}
                className={cn("w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all", isGenerating && "opacity-50 cursor-not-allowed")}
              >
                <option value="gemini-flash">Gemini 2.5 Flash</option>
                <option value="claude-haiku">Claude Haiku 4.5</option>
                <option value="gpt-5.1">GPT-5.1</option>
              </select>
            </div>
          </div>

          {/* Auto Evaluate Toggle */}
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-800">자동 평가 파이프라인</p>
              <p className="text-xs text-slate-400">생성 후 4-Layer 평가 자동 실행</p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer"
                checked={formValues.autoEvaluate}
                onChange={(e) => setFormValues({ ...formValues, autoEvaluate: e.target.checked })}
                disabled={isGenerating}
              />
              <div className={cn("w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600", isGenerating && "opacity-50 cursor-not-allowed")} />
            </label>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-3 border-t border-slate-100">
            <button
              onClick={handleStart}
              disabled={isGenerating}
              className={cn("flex-1 py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition-all", isGenerating ? "bg-slate-100 text-slate-400 cursor-not-allowed" : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm")}
            >
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              <span>
                {phase === "generating" ? "생성 중..." : phase === "evaluating" ? "평가 중..." : formValues.autoEvaluate ? "생성 및 평가 시작" : "QA 생성 시작"}
              </span>
            </button>
            {isGenerating && (
              <button onClick={handleCancel} className="px-4 py-3 rounded-lg font-semibold bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-all">
                취소
              </button>
            )}
          </div>

          {/* Progress Bar */}
          {isGenerating && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-slate-500">
                <span>{phase === "generating" ? "생성 중" : "평가 중"}</span>
                <span className="text-indigo-600 font-semibold">{progress}%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div className="bg-indigo-500 h-full rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}

          {/* 4-Layer Evaluation Progress */}
          {phase === "evaluating" && (
            <div className="pt-3 border-t border-slate-100 space-y-2.5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">평가 파이프라인</p>
              {(["syntax", "stats", "rag", "quality"] as const).map((layer) => {
                const layerInfo = evalLayers[layer];
                const layerLabel = {
                  syntax:  "Layer 1-A  Syntax Validation",
                  stats:   "Layer 1-B  Dataset Statistics",
                  rag:     "Layer 2    RAG Triad",
                  quality: "Layer 3    Quality Score",
                }[layer];
                return (
                  <div key={layer} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-slate-600">{layerLabel}</span>
                      <span className={cn("font-semibold px-2 py-0.5 rounded",
                        layerInfo.status === "completed" ? "bg-emerald-50 text-emerald-700" :
                        layerInfo.status === "running"   ? "bg-amber-50 text-amber-700" :
                                                           "bg-slate-100 text-slate-400"
                      )}>
                        {layerInfo.status === "completed" ? "완료" : layerInfo.status === "running" ? "실행 중" : "대기"}
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-1 overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all duration-300",
                        layerInfo.status === "completed" ? "bg-emerald-400" :
                        layerInfo.status === "running"   ? "bg-amber-400" : "bg-slate-200"
                      )} style={{ width: `${layerInfo.progress || 0}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Hierarchy */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2 text-slate-800">
              <ListTree className="w-4 h-4 text-indigo-500" /> Target Hierarchy
            </h3>
            <button
              onClick={loadHierarchyList}
              disabled={isLoadingHierarchy || isGenerating}
              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-50 rounded-lg transition-colors disabled:opacity-50"
              title="새로고침"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isLoadingHierarchy && "animate-spin")} />
            </button>
          </div>

          {!hierarchyLoaded && !isLoadingHierarchy && (
            <p className="text-xs text-slate-400 text-center py-6 leading-relaxed">
              {currentFilename
                ? "Hierarchy 정보가 없습니다.\n태깅이 완료된 문서인지 확인해주세요."
                : "Standardization 탭에서 문서를 업로드하면\n해당 문서의 계층이 표시됩니다."}
            </p>
          )}

          {isLoadingHierarchy && (
            <div className="flex items-center gap-2 text-sm text-slate-400 py-6 justify-center">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>불러오는 중...</span>
            </div>
          )}

          {hierarchyLoaded && (
            <div className="flex flex-col gap-3 flex-1">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">L1 카테고리</label>
                <select
                  value={selectedL1}
                  onChange={(e) => handleL1Change(e.target.value)}
                  disabled={isGenerating}
                  className={cn("w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all", isGenerating && "opacity-50 cursor-not-allowed")}
                >
                  <option value="">전체 (필터 없음)</option>
                  {hierarchyL1List.map((l1: string) => <option key={l1} value={l1}>{l1}</option>)}
                </select>
              </div>

              {selectedL1 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">L2 섹션</label>
                  <select
                    value={selectedL2}
                    onChange={(e) => handleL2Change(e.target.value)}
                    disabled={isGenerating}
                    className={cn("w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all", isGenerating && "opacity-50 cursor-not-allowed")}
                  >
                    <option value="">전체 (L1 내 모든 섹션)</option>
                    {(hierarchyL2Map[selectedL1] || []).map((l2: string) => <option key={l2} value={l2}>{l2}</option>)}
                  </select>
                </div>
              )}

              {selectedL1 && selectedL2 && (hierarchyL3Map[`${selectedL1}__${selectedL2}`] || []).length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">L3 항목</label>
                  <select
                    value={selectedL3}
                    onChange={(e) => setSelectedL3(e.target.value)}
                    disabled={isGenerating}
                    className={cn("w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all", isGenerating && "opacity-50 cursor-not-allowed")}
                  >
                    <option value="">전체 (L2 내 모든 항목)</option>
                    {(hierarchyL3Map[`${selectedL1}__${selectedL2}`] || []).map((l3: string) => <option key={l3} value={l3}>{l3}</option>)}
                  </select>
                </div>
              )}

              <div className="mt-4 pt-3 border-t border-slate-100 space-y-1">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">선택 범위</p>
                {!selectedL1 ? (
                  <p className="text-xs text-slate-500">전체 문서에서 샘플링</p>
                ) : (
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs text-indigo-700 font-medium">
                      <ChevronRight className="w-3 h-3" />{selectedL1}
                    </div>
                    {selectedL2 && (
                      <div className="flex items-center gap-1.5 text-xs text-indigo-400 pl-4">
                        <ChevronRight className="w-3 h-3" />{selectedL2}
                      </div>
                    )}
                    {selectedL3 && (
                      <div className="flex items-center gap-1.5 text-xs text-indigo-300 pl-8">
                        <ChevronRight className="w-3 h-3" />{selectedL3}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Terminal Output — full width */}
      <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-800 bg-slate-900">
          <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
          <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
          <div className="w-2.5 h-2.5 rounded-full bg-slate-700" />
          <span className="ml-2 text-xs text-slate-500 font-mono">output</span>
        </div>
        <div className="p-5 font-mono text-xs h-52 overflow-y-auto space-y-0.5">
          {logs.length === 0 ? (
            <p className="text-slate-600">Waiting for output...</p>
          ) : (
            logs.map((log: string, i: number) => (
              <p key={i} className={cn(
                "leading-5",
                log.includes('[ERROR]') ? "text-red-400" :
                log.includes('[OK]')    ? "text-emerald-400" :
                log.includes('[WARN]')  ? "text-amber-400" :
                                          "text-slate-400"
              )}>
                {log}
              </p>
            ))
          )}
        </div>
      </div>

      {/* Completion Card — full width */}
      <AnimatePresence>
      {phase === "complete" && resultFile && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <h3 className="font-semibold text-slate-800">
              {formValues.autoEvaluate && evalReport ? "파이프라인 완료" : "생성 완료"}
            </h3>
          </div>

          {formValues.autoEvaluate && evalReport && typeof evalReport === 'object' && 'summary' in evalReport ? (
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: "총 QA", value: `${evalReport.metadata?.total_qa}개` },
                { label: "구문 검증", value: `${evalReport.summary?.syntax_pass_rate}%` },
                { label: "Dataset Score", value: `${evalReport.summary?.dataset_quality_score}/10` },
                { label: "최종 등급", value: `${evalReport.summary?.grade} (${(evalReport.summary?.final_score * 100).toFixed(1)}%)` },
              ].map(({ label, value }) => (
                <div key={label} className="bg-slate-50 rounded-lg p-3 space-y-1">
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className="text-sm font-semibold text-slate-800">{value}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">{resultFile}</p>
          )}

          {formValues.autoEvaluate && evalReport && onGoToEvaluation && (
            <button
              onClick={onGoToEvaluation}
              className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              평가 결과 보기
              <ChevronRight className="w-4 h-4" />
            </button>
          )}
        </motion.div>
      )}
      </AnimatePresence>

    </div>
  );
}