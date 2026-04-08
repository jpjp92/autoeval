/**
 * API Client for Auto Evaluation Backend
 */

export const API_BASE = '';

// ── 에러 메시지 매핑 ──────────────────────────────────────────────────────────

export function mapErrorToMessage(error: string): string {
  // ① 카테고리 선택했는데 해당 청크 없음
  if (error.includes("계층") && error.includes("청크가 없습니다"))
    return "선택한 카테고리에 해당하는 문서 데이터가 없습니다.\n'Documents' 페이지에서 컨텍스트 분석이 완료됐는지 확인해 주세요.";

  // ② 카테고리 분류 미완료 (백엔드 미처리 수치 보존)
  const taggingMatch = error.match(/\((\d+\/\d+)개 미태깅\)/);
  if (error.includes("태깅이 완료되지 않았습니다"))
    return `카테고리 분류가 완료되지 않았습니다${taggingMatch ? ` (미처리 ${taggingMatch[1]}개)` : ''}.\n'Documents' 페이지에서 컨텍스트 분석을 다시 실행해 주세요.`;

  // ③ 문서 자체 없음 (업로드 미완료)
  if (error.includes("QA 생성에 필요한 문서 청크를 찾을 수 없습니다"))
    return "업로드된 문서가 없습니다.\n'Documents' 페이지에서 문서를 업로드하고 카테고리 분류를 완료해 주세요.";

  // LLM 과부하 / 서버 일시 지연 (503, high demand)
  if (error.includes("503") || error.toLowerCase().includes("high demand"))
    return "현재 일시적으로 응답이 지연됩니다. 잠시 후 다시 시도해 주세요.";

  // DB 연결 오류
  if (error.includes("Supabase") || error.includes("unavailable"))
    return "데이터베이스 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.";

  // 네트워크 단절
  if (error.toLowerCase().includes("failed to fetch") || error.toLowerCase().includes("networkerror"))
    return "네트워크 연결을 확인해 주세요.";

  // fallback — 내부 문자열 노출 제거
  return "일시적인 오류가 발생했습니다. 문제가 지속되면 관리자에게 문의해 주세요.";
}

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  status_code?: number;
}

// ── 엔드포인트별 응답 타입 ─────────────────────────────────────────────────────

export interface JobStartResponse extends ApiResponse {
  job_id?: string;
}

export interface GenStatusResponse extends ApiResponse {
  job_id?: string;
  status?: string;
  progress?: number;
  message?: string;
  result_file?: string;
  result_id?: string;
}

export interface GenPreviewResponse extends ApiResponse {
  preview?: any[];
  total?: number;
}

export interface EvalStatusResponse extends ApiResponse {
  job_id?: string;
  status?: string;
  progress?: number;
  message?: string;
  layers?: Record<string, any>;
  eval_report?: any;
}

export interface EvalExportResponse extends ApiResponse {
  detail?: any[];
  timestamp?: string;
}

export interface EvalHistoryResponse extends ApiResponse {
  history?: any[];
}

interface GenerateRequest {
  model: string;
  lang: string;
  samples: number;
  qa_per_doc?: number;
  prompt_version: string;
  doc_ids?: string[];
  filename?: string;
  hierarchy_h1?: string;
  hierarchy_h2?: string;
  hierarchy_h3?: string;
}

interface EvaluateRequest {
  result_filename: string;
  evaluator_model?: string;
  generation_id?: string;
  include_h1?: boolean;
  include_h2?: boolean;
}

// ── 공통 fetch 래퍼 ───────────────────────────────────────────────────────────

function httpStatusToMessage(status: number): string {
  if (status === 400) return '요청 형식이 올바르지 않습니다. 입력값을 확인해 주세요.';
  if (status === 401 || status === 403) return '접근 권한이 없습니다.';
  if (status === 404) return '요청한 데이터를 찾을 수 없습니다.';
  if (status === 429) return '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.';
  if (status >= 500) return '서버에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.';
  return `HTTP ${status}`;
}

async function apiFetch<T = any>(url: string, options?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(httpStatusToMessage(response.status));
    return await response.json();
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
}

/** Cold start 대비 재시도 fetch (최대 retries회, delayMs 간격) */
export async function apiFetchWithRetry<T = any>(
  url: string,
  options: RequestInit,
  retries = 3,
  delayMs = 5000,
): Promise<ApiResponse<T>> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (!response.ok) {
        let errMsg = httpStatusToMessage(response.status);
        try {
          const errBody = await response.json();
          if (errBody.detail) errMsg = errBody.detail;
        } catch {}
        throw new Error(errMsg);
      }
      return await response.json();
    } catch (e) {
      if (attempt === retries) return { success: false, error: '서버에 연결할 수 없습니다. 네트워크 상태를 확인하거나 잠시 후 다시 시도해 주세요.' };
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return { success: false, error: '서버에 연결할 수 없습니다. 네트워크 상태를 확인하거나 잠시 후 다시 시도해 주세요.' };
}

