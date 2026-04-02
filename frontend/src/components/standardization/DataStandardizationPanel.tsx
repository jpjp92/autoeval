import React, { useState } from "react";
import { Upload, FileText, CheckCircle2, Loader2, Database, AlertCircle, Sparkles, ChevronRight, ArrowRight, Check } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { API_BASE, getHierarchyList } from "@/src/lib/api";

/** Cold start 대비 재시도 fetch (최대 3회, 5초 간격) */
async function fetchWithRetry(url: string, options: RequestInit, retries = 3, delayMs = 5000): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error("fetch failed");
}

interface HierarchyData { h1: string; h2: string; h3: string; }
interface TaggingSample { id: string; content_preview: string; hierarchy: HierarchyData; }
interface AnalysisResult {
  domain_analysis: string;
  h1_candidates: string[];
  h2_h3_master: Record<string, Record<string, string[]>>;
  document_id?: string;
}

const docIdKey  = (filename: string) => `document_id:${filename}`;
const saveDocumentId = (filename: string, id: string) =>
  localStorage.setItem(docIdKey(filename), id);
const clearDocumentId = (filename: string) => {
  localStorage.removeItem(docIdKey(filename));
};

export function DataStandardizationPanel({ setActiveTab, onUploadComplete, onTaggingComplete }: {
  setActiveTab?: (tab: string) => void;
  onUploadComplete?: (filename: string) => void;
  onTaggingComplete?: (treeData: { h1_list: string[]; h2_by_h1: Record<string, string[]>; h3_by_h1_h2: Record<string, string[]> }) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [uploadedFilename, setUploadedFilename] = useState<string | null>(null);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isTagging, setIsTagging] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [selectedH1s, setSelectedH1s] = useState<string[]>([]);
  const [taggingSamples, setTaggingSamples] = useState<TaggingSample[]>([]);
  const [hierarchyMessage, setHierarchyMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [hierarchyTree, setHierarchyTree] = useState<{ h1_list: string[]; h2_by_h1: Record<string, string[]>; h3_by_h1_h2: Record<string, string[]> } | null>(null);
  const [expandedH1, setExpandedH1] = useState<Record<string, boolean>>({});
  const [expandedH2, setExpandedH2] = useState<Record<string, boolean>>({});

  const validateAndSetFile = (selectedFile: File) => {
    if (selectedFile.size > 100 * 1024 * 1024) {
      setUploadMessage({ text: "파일 크기는 100MB를 초과할 수 없습니다.", type: "error" });
      setFile(null);
      return;
    }
    setUploadMessage(null);
    setFile(selectedFile);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) validateAndSetFile(e.target.files[0]);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.[0]) validateAndSetFile(e.dataTransfer.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return;
    setIsUploading(true);
    setUploadMessage(null);
    const formData = new FormData();
    formData.append("file", file);
    const fileName = file.name;
    try {
      const res = await fetch(`${API_BASE}/api/ingestion/upload`, { method: "POST", body: formData });
      const data = await res.json();
      if (res.ok) {
        setUploadMessage({ text: `"${fileName}" 분석이 완료되었습니다.`, type: "success" });
        setUploadedFilename(fileName);
        clearDocumentId(fileName); // 재업로드 시 기존 document_id 무효화
        onUploadComplete?.(fileName);
        setFile(null);
      } else {
        setUploadMessage({ text: data.detail || "업로드 실패", type: "error" });
      }
    } catch {
      setUploadMessage({ text: "서버 연결에 실패했습니다.", type: "error" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleAnalyze = async () => {
    if (!uploadedFilename) return;
    setIsAnalyzing(true);
    setHierarchyMessage(null);
    setAnalysis(null);
    setTaggingSamples([]);
    setHierarchyTree(null);
    try {
      // 1단계: H1/H2/H3 master 한 번에 생성
      const res = await fetchWithRetry(`${API_BASE}/api/ingestion/analyze-hierarchy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: uploadedFilename }),
      });
      if (!res.ok) {
        const errData = await res.json();
        const detail = errData.detail || "";
        const isOverloaded = res.status === 503 || detail.includes("503") || detail.toLowerCase().includes("unavailable") || detail.toLowerCase().includes("high demand");
        throw new Error(isOverloaded
          ? "현재 일시적으로 응답이 지연됩니다. 잠시 후 다시 시도해 주세요."
          : detail || "분석 중 오류가 발생했습니다. 다시 시도해 주세요."
        );
      }
      const data: AnalysisResult = await res.json();
      setAnalysis(data);
      setSelectedH1s(data.h1_candidates);
      if (data.document_id) {
        saveDocumentId(uploadedFilename, data.document_id);
      }
      setIsAnalyzing(false);

      // 2단계: 청크 태깅 (document_id 기반 — 현재 업로드 버전만 태깅)
      setIsTagging(true);
      const taggingRes = await fetch(`${API_BASE}/api/ingestion/apply-granular-tagging`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: uploadedFilename,
          selected_h1_list: data.h1_candidates,
          h2_h3_master: data.h2_h3_master,
          document_id: data.document_id,
        }),
      });
      if (!taggingRes.ok) throw new Error((await taggingRes.json()).detail || "카테고리 적용 실패");
      const taggingData = await taggingRes.json();
      setTaggingSamples(taggingData.samples || []);

      const treeRes = await getHierarchyList(uploadedFilename);
      if (treeRes.success) {
        setHierarchyTree(treeRes);
        const expandedH1Init: Record<string, boolean> = {};
        const expandedH2Init: Record<string, boolean> = {};
        treeRes.h1_list.forEach((h1: string) => {
          expandedH1Init[h1] = true;
          (treeRes.h2_by_h1[h1] ?? []).forEach((h2: string) => {
            expandedH2Init[`${h1}__${h2}`] = false;
          });
        });
        setExpandedH1(expandedH1Init);
        setExpandedH2(expandedH2Init);
        onTaggingComplete?.(treeRes);
      } else {
        onTaggingComplete?.({ h1_list: [], h2_by_h1: {}, h3_by_h1_h2: {} });
      }
    } catch (e: any) {
      setHierarchyMessage({ text: e.message, type: "error" });
      setIsAnalyzing(false);
    } finally {
      setIsTagging(false);
    }
  };

  const toggleH1 = (h1: string) =>
    setSelectedH1s(prev => prev.includes(h1) ? prev.filter(s => s !== h1) : [...prev, h1]);

  const uploadDone = !!uploadedFilename && uploadMessage?.type === "success";
  const hierarchyDone = !isAnalyzing && !isTagging && taggingSamples.length > 0;

  return (
    <div className="max-w-4xl mx-auto space-y-0">

      {/* ── Step 1: 문서 업로드 ─────────────────────────────────────── */}
      <StepCard
        step={1}
        title="문서 업로드"
        subtitle="PDF 또는 DOCX 문서를 업로드하면 문맥을 파악해 의미 단위로 나누어 저장합니다."
        icon={<Database className="w-4 h-4" />}
        status={uploadDone ? "done" : "active"}
        isLast={false}
      >
        {uploadDone ? (
          /* 완료 상태 — 파일명 표시 */
          <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 rounded-xl">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-emerald-800 dark:text-emerald-400 truncate">{uploadedFilename}</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-500 mt-0.5">분석 완료 · 다음 단계로 이동하세요</p>
            </div>
            <button
              onClick={() => { setUploadedFilename(null); setUploadMessage(null); setAnalysis(null); setTaggingSamples([]); setHierarchyTree(null); }}
              className="text-xs text-emerald-600 hover:text-emerald-800 underline underline-offset-2 flex-shrink-0"
            >
              변경
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Dropzone */}
            <div
              className={cn(
                "border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center cursor-pointer transition-all",
                isDragging
                  ? "border-indigo-500 bg-indigo-50/80 dark:bg-indigo-500/20 shadow-[inset_0_0_20px_rgba(99,102,241,0.1)] scale-[1.01]"
                  : file
                    ? "border-indigo-400 bg-indigo-50/40 dark:bg-indigo-500/10"
                    : "border-slate-200 dark:border-white/10 hover:border-indigo-300 hover:bg-indigo-50/20 dark:hover:border-indigo-500/40 dark:hover:bg-indigo-500/5"
              )}
              onClick={() => document.getElementById("file-upload")?.click()}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                type="file" id="file-upload" className="hidden"
                accept=".pdf,.docx,.doc,.txt,.md"
                onChange={handleFileChange}
              />
              {file ? (
                <>
                  <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center mb-3">
                    <FileText className="w-5 h-5 text-indigo-600" />
                  </div>
                  <p className="text-sm font-semibold text-indigo-700">{file.name}</p>
                  <p className="text-xs text-indigo-400 mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  <button
                    onClick={e => { e.stopPropagation(); setFile(null); }}
                    className="mt-3 text-xs text-red-400 hover:text-red-600 hover:underline"
                  >파일 제거</button>
                </>
              ) : (
                <>
                  <div className="w-10 h-10 bg-slate-100 dark:bg-white/10 rounded-xl flex items-center justify-center mb-3">
                    <Upload className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                  </div>
                  <p className="text-sm font-medium text-slate-600 dark:text-slate-300">클릭하여 파일 선택 또는 드래그 앤 드롭</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">PDF, DOCX · 최대 100MB</p>
                </>
              )}
            </div>

            {/* Error message */}
            {uploadMessage?.type === "error" && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{uploadMessage.text}</p>
              </div>
            )}

            <button
              onClick={handleUpload}
              disabled={!file || isUploading}
              className={cn(
                "w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all",
                !file || isUploading
                  ? "bg-slate-100 dark:bg-white/8 text-slate-400 dark:text-slate-500 cursor-not-allowed"
                  : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-200 active:scale-[0.99]"
              )}
            >
              {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              {isUploading ? (
                <span className="inline-flex items-baseline gap-[1px]">
                  문서 분석 중&nbsp;
                  <span className="inline-block animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
                  <span className="inline-block animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
                  <span className="inline-block animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
                </span>
              ) : "문서 업로드"}
            </button>
          </div>
        )}
      </StepCard>

      {/* ── Step 2: 컨텍스트 분석 ───────────────────────────────────── */}
      <StepCard
        step={2}
        title="컨텍스트 분석"
        subtitle="문서의 목차와 구조를 분석해 카테고리를 자동으로 분류합니다."
        icon={<Sparkles className="w-4 h-4" />}
        status={!uploadDone ? "pending" : hierarchyDone ? "done" : "active"}
        isLast={true}
      >
        {!uploadDone ? (
          <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/8 rounded-xl">
            <div className="w-8 h-8 bg-slate-100 dark:bg-white/8 rounded-lg flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-slate-300 dark:text-slate-600" />
            </div>
            <p className="text-sm text-slate-400 dark:text-slate-500">Step 1 완료 후 활성화됩니다.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 파일명 + 분석 버튼 */}
            <div className="flex items-center gap-3">
              <div className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/8 rounded-xl min-w-0">
                <FileText className="w-4 h-4 text-slate-400 dark:text-slate-500 flex-shrink-0" />
                <span className="text-sm text-slate-600 dark:text-slate-300 truncate">{uploadedFilename}</span>
              </div>
              <button
                onClick={handleAnalyze}
                disabled={isAnalyzing || isTagging}
                className={cn(
                  "min-w-[168px] px-4 py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all whitespace-nowrap flex-shrink-0",
                  isAnalyzing || isTagging
                    ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                    : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-200 active:scale-[0.99]"
                )}
              >
                {(isAnalyzing || isTagging) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {isAnalyzing ? <span className="inline-flex items-baseline gap-[1px]">카테고리 분류 중&nbsp;<span className="inline-block animate-bounce" style={{ animationDelay: "0ms" }}>.</span><span className="inline-block animate-bounce" style={{ animationDelay: "150ms" }}>.</span><span className="inline-block animate-bounce" style={{ animationDelay: "300ms" }}>.</span></span> : isTagging ? <span className="inline-flex items-baseline gap-[1px]">카테고리 적용 중&nbsp;<span className="inline-block animate-bounce" style={{ animationDelay: "0ms" }}>.</span><span className="inline-block animate-bounce" style={{ animationDelay: "150ms" }}>.</span><span className="inline-block animate-bounce" style={{ animationDelay: "300ms" }}>.</span></span> : "컨텍스트 분석"}
              </button>
            </div>

            {/* 에러 */}
            {hierarchyMessage?.type === "error" && (
              <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-100 rounded-xl">
                <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm text-red-700">{hierarchyMessage.text}</p>
              </div>
            )}

            {/* 진행 중 상태 */}
            {(isAnalyzing || isTagging) && (
              <div className="flex items-center gap-3 px-4 py-3 bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-100 dark:border-indigo-500/20 rounded-xl">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-500 flex-shrink-0" />
                <p className="text-sm text-indigo-700 dark:text-indigo-400 inline-flex items-baseline">
                  {isAnalyzing
                    ? <span className="inline-flex items-baseline gap-[1px]">문서 구조를 분석하고 카테고리를 분류하는 중입니다&nbsp;<span className="inline-block animate-bounce" style={{ animationDelay: "0ms" }}>.</span><span className="inline-block animate-bounce" style={{ animationDelay: "150ms" }}>.</span><span className="inline-block animate-bounce" style={{ animationDelay: "300ms" }}>.</span></span>
                    : <span className="inline-flex items-baseline gap-[1px]">분류된 카테고리를 문서에 적용하는 중입니다&nbsp;<span className="inline-block animate-bounce" style={{ animationDelay: "0ms" }}>.</span><span className="inline-block animate-bounce" style={{ animationDelay: "150ms" }}>.</span><span className="inline-block animate-bounce" style={{ animationDelay: "300ms" }}>.</span></span>}
                </p>
              </div>
            )}

            {/* H1 후보 */}
            {analysis && (
              <div className="space-y-2 animate-in fade-in duration-300">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">대분류 후보</p>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.h1_candidates.map(h1 => (
                    <button
                      key={h1}
                      onClick={() => toggleH1(h1)}
                      className={cn(
                        "px-3 py-1 rounded-full text-xs font-medium border transition-all",
                        selectedH1s.includes(h1)
                          ? "bg-indigo-100 dark:bg-indigo-500/20 border-indigo-300 dark:border-indigo-500/40 text-indigo-700 dark:text-indigo-300"
                          : "bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-indigo-200 dark:hover:border-indigo-500/30"
                      )}
                    >
                      {h1}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 태깅 샘플 미리보기 */}
            {taggingSamples.length > 0 && (
              <div className="space-y-2 animate-in fade-in duration-300">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">분류 결과 미리보기</p>
                <div className="space-y-1.5">
                  {(() => {
                    const seen = new Set<string>();
                    const picked: typeof taggingSamples = [];
                    for (const s of taggingSamples) {
                      if (picked.length >= 3) break;
                      if (!seen.has(s.hierarchy.h1)) { seen.add(s.hierarchy.h1); picked.push(s); }
                    }
                    for (const s of taggingSamples) {
                      if (picked.length >= 3) break;
                      if (!picked.includes(s)) picked.push(s);
                    }
                    return picked;
                  })().map((s, i) => (
                    <div key={i} className="flex items-start gap-3 px-3 py-2.5 bg-slate-50 dark:bg-white/5 border border-slate-100 dark:border-white/8 rounded-lg">
                      <p className="flex-1 text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-2 min-w-0">{s.content_preview}</p>
                      <div className="flex items-center gap-1 flex-shrink-0 text-[10px] font-medium">
                        <span className="px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 rounded">{s.hierarchy.h1}</span>
                        <ChevronRight className="w-3 h-3 text-slate-300 dark:text-slate-600" />
                        <span className="px-1.5 py-0.5 bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-300 rounded">{s.hierarchy.h2}</span>
                        <ChevronRight className="w-3 h-3 text-slate-300 dark:text-slate-600" />
                        <span className="px-1.5 py-0.5 bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300 rounded">{s.hierarchy.h3}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 계층 트리 */}
            {hierarchyTree && hierarchyTree.h1_list.length > 0 && (() => {
              const totalH2 = (Object.values(hierarchyTree.h2_by_h1) as string[][]).reduce((s, arr) => s + arr.length, 0);
              const totalH3 = (Object.values(hierarchyTree.h3_by_h1_h2) as string[][]).reduce((s, arr) => s + arr.length, 0);
              const H1_DOT_COLORS = ["bg-violet-400", "bg-blue-400", "bg-emerald-500", "bg-amber-400"];
              return (
                <div className="space-y-2 animate-in fade-in duration-400">
                  {/* 헤더: 제목 + 레벨 칩 */}
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">카테고리 구조</p>
                    <div className="flex items-center gap-1.5 text-[11px] font-medium">
                      <span className="px-2.5 py-0.5 bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-200 dark:border-violet-500/30 rounded-full">H1 · {hierarchyTree.h1_list.length}</span>
                      <span className="px-2.5 py-0.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30 rounded-full">H2 · {totalH2}</span>
                      <span className="px-2.5 py-0.5 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-500/30 rounded-full">H3 · {totalH3}</span>
                    </div>
                  </div>

                  {/* 트리 */}
                  <div className="rounded-xl border border-slate-100 dark:border-white/8 bg-white dark:bg-white/5 overflow-hidden">
                    {hierarchyTree.h1_list.map((h1: string, h1Idx: number) => {
                      const h2s = hierarchyTree.h2_by_h1[h1] ?? [];
                      const isH1Open = expandedH1[h1] ?? true;
                      const dotColor = H1_DOT_COLORS[h1Idx % H1_DOT_COLORS.length];

                      return (
                        <div key={h1}>
                          {h1Idx > 0 && <div className="h-px bg-slate-50 dark:bg-white/5 mx-4" />}

                          {/* H1 행 */}
                          <button
                            onClick={() => setExpandedH1(prev => ({ ...prev, [h1]: !isH1Open }))}
                            className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-slate-50/80 dark:hover:bg-white/5 transition-colors text-left"
                          >
                            <ChevronRight className={cn("w-3.5 h-3.5 text-slate-300 dark:text-slate-600 transition-transform flex-shrink-0", isH1Open && "rotate-90")} />
                            <span className={cn("w-2 h-2 rounded-full flex-shrink-0", dotColor)} />
                            <span className="text-sm font-semibold text-slate-800 dark:text-slate-100 flex-1">{h1}</span>
                            <span className="text-[11px] text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-white/8 border border-slate-200 dark:border-white/10 px-2 py-0.5 rounded-full">{h2s.length} H2</span>
                          </button>

                          {/* H2 목록 */}
                          {isH1Open && h2s.length > 0 && (
                            <div className="relative pl-10 pr-4 pb-2">
                              {/* H1 세로 가이드라인 */}
                              <div className="absolute left-[21px] top-0 bottom-6 w-px bg-violet-200" />

                              {h2s.map((h2: string) => {
                                const h3Key = `${h1}__${h2}`;
                                const h3s = hierarchyTree.h3_by_h1_h2[h3Key] ?? [];
                                const isH2Open = expandedH2[h3Key] ?? false;

                                return (
                                  <div key={h2} className="relative mb-0.5">
                                    {/* H2 가로 브랜치 */}
                                    <div className="absolute left-[-13px] top-[18px] w-3 h-px bg-violet-200" />

                                    {/* H2 행 */}
                                    <button
                                      onClick={() => h3s.length > 0 && setExpandedH2((prev: Record<string, boolean>) => ({ ...prev, [h3Key]: !isH2Open }))}
                                      className={cn(
                                        "w-full flex items-center gap-2 py-2 px-2.5 rounded-lg transition-colors text-left",
                                        h3s.length > 0 ? "hover:bg-indigo-50/60 dark:hover:bg-indigo-500/10 cursor-pointer" : "cursor-default"
                                      )}
                                    >
                                      <ChevronRight className={cn(
                                        "w-3 h-3 flex-shrink-0 transition-transform",
                                        h3s.length > 0 ? "text-slate-300" : "text-transparent",
                                        isH2Open && "rotate-90"
                                      )} />
                                      <span className="text-sm text-indigo-600 flex-1">{h2}</span>
                                      {h3s.length > 0 && (
                                        <span className="text-[10px] text-slate-400">{h3s.length} H3</span>
                                      )}
                                    </button>

                                    {/* H3 목록 */}
                                    {isH2Open && h3s.length > 0 && (
                                      <div className="relative pl-6 mb-1">
                                        {/* H2 세로 가이드라인 */}
                                        <div className="absolute left-[10px] top-0 bottom-4 w-px bg-emerald-200" />

                                        {h3s.map((h3: string) => (
                                          <div key={h3} className="relative flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-emerald-50/50 dark:hover:bg-emerald-500/10 transition-colors">
                                            {/* H3 가로 브랜치 */}
                                            <div className="absolute left-[-14px] top-1/2 -translate-y-1/2 w-3 h-px bg-emerald-200 dark:bg-emerald-500/30" />
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                                            <span className="text-xs text-emerald-700 dark:text-emerald-400">{h3}</span>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* QA 생성 이동 */}
            {hierarchyDone && setActiveTab && (
              <div className="pt-4 border-t border-slate-100 dark:border-white/8 flex items-center justify-between animate-in fade-in duration-300">
                <p className="text-xs text-slate-400 dark:text-slate-500">계층 태깅이 완료되었습니다.</p>
                <button
                  onClick={() => setActiveTab("generation")}
                  className="min-w-[168px] flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-all shadow-sm active:scale-[0.99]"
                >
                  QA 생성으로 이동
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}
      </StepCard>
    </div>
  );
}

/* ── StepCard 공통 컴포넌트 ───────────────────────────────────── */
type StepStatus = "pending" | "active" | "done";

function StepCard({
  step, title, subtitle, icon, status, isLast, children,
}: {
  step: number; title: string; subtitle: string;
  icon: React.ReactNode; status: StepStatus; isLast: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-0">
      {/* 왼쪽: 스텝 번호 + 연결선 */}
      <div className="flex flex-col items-center pt-6 mr-5">
        {/* 스텝 원 */}
        <div className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 border-2 transition-all",
          status === "done"
            ? "bg-indigo-600 border-indigo-600 text-white"
            : status === "active"
            ? "bg-white dark:bg-slate-800 border-indigo-500 text-indigo-600"
            : "bg-white dark:bg-slate-800 border-slate-200 dark:border-white/15 text-slate-400 dark:text-slate-500"
        )}>
          {status === "done" ? <Check className="w-4 h-4" /> : step}
        </div>
        {/* 연결선 */}
        {!isLast && (
          <div className={cn(
            "w-0.5 flex-1 mt-2 mb-0 min-h-[2rem]",
            status === "done" ? "bg-indigo-200" : "bg-slate-100"
          )} />
        )}
      </div>

      {/* 오른쪽: 카드 */}
      <div className={cn(
        "flex-1 bg-white/80 dark:bg-white/5 backdrop-blur-sm rounded-2xl border shadow-lg shadow-slate-200/40 dark:shadow-black/20 overflow-hidden mb-4 transition-all",
        status === "pending" ? "border-white/60 dark:border-white/5 opacity-60" : "border-white/60 dark:border-white/8"
      )}>
        {/* 헤더 */}
        <div className={cn(
          "px-6 py-4 border-b flex items-center gap-3",
          status === "active"
            ? "border-slate-100 dark:border-white/8 bg-slate-50/50 dark:bg-white/5"
            : "border-slate-100 dark:border-white/8 bg-slate-50/30 dark:bg-white/3"
        )}>
          <div className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
            status === "done" ? "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400"
            : status === "active" ? "bg-indigo-100 dark:bg-indigo-500/20 text-indigo-500"
            : "bg-slate-100 dark:bg-white/8 text-slate-400 dark:text-slate-500"
          )}>
            {icon}
          </div>
          <div>
            <h3 className={cn(
              "text-sm font-semibold",
              status === "pending" ? "text-slate-400 dark:text-slate-500" : "text-slate-800 dark:text-slate-100"
            )}>{title}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>
          </div>
          {status === "done" && (
            <span className="ml-auto px-2 py-0.5 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[11px] font-semibold rounded-full">완료</span>
          )}
        </div>

        {/* 본문 */}
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
