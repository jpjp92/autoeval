import React, { useState } from "react";
import { Upload, FileText, CheckCircle2, Loader2, Database, Layers, AlertCircle } from "lucide-react";
import { cn } from "@/src/lib/utils";
import { API_BASE } from "@/src/lib/api";

export function DataStandardizationPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "success" | "error">("idle");
  const [previews, setPreviews] = useState<any[]>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;

    setIsUploading(true);
    setMessage(null);
    setStatus("idle");

    const formData = new FormData();
    formData.append("file", file);
    const fileName = file.name;

    try {
      const response = await fetch(`${API_BASE}/api/ingestion/upload`, {
        method: "POST",
        body: formData,
      });

      const data = await response.json();

      if (response.ok) {
        setStatus("success");
        setMessage(`문서 "${fileName}" 업로드 및 벡터화 작업이 시작되었습니다.`);
        setFile(null);
        // 즉시 프리뷰 로드 시도 (백그라운드 작업이므로 약간의 지연 후 시도 권장)
        setTimeout(() => fetchPreviews(fileName), 2000);
      } else {
        setStatus("error");
        setMessage(data.detail || "업로드에 실패했습니다.");
      }
    } catch (err) {
      setStatus("error");
      setMessage("서버 연결에 실패했습니다.");
    } finally {
      setIsUploading(false);
    }
  };

  const fetchPreviews = async (filename: string) => {
    setIsLoadingPreview(true);
    try {
      // 이전에 만든 get_document_chunks 기반 엔드포인트가 필요할 수 있음
      // 여기서는 analyze-hierarchy 용으로 만든 get_document_chunks를 활용하는 API가 있다고 가정하거나
      // 새로 추가해야 함. 일단 ingestion_api에 preview 용 GET 추가 예정
      const response = await fetch(`${API_BASE}/api/ingestion/previews?filename=${encodeURIComponent(filename)}`);
      if (response.ok) {
        const data = await response.json();
        setPreviews(data.chunks || []);
      }
    } catch (err) {
      console.error("Failed to fetch previews", err);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <h3 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
            <Database className="w-5 h-5 text-indigo-500" /> 데이터 규격화 (Standardization)
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Gemini Embedding 2를 사용하여 다양한 문서를 벡터 DB로 정규화합니다.
          </p>
        </div>

        <div className="p-8 space-y-8">
          {/* File Upload Area */}
          <div className="space-y-4">
            <label className="block text-sm font-medium text-slate-700">문서 업로드 <span className="text-red-500">*</span></label>
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
                  onClick={(e) => {
                    e.stopPropagation();
                    setFile(null);
                  }}
                  className="mt-4 text-xs text-red-500 hover:underline"
                >
                  파일 제거
                </button>
              )}
            </div>
          </div>

          {/* Preview Area (After Upload) */}
          {previews.length > 0 && (
            <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
              <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <FileText className="w-4 h-4 text-emerald-500" /> 인제스션 데이터 프리뷰 (최근 3개)
              </h4>
              <div className="space-y-3">
                {previews.slice(0, 3).map((chunk, idx) => (
                  <div key={idx} className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 leading-relaxed overflow-hidden">
                    <div className="font-bold text-indigo-600 mb-2">Chunk #{chunk.metadata?.chunk_index + 1}</div>
                    {chunk.content.length > 300 ? chunk.content.substring(0, 300) + "..." : chunk.content}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-slate-400 text-center italic">백그라운드 작업이 진행됨에 따라 더 많은 데이터가 저장됩니다.</p>
            </div>
          )}

          {/* Status Message */}
          {message && (
            <div className={cn(
              "p-4 rounded-xl border flex items-start gap-3 animate-in shadow-sm",
              status === "success" ? "bg-emerald-50 border-emerald-100 text-emerald-800" : "bg-red-50 border-red-100 text-red-800"
            )}>
              {status === "success" ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              )}
              <div className="flex-1">
                <p className="text-sm font-medium">{message}</p>
              </div>
            </div>
          )}

          {/* Action Button */}
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
            <span>{isUploading ? "데이터 처리 중..." : "데이터 정규화 시작"}</span>
          </button>
        </div>
      </div>

      {/* Info Card */}
      <div className="bg-slate-100/50 p-6 rounded-2xl border border-slate-200/50">
        <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          💡 데이터 정규화 가이드
        </h4>
        <ul className="mt-3 space-y-2 text-xs text-slate-500 list-disc ml-4 leading-relaxed">
          <li>업로드된 파일은 LangChain의 <code className="bg-slate-200 px-1 rounded">RecursiveCharacterTextSplitter</code>를 통해 약 1,000자 단위로 분할됩니다.</li>
          <li>분할된 각 조각은 <strong>Gemini Embedding 2</strong> 모델을 통해 1,536차원의 벡터로 변환됩니다.</li>
          <li>변환된 벡터는 Supabase의 <code className="bg-slate-200 px-1 rounded">pgvector</code> 확장을 사용하는 <code className="bg-slate-200 px-1 rounded">doc_chunks</code> 테이블에 저장됩니다.</li>
          <li>이후 QA 생성 단계에서 해당 벡터 데이터를 기반으로 가장 관련성 높은 문맥을 자동으로 검색합니다.</li>
        </ul>
      </div>
    </div>
  );
}
