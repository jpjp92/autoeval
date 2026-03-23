/**
 * API Client for Auto Evaluation Backend
 */

export const API_BASE = '';

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
