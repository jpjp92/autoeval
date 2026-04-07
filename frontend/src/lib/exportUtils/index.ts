/**
 * Export utilities for evaluation results
 * Supports XLSX (2-sheet), HTML, JSON, and ZIP (XLSX + HTML) formats
 */
import * as XLSX from 'xlsx';
import JSZip from 'jszip';
import type { EvaluationData } from './types';
import { buildWorkbook } from './xlsxBuilder';
import { buildHTMLContent } from './htmlBuilder';

export type { EvaluationData } from './types';
export { exportToCSV } from './xlsxBuilder';
export { exportToHTML } from './htmlBuilder';

export function exportToJSON(data: EvaluationData): void {
  const qaModel   = data.metadata?.qa_model  || '-';
  const evalModel = data.metadata?.eval_model || '-';

  const cleaned = {
    metadata: {
      qa_model:   qaModel,
      eval_model: evalModel,
      timestamp:  data.metadata?.timestamp ?? new Date().toISOString(),
      source:     data.metadata?.source ?? '-',
    },
    summaryStats: data.summaryStats.map(({ label, value }) => ({ label, value })),
    layer1Stats: data.layer1Stats.map(({ subject, A }) => ({ subject, score: A.toFixed(2) })),
    intentDistribution: data.intentDistribution.map((d) => ({
      label: d.krLabel ? `${d.name}(${d.krLabel})` : (d.label ?? d.name),
      count: d.value,
    })),
    llmQualityScores: data.llmQualityScores.map((s) => ({
      metric: s.nameEn ? `${s.name}(${s.nameEn})` : s.name,
      score:  s.score.toFixed(2),
    })),
    detailedQA: data.detailedQA.map((qa) => {
      const qFail = qa.l2_avg < 0.7;
      const rFail = qa.triad_avg < 0.7;
      return {
        id:          qa.id,
        intent:      qa.intent,
        q:           qa.q,
        a:           qa.a ?? '',
        context:     qa.context ?? '',
        quality_avg: qa.l2_avg.toFixed(2),
        triad_avg:   qa.triad_avg.toFixed(2),
        status:      qFail && rFail ? '실패' : (qFail || rFail) ? '보류' : '성공',
      };
    }),
  };

  const blob = new Blob([JSON.stringify(cleaned, null, 2)], { type: 'application/json;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `evaluation-report-${new Date().toISOString().slice(0, 10)}.json`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export async function exportToZip(data: EvaluationData): Promise<void> {
  const dateStr = new Date().toISOString().slice(0, 10);
  const zip = new JSZip();

  const wb = buildWorkbook(data);
  const xlsxBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as Uint8Array;
  zip.file(`qa-evaluation-${dateStr}.xlsx`, xlsxBuffer);

  const htmlContent = buildHTMLContent(data);
  zip.file(`evaluation-report-${dateStr}.html`, htmlContent);

  const blob = await zip.generateAsync({ type: 'blob' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `evaluation-report-${dateStr}.zip`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
