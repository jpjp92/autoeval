/**
 * API Client for Auto Evaluation Backend
 * Handles all HTTP requests to the FastAPI server
 */

export const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  status_code?: number;
}

interface ResultFile {
  filename: string;
  filepath: string;
  model: string;
  lang: string;
  prompt_version: string;
  qa_count: number;
  timestamp: string;
  size_kb: number;
}

interface GenerateRequest {
  model: string;
  lang: string;
  samples: number;
  qa_per_doc?: number;
  prompt_version: string;
  doc_ids?: string[];
  filename?: string;
  hierarchy_l1?: string;
  hierarchy_l2?: string;
  hierarchy_l3?: string;
}

interface EvaluateRequest {
  result_filename: string;
  evaluator_model?: string;
  generation_id?: string;
  include_l1?: boolean;
  include_l2?: boolean;
}

interface ExportRequest {
  result_filename: string;
  export_format: 'csv' | 'html' | 'xlsx' | 'json';
}

/**
 * Health check
 */
export async function healthCheck(): Promise<ApiResponse> {
  try {
    const response = await fetch(`${API_BASE}/health`);
    return await response.json();
  } catch (error) {
    return {
      success: false,
      error: `Health check failed: ${(error as Error).message}`,
    };
  }
}

/**
 * Get system configuration
 */
export async function getConfig(): Promise<ApiResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/config`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return {
      success: false,
      error: `Failed to get config: ${(error as Error).message}`,
    };
  }
}

/**
 * Get system status
 */
export async function getStatus(): Promise<ApiResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/status`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return {
      success: false,
      error: `Failed to get status: ${(error as Error).message}`,
    };
  }
}

/**
 * Get list of all evaluation results
 */
export async function getResults(): Promise<ApiResponse<{ count: number; results: ResultFile[] }>> {
  try {
    const response = await fetch(`${API_BASE}/api/results`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return {
      success: false,
      error: `Failed to get results: ${(error as Error).message}`,
    };
  }
}

/**
 * Get detailed evaluation result
 */
export async function getResultDetail(filename: string): Promise<ApiResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/results/${encodeURIComponent(filename)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return {
      success: false,
      error: `Failed to get result detail: ${(error as Error).message}`,
    };
  }
}

/**
 * Get available hierarchy L1/L2 list from DB
 * filename 지정 시 해당 문서 청크만 대상으로 조회
 */
export async function getHierarchyList(filename?: string): Promise<{ l1_list: string[]; l2_by_l1: Record<string, string[]>; l3_by_l1_l2: Record<string, string[]>; success: boolean }> {
  try {
    const params = filename ? `?filename=${encodeURIComponent(filename)}` : "";
    const response = await fetch(`${API_BASE}/api/ingestion/hierarchy-list${params}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return { success: false, l1_list: [], l2_by_l1: {}, l3_by_l1_l2: {} };
  }
}

/**
 * Start QA generation
 */
export async function generateQA(request: GenerateRequest): Promise<any> {
  try {
    const response = await fetch(`${API_BASE}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return {
      success: false,
      error: `Failed to start generation: ${(error as Error).message}`,
    };
  }
}

/**
 * Start evaluation
 */
export async function evaluateQA(request: EvaluateRequest): Promise<ApiResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/evaluate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return {
      success: false,
      error: `Failed to start evaluation: ${(error as Error).message}`,
    };
  }
}

/**
 * Export results
 */
export async function exportResults(request: ExportRequest): Promise<ApiResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/export`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return {
      success: false,
      error: `Failed to export: ${(error as Error).message}`,
    };
  }
}

/**
 * Get evaluation job status
 */
export async function getEvalStatus(jobId: string): Promise<ApiResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/evaluate/${encodeURIComponent(jobId)}/status`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return { success: false, error: `Failed to get eval status: ${(error as Error).message}` };
  }
}

/**
 * Get current session eval job list (in-memory)
 */
export async function getEvalList(): Promise<ApiResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/evaluate/list`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return { success: false, error: `Failed to get eval list: ${(error as Error).message}` };
  }
}

/**
 * Fetch full QA + eval score detail for xlsx export (current session job)
 */
export async function getEvalExport(jobId: string): Promise<ApiResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/evaluate/${encodeURIComponent(jobId)}/export`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return { success: false, error: `Export fetch failed: ${(error as Error).message}` };
  }
}

/**
 * Fetch full QA + eval score detail by Supabase eval_id (history items)
 */
export async function getEvalExportById(evalId: string): Promise<ApiResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/evaluate/export-by-id/${encodeURIComponent(evalId)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return { success: false, error: `Export fetch failed: ${(error as Error).message}` };
  }
}

/**
 * Get persistent eval history from Supabase
 */
export async function getEvalHistory(): Promise<ApiResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/evaluate/history`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    return { success: false, error: `Failed to get eval history: ${(error as Error).message}` };
  }
}

/**
 * Watch SSE stream (for streaming responses)
 */
export function watchStream(
  endpoint: string,
  onMessage: (data: any) => void,
  onError: (error: Error) => void
): () => void {
  const eventSource = new EventSource(`${API_BASE}${endpoint}`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      onMessage(data);
    } catch (error) {
      onError(error as Error);
    }
  };

  eventSource.onerror = () => {
    onError(new Error('Stream connection error'));
    eventSource.close();
  };

  // Return function to close the stream
  return () => eventSource.close();
}

/**
 * Get API base URL (for debugging)
 */
export function getAPIBase(): string {
  return API_BASE;
}
