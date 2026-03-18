import React, { useState } from "react";
import { Upload, FileText, CheckCircle2, Loader2, Database, AlertCircle, Sparkles, ChevronRight, ArrowRight, ChevronDown } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { API_BASE, getHierarchyList } from "@/src/lib/api";

interface HierarchyData { l1: string; l2: string; l3: string; }
interface TaggingSample { id: string; content_preview: string; hierarchy: HierarchyData; }
interface AnalysisResult {
  domain_analysis: string;
  l1_candidates: string[];
  suggested_hierarchy: HierarchyData;
  validation: string;
}

export function DataStandardizationPanel({ setActiveTab, onUploadComplete, onTaggingComplete }: {
  setActiveTab?: (tab: string) => void;
  onUploadComplete?: (filename: string) => void;
  onTaggingComplete?: () => void;
}) {
  // --- Upload state ---
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [uploadedFilename, setUploadedFilename] = useState<string | null>(null);

  // --- Hierarchy state ---
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isTagging, setIsTagging] = useState(false);
  const [isAnalyzingSamples, setIsAnalyzingSamples] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [selectedL1s, setSelectedL1s] = useState<string[]>([]);
  const [taggingSamples, setTaggingSamples] = useState<TaggingSample[]>([]);
  const [hierarchyMessage, setHierarchyMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [hierarchyTree, setHierarchyTree] = useState<{ l1_list: string[]; l2_by_l1: Record<string, string[]>; l3_by_l1_l2: Record<string, string[]> } | null>(null);
  const [expandedL1, setExpandedL1] = useState<Record<string, boolean>>({});

  // ── Upload handlers ──────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) setFile(e.target.files[0]);
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
        setUploadMessage({ text: `"${fileName}" 업로드 완료. 백그라운드에서 벡터화 중입니다.`, type: "success" });
        setUploadedFilename(fileName);
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

  // ── Hierarchy handlers ───────────────────────────────────────────
  const handleAnalyze = async () => {
    if (!uploadedFilename) return;
    setIsAnalyzing(true);
    setHierarchyMessage(null);
    setAnalysis(null);
    setTaggingSamples([]);
    try {
      const res = await fetch(`${API_BASE}/api/ingestion/analyze-hierarchy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: uploadedFilename }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "분석 실패");
      const data: AnalysisResult = await res.json();
      setAnalysis(data);
      setSelectedL1s(data.l1_candidates);
      runTagging(uploadedFilename, data.l1_candidates);
    } catch (e: any) {
      setHierarchyMessage({ text: e.message, type: "error" });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const runTagging = async (filename: string, l1s: string[]) => {
    setIsAnalyzingSamples(true);
    setIsTagging(true);
    setHierarchyTree(null);
    try {
      const [samplesRes, taggingRes] = await Promise.all([
        fetch(`${API_BASE}/api/ingestion/analyze-tagging-samples`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, selected_l1_list: l1s }),
        }),
        fetch(`${API_BASE}/api/ingestion/apply-granular-tagging`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, selected_l1_list: l1s }),
        }),
      ]);
      if (samplesRes.ok) {
        const d = await samplesRes.json();
        setTaggingSamples(d.samples || []);
      }
      if (!taggingRes.ok) throw new Error((await taggingRes.json()).detail || "태깅 실패");

      // 태깅 완료 후 계층 트리 조회
      const treeRes = await getHierarchyList(filename);
      if (treeRes.success) {
        setHierarchyTree(treeRes);
        // L1 전체 펼침 (기본값)
        const expanded: Record<string, boolean> = {};
        treeRes.l1_list.forEach((l1: string) => { expanded[l1] = true; });
        setExpandedL1(expanded);
      }
      // 태깅 완료 알림 → QAGenerationPanel hierarchy 재로드 트리거
      onTaggingComplete?.();
    } catch (e: any) {
      setHierarchyMessage({ text: e.message, type: "error" });
    } finally {
      setIsAnalyzingSamples(false);
      setIsTagging(false);
    }
  };

  const toggleL1 = (l1: string) =>
    setSelectedL1s(prev => prev.includes(l1) ? prev.filter(s => s !== l1) : [...prev, l1]);

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* ── Upload Card ───────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Database className="w-5 h-5 text-indigo-500" /> 데이터 규격화 (Standardization)
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Gemini Embedding 2를 사용하여 다양한 문서를 벡터 DB로 정규화합니다.
          </p>
        </div>

        <div className="p-8 space-y-6">
          {/* Dropzone */}
          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">
              문서 업로드 <span className="text-red-500">*</span>
            </label>
            <div
              className={cn(
                "border-2 border-dashed rounded-xl p-10 flex flex-col items-center justify-center transition-all cursor-pointer",
                file ? "border-indigo-400 bg-indigo-50/30" : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50/50"
              )}
              onClick={() => document.getElementById("file-upload")?.click()}
            >
              <input
                type="file"
                id="file-upload"
                className="hidden"
                accept=".pdf,.docx,.doc,.txt,.md"
                onChange={handleFileChange}
              />
              {file ? (
                <FileText className="w-12 h-12 text-indigo-500 mb-3" />
              ) : (
                <Upload className="w-12 h-12 text-slate-300 mb-3" />
              )}
              <span className="text-sm font-medium text-slate-600">
                {file ? file.name : "클릭하여 파일 선택 또는 드래그 앤 드롭"}
              </span>
              <span className="text-xs text-slate-400 mt-1">PDF, Word, TXT, MD (최대 10MB)</span>
              {file && (
                <button
                  onClick={(e) => { e.stopPropagation(); setFile(null); }}
                  className="mt-4 text-xs text-red-500 hover:underline"
                >
                  파일 제거
                </button>
              )}
            </div>
          </div>

          {/* Upload status */}
          {uploadMessage && (
            <div className={cn(
              "p-4 rounded-xl border flex items-start gap-3 animate-in shadow-sm",
              uploadMessage.type === "success" ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-red-50 border-red-100 text-red-800"
            )}>
              {uploadMessage.type === "success" ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              )}
              <p className="text-sm font-medium">{uploadMessage.text}</p>
            </div>
          )}

          {/* Upload button */}
          <button
            onClick={handleUpload}
            disabled={!file || isUploading}
            className={cn(
              "w-full py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95",
              !file || isUploading
                ? "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none"
                : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200"
            )}
          >
            {isUploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Database className="w-5 h-5" />}
            <span>{isUploading ? "데이터 처리 중..." : "데이터 규격화 시작"}</span>
          </button>
        </div>
      </div>

      {/* ── Hierarchy Card (업로드 완료 후 노출) ──────────────────── */}
      {uploadedFilename && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="p-6 border-b border-slate-100 bg-slate-50/50">
            <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-violet-500" /> 컨텍스트 분석 (Hierarchy)
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              LLM이 문서 도메인을 분석하고 L1/L2/L3 계층 구조를 자동으로 태깅합니다.
            </p>
          </div>

          <div className="p-8 space-y-6">
            {/* Filename + Analyze button */}
            <div className="flex items-center gap-3">
              <div className="flex-1 flex items-center gap-2 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl min-w-0">
                <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <span className="text-sm text-slate-600 truncate">{uploadedFilename}</span>
              </div>
              <button
                onClick={handleAnalyze}
                disabled={isAnalyzing || isTagging}
                className={cn(
                  "px-5 py-3 rounded-xl font-semibold text-sm flex items-center gap-2 transition-all shadow-md active:scale-95 whitespace-nowrap",
                  isAnalyzing || isTagging
                    ? "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none"
                    : "bg-violet-600 text-white hover:bg-violet-700 shadow-violet-200"
                )}
              >
                {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                <span>{isAnalyzing ? "분석 중..." : "컨텍스트 분석"}</span>
              </button>
            </div>

            {/* Hierarchy message */}
            {hierarchyMessage && (
              <div className={cn(
                "p-4 rounded-xl border flex items-start gap-3 animate-in shadow-sm",
                hierarchyMessage.type === "success" ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-red-50 border-red-100 text-red-800"
              )}>
                {hierarchyMessage.type === "success" ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                )}
                <p className="text-sm font-medium">{hierarchyMessage.text}</p>
              </div>
            )}

            {/* L1 candidates */}
            {analysis && (
              <div className="space-y-3 animate-in fade-in duration-300">
                <p className="text-sm font-medium text-slate-700">L1 도메인 후보</p>
                <div className="flex flex-wrap gap-2">
                  {analysis.l1_candidates.map(l1 => (
                    <button
                      key={l1}
                      onClick={() => toggleL1(l1)}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                        selectedL1s.includes(l1)
                          ? "bg-violet-100 border-violet-300 text-violet-700"
                          : "bg-slate-50 border-slate-200 text-slate-500 hover:border-violet-200"
                      )}
                    >
                      {l1}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Tagging samples */}
            {(isAnalyzingSamples || taggingSamples.length > 0) && (
              <div className="space-y-3 animate-in fade-in duration-300">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-slate-700">태깅 샘플 미리보기</p>
                  {(isAnalyzingSamples || isTagging) && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />
                  )}
                </div>
                <div className="space-y-2">
                  {taggingSamples.map((s, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <p className="flex-1 text-xs text-slate-600 leading-relaxed line-clamp-2">{s.content_preview}</p>
                      <div className="flex items-center gap-1 flex-shrink-0 text-[10px] font-medium">
                        <span className="px-2 py-0.5 bg-violet-100 text-violet-700 rounded-full">{s.hierarchy.l1}</span>
                        <ChevronRight className="w-3 h-3 text-slate-300" />
                        <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full">{s.hierarchy.l2}</span>
                        <ChevronRight className="w-3 h-3 text-slate-300" />
                        <span className="px-2 py-0.5 bg-sky-100 text-sky-700 rounded-full">{s.hierarchy.l3}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 계층 구조 트리 */}
            {hierarchyTree && hierarchyTree.l1_list.length > 0 && (() => {
              const totalL2 = (Object.values(hierarchyTree.l2_by_l1) as string[][]).reduce((s, arr) => s + arr.length, 0);
              const totalL3 = (Object.values(hierarchyTree.l3_by_l1_l2) as string[][]).reduce((s, arr) => s + arr.length, 0);
              return (
                <div className="space-y-2 animate-in fade-in duration-400">
                  {/* 헤더 */}
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-slate-700">계층 구조</p>
                    <div className="flex items-center gap-1.5 text-[11px] font-medium">
                      <span className="px-2 py-0.5 bg-violet-100 text-violet-600 rounded-full">L1 · {hierarchyTree.l1_list.length}</span>
                      <span className="text-slate-300">·</span>
                      <span className="px-2 py-0.5 bg-indigo-100 text-indigo-600 rounded-full">L2 · {totalL2}</span>
                      <span className="text-slate-300">·</span>
                      <span className="px-2 py-0.5 bg-sky-100 text-sky-600 rounded-full">L3 · {totalL3}</span>
                    </div>
                  </div>

                  {/* 트리 */}
                  <div className="rounded-xl border border-slate-100 bg-white overflow-hidden divide-y divide-slate-50">
                    {hierarchyTree.l1_list.map((l1: string) => {
                      const l2s = hierarchyTree.l2_by_l1[l1] ?? [];
                      const isOpen = expandedL1[l1] ?? true;
                      return (
                        <div key={l1}>
                          {/* L1 행 */}
                          <button
                            onClick={() => setExpandedL1((prev: Record<string, boolean>) => ({ ...prev, [l1]: !isOpen }))}
                            className="w-full flex items-center gap-2.5 px-4 py-2.5 hover:bg-slate-50 transition-colors text-left"
                          >
                            <ChevronDown className={cn("w-3.5 h-3.5 text-slate-300 transition-transform flex-shrink-0", !isOpen && "-rotate-90")} />
                            <span className="w-2 h-2 rounded-full bg-violet-400 flex-shrink-0" />
                            <span className="text-sm font-bold text-slate-800 flex-1">{l1}</span>
                            <span className="text-[11px] text-slate-400">{l2s.length} L2</span>
                          </button>

                          {/* L2 + L3 트리 */}
                          {isOpen && l2s.length > 0 && (
                            <div className="pl-8 pr-4 pb-2 space-y-0">
                              {l2s.map((l2: string, idx: number) => {
                                const l3s = hierarchyTree.l3_by_l1_l2[`${l1}__${l2}`] ?? [];
                                const isLast = idx === l2s.length - 1;
                                return (
                                  <div key={l2} className="relative flex items-start gap-2 py-1.5">
                                    {/* 트리 라인 */}
                                    <div className="flex flex-col items-center flex-shrink-0 w-4 mt-0.5">
                                      <span className="text-slate-300 text-xs leading-none font-mono select-none">
                                        {isLast ? '└' : '├'}
                                      </span>
                                    </div>
                                    {/* L2 이름 + L3 chips */}
                                    <div className="flex-1 flex items-center flex-wrap gap-1.5 min-w-0">
                                      <span className="text-xs font-semibold text-indigo-600 whitespace-nowrap">{l2}</span>
                                      {l3s.map((l3: string) => (
                                        <span
                                          key={l3}
                                          className="px-1.5 py-0.5 text-[10px] bg-sky-50 text-sky-500 border border-sky-100 rounded font-medium whitespace-nowrap"
                                        >
                                          {l3}
                                        </span>
                                      ))}
                                    </div>
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

            {/* 태깅 완료 → QA 생성 이동 버튼 */}
            {!isTagging && !isAnalyzingSamples && taggingSamples.length > 0 && setActiveTab && (
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                <p className="text-xs text-slate-400">계층 태깅이 완료되었습니다. QA 데이터를 생성할 수 있습니다.</p>
                <button
                  onClick={() => setActiveTab("generation")}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-all shadow-sm"
                >
                  QA 생성으로 이동
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Info Card ─────────────────────────────────────────────── */}
      <div className="bg-slate-100/50 p-6 rounded-2xl border border-slate-200/50">
        <h4 className="text-sm font-semibold text-slate-700">💡 파이프라인 가이드</h4>
        <ul className="mt-3 space-y-2 text-xs text-slate-500 list-disc ml-4 leading-relaxed">
          <li>업로드된 파일은 LangChain의 <code className="bg-slate-200 px-1 rounded">RecursiveCharacterTextSplitter</code>를 통해 약 1,000자 단위로 분할됩니다.</li>
          <li>분할된 각 조각은 <strong>Gemini Embedding 2</strong> 모델을 통해 1,536차원 벡터로 변환되어 저장됩니다.</li>
          <li>업로드 완료 후 <strong>AI 분석 실행</strong>을 클릭하면 L1/L2/L3 계층 태깅이 자동으로 적용됩니다.</li>
        </ul>
      </div>
    </div>
  );
}
