/**
 * API Client for Auto Evaluation Backend
 */

export const API_BASE = '';

// ── 에러 메시지 매핑 ──────────────────────────────────────────────────────────

export function mapErrorToMessage(error: string): string {
  if (error.includes("계층") && error.includes("청크가 없습니다"))
    return "선택한 계층(H1/H2)에 해당하는 데이터가 없습니다.\nHierarchy 태깅(Pass3)이 완료됐는지 확인해 주세요.";
  if (error.includes("태깅이 완료되지 않았습니다"))
    return "Hierarchy 태깅(Pass3)이 완료되지 않았습니다.\nPass3을 먼저 실행해 주세요.";
  if (error.includes("Supabase") || error.includes("unavailable"))
    return "데이터베이스 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.";
  return `오류가 발생했습니다: ${error}`;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  status_code?: number;
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

// ── Dashboard ──────────────────────────────────────────────────────────────

export async function getDashboardMetrics(): Promise<ApiResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/dashboard/metrics`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return { success: false, error: `Failed to get dashboard metrics: ${(error as Error).message}` };
  }
}

// ── Ingestion ──────────────────────────────────────────────────────────────

export async function getHierarchyList(filename?: string): Promise<{
  h1_list: string[];
  h2_by_h1: Record<string, string[]>;
  h3_by_h1_h2: Record<string, string[]>;
  success: boolean;
}> {
  try {
    const params = filename ? `?filename=${encodeURIComponent(filename)}` : '';
    const response = await fetch(`${API_BASE}/api/ingestion/hierarchy-list${params}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch {
    return { success: false, h1_list: [], h2_by_h1: {}, h3_by_h1_h2: {} };
  }
}

// ── Generation ─────────────────────────────────────────────────────────────

export async function generateQA(request: GenerateRequest): Promise<ApiResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return { success: false, error: `Failed to start generation: ${(error as Error).message}` };
  }
}

// ── Evaluation ─────────────────────────────────────────────────────────────

export async function evaluateQA(request: EvaluateRequest): Promise<ApiResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return { success: false, error: `Failed to start evaluation: ${(error as Error).message}` };
  }
}

export async function getEvalStatus(jobId: string): Promise<ApiResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/evaluate/${encodeURIComponent(jobId)}/status`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return { success: false, error: `Failed to get eval status: ${(error as Error).message}` };
  }
}

export async function getEvalHistory(): Promise<ApiResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/evaluate/history`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return { success: false, error: `Failed to get eval history: ${(error as Error).message}` };
  }
}

export async function getEvalExport(jobId: string): Promise<ApiResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/evaluate/${encodeURIComponent(jobId)}/export`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return { success: false, error: `Export fetch failed: ${(error as Error).message}` };
  }
}

export async function getEvalExportById(evalId: string): Promise<ApiResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/evaluate/export-by-id/${encodeURIComponent(evalId)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return { success: false, error: `Export fetch failed: ${(error as Error).message}` };
  }
}
