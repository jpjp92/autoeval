/**
 * QA Generation Panel — 3-Step 레이아웃
 * Step 1: 생성 설정 (모델, 샘플 수, 평가 모델, Hierarchy)
 * Step 2: QA 생성   (프로그레스 + QA 카드 Preview)
 * Step 3: QA 평가   (4-Layer 진행 + 지표 + 결과 보기)
 */

import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  Settings, Play, Loader2, ListTree, CheckCircle2, ChevronRight,
  AlertCircle, X, RefreshCw, Check, BarChart2,
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
}

interface QaPreviewItem {
  context: string;
  q: string;
  a: string;
  intent: string;
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

// ── 공통 버튼 사이즈 ──────────────────────────────────────────────────────────
const btnBase = "min-w-[148px] flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-xl transition-all active:scale-[0.98] flex-shrink-0";

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
        "flex-1 bg-white/80 backdrop-blur-sm rounded-2xl border shadow-lg shadow-slate-200/40 overflow-hidden mb-4 transition-all",
        status === "pending" ? "border-white/60 opacity-60" : "border-white/60"
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

// intent → 한국어 레이블 (QAEvaluationDashboard 기준)
const intentLabel = (intent: string) => {
  const map: Record<string, string> = {
    factoid:    "사실형",
    numeric:    "수치형",
    procedure:  "절차형",
    why:        "원인형",
    how:        "방법형",
    definition: "정의형",
    list:       "목록형",
    boolean:    "확인형",
  };
  return map[intent?.toLowerCase()] ?? intent;
};

// intent 뱃지 색상
const intentColor = (intent: string) => {
  const map: Record<string, string> = {
    factoid:    "bg-blue-50 text-blue-600 border-blue-100",
    numeric:    "bg-yellow-50 text-yellow-600 border-yellow-100",
    definition: "bg-sky-50 text-sky-600 border-sky-100",
    how:        "bg-emerald-50 text-emerald-600 border-emerald-100",
    procedure:  "bg-indigo-50 text-indigo-600 border-indigo-100",
    why:        "bg-fuchsia-50 text-fuchsia-600 border-fuchsia-100",
    list:       "bg-amber-50 text-amber-600 border-amber-100",
    boolean:    "bg-purple-50 text-purple-600 border-purple-100",
  };
  return map[intent?.toLowerCase()] ?? "bg-slate-100 text-slate-500 border-slate-200";
};

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
  const [resultId, setResultId] = useState<string | null>(null);
  const [evalReport, setEvalReport] = useState<any>(null);

  const [qaPreview, setQaPreview] = useState<QaPreviewItem[]>([]);
  const [qaPreviewTotal, setQaPreviewTotal] = useState(0);

  const prevLayerStatuses = useRef<Record<string, string>>({});
  const [evalLayers, setEvalLayers] = useState<any>({
    syntax:  { status: "pending", progress: 0, message: "" },
    stats:   { status: "pending", progress: 0, message: "" },
    rag:     { status: "pending", progress: 0, message: "" },
    quality: { status: "pending", progress: 0, message: "" },
  });

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

        setProgress(data.progress || 0);
        setStatusMessage(data.message || "");

        if (data.status === 'completed') {
          setIsGenerating(false);
          setResultFile(data.result_file || null);
          setResultId(data.result_id || null);
          clearInterval(pollInterval);

          // QA Preview 조회
          try {
            const previewRes = await fetch(`${API_BASE}/api/generate/${jobId}/preview?limit=3`);
            const previewData = await previewRes.json();
            if (previewData.success) {
              setQaPreview(previewData.preview ?? []);
              setQaPreviewTotal(previewData.total ?? 0);
            }
          } catch {}

          setJobId(null);
          if (formValues.autoEvaluate && data.result_file) {
            setPhase('evaluating');
            setProgress(0);
            startEvaluation(data.result_file, data.result_id);
          } else {
            setPhase('complete');
          }
        } else if (data.status === 'failed') {
          setIsGenerating(false);
          setError(data.error || "Unknown error");
          clearInterval(pollInterval);
          setJobId(null);
          setPhase('complete');
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
          Object.entries(data.layers).forEach(([layer, info]: [string, any]) => {
            prevLayerStatuses.current[layer] = info.status;
          });
        }