// ── Dashboard ──────────────────────────────────────────────────────────────

export async function getDashboardMetrics(): Promise<ApiResponse> {
  return apiFetch(`${API_BASE}/api/dashboard/metrics`);
}

// ── Ingestion ──────────────────────────────────────────────────────────────

export async function getHierarchyList(filename?: string, filterForQa = true): Promise<{
  h1_list: string[];
  h2_by_h1: Record<string, string[]>;
  h3_by_h1_h2: Record<string, string[]>;
  success: boolean;
}> {
  const qs = new URLSearchParams();
  if (filename) qs.set('filename', filename);
  if (!filterForQa) qs.set('filter_for_qa', 'false');
  const params = qs.toString() ? `?${qs.toString()}` : '';
  // 백엔드가 flat JSON { success, h1_list, h2_by_h1, h3_by_h1_h2 } 을 반환 (data 키 없음)
  const result = await apiFetch(`${API_BASE}/api/ingestion/hierarchy-list${params}`) as unknown as {
    success: boolean;
    h1_list?: string[];
    h2_by_h1?: Record<string, string[]>;
    h3_by_h1_h2?: Record<string, string[]>;
    error?: string;
  };
  if (!result.success) return { success: false, h1_list: [], h2_by_h1: {}, h3_by_h1_h2: {} };
  return {
    success: true,
    h1_list:      result.h1_list      ?? [],
    h2_by_h1:     result.h2_by_h1     ?? {},
    h3_by_h1_h2:  result.h3_by_h1_h2  ?? {},
  };
}

// ── Ingestion ───────────────────────────────────────────────────────────────

export interface AnalyzeHierarchyResponse extends ApiResponse {
  domain_analysis?: string;
  h1_candidates?: string[];
  h2_h3_master?: Record<string, Record<string, string[]>>;
  document_id?: string;
}

export interface TaggingResponse extends ApiResponse {
  samples?: { id: string; content_preview: string; hierarchy: { h1: string; h2: string; h3: string } }[];
}

export async function uploadDocument(formData: FormData): Promise<ApiResponse> {
  return apiFetch(`${API_BASE}/api/ingestion/upload`, { method: 'POST', body: formData });
}

export async function analyzeHierarchy(filename: string): Promise<AnalyzeHierarchyResponse> {
  return apiFetchWithRetry<AnalyzeHierarchyResponse>(
    `${API_BASE}/api/ingestion/analyze-hierarchy`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename }) },
  ) as Promise<AnalyzeHierarchyResponse>;
}

export async function applyGranularTagging(payload: {
  filename: string;
  selected_h1_list: string[];
  h2_h3_master: Record<string, Record<string, string[]>>;
  document_id?: string;
}): Promise<TaggingResponse> {
  return apiFetch(`${API_BASE}/api/ingestion/apply-granular-tagging`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }) as Promise<TaggingResponse>;
}

// ── Generation ─────────────────────────────────────────────────────────────

export async function generateQA(request: GenerateRequest): Promise<JobStartResponse> {
  return apiFetch(`${API_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  }) as Promise<JobStartResponse>;
}

export async function getGenStatus(jobId: string): Promise<GenStatusResponse> {
  return apiFetch(`${API_BASE}/api/generate/${encodeURIComponent(jobId)}/status`) as Promise<GenStatusResponse>;
}

export async function getGenPreview(jobId: string, limit = 3): Promise<GenPreviewResponse> {
  return apiFetch(`${API_BASE}/api/generate/${encodeURIComponent(jobId)}/preview?limit=${limit}`) as Promise<GenPreviewResponse>;
}

// ── Evaluation ─────────────────────────────────────────────────────────────

export async function evaluateQA(request: EvaluateRequest): Promise<JobStartResponse> {
  return apiFetch(`${API_BASE}/api/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  }) as Promise<JobStartResponse>;
}

export async function getEvalStatus(jobId: string): Promise<EvalStatusResponse> {
  return apiFetch(`${API_BASE}/api/evaluate/${encodeURIComponent(jobId)}/status`) as Promise<EvalStatusResponse>;
}

export async function getEvalHistory(): Promise<EvalHistoryResponse> {
  return apiFetch(`${API_BASE}/api/evaluate/history`) as Promise<EvalHistoryResponse>;
}

export async function getEvalExport(jobId: string): Promise<EvalExportResponse> {
  return apiFetch(`${API_BASE}/api/evaluate/${encodeURIComponent(jobId)}/export`) as Promise<EvalExportResponse>;
}

export async function getEvalExportById(evalId: string): Promise<EvalExportResponse> {
  return apiFetch(`${API_BASE}/api/evaluate/export-by-id/${encodeURIComponent(evalId)}`) as Promise<EvalExportResponse>;
}
