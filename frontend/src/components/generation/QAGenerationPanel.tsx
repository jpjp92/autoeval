/**
 * QA Generation Panel — Step 기반 레이아웃
 * Step 1: 설정 (모델, 언어, 샘플 수, Hierarchy)
 * Step 2: 실행 (생성 + 평가 + 결과)
 */

import { useState, useEffect, useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Settings, Play, Loader2, ListTree, CheckCircle2, ChevronRight,
  AlertCircle, X, RefreshCw, Check, Terminal,
} from "lucide-react";
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
  result_id?: string;
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

// ── StepCard ─────────────────────────────────────────────────────────────────
type StepStatus = "pending" | "active" | "done";

function StepCard({
  step, title, subtitle, icon, status, isLast, children,
}: {
  step: number; title: string; subtitle: string;
  icon: ReactNode; status: StepStatus; isLast: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex gap-0">
      <div className="flex flex-col items-center pt-6 mr-5">
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 border-2 transition-all",
          status === "done"   ? "bg-indigo-600 border-indigo-600 text-white" :
          status === "active" ? "bg-white border-indigo-500 text-indigo-600" :
                                "bg-white border-slate-200 text-slate-400"
        )}>
          {status === "done" ? <Check className="w-4 h-4" /> : step}
        </div>
        {!isLast && (
          <div className={cn(
            "w-0.5 flex-1 mt-2 min-h-[2rem]",
            status === "done" ? "bg-indigo-200" : "bg-slate-100"
          )} />
        )}
      </div>
      <div className={cn(
        "flex-1 bg-white rounded-2xl border shadow-sm overflow-hidden mb-4 transition-all",
        status === "pending" ? "border-slate-200 opacity-60" : "border-slate-200"
      )}>
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3">
          <div className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
            status === "done"   ? "bg-indigo-100 text-indigo-600" :
            status === "active" ? "bg-indigo-100 text-indigo-500" :
                                  "bg-slate-100 text-slate-400"
          )}>
            {icon}
          </div>
          <div>
            <h3 className={cn("text-sm font-semibold", status === "pending" ? "text-slate-400" : "text-slate-800")}>
              {title}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          </div>
          {status === "done" && (
            <span className="ml-auto px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[11px] font-semibold rounded-full">완료</span>
          )}
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

// ── Select 공통 스타일 ────────────────────────────────────────────────────────
const selectCls = (disabled: boolean) => cn(
  "w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all",
  disabled && "opacity-50 cursor-not-allowed"
);