        if (data.status === 'completed') {
          setEvalReport(data.eval_report);
          setPhase('complete');
          clearInterval(pollInterval);
          onEvalComplete?.(evalJobId);
          setEvalJobId(null);
        } else if (data.status === 'failed') {
          setError(data.error || "Evaluation failed");
          setPhase('complete');
          clearInterval(pollInterval);
          setEvalJobId(null);
        }
      } catch {}
    }, 1000);
    return () => clearInterval(pollInterval);
  }, [evalJobId]);

  const startEvaluation = async (resultFile: string, genId?: string) => {
    try {
      const evalResponse = await fetch(`${API_BASE}/api/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          result_filename: resultFile,
          evaluator_model: formValues.evaluatorModel,
          generation_id: genId,
        }),
      });
      if (!evalResponse.ok) throw new Error("Failed to start evaluation");
      const evalData = await evalResponse.json();
      if (evalData.success && evalData.job_id) {
        setEvalJobId(evalData.job_id);
      } else throw new Error(evalData.error || "Failed to start evaluation");
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setError(errorMsg);
      setPhase('complete');
    }
  };

  const handleStart = async () => {
    setError(null);
    setIsGenerating(true);
    setProgress(0);
    setPhase("generating");
    setResultFile(null);
    setResultId(null);
    setQaPreview([]);
    setQaPreviewTotal(0);
    try {
      const response = await generateQA({
        model: formValues.model, lang: formValues.lang, samples: formValues.samples,
        prompt_version: formValues.promptVersion,
        ...(currentFilename && { filename: currentFilename }),
        ...(selectedL1 && { hierarchy_l1: selectedL1 }),
        ...(selectedL2 && { hierarchy_l2: selectedL2 }),
        ...(selectedL3 && { hierarchy_l3: selectedL3 }),
      }) as any;
      if (!response.success || !response.job_id) throw new Error(response.error || "Failed to start generation");
      setJobId(response.job_id);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      setError(errorMsg);
      setIsGenerating(false);
      setPhase("complete");
    }
  };

  const handleCancel = () => {
    setIsGenerating(false);
    setPhase("idle");
    setJobId(null);
  };

  const handleReset = () => {
    setPhase("idle");
    setError(null);
    setResultFile(null);
    setResultId(null);
    setEvalReport(null);
    setProgress(0);
    setQaPreview([]);
    setQaPreviewTotal(0);
    setEvalLayers({
      syntax:  { status: "pending", progress: 0, message: "" },
      stats:   { status: "pending", progress: 0, message: "" },
      rag:     { status: "pending", progress: 0, message: "" },
      quality: { status: "pending", progress: 0, message: "" },
    });
    prevLayerStatuses.current = {};
  };

  // Step 상태
  const step1Status: StepStatus = phase === "idle" ? "active" : "done";
  const step2Status: StepStatus =
    phase === "idle" ? "pending" :
    phase === "generating" ? "active" : "done";
  const generationDone = phase === "complete" || phase === "evaluating";
  const evaluationDone = phase === "complete" && !!evalReport;
  const step3Status: StepStatus =
    !generationDone ? "pending" :
    evaluationDone ? "done" : "active";

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
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">생성 모델</label>
              <select value={formValues.model} onChange={e => setFormValues({ ...formValues, model: e.target.value })} disabled={isGenerating} className={selectCls(isGenerating)}>
                <option value="gemini-3.1-flash">Gemini 3.1 Flash</option>
                <option value="claude-sonnet">Claude Sonnet 4.6</option>
                <option value="gpt-5.2">GPT-5.2</option>
              </select>
            </div>

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

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">평가 모델</label>
              <select value={formValues.evaluatorModel} onChange={e => setFormValues({ ...formValues, evaluatorModel: e.target.value })} disabled={isGenerating} className={selectCls(isGenerating)}>
                <option value="gemini-flash">Gemini 2.5 Flash</option>
                <option value="claude-haiku">Claude Haiku 4.5</option>
                <option value="gpt-5.1">GPT-5.1</option>
              </select>
            </div>

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
              <button onClick={loadHierarchyList} disabled={isLoadingHierarchy || isGenerating} className="p-1 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded transition-colors disabled:opacity-50">
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

      {/* ── Step 2: QA 생성 ──────────────────────────────────────────────── */}
      <StepCard
        step={2} title="QA 생성"
        subtitle="설정 기반으로 QA 데이터를 생성합니다."
        icon={<Play className="w-4 h-4" />}
        status={step2Status} isLast={false}
      >
        {phase === "idle" ? (
          /* 대기 */
          <div className="flex items-center gap-4">
            <div className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl">
              <p className="text-xs text-slate-400">Step 1 설정 완료 후 실행 버튼을 눌러 시작하세요.</p>
            </div>
            <button onClick={handleStart} className={cn(btnBase, "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-200")}>
              <Play className="w-4 h-4" /> 생성 시작
            </button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* 에러 */}
            {error && phase !== "evaluating" && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="flex-1 text-sm text-red-700">{error}</p>
                <button onClick={() => setError(null)}><X className="w-4 h-4 text-red-400 hover:text-red-600" /></button>
              </div>
            )}

            {/* 진행 상태 */}
            <div className="flex items-center gap-4">
              <div className="flex-1 space-y-2">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>
                    {phase === "generating"
                      ? (statusMessage || "QA 생성 중...")
                      : "생성 완료"}
                  </span>
                  {phase === "generating" && <span className="text-indigo-600 font-semibold">{progress}%</span>}
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div className={cn(
                    "h-full rounded-full transition-all duration-300",
                    step2Status === "done" ? "bg-emerald-400" : "bg-indigo-500"
                  )} style={{ width: step2Status === "done" ? "100%" : `${progress}%` }} />
                </div>
              </div>
              {isGenerating ? (
                <button onClick={handleCancel} className={cn(btnBase, "bg-red-50 text-red-600 border border-red-200 hover:bg-red-100")}>
                  <X className="w-4 h-4" /> 취소
                </button>
              ) : phase === "complete" && (
                <button onClick={handleReset} className={cn(btnBase, "bg-slate-100 text-slate-600 hover:bg-slate-200")}>
                  <RefreshCw className="w-4 h-4" /> 다시 실행
                </button>
              )}
            </div>

            {/* QA 생성 중 — 로딩 스켈레톤 */}
            {phase === "generating" && (
              <div className="space-y-2.5 animate-pulse">
                {[1, 2, 3].map(i => (
                  <div key={i} className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 space-y-3">
                    <div className="h-2.5 bg-slate-200 rounded w-4/5" />
                    <div className="h-px bg-slate-100" />
                    <div className="flex gap-2">
                      <div className="h-5 w-5 bg-indigo-100 rounded flex-shrink-0" />
                      <div className="h-2.5 bg-slate-200 rounded w-3/4 mt-1" />
                    </div>
                    <div className="flex gap-2">
                      <div className="h-5 w-5 bg-emerald-100 rounded flex-shrink-0" />
                      <div className="space-y-1.5 flex-1 mt-1">
                        <div className="h-2.5 bg-slate-200 rounded w-full" />
                        <div className="h-2.5 bg-slate-200 rounded w-2/3" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* QA Preview 카드 */}
            {step2Status === "done" && qaPreview.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">QA 미리보기</p>
                  <span className="text-xs text-slate-400">
                    총 <span className="font-semibold text-indigo-600">{qaPreviewTotal}개</span> 생성 · 상위 {qaPreview.length}개 표시
                  </span>
                </div>
                <div className="space-y-2.5">
                  {qaPreview.map((item, i) => (
                    <div key={i} className="rounded-xl border border-slate-100 bg-slate-50/60 p-4 space-y-2.5">
                      {/* context */}
                      <p className="text-[11px] text-slate-400 leading-relaxed line-clamp-2 font-mono">
                        {item.context}
                      </p>
                      <div className="h-px bg-slate-100" />
                      {/* Q */}
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 text-[10px] font-bold text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded flex-shrink-0">Q</span>
                        <p className="text-sm text-slate-700 font-medium leading-snug">{item.q}</p>
                      </div>
                      {/* A */}
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded flex-shrink-0">A</span>
                        <p className="text-sm text-slate-600 leading-snug">{item.a}</p>
                      </div>
                      {/* intent */}
                      {item.intent && (
                        <div className="flex justify-end">
                          <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full border", intentColor(item.intent))}>
                            {intentLabel(item.intent)}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </StepCard>

      {/* ── Step 3: QA 평가 ──────────────────────────────────────────────── */}
      <StepCard
        step={3} title="QA 평가"
        subtitle="4-Layer 평가 파이프라인을 실행하고 품질 지표를 확인합니다."
        icon={<BarChart2 className="w-4 h-4" />}
        status={step3Status} isLast={true}
      >
        {/* pending — 생성 전 */}
        {step3Status === "pending" && (
          <div className="px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl">
            <p className="text-xs text-slate-400">
              {formValues.autoEvaluate
                ? "QA 생성 완료 후 자동으로 평가가 시작됩니다."
                : "QA 생성 완료 후 아래에서 평가를 직접 시작할 수 있습니다."}
            </p>
          </div>
        )}

        {/* active / done */}
        {step3Status !== "pending" && (
          <div className="space-y-4">
            {/* 에러 */}
            {error && (phase === "evaluating" || (phase === "complete" && !evalReport)) && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="flex-1 text-sm text-red-700">{error}</p>
                <button onClick={() => setError(null)}><X className="w-4 h-4 text-red-400 hover:text-red-600" /></button>
              </div>
            )}

            {/* 수동 평가 시작 (autoEvaluate=false + 생성 완료) */}
            {phase === "complete" && !evalReport && resultFile && (
              <div className="flex items-center gap-4">
                <div className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <p className="text-xs text-slate-400">QA 생성이 완료되었습니다. 평가를 시작하세요.</p>
                </div>
                <button
                  onClick={() => { setPhase("evaluating"); setProgress(0); startEvaluation(resultFile, resultId ?? undefined); }}
                  className={cn(btnBase, "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-200")}
                >
                  <Play className="w-4 h-4" /> 평가 시작
                </button>
              </div>
            )}

            {/* 전체 프로그레스 (평가 중) */}
            {phase === "evaluating" && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>{statusMessage || "평가 중..."}</span>
                  <span className="text-indigo-600 font-semibold">{progress}%</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div className="h-full rounded-full bg-indigo-500 transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
              </div>
            )}

            {/* 4-Layer 상태 (평가 시작 후에만 표시) */}
            {(phase === "evaluating" || evaluationDone) && <div className="space-y-2.5">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">평가 파이프라인</p>
              {(["syntax", "stats", "rag", "quality"] as const).map(layer => {
                const info = evalLayers[layer];
                const label = {
                  syntax:  "Layer 1-A · Syntax Validation",
                  stats:   "Layer 1-B · Data Statistics",
                  rag:     "Layer 2 · RAG Triad",
                  quality: "Layer 3 · Quality Score",
                }[layer];
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
            </div>}

            {/* 완료 지표 */}
            {step3Status === "done" && evalReport?.summary && (
              <div className="pt-4 border-t border-slate-100 space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> 평가 결과
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {(() => {
                    const s = evalReport.summary;
                    const m = evalReport.metadata ?? {};
                    return [
                      { label: "총 QA",      value: `${m.total_qa ?? '-'}개`,                        ok: null              },
                      { label: "구문 통과율", value: `${s.syntax_pass_rate ?? 0}%`,                   ok: (s.syntax_pass_rate ?? 0) >= 80     },
                      { label: "Dataset",    value: `${s.dataset_quality_score ?? 0}/10`,             ok: (s.dataset_quality_score ?? 0) >= 7 },
                      { label: "RAG 점수",   value: s.rag_average_score?.toFixed(2) ?? '-',           ok: (s.rag_average_score ?? 0) >= 0.7   },
                      { label: "품질 점수",  value: s.quality_average_score?.toFixed(2) ?? '-',       ok: (s.quality_average_score ?? 0) >= 0.7 },
                      { label: "최종 점수",  value: `${((s.final_score ?? 0) * 100).toFixed(1)}/100`, ok: 'highlight' as any },
                    ];
                  })().map(({ label, value, ok }) => (
                    <div key={label} className={cn(
                      "rounded-xl border flex flex-col items-center justify-center py-3 gap-1 cursor-default select-none transition-all",
                      ok === 'highlight' ? "bg-indigo-50 border-indigo-100 hover:bg-indigo-100" :
                      ok === true        ? "bg-white border-emerald-100 hover:bg-emerald-50" :
                      ok === false       ? "bg-white border-amber-100 hover:bg-amber-50" :
                                          "bg-white border-slate-100 hover:bg-slate-50"
                    )}>
                      <p className="text-[10px] text-slate-400 font-medium">{label}</p>
                      <p className={cn("text-sm font-bold",
                        ok === 'highlight' ? "text-indigo-700" :
                        ok === true        ? "text-emerald-700" :
                        ok === false       ? "text-amber-600"  : "text-slate-700"
                      )}>{value}</p>
                    </div>
                  ))}
                </div>

                {onGoToEvaluation && (
                  <div className="flex justify-end pt-1">
                    <button onClick={onGoToEvaluation} className={cn(btnBase, "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-200")}>
                      평가 결과 보기 <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </StepCard>
    </div>
  );
}
