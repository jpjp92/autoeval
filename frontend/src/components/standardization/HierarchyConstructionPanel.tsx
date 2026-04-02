import React, { useState } from "react";
import {
  Layers,
  Search,
  Sparkles,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Info,
  ChevronRight
} from "lucide-react";
import { cn } from "@/src/lib/utils";
import { API_BASE } from "@/src/lib/api";

interface HierarchyData {
  h1: string;
  h2: string;
  h3: string;
}

interface TaggingSample {
  id: string;
  content_preview: string;
  hierarchy: HierarchyData;
}

interface AnalysisResult {
  domain_analysis: string;
  h1_candidates: string[];
  suggested_hierarchy: HierarchyData;
  validation: string;
}

export function HierarchyConstructionPanel() {
  const [filename, setFilename] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isTagging, setIsTagging] = useState(false);
  const [isAnalyzingSamples, setIsAnalyzingSamples] = useState(false);
  const [taggingSamples, setTaggingSamples] = useState<TaggingSample[]>([]);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [selectedH1s, setSelectedH1s] = useState<string[]>([]);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const handleAnalyze = async () => {
    if (!filename.trim()) return;

    setIsAnalyzing(true);
    setMessage(null);
    setAnalysis(null);

    try {
      const response = await fetch(`${API_BASE}/api/ingestion/analyze-hierarchy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "분석에 실패했습니다.");
      }

      const data: AnalysisResult = await response.json();
      setAnalysis(data);
      setSelectedH1s(data.h1_candidates);
      
      // 자동 연계 분석 및 태깅 시작
      handleAnalyzeSamples(filename, data.h1_candidates);
      handleApplyGranularTagging(filename, data.h1_candidates);
    } catch (err: any) {
      setMessage({ text: err.message, type: "error" });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleApplyGranularTagging = async (overrideFile?: string, overrideH1s?: string[]) => {
    const targetFile = overrideFile || filename;
    const targetH1s = overrideH1s || selectedH1s;
    if (!targetFile || targetH1s.length === 0) return;

    setIsTagging(true);
    setMessage(null);

    try {
      const response = await fetch(`${API_BASE}/api/ingestion/apply-granular-tagging`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: targetFile,
          selected_h1_list: targetH1s
        }),
      });

      if (response.ok) {
        // Success message removed per user request to keep UI cleaner
        // Also refresh samples to show the latest result
        handleAnalyzeSamples(targetFile, targetH1s);
      } else {
        const errorData = await response.json();
        throw new Error(errorData.detail || "태깅 시작에 실패했습니다.");
      }
    } catch (err: any) {
      setMessage({ text: err.message, type: "error" });
    } finally {
      setIsTagging(false);
    }
  };

  const handleAnalyzeSamples = async (overrideFile?: string, overrideL1s?: string[]) => {
    const targetFile = overrideFile || filename;
    const targetL1s = overrideL1s || selectedH1s;
    if (!targetFile || targetL1s.length === 0) return;

    setIsAnalyzingSamples(true);
    setTaggingSamples([]);

    try {
      const response = await fetch(`${API_BASE}/api/ingestion/analyze-tagging-samples`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          filename: targetFile, 
          selected_h1_list: targetL1s
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "계층 구조 분석에 실패했습니다.");
      }

      const data = await response.json();
      setTaggingSamples(data.samples);
    } catch (err: any) {
      setMessage({ text: err.message, type: "error" });
    } finally {
      setIsAnalyzingSamples(false);
    }
  };

  const toggleH1 = (h1: string) => {
    if (selectedH1s.includes(h1)) {
      setSelectedH1s(selectedH1s.filter(s => s !== h1));
    } else {
      setSelectedH1s([...selectedH1s, h1]);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50/50 rounded-full -mr-16 -mt-16 blur-3xl opacity-50" />
        <div className="relative z-10">
          <h3 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Layers className="w-6 h-6 text-indigo-500" /> 계층 구조화 (Hierarchy Construction)
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            저장된 문서를 LLM(Gemini 3 Flash)이 분석하여 최적의 계층 구조를 구성합니다.
          </p>
        </div>
        
        <div className="flex items-center gap-2 relative z-10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input 
              type="text" 
              placeholder="분석할 파일명 입력..."
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              className="pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all w-64"
            />
          </div>
          <button 
            onClick={handleAnalyze}
            disabled={!filename || isAnalyzing}
            className={cn(
              "px-4 py-2 rounded-xl font-semibold text-sm flex items-center gap-2 transition-all active:scale-95 shadow-sm",
              !filename || isAnalyzing
                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-100"
            )}
          >
            {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            <span>{isAnalyzing ? <span className="inline-flex items-baseline gap-[1px]">분석 중&nbsp;<span className="inline-block animate-bounce" style={{ animationDelay: "0ms" }}>.</span><span className="inline-block animate-bounce" style={{ animationDelay: "150ms" }}>.</span><span className="inline-block animate-bounce" style={{ animationDelay: "300ms" }}>.</span></span> : "AI 분석 실행"}</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 font-sans">
        {/* Left: AI Analysis Result */}
        <div className="lg:col-span-3 space-y-6">
          {analysis ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-in zoom-in-95 duration-300">
              <div className="px-6 py-4 border-b border-slate-100 bg-slate-50/50 flex items-center justify-between">
                <h4 className="font-bold text-slate-700 flex items-center gap-2 text-sm uppercase tracking-wider">
                  <Info className="w-4 h-4 text-indigo-500" /> AI 분석 결과
                </h4>
                <div className="text-[10px] font-bold px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full uppercase">Gemini 3 Flash </div>
              </div>
              
              <div className="p-6 space-y-8">
                {/* Step 1: Domain Analysis */}
                <div className="space-y-3">
                  <h5 className="text-xs font-bold text-indigo-600 flex items-center gap-1.5 uppercase">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" /> 1. 도메인 분석
                  </h5>
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-100 text-sm text-slate-700 leading-relaxed italic">
                    "{analysis.domain_analysis}"
                  </div>
                </div>

                {/* Step 2: Master Schema Discovery */}
                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <h5 className="text-xs font-bold text-indigo-600 flex items-center gap-1.5 uppercase">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" /> 2. 상위 스키마 탐색 및 선정
                    </h5>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApplyGranularTagging()}
                        disabled={isTagging || selectedH1s.length === 0}
                        className="text-[10px] font-bold px-3 py-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-all flex items-center gap-1 disabled:opacity-50"
                      >
                        {isTagging ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        DB 전체 반영
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-500">문서의 다양한 맥락을 포괄하기 위한 H1 도메인 후보입니다. 태깅에 반영할 항목을 선택/수정하세요.</p>
                  <div className="flex flex-wrap gap-2">
                    {analysis.h1_candidates.map((h1) => (
                      <button
                        key={h1}
                        onClick={() => toggleH1(h1)}
                        className={cn(
                          "px-4 py-2 rounded-full text-xs font-bold transition-all border-2",
                          selectedH1s.includes(h1)
                            ? "bg-indigo-500 border-indigo-500 text-white shadow-md shadow-indigo-200"
                            : "bg-white border-slate-200 text-slate-400 hover:border-indigo-200 hover:text-indigo-400"
                        )}
                      >
                        {h1}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Step 3: Tagging Samples Preview */}
                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <h5 className="text-xs font-bold text-indigo-600 flex items-center gap-1.5 uppercase">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" /> 3. 세부 계층 분석 미리보기 (샘플)
                  </h5>
                  {isAnalyzingSamples ? (
                    <div className="py-10 flex flex-col items-center justify-center text-slate-400 space-y-2">
                      <Loader2 className="w-8 h-8 animate-spin text-indigo-300" />
                      <p className="text-xs">상세 계층 정보를 분석하고 있습니다...</p>
                    </div>
                  ) : taggingSamples.length > 0 ? (
                    <div className="grid grid-cols-1 gap-3 animate-in fade-in duration-500">
                      {taggingSamples.map((sample, idx) => (
                        <div key={idx} className="p-4 bg-slate-50 rounded-xl border border-slate-200 flex flex-col gap-3">
                          <p className="text-[11px] text-slate-600 italic line-clamp-2">"{sample.content_preview}"</p>
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded-md">{sample.hierarchy.h1}</span>
                            <ChevronRight className="w-3 h-3 text-slate-300" />
                            <span className="px-2 py-0.5 bg-white border border-slate-200 text-slate-700 text-[10px] font-bold rounded-md">{sample.hierarchy.h2}</span>
                            <ChevronRight className="w-3 h-3 text-slate-300" />
                            <span className="px-2 py-0.5 bg-white border border-slate-200 text-slate-700 text-[10px] font-bold rounded-md">{sample.hierarchy.h3}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="py-6 text-center text-[11px] text-slate-400 border border-dashed border-slate-200 rounded-xl">
                      분석 결과가 여기에 표시됩니다.
                    </div>
                  )}
                </div>

                {/* Step 4: Validation */}
                <div className="space-y-3 pt-4 border-t border-slate-100">
                  <h5 className="text-xs font-bold text-indigo-600 flex items-center gap-1.5 uppercase">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" /> 4. 도메인 및 계층 구성 근거
                  </h5>
                  <div className="p-4 bg-emerald-50/50 rounded-xl border border-emerald-100 text-sm text-slate-700 leading-relaxed">
                    <div className="flex gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <p className="text-[11px] font-medium leading-relaxed">{analysis.validation}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 border-dashed p-20 flex flex-col items-center justify-center text-center space-y-4">
              <div className="w-16 h-16 bg-slate-50 rounded-2xl flex items-center justify-center">
                <Sparkles className="w-8 h-8 text-slate-300" />
              </div>
              <div>
                <h4 className="text-slate-600 font-semibold text-lg">파일명을 입력하고 분석을 시작하세요</h4>
                <p className="text-slate-400 text-sm max-w-sm mx-auto mt-2">
                  Gemini 3 Flash가 문서 본문을 이해하고 비즈니스 관점의 전문적인 계층 구조로 분류해 드립니다.
                </p>
              </div>
            </div>
          )}

          {/* Feedback Section */}
          {message && (
            <div className={cn(
              "p-4 rounded-xl border flex items-start gap-3 animate-in fade-in slide-in-from-top-4 shadow-sm",
              message.type === "success" ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-red-50 border-red-100 text-red-800"
            )}>
              {message.type === "success" ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              )}
              <p className="text-sm font-medium">{message.text}</p>
            </div>
          )}
        </div>
      </div>

      {/* Guide Card */}
      <div className="bg-slate-100/50 p-6 rounded-2xl border border-slate-200/50">
        <h5 className="flex items-center gap-2 text-slate-700 font-bold text-sm mb-3">
          💡 계층 구조화 가이드
        </h5>
        <ul className="space-y-2 text-xs text-slate-500 list-disc ml-4 leading-relaxed">
          <li><strong>도메인 분석</strong>: AI가 문서의 전체 맥락을 파악하여 최적의 상위 카테고리(H1)를 제안합니다.</li>
          <li><strong>스키마 선정</strong>: 제안된 H1 중 실제 태깅에 사용할 항목을 선택하거나 수정할 수 있습니다.</li>
          <li><strong>DB 반영</strong>: 'DB 전체 반영' 시 선택된 도메인을 기준으로 모든 청크에 세부 계층(H1-H2-H3)이 자동 할당됩니다.</li>
          <li><strong>품질 검증</strong>: 할당된 계층 정보는 향후 QA 생성 단계에서 정교한 필터링 기준으로 사용됩니다.</li>
        </ul>
      </div>
    </div>
  );
}
