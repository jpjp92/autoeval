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
}

interface EvaluateRequest {
  result_filename: string;
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