// ── Main Component ────────────────────────────────────────────────────────────
export function QAGenerationPanel({ currentFilename, taggingVersion, onEvalComplete, onGoToEvaluation }: QAGenerationPanelProps = {}) {

  const [formValues, setFormValues] = useState<FormValues>({
    model: "gemini-3.1-flash", lang: "en", samples: 2,
    promptVersion: "v1", autoEvaluate: true, evaluatorModel: "gpt-5.1",
  });
  const [sampleInputValue, setSampleInputValue] = useState("");

  const [isGenerating, setIsGenerating] = useState(false);
  const [phase, setPhase] = useState<"idle" | "generating" | "evaluating" | "complete">("idle");
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [evalJobId, setEvalJobId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resultFile, setResultFile] = useState<string | null>(null);
  const [evalReport, setEvalReport] = useState<any>(null);

  const prevLayerStatuses = useRef<Record<string, string>>({});
  const [evalLayers, setEvalLayers] = useState<any>({
    syntax:  { status: "pending", progress: 0, message: "" },
    stats:   { status: "pending", progress: 0, message: "" },
    rag:     { status: "pending", progress: 0, message: "" },
    quality: { status: "pending", progress: 0, message: "" },
  });

  const [logs, setLogs] = useState<string[]>([]);

  const [hierarchyL1List, setHierarchyL1List]   = useState<string[]>([]);
  const [hierarchyL2Map, setHierarchyL2Map]     = useState<Record<string, string[]>>({});
  const [hierarchyL3Map, setHierarchyL3Map]     = useState<Record<string, string[]>>({});
  const [selectedL1, setSelectedL1]             = useState("");
  const [selectedL2, setSelectedL2]             = useState("");
  const [selectedL3, setSelectedL3]             = useState("");
  const [isLoadingHierarchy, setIsLoadingHierarchy] = useState(false);
  const [hierarchyLoaded, setHierarchyLoaded]   = useState(false);

  useEffect(() => { loadHierarchyList(); }, [currentFilename, taggingVersion]);

  const loadHierarchyList = async () => {
    setSelectedL1(""); setSelectedL2(""); setSelectedL3("");
    if (!currentFilename) {
      setHierarchyL1List([]); setHierarchyL2Map({}); setHierarchyL3Map({});
      setHierarchyLoaded(false); return;
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

  const handleL1Change = (l1: string) => { setSelectedL1(l1); setSelectedL2(""); setSelectedL3(""); };
  const handleL2Change = (l2: string) => { setSelectedL2(l2); setSelectedL3(""); };

  // 생성 폴링
  useEffect(() => {
    if (!isGenerating || !jobId) return;
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/api/generate/${jobId}/status`);
        if (!response.ok) throw new Error("Status check failed");
        const data: GenerationStatus = await response.json();

        setPhase(data.status === 'completed' || data.status === 'failed' ? 'complete' : 'generating');
        setProgress(data.progress || 0);
        setStatusMessage(data.message || "");

        if (data.status === 'completed') {
          setIsGenerating(false);
          setResultFile(data.result_file || null);
          addLog(`✓ Generation completed: ${data.result_file}`, 'success');
          if (data.result_id) addLog(`✓ Saved to Supabase: ${data.result_id}`, 'success');
          clearInterval(pollInterval);
          setJobId(null);
          if (formValues.autoEvaluate && data.result_file) {
            setPhase('evaluating'); setProgress(0);
            addLog('Starting auto-evaluation...', 'info');
            startEvaluation(data.result_file, data.result_id);
          } else {
            setPhase('complete');
          }
        } else if (data.status === 'failed') {
          setIsGenerating(false);
          setError(data.error || "Unknown error");
          addLog(`✗ Generation failed: ${data.error}`, 'error');
          clearInterval(pollInterval); setJobId(null);
        }
      } catch {}
    }, 1000);
    return () => clearInterval(pollInterval);
  }, [isGenerating, jobId, formValues.autoEvaluate]);

  // 평가 폴링
  useEffect(() => {
    if (!evalJobId) return;
    const pollInterval = setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/api/evaluate/${evalJobId}/status`);
        if (!response.ok) throw new Error("Status check failed");
        const data = await response.json();

        setProgress(data.progress || 0);
        setStatusMessage(data.message || "");

        if (data.layers) {
          setEvalLayers(data.layers);
          const LAYER_NAMES: Record<string, string> = {
            syntax: "Layer 1-A 구문 검증", stats: "Layer 1-B 데이터셋 통계",
            rag: "Layer 2 RAG Triad", quality: "Layer 3 품질 평가",
          };
          Object.entries(data.layers).forEach(([layer, info]: [string, any]) => {
            const prev = prevLayerStatuses.current[layer];
            if (info.status === 'completed' && prev !== 'completed')
              addLog(`${LAYER_NAMES[layer] ?? layer} 완료: ${info.message}`, 'success');
            else if (info.status === 'running' && prev !== 'running')
              addLog(`${LAYER_NAMES[layer] ?? layer} 시작중...`, 'info');
            prevLayerStatuses.current[layer] = info.status;
          });
        }

        if (data.status === 'completed') {
          setEvalReport(data.eval_report);
          addLog('전체 평가 파이프라인 완료', 'success');
          setPhase('complete');
          clearInterval(pollInterval);
          onEvalComplete?.(evalJobId);
          setEvalJobId(null);
        } else if (data.status === 'failed') {
          setError(data.error || "Evaluation failed");
          addLog(`✗ 평가 실패: ${data.error}`, 'error');
          setPhase('complete');
          clearInterval(pollInterval); setEvalJobId(null);
        }
      } catch {}
    }, 1000);
    return () => clearInterval(pollInterval);
  }, [evalJobId]);

  const addLog = (message: string, type: 'info' | 'success' | 'error' | 'warning' = 'info') => {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const prefix = { info: '[INFO]', success: '[OK]', error: '[ERROR]', warning: '[WARN]' }[type];
    setLogs(prev => [...prev, `${timestamp} ${prefix} ${message}`]);
  };

  const startEvaluation = async (resultFile: string, genId?: string) => {
    try {
      const evalResponse = await fetch(`${API_BASE}/api/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result_filename: resultFile, evaluator_model: formValues.evaluatorModel, generation_id: genId }),
      });
      if (!evalResponse.ok) throw new Error("Failed to start evaluation");
      const evalData = await evalResponse.json();
      if (evalData.success && evalData.job_id) {
        setEvalJobId(evalData.job_id);
        addLog(`Evaluation job started: ${evalData.job_id} with model: ${evalData.evaluator_model}`);
      } else throw new Error(evalData.error || "Failed to start evaluation");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setError(errorMsg); addLog(errorMsg, 'error'); setPhase('complete');
    }
  };

  const handleStart = async () => {
    setError(null); setLogs([]); setIsGenerating(true);
    setProgress(0); setPhase("generating"); setResultFile(null);
    addLog(`Starting QA generation (model: ${formValues.model}, lang: ${formValues.lang}, samples: ${formValues.samples})`);
    try {
      const response = await generateQA({
        model: formValues.model, lang: formValues.lang, samples: formValues.samples,
        prompt_version: formValues.promptVersion,
        ...(currentFilename && { filename: currentFilename }),
        ...(selectedL1 && { hierarchy_l1: selectedL1 }),
        ...(selectedL2 && { hierarchy_l2: selectedL2 }),
        ...(selectedL3 && { hierarchy_l3: selectedL3 }),
      });
      if (!response.success || !response.job_id) throw new Error(response.error || "Failed to start generation");
      setJobId(response.job_id);
      addLog(`Job started: ${response.job_id}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setError(errorMsg); addLog(errorMsg, 'error');
      setIsGenerating(false); setPhase("complete");
    }
  };

  const handleCancel = () => {
    setIsGenerating(false); setPhase("idle"); setJobId(null);
    addLog("Generation cancelled by user", 'warning');
  };

  const handleReset = () => {
    setPhase("idle"); setError(null); setLogs([]);
    setResultFile(null); setEvalReport(null); setProgress(0);
    setEvalLayers({ syntax: { status: "pending", progress: 0, message: "" }, stats: { status: "pending", progress: 0, message: "" }, rag: { status: "pending", progress: 0, message: "" }, quality: { status: "pending", progress: 0, message: "" } });
    prevLayerStatuses.current = {};
  };

  const step1Status: StepStatus = phase === "idle" ? "active" : "done";
  const step2Status: StepStatus = phase === "idle" ? "pending" : phase === "complete" ? "done" : "active";

  return (
    <div className="max-w-4xl mx-auto space-y-0">

      {/* ── Step 1: 생성 설정 ─────────────────────────────────────────── */}
      <StepCard
        step={1} title="생성 설정"
        subtitle="QA 생성 모델, 샘플 수, 평가 모델을 설정합니다."
        icon={<Settings className="w-4 h-4" />}
        status={step1Status} isLast={false}
      >
        <div className="space-y-5">
          {/* 설정 폼 — 4개 항목 2열 그리드 */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            {/* 생성 모델 */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">생성 모델</label>
              <select value={formValues.model} onChange={e => setFormValues({ ...formValues, model: e.target.value })} disabled={isGenerating} className={selectCls(isGenerating)}>
                <option value="gemini-3.1-flash">Gemini 3.1 Flash</option>
                <option value="claude-sonnet">Claude Sonnet 4.6</option>
                <option value="gpt-5.2">GPT-5.2</option>
              </select>
            </div>

            {/* 문서당 샘플 수 */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">문서당 샘플 수</label>
              <input
                type="number" min="1" max="50" placeholder="1 – 50"
                value={sampleInputValue}
                onChange={e => {
                  const val = e.target.value; setSampleInputValue(val);
                  const num = parseInt(val);
                  if (!isNaN(num) && num >= 1 && num <= 50) setFormValues({ ...formValues, samples: num });
                }}
                onBlur={e => { if (e.target.value === "") setFormValues({ ...formValues, samples: 1 }); }}
                disabled={isGenerating}
                className={selectCls(isGenerating)}
              />
            </div>

            {/* 평가 모델 */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">평가 모델</label>
              <select value={formValues.evaluatorModel} onChange={e => setFormValues({ ...formValues, evaluatorModel: e.target.value })} disabled={isGenerating} className={selectCls(isGenerating)}>
                <option value="gemini-flash">Gemini 2.5 Flash</option>
                <option value="claude-haiku">Claude Haiku 4.5</option>
                <option value="gpt-5.1">GPT-5.1</option>
              </select>
            </div>

            {/* 자동 평가 — 다른 항목과 동일한 라벨+박스 구조 */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">자동 평가</label>
              <div className={cn("w-full flex items-center justify-between px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg", isGenerating && "opacity-50")}>
                <p className="text-sm text-slate-600">생성 후 4-Layer 자동 실행</p>
                <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                  <input type="checkbox" className="sr-only peer"
                    checked={formValues.autoEvaluate}
                    onChange={e => setFormValues({ ...formValues, autoEvaluate: e.target.checked })}
                    disabled={isGenerating}
                  />
                  <div className="w-10 h-5 bg-slate-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600" />
                </label>
              </div>
            </div>
          </div>

          {/* Target Hierarchy */}
          <div className="pt-4 border-t border-slate-100 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                <ListTree className="w-3.5 h-3.5" /> Target Hierarchy
              </p>
              <button onClick={loadHierarchyList} disabled={isLoadingHierarchy || isGenerating} className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded transition-colors disabled:opacity-50" title="새로고침">
                <RefreshCw className={cn("w-3.5 h-3.5", isLoadingHierarchy && "animate-spin")} />
              </button>
            </div>

            {isLoadingHierarchy ? (
              <div className="flex items-center gap-2 text-sm text-slate-400 py-3 justify-center">
                <Loader2 className="w-4 h-4 animate-spin" /> <span>불러오는 중...</span>
              </div>
            ) : !hierarchyLoaded ? (
              <div className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl">
                <p className="text-xs text-slate-400 leading-relaxed">
                  {currentFilename
                    ? "Hierarchy 정보가 없습니다. 태깅이 완료된 문서인지 확인해주세요."
                    : "Standardization 탭에서 문서를 업로드하면 계층이 표시됩니다."}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">L1 카테고리</label>
                  <select value={selectedL1} onChange={e => handleL1Change(e.target.value)} disabled={isGenerating} className={selectCls(isGenerating)}>
                    <option value="">전체</option>
                    {hierarchyL1List.map(l1 => <option key={l1} value={l1}>{l1}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">L2 섹션</label>
                  <select value={selectedL2} onChange={e => handleL2Change(e.target.value)} disabled={isGenerating || !selectedL1} className={selectCls(isGenerating || !selectedL1)}>
                    <option value="">전체</option>
                    {(hierarchyL2Map[selectedL1] || []).map(l2 => <option key={l2} value={l2}>{l2}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">L3 항목</label>
                  <select value={selectedL3} onChange={e => setSelectedL3(e.target.value)} disabled={isGenerating || !selectedL2} className={selectCls(isGenerating || !selectedL2)}>
                    <option value="">전체</option>
                    {(hierarchyL3Map[`${selectedL1}__${selectedL2}`] || []).map(l3 => <option key={l3} value={l3}>{l3}</option>)}
                  </select>
                </div>
              </div>
            )}

            {/* 선택 범위 표시 */}
            {hierarchyLoaded && selectedL1 && (
              <div className="flex items-center gap-1.5 text-xs text-indigo-600 font-medium px-1">
                <ChevronRight className="w-3 h-3" />{selectedL1}
                {selectedL2 && <><ChevronRight className="w-3 h-3 text-slate-300" /><span className="text-indigo-400">{selectedL2}</span></>}
                {selectedL3 && <><ChevronRight className="w-3 h-3 text-slate-300" /><span className="text-indigo-300">{selectedL3}</span></>}
              </div>
            )}
          </div>
        </div>
      </StepCard>

      {/* ── Step 2: 생성 및 평가 ──────────────────────────────────────── */}
      <StepCard
        step={2} title="생성 및 평가"
        subtitle={formValues.autoEvaluate ? "QA를 생성하고 4-Layer 평가 파이프라인을 자동 실행합니다." : "설정 기반으로 QA 데이터를 생성합니다."}
        icon={<Play className="w-4 h-4" />}
        status={step2Status} isLast={true}
      >
        {phase === "idle" ? (
          /* 대기 상태 */
          <div className="flex items-center gap-4">
            <div className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl">
              <p className="text-xs text-slate-400">Step 1 설정 완료 후 실행 버튼을 눌러 시작하세요.</p>
            </div>
            <button
              onClick={handleStart}
              className="min-w-[168px] flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 shadow-sm shadow-indigo-200 transition-all active:scale-[0.99] flex-shrink-0"
            >
              <Play className="w-4 h-4" />
              {formValues.autoEvaluate ? "생성 및 평가 시작" : "QA 생성 시작"}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 에러 */}
            {error && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="flex-1 text-sm text-red-700">{error}</p>
                <button onClick={() => setError(null)}><X className="w-4 h-4 text-red-400 hover:text-red-600" /></button>
              </div>
            )}

            {/* 진행 상태 + 버튼 */}
            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-2">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>{statusMessage || (phase === "generating" ? "생성 중..." : phase === "evaluating" ? "평가 중..." : "완료")}</span>
                  {phase !== "complete" && <span className="text-indigo-600 font-semibold">{progress}%</span>}
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div className={cn(
                    "h-full rounded-full transition-all duration-300",
                    phase === "complete" ? "bg-emerald-400" : "bg-indigo-500"
                  )} style={{ width: phase === "complete" ? "100%" : `${progress}%` }} />
                </div>
              </div>
              {isGenerating ? (
                <button onClick={handleCancel} className="min-w-[168px] flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 text-red-600 text-sm font-semibold rounded-xl border border-red-200 hover:bg-red-100 transition-all flex-shrink-0">
                  <X className="w-4 h-4" /> 취소
                </button>
              ) : phase === "complete" && (
                <button onClick={handleReset} className="min-w-[168px] flex items-center justify-center gap-2 px-4 py-2.5 bg-slate-100 text-slate-600 text-sm font-semibold rounded-xl hover:bg-slate-200 transition-all flex-shrink-0">
                  <RefreshCw className="w-4 h-4" /> 다시 실행
                </button>
              )}
            </div>

            {/* 4-Layer 평가 진행 */}
            {(phase === "evaluating" || (phase === "complete" && evalReport)) && (
              <div className="pt-3 border-t border-slate-100 space-y-2.5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">평가 파이프라인</p>
                {(["syntax", "stats", "rag", "quality"] as const).map(layer => {
                  const info = evalLayers[layer];
                  const label = { syntax: "Layer 1-A · Syntax Validation", stats: "Layer 1-B · Dataset Statistics", rag: "Layer 2 · RAG Triad", quality: "Layer 3 · Quality Score" }[layer];
                  return (
                    <div key={layer} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono text-slate-600">{label}</span>
                        <span className={cn("font-semibold px-2 py-0.5 rounded-full text-[11px]",
                          info.status === "completed" ? "bg-emerald-100 text-emerald-700" :
                          info.status === "running"   ? "bg-amber-100 text-amber-700" :
                                                        "bg-slate-100 text-slate-400"
                        )}>
                          {info.status === "completed" ? "완료" : info.status === "running" ? "실행 중" : "대기"}
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1 overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all duration-300",
                          info.status === "completed" ? "bg-emerald-400" :
                          info.status === "running"   ? "bg-amber-400" : "bg-slate-200"
                        )} style={{ width: `${info.progress || 0}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 터미널 출력 */}
            <div className="bg-slate-950 rounded-xl border border-slate-800 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-800 bg-slate-900">
                <div className="w-2 h-2 rounded-full bg-slate-700" />
                <div className="w-2 h-2 rounded-full bg-slate-700" />
                <div className="w-2 h-2 rounded-full bg-slate-700" />
                <Terminal className="w-3 h-3 text-slate-500 ml-1" />
                <span className="text-xs text-slate-500 font-mono">output</span>
              </div>
              <div className="p-4 font-mono text-xs h-44 overflow-y-auto space-y-0.5">
                {logs.length === 0
                  ? <p className="text-slate-600">Waiting for output...</p>
                  : logs.map((log, i) => (
                    <p key={i} className={cn("leading-5",
                      log.includes('[ERROR]') ? "text-red-400" :
                      log.includes('[OK]')    ? "text-emerald-400" :
                      log.includes('[WARN]')  ? "text-amber-400" : "text-slate-400"
                    )}>{log}</p>
                  ))
                }
              </div>
            </div>

            {/* 완료 카드 */}
            <AnimatePresence>
              {phase === "complete" && resultFile && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }} transition={{ duration: 0.3 }}
                  className="p-4 bg-emerald-50 border border-emerald-100 rounded-xl space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    <p className="text-sm font-semibold text-emerald-800">
                      {formValues.autoEvaluate && evalReport ? "파이프라인 완료" : "생성 완료"}
                    </p>
                  </div>

                  {formValues.autoEvaluate && evalReport && typeof evalReport === 'object' && 'summary' in evalReport && (
                    <div className="grid grid-cols-4 gap-2">
                      {[
                        { label: "총 QA", value: `${evalReport.metadata?.total_qa}개` },
                        { label: "구문 검증", value: `${evalReport.summary?.syntax_pass_rate}%` },
                        { label: "Dataset Score", value: `${evalReport.summary?.dataset_quality_score}/10` },
                        { label: "최종 등급", value: `${evalReport.summary?.grade}` },
                      ].map(({ label, value }) => (
                        <div key={label} className="bg-white rounded-lg p-2.5 border border-emerald-100 space-y-0.5">
                          <p className="text-xs text-slate-400">{label}</p>
                          <p className="text-sm font-semibold text-slate-800">{value}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {formValues.autoEvaluate && evalReport && onGoToEvaluation && (
                    <div className="pt-2 border-t border-emerald-100 flex justify-end">
                      <button
                        onClick={onGoToEvaluation}
                        className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
                      >
                        평가 결과 보기 <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </StepCard>
    </div>
  );
}
