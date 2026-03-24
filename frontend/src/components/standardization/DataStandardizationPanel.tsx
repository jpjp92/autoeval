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
  suggested_hierarchy: HierarchyData;
  validation: string;
  anchor_ids?: string[];
}

const anchorKey = (filename: string) => `anchor_ids:${filename}`;
const saveAnchorIds = (filename: string, ids: string[]) =>
  localStorage.setItem(anchorKey(filename), JSON.stringify(ids));
const clearAnchorIds = (filename: string) =>
  localStorage.removeItem(anchorKey(filename));

export function DataStandardizationPanel({ setActiveTab, onUploadComplete, onTaggingComplete }: {
  setActiveTab?: (tab: string) => void;
  onUploadComplete?: (filename: string) => void;
  onTaggingComplete?: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [uploadedFilename, setUploadedFilename] = useState<string | null>(null);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAnalyzingL2L3, setIsAnalyzingL2L3] = useState(false);
  const [isTagging, setIsTagging] = useState(false);
  const [isAnalyzingSamples, setIsAnalyzingSamples] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [selectedH1s, setSelectedH1s] = useState<string[]>([]);
  const [h2h3Master, setH2h3Master] = useState<Record<string, Record<string, string[]>> | null>(null);
  const [taggingSamples, setTaggingSamples] = useState<TaggingSample[]>([]);
  const [hierarchyMessage, setHierarchyMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [hierarchyTree, setHierarchyTree] = useState<{ h1_list: string[]; h2_by_h1: Record<string, string[]>; h3_by_h1_h2: Record<string, string[]> } | null>(null);
  const [expandedH1, setExpandedH1] = useState<Record<string, boolean>>({});
  const [expandedH2, setExpandedH2] = useState<Record<string, boolean>>({});

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
        clearAnchorIds(fileName); // 재업로드 시 기존 anchor_ids 무효화
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
    setH2h3Master(null);
    try {
      // 1단계: H1 master 생성
      const res = await fetchWithRetry(`${API_BASE}/api/ingestion/analyze-hierarchy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: uploadedFilename }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "분석 실패");
      const data: AnalysisResult = await res.json();
      setAnalysis(data);
      setSelectedH1s(data.h1_candidates);
      // anchor_ids localStorage 저장 (재업로드 전까지 유지)
      if (data.anchor_ids?.length) {
        saveAnchorIds(uploadedFilename, data.anchor_ids);
      }
      setIsAnalyzing(false);

      // 2단계: H2/H3 master 생성 (anchor_ids 재전달)
      setIsAnalyzingL2L3(true);
      const h2h3Res = await fetchWithRetry(`${API_BASE}/api/ingestion/analyze-h2-h3`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: uploadedFilename,
          selected_h1_list: data.h1_candidates,
          anchor_ids: data.anchor_ids ?? [],
        }),
      });
      if (!h2h3Res.ok) throw new Error((await h2h3Res.json()).detail || "H2/H3 분석 실패");
      const h2h3Data = await h2h3Res.json();
      const master = h2h3Data.h2_h3_master;
      setH2h3Master(master);
      setIsAnalyzingL2L3(false);

      // 3단계: 태깅 적용
      runTagging(uploadedFilename, data.h1_candidates, master);
    } catch (e: any) {
      setHierarchyMessage({ text: e.message, type: "error" });
      setIsAnalyzing(false);
      setIsAnalyzingL2L3(false);
    }
  };

  const runTagging = async (filename: string, h1s: string[], master: Record<string, Record<string, string[]>>) => {
    setIsAnalyzingSamples(true);
    setIsTagging(true);
    setHierarchyTree(null);
    try {
      const [samplesRes, taggingRes] = await Promise.all([
        fetch(`${API_BASE}/api/ingestion/analyze-tagging-samples`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, selected_h1_list: h1s, h2_h3_master: master }),
        }),
        fetch(`${API_BASE}/api/ingestion/apply-granular-tagging`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, selected_h1_list: h1s, h2_h3_master: master }),
        }),
      ]);
      if (samplesRes.ok) {
        const d = await samplesRes.json();
        setTaggingSamples(d.samples || []);
      }
      if (!taggingRes.ok) throw new Error((await taggingRes.json()).detail || "태깅 실패");
      const treeRes = await getHierarchyList(filename);
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
      }
      onTaggingComplete?.();
    } catch (e: any) {
      setHierarchyMessage({ text: e.message, type: "error" });
    } finally {
      setIsAnalyzingSamples(false);
      setIsTagging(false);
    }
  };

  const toggleH1 = (h1: string) =>
    setSelectedH1s(prev => prev.includes(h1) ? prev.filter(s => s !== h1) : [...prev, h1]);

  const uploadDone = !!uploadedFilename && uploadMessage?.type === "success";
  const hierarchyDone = !isTagging && !isAnalyzingSamples && taggingSamples.length > 0;

  return (
    <div className="max-w-4xl mx-auto space-y-0">

      {/* ── Step 1: 문서 업로드 ─────────────────────────────────────── */}
      <StepCard
        step={1}
        title="문서 업로드"
        subtitle="PDF, DOCX 파일을 업로드하면 Gemini Embedding 2로 벡터화합니다."
        icon={<Database className="w-4 h-4" />}
        status={uploadDone ? "done" : "active"}
        isLast={false}
      >
        {uploadDone ? (
          /* 완료 상태 — 파일명 표시 */
          <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-100 rounded-xl">
            <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-emerald-800 truncate">{uploadedFilename}</p>
              <p className="text-xs text-emerald-600 mt-0.5">벡터화 완료 · 다음 단계를 진행하세요</p>
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
                file
                  ? "border-indigo-400 bg-indigo-50/40"
                  : "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/20"
              )}
              onClick={() => document.getElementById("file-upload")?.click()}
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
                  <div className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center mb-3">
                    <Upload className="w-5 h-5 text-slate-400" />
                  </div>
                  <p className="text-sm font-medium text-slate-600">클릭하여 파일 선택 또는 드래그 앤 드롭</p>
                  <p className="text-xs text-slate-400 mt-1">PDF, DOCX · 최대 10MB</p>
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
                  ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                  : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-200 active:scale-[0.99]"
              )}
            >
              {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              {isUploading ? "업로드 중..." : "업로드 및 벡터화"}
            </button>
          </div>
        )}
      </StepCard>

      {/* ── Step 2: 컨텍스트 분석 ───────────────────────────────────── */}
      <StepCard
        step={2}
        title="컨텍스트 분석"
        subtitle="LLM이 문서를 분석해 H1/H2/H3 계층 구조를 자동으로 태깅합니다."
        icon={<Sparkles className="w-4 h-4" />}
        status={!uploadDone ? "pending" : hierarchyDone ? "done" : "active"}
        isLast={true}
      >
        {!uploadDone ? (
          <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-slate-300" />
            </div>
            <p className="text-sm text-slate-400">Step 1 완료 후 활성화됩니다.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 파일명 + 분석 버튼 */}
            <div className="flex items-center gap-3">
              <div className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl min-w-0">
                <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                <span className="text-sm text-slate-600 truncate">{uploadedFilename}</span>
              </div>
              <button
                onClick={handleAnalyze}
                disabled={isAnalyzing || isAnalyzingL2L3 || isTagging}
                className={cn(
                  "min-w-[168px] px-4 py-2.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all whitespace-nowrap flex-shrink-0",
                  isAnalyzing || isAnalyzingL2L3 || isTagging
                    ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                    : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-200 active:scale-[0.99]"
                )}
              >
                {(isAnalyzing || isAnalyzingL2L3 || isTagging) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {isAnalyzing ? "H1 분석 중..." : isAnalyzingL2L3 ? "H2/H3 생성 중..." : isTagging ? "태깅 중..." : "컨텍스트 분석"}
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
            {(isAnalyzing || isAnalyzingL2L3 || isTagging) && (
              <div className="flex items-center gap-3 px-4 py-3 bg-indigo-50 border border-indigo-100 rounded-xl">
                <Loader2 className="w-4 h-4 animate-spin text-indigo-500 flex-shrink-0" />
                <p className="text-sm text-indigo-700">
                  {isAnalyzing ? "1단계: H1 도메인 분석 중..." : isAnalyzingL2L3 ? "2단계: H2/H3 분류 체계 생성 중..." : "3단계: 청크 태깅 적용 중..."}
                </p>
              </div>
            )}

            {/* H1 후보 */}
            {analysis && (
              <div className="space-y-2 animate-in fade-in duration-300">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">H1 도메인 후보</p>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.h1_candidates.map(h1 => (
                    <button
                      key={h1}
                      onClick={() => toggleH1(h1)}
                      className={cn(
                        "px-3 py-1 rounded-full text-xs font-medium border transition-all",
                        selectedH1s.includes(h1)
                          ? "bg-indigo-100 border-indigo-300 text-indigo-700"
                          : "bg-slate-50 border-slate-200 text-slate-500 hover:border-indigo-200"
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
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">태깅 샘플 미리보기</p>
                <div className="space-y-1.5">
                  {taggingSamples.map((s, i) => (
                    <div key={i} className="flex items-start gap-3 px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-lg">
                      <p className="flex-1 text-xs text-slate-600 leading-relaxed line-clamp-2 min-w-0">{s.content_preview}</p>
                      <div className="flex items-center gap-1 flex-shrink-0 text-[10px] font-medium">
                        <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded">{s.hierarchy.h1}</span>
                        <ChevronRight className="w-3 h-3 text-slate-300" />
                        <span className="px-1.5 py-0.5 bg-sky-100 text-sky-700 rounded">{s.hierarchy.h2}</span>
                        <ChevronRight className="w-3 h-3 text-slate-300" />
                        <span className="px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded">{s.hierarchy.h3}</span>
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
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">계층 구조</p>
                    <div className="flex items-center gap-1.5 text-[11px] font-medium">
                      <span className="px-2.5 py-0.5 bg-violet-50 text-violet-600 border border-violet-200 rounded-full">H1 · {hierarchyTree.h1_list.length}</span>
                      <span className="px-2.5 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-200 rounded-full">H2 · {totalH2}</span>
                      <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-full">H3 · {totalH3}</span>
                    </div>
                  </div>

                  {/* 트리 */}
                  <div className="rounded-xl border border-slate-100 bg-white overflow-hidden">
                    {hierarchyTree.h1_list.map((h1: string, h1Idx: number) => {
                      const h2s = hierarchyTree.h2_by_h1[h1] ?? [];
                      const isH1Open = expandedH1[h1] ?? true;
                      const dotColor = H1_DOT_COLORS[h1Idx % H1_DOT_COLORS.length];

                      return (
                        <div key={h1}>
                          {h1Idx > 0 && <div className="h-px bg-slate-50 mx-4" />}

                          {/* H1 행 */}
                          <button
                            onClick={() => setExpandedH1(prev => ({ ...prev, [h1]: !isH1Open }))}
                            className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-slate-50/80 transition-colors text-left"
                          >
                            <ChevronRight className={cn("w-3.5 h-3.5 text-slate-300 transition-transform flex-shrink-0", isH1Open && "rotate-90")} />
                            <span className={cn("w-2 h-2 rounded-full flex-shrink-0", dotColor)} />
                            <span className="text-sm font-semibold text-slate-800 flex-1">{h1}</span>
                            <span className="text-[11px] text-slate-400 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">{h2s.length} H2</span>
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
                                        h3s.length > 0 ? "hover:bg-indigo-50/60 cursor-pointer" : "cursor-default"
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
                                          <div key={h3} className="relative flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-emerald-50/50 transition-colors">
                                            {/* H3 가로 브랜치 */}
                                            <div className="absolute left-[-14px] top-1/2 -translate-y-1/2 w-3 h-px bg-emerald-200" />
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                                            <span className="text-xs text-emerald-700">{h3}</span>
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
              <div className="pt-4 border-t border-slate-100 flex items-center justify-between animate-in fade-in duration-300">
                <p className="text-xs text-slate-400">계층 태깅이 완료되었습니다.</p>
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
            ? "bg-white border-indigo-500 text-indigo-600"
            : "bg-white border-slate-200 text-slate-400"
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
        "flex-1 bg-white/80 backdrop-blur-sm rounded-2xl border shadow-lg shadow-slate-200/40 overflow-hidden mb-4 transition-all",
        status === "pending" ? "border-white/60 opacity-60" : "border-white/60"
      )}>
        {/* 헤더 */}
        <div className={cn(
          "px-6 py-4 border-b flex items-center gap-3",
          status === "active" ? "border-slate-100 bg-slate-50/50" : "border-slate-100 bg-slate-50/30"
        )}>
          <div className={cn(
            "w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0",
            status === "done" ? "bg-indigo-100 text-indigo-600" : status === "active" ? "bg-indigo-100 text-indigo-500" : "bg-slate-100 text-slate-400"
          )}>
            {icon}
          </div>
          <div>
            <h3 className={cn(
              "text-sm font-semibold",
              status === "pending" ? "text-slate-400" : "text-slate-800"
            )}>{title}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
          </div>
          {status === "done" && (
            <span className="ml-auto px-2 py-0.5 bg-emerald-100 text-emerald-700 text-[11px] font-semibold rounded-full">완료</span>
          )}
        </div>

        {/* 본문 */}
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
