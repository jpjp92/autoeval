import React, { useState } from "react";
import { Upload, FileText, CheckCircle2, Loader2, Database, AlertCircle, Sparkles, ChevronRight, ArrowRight, Check } from "lucide-react";
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
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [uploadedFilename, setUploadedFilename] = useState<string | null>(null);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAnalyzingL2L3, setIsAnalyzingL2L3] = useState(false);
  const [isTagging, setIsTagging] = useState(false);
  const [isAnalyzingSamples, setIsAnalyzingSamples] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [selectedL1s, setSelectedL1s] = useState<string[]>([]);
  const [l2l3Master, setL2l3Master] = useState<Record<string, Record<string, string[]>> | null>(null);
  const [taggingSamples, setTaggingSamples] = useState<TaggingSample[]>([]);
  const [hierarchyMessage, setHierarchyMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [hierarchyTree, setHierarchyTree] = useState<{ l1_list: string[]; l2_by_l1: Record<string, string[]>; l3_by_l1_l2: Record<string, string[]> } | null>(null);
  const [expandedL1, setExpandedL1] = useState<Record<string, boolean>>({});
  const [expandedL2, setExpandedL2] = useState<Record<string, boolean>>({});

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

  const handleAnalyze = async () => {
    if (!uploadedFilename) return;
    setIsAnalyzing(true);
    setHierarchyMessage(null);
    setAnalysis(null);
    setTaggingSamples([]);
    setL2l3Master(null);
    try {
      // 1단계: L1 master 생성
      const res = await fetch(`${API_BASE}/api/ingestion/analyze-hierarchy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: uploadedFilename }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "분석 실패");
      const data: AnalysisResult = await res.json();
      setAnalysis(data);
      setSelectedL1s(data.l1_candidates);
      setIsAnalyzing(false);

      // 2단계: L2/L3 master 생성
      setIsAnalyzingL2L3(true);
      const l2l3Res = await fetch(`${API_BASE}/api/ingestion/analyze-l2-l3`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: uploadedFilename, selected_l1_list: data.l1_candidates }),
      });
      if (!l2l3Res.ok) throw new Error((await l2l3Res.json()).detail || "L2/L3 분석 실패");
      const l2l3Data = await l2l3Res.json();
      const master = l2l3Data.l2_l3_master;
      setL2l3Master(master);
      setIsAnalyzingL2L3(false);

      // 3단계: 태깅 적용
      runTagging(uploadedFilename, data.l1_candidates, master);
    } catch (e: any) {
      setHierarchyMessage({ text: e.message, type: "error" });
      setIsAnalyzing(false);
      setIsAnalyzingL2L3(false);
    }
  };

  const runTagging = async (filename: string, l1s: string[], master: Record<string, Record<string, string[]>>) => {
    setIsAnalyzingSamples(true);
    setIsTagging(true);
    setHierarchyTree(null);
    try {
      const [samplesRes, taggingRes] = await Promise.all([
        fetch(`${API_BASE}/api/ingestion/analyze-tagging-samples`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, selected_l1_list: l1s, l2_l3_master: master }),
        }),
        fetch(`${API_BASE}/api/ingestion/apply-granular-tagging`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, selected_l1_list: l1s, l2_l3_master: master }),
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
        const expandedL1Init: Record<string, boolean> = {};
        const expandedL2Init: Record<string, boolean> = {};
        treeRes.l1_list.forEach((l1: string) => {
          expandedL1Init[l1] = true;
          (treeRes.l2_by_l1[l1] ?? []).forEach((l2: string) => {
            expandedL2Init[`${l1}__${l2}`] = false;
          });
        });
        setExpandedL1(expandedL1Init);
        setExpandedL2(expandedL2Init);
      }
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
        subtitle="LLM이 문서를 분석해 L1/L2/L3 계층 구조를 자동으로 태깅합니다."
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
                {isAnalyzing ? "L1 분석 중..." : isAnalyzingL2L3 ? "L2/L3 생성 중..." : isTagging ? "태깅 중..." : "컨텍스트 분석"}
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
                  {isAnalyzing ? "1단계: L1 도메인 분석 중..." : isAnalyzingL2L3 ? "2단계: L2/L3 분류 체계 생성 중..." : "3단계: 청크 태깅 적용 중..."}
                </p>
              </div>
            )}

            {/* L1 후보 */}
            {analysis && (
              <div className="space-y-2 animate-in fade-in duration-300">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">L1 도메인 후보</p>
                <div className="flex flex-wrap gap-1.5">
                  {analysis.l1_candidates.map(l1 => (
                    <button
                      key={l1}
                      onClick={() => toggleL1(l1)}
                      className={cn(
                        "px-3 py-1 rounded-full text-xs font-medium border transition-all",
                        selectedL1s.includes(l1)
                          ? "bg-indigo-100 border-indigo-300 text-indigo-700"
                          : "bg-slate-50 border-slate-200 text-slate-500 hover:border-indigo-200"
                      )}
                    >
                      {l1}
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
                        <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded">{s.hierarchy.l1}</span>
                        <ChevronRight className="w-3 h-3 text-slate-300" />
                        <span className="px-1.5 py-0.5 bg-sky-100 text-sky-700 rounded">{s.hierarchy.l2}</span>
                        <ChevronRight className="w-3 h-3 text-slate-300" />
                        <span className="px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded">{s.hierarchy.l3}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 계층 트리 */}
            {hierarchyTree && hierarchyTree.l1_list.length > 0 && (() => {
              const totalL2 = (Object.values(hierarchyTree.l2_by_l1) as string[][]).reduce((s, arr) => s + arr.length, 0);
              const totalL3 = (Object.values(hierarchyTree.l3_by_l1_l2) as string[][]).reduce((s, arr) => s + arr.length, 0);
              const L1_DOT_COLORS = ["bg-violet-400", "bg-blue-400", "bg-emerald-500", "bg-amber-400"];
              return (
                <div className="space-y-2 animate-in fade-in duration-400">
                  {/* 헤더: 제목 + 레벨 칩 */}
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">계층 구조</p>
                    <div className="flex items-center gap-1.5 text-[11px] font-medium">
                      <span className="px-2.5 py-0.5 bg-violet-50 text-violet-600 border border-violet-200 rounded-full">L1 · {hierarchyTree.l1_list.length}</span>
                      <span className="px-2.5 py-0.5 bg-indigo-50 text-indigo-600 border border-indigo-200 rounded-full">L2 · {totalL2}</span>
                      <span className="px-2.5 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-full">L3 · {totalL3}</span>
                    </div>
                  </div>

                  {/* 트리 */}
                  <div className="rounded-xl border border-slate-100 bg-white overflow-hidden">
                    {hierarchyTree.l1_list.map((l1: string, l1Idx: number) => {
                      const l2s = hierarchyTree.l2_by_l1[l1] ?? [];
                      const isL1Open = expandedL1[l1] ?? true;
                      const dotColor = L1_DOT_COLORS[l1Idx % L1_DOT_COLORS.length];

                      return (
                        <div key={l1}>
                          {l1Idx > 0 && <div className="h-px bg-slate-50 mx-4" />}

                          {/* L1 행 */}
                          <button
                            onClick={() => setExpandedL1(prev => ({ ...prev, [l1]: !isL1Open }))}
                            className="w-full flex items-center gap-2.5 px-4 py-3 hover:bg-slate-50/80 transition-colors text-left"
                          >
                            <ChevronRight className={cn("w-3.5 h-3.5 text-slate-300 transition-transform flex-shrink-0", isL1Open && "rotate-90")} />
                            <span className={cn("w-2 h-2 rounded-full flex-shrink-0", dotColor)} />
                            <span className="text-sm font-semibold text-slate-800 flex-1">{l1}</span>
                            <span className="text-[11px] text-slate-400 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">{l2s.length} L2</span>
                          </button>

                          {/* L2 목록 */}
                          {isL1Open && l2s.length > 0 && (
                            <div className="relative pl-10 pr-4 pb-2">
                              {/* L1 세로 가이드라인 */}
                              <div className="absolute left-[21px] top-0 bottom-6 w-px bg-violet-200" />

                              {l2s.map((l2: string) => {
                                const l3Key = `${l1}__${l2}`;
                                const l3s = hierarchyTree.l3_by_l1_l2[l3Key] ?? [];
                                const isL2Open = expandedL2[l3Key] ?? false;

                                return (
                                  <div key={l2} className="relative mb-0.5">
                                    {/* L2 가로 브랜치 */}
                                    <div className="absolute left-[-13px] top-[18px] w-3 h-px bg-violet-200" />

                                    {/* L2 행 */}
                                    <button
                                      onClick={() => l3s.length > 0 && setExpandedL2((prev: Record<string, boolean>) => ({ ...prev, [l3Key]: !isL2Open }))}
                                      className={cn(
                                        "w-full flex items-center gap-2 py-2 px-2.5 rounded-lg transition-colors text-left",
                                        l3s.length > 0 ? "hover:bg-indigo-50/60 cursor-pointer" : "cursor-default"
                                      )}
                                    >
                                      <ChevronRight className={cn(
                                        "w-3 h-3 flex-shrink-0 transition-transform",
                                        l3s.length > 0 ? "text-slate-300" : "text-transparent",
                                        isL2Open && "rotate-90"
                                      )} />
                                      <span className="text-sm text-indigo-600 flex-1">{l2}</span>
                                      {l3s.length > 0 && (
                                        <span className="text-[10px] text-slate-400">{l3s.length} L3</span>
                                      )}
                                    </button>

                                    {/* L3 목록 */}
                                    {isL2Open && l3s.length > 0 && (
                                      <div className="relative pl-6 mb-1">
                                        {/* L2 세로 가이드라인 */}
                                        <div className="absolute left-[10px] top-0 bottom-4 w-px bg-emerald-200" />

                                        {l3s.map((l3: string) => (
                                          <div key={l3} className="relative flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-emerald-50/50 transition-colors">
                                            {/* L3 가로 브랜치 */}
                                            <div className="absolute left-[-14px] top-1/2 -translate-y-1/2 w-3 h-px bg-emerald-200" />
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 flex-shrink-0" />
                                            <span className="text-xs text-emerald-700">{l3}</span>
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
