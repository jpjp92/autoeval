/**
 * Export utilities for evaluation results
 * Supports XLSX (2-sheet), HTML, JSON, and ZIP (XLSX + HTML) formats
 */
import * as XLSX from 'xlsx';
import JSZip from 'jszip';

const INTENT_KR: Record<string, string> = {
  // 신규 6종 (2026-03-25~)
  fact:       '사실형',
  purpose:    '원인형',
  how:        '방법형',
  condition:  '조건형',
  comparison: '비교형',
  list:       '열거형',
  // 구형 8종 (하위 호환)
  factoid:      '사실형',
  numeric:      '수치형',
  procedure:    '절차형',
  why:          '원인형',
  definition:   '정의형',
  boolean:      '확인형',
  summary:      '요약형',
  confirmation: '확인형',
};

const FAILURE_KR: Record<string, string> = {
  hallucination:      '환각오류',
  faithfulness_error: '근거오류',
  poor_context:       '문맥부족',
  retrieval_miss:     '검색오류',
  ambiguous_question: '질문모호',
  bad_chunk:          '불량청크',
  evaluation_error:   '평가오류',
  low_quality:        '품질미달',
  syntax_error:       '구문오류',
};

export interface EvaluationData {
  summaryStats: Array<{ label: string; value: string; icon?: any; color?: string; bg?: string }>;
  layer1Stats: Array<{ subject: string; A: number; fullMark: number }>;
  intentDistribution: Array<{ name: string; label?: string; krLabel?: string; value: number }>;
  llmQualityScores: Array<{ name: string; nameEn?: string; score: number; group?: 'rag' | 'quality' }>;
  detailedQA: Array<{
    id: number;
    q: string;
    a?: string;
    context?: string;
    intent: string;
    l2_avg: number;
    triad_avg: number;
    pass: boolean;
    primary_failure?: string | null;
    failure_types?: string[];
    relevance_reason?: string;
    groundedness_reason?: string;
    clarity_reason?: string;           // 구형 (명확성)
    context_relevance_reason?: string; // 신형 (맥락성)
    factuality_reason?: string;
    completeness_reason?: string;
    specificity_reason?: string;
    conciseness_reason?: string;
    failure_reason?: string;
    // Individual scores
    relevance?:         number;
    groundedness?:      number;
    context_relevance?: number;
    completeness?:      number;
    factuality?:        number;
    specificity?:       number;
    conciseness?:       number;
    clarity?:           number;
  }>;
  metadata?: {
    qa_model?:  string;  // QA 생성 모델
    eval_model?: string; // 평가 모델
    lang?:      string;
    timestamp?: string;
    source?:    string;  // 출처 문서명
    // 하위 호환 (기존 코드 대응)
    model?:     string;
    prompt?:    string;
  };
}

/** UTC ISO → KST 문자열 (Asia/Seoul, UTC+9) */
function toKST(isoString?: string): string {
  const d = isoString ? new Date(isoString) : new Date();
  return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
}

/**
 * Export evaluation results to XLSX (Stats 시트 + Detail 시트)
 */
function buildWorkbook(data: EvaluationData): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const evalDate = toKST(data.metadata?.timestamp);
  const qaModel   = data.metadata?.qa_model   || data.metadata?.model || '-';
  const evalModel = data.metadata?.eval_model || data.metadata?.model || '-';
  const source    = data.metadata?.source || '-';

  // ── Stats 시트 ──────────────────────────────────────────────────────────────
  const statsRows: (string | number)[][] = [];

  statsRows.push(['[ 메타데이터 ]', '']);
  statsRows.push(['QA 생성 모델',    qaModel]);
  statsRows.push(['평가 모델',       evalModel]);
  statsRows.push(['평가 일시 (KST)', evalDate]);
  statsRows.push(['출처 문서',       source]);
  statsRows.push([]);

  statsRows.push(['[ 요약 통계 ]', '']);
  statsRows.push(['항목', '값']);
  data.summaryStats.forEach((s) => statsRows.push([s.label, s.value]));
  statsRows.push([]);

  statsRows.push(['[ 데이터 통계 (0-10) ]', '']);
  statsRows.push(['지표', '점수']);
  data.layer1Stats.forEach((s) => statsRows.push([s.subject, +s.A.toFixed(3)]));
  statsRows.push([]);

  statsRows.push(['[ 질문 의도 분포 ]', '']);
  statsRows.push(['의도', '개수']);
  data.intentDistribution.forEach((i) => {
    const displayName = i.krLabel ? `${i.krLabel}(${i.name})` : (i.label ?? i.name);
    statsRows.push([displayName, i.value]);
  });
  statsRows.push([]);

  statsRows.push(['[ 통합 품질 평가 점수 (0-1) ]', '']);
  statsRows.push(['지표', '점수']);
  data.llmQualityScores.forEach((s) => {
    const displayName = s.nameEn ? `${s.name}(${s.nameEn})` : s.name;
    statsRows.push([displayName, +s.score.toFixed(4)]);
  });

  const wsStats = XLSX.utils.aoa_to_sheet(statsRows);
  wsStats['!cols'] = [{ wch: 28 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsStats, 'Stats');

  // ── Detail 시트 ─────────────────────────────────────────────────────────────
  const detailHeader = ['ID', '의도', 'Context', 'Question', 'Answer', '품질 점수', 'Triad 점수', '상태', '실패유형', '평가일시 (KST)'];
  const detailRows = data.detailedQA.map((qa) => {
    const qFail = (qa.l2_avg === undefined || qa.l2_avg === null) ? true : qa.l2_avg < 0.7;
    const rFail = (qa.triad_avg === undefined || qa.triad_avg === null) ? true : qa.triad_avg < 0.7;
    const hasError = (qa.pass === false) || (qa.failure_types && qa.failure_types.length > 0);
    
    let status = '성공';
    if (qFail && rFail) {
      status = '실패';
    } else if (qFail || rFail || hasError) {
      status = '보류';
    }
    const failureLabel = qa.primary_failure ? (FAILURE_KR[qa.primary_failure] ?? qa.primary_failure) : '-';
    return [
      qa.id,
      INTENT_KR[qa.intent] ?? qa.intent,
      qa.context ?? '',
      qa.q,
      qa.a ?? '',
      +qa.l2_avg.toFixed(4),
      +qa.triad_avg.toFixed(4),
      status,
      failureLabel,
      evalDate,
    ];
  });

  const wsDetail = XLSX.utils.aoa_to_sheet([detailHeader, ...detailRows]);
  wsDetail['!cols'] = [
    { wch: 6 },   // ID
    { wch: 12 },  // 의도
    { wch: 55 },  // Context
    { wch: 50 },  // Question
    { wch: 50 },  // Answer
    { wch: 12 },  // 품질 점수
    { wch: 12 },  // Triad 점수
    { wch: 8  },  // 상태
    { wch: 12 },  // 실패유형
    { wch: 22 },  // 평가일시
  ];
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Detail');

  return wb;
}

export function exportToCSV(data: EvaluationData): void {
  const wb = buildWorkbook(data);
  const filename = `qa-evaluation-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}

/**
 * Export evaluation results to HTML
 */
// ── SVG 차트 생성 헬퍼 ────────────────────────────────────────────────────────

function svgTreemap(
  items: Array<{ name: string; krLabel?: string; label?: string; value: number }>,
  colorMap: Record<string, string>,
): string {
  const W = 340; const H = 220;
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0) return `<svg width="${W}" height="${H}"></svg>`;

  const sorted = [...items].sort((a, b) => b.value - a.value);
  let output = '';

  function divide(rects: any[], x: number, y: number, w: number, h: number, vertical: boolean) {
    if (rects.length === 0) return;
    if (rects.length === 1) {
      const item = rects[0];
      const color = colorMap[item.name] ?? '#94a3b8';
      const pct = total > 0 ? ((item.value / total) * 100).toFixed(1) : '0';
      const lbl = item.krLabel ?? item.label ?? item.name;
      output += `<rect x="${x + 1}" y="${y + 1}" width="${Math.max(0, w - 2)}" height="${Math.max(0, h - 2)}" fill="${color}" rx="6" opacity="0.9" style="cursor:pointer;transition:all .2s" onmouseover="this.style.opacity=1;this.style.filter='brightness(1.1)';showTip(event,'${lbl}: ${item.value}개 (${pct}%)')" onmouseout="this.style.opacity=0.9;this.style.filter='none';hideTip()"/>`;
      // 가변 폰트 사이즈 및 표시 여부 결정 (가시성 최우선)
      const area = w * h;
      const isLarge  = w > 70 && h > 50;
      const isMedium = w > 44 && h > 28;
      const isSmall  = w > 28 && h > 18;
      const isMicro  = w > 18 && h > 14; // 최소 18px 너비면 % 표시 가능

      if (isLarge) {
        output += `<text x="${x + w / 2}" y="${y + h / 2 - 8}" text-anchor="middle" dominant-baseline="middle" fill="white" font-size="10" opacity="0.85" style="pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,0.3)">${lbl}</text>`;
        output += `<text x="${x + w / 2}" y="${y + h / 2 + 8}" text-anchor="middle" dominant-baseline="middle" fill="white" font-size="14" font-weight="800" style="pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,0.3)">${pct}%</text>`;
      } else if (isMedium) {
        output += `<text x="${x + w / 2}" y="${y + h / 2 - 7}" text-anchor="middle" dominant-baseline="middle" fill="white" font-size="9" opacity="0.85" style="pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,0.3)">${lbl}</text>`;
        output += `<text x="${x + w / 2}" y="${y + h / 2 + 7}" text-anchor="middle" dominant-baseline="middle" fill="white" font-size="12" font-weight="700" style="pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,0.3)">${pct}%</text>`;
      } else if (isSmall) {
        output += `<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="middle" fill="white" font-size="10" font-weight="700" style="pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,0.3)">${pct}%</text>`;
      } else if (isMicro) {
        output += `<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="middle" fill="white" font-size="8.5" font-weight="700" style="pointer-events:none;text-shadow:0 1px 2px rgba(0,0,0,0.2)">${pct}%</text>`;
      }
      return;
    }

    const mid = Math.ceil(rects.length / 2);
    const left = rects.slice(0, mid);
    const right = rects.slice(mid);
    const leftSum = left.reduce((s, i) => s + i.value, 0);
    const rightSum = right.reduce((s, i) => s + i.value, 0);
    const ratio = leftSum / (leftSum + rightSum);

    if (vertical) {
      const lw = w * ratio;
      divide(left, x, y, lw, h, false);
      divide(right, x + lw, y, w - lw, h, false);
    } else {
      const lh = h * ratio;
      divide(left, x, y, w, lh, true);
      divide(right, x, y + lh, w, h - lh, true);
    }
  }

  divide(sorted, 0, 0, W, H, true);
  return `<svg class="treemap-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${output}</svg>`;
}

function svgRadialGrid(items: Array<{ subject: string; A: number; fullMark: number }>): string {
  const W = 340; const H = 220;
  const colSize = W / 2;
  const rowSize = H / 2;
  
  let output = '';

  const config: Record<string, { color: string; iconPath: string; desc: string }> = {
    '다양성': { 
      color: '#06b6d4', 
      iconPath: '<path d="M16 3h5v5M3 21l18-18M3 3l5 5M13 13l3 3M16 21h5v-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
      desc: '분포도' 
    },
    '중복성': { 
      color: '#f59e0b', 
      iconPath: '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
      desc: '의미중복' 
    },
    '편향성': { 
      color: '#6366f1', 
      iconPath: '<path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z"/><path d="M7 21h10M12 3v18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
      desc: '치우침' 
    },
    '충족성': { 
      color: '#10b981', 
      iconPath: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
      desc: '정보량' 
    }
  };

  items.forEach((item, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = col * colSize + colSize / 2;
    const y = row * rowSize + rowSize / 2 - 10;
    const cfg = config[item.subject] || { color: '#6366f1', iconPath: '', desc: '' };
    const r = 38;
    const circ = 2 * Math.PI * r;
    const offset = circ * (1 - item.A / item.fullMark);

    output += `
    <g class="gauge-group" transform="translate(${x}, ${y})" onmouseover="showTip(event, '${item.subject}: ${item.A.toFixed(1)}/10')" onmouseout="hideTip()">
      <circle cx="0" cy="0" r="${r}" fill="none" stroke="#f1f5f9" stroke-width="6" />
      <circle cx="0" cy="0" r="${r}" fill="none" stroke="${cfg.color}" stroke-width="6" stroke-dasharray="${circ}" stroke-dashoffset="${circ}" stroke-linecap="round" transform="rotate(-90)">
        <animate attributeName="stroke-dashoffset" from="${circ}" to="${offset}" dur="1s" fill="freeze" ease="ease-out" />
      </circle>
      <text x="0" y="5" text-anchor="middle" font-size="14" font-weight="800" fill="#1e293b">${item.A.toFixed(1)}</text>
      <g transform="translate(-8, 12) scale(0.6)" style="color:${cfg.color}">
        ${cfg.iconPath}
      </g>
      <text x="0" y="52" text-anchor="middle" font-size="10" font-weight="700" fill="#64748b">${item.subject}</text>
    </g>`;
  });

  return `<svg class="radial-grid-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
    ${output}
  </svg>`;
}

function svgBars(items: Array<{ name: string; nameEn?: string; score: number; group?: 'rag' | 'quality' }>): string {
  const W = 340; const barH = 20; const gap = items.length <= 4 ? 22 : 10; const labelW = 88; const barMaxW = 210;
  const barsH = gap + items.length * (barH + gap);
  const legendY = barsH + (items.length <= 4 ? 56 : 10);
  const totalH = legendY + 16;

  let bars = '';
  items.forEach((item, i) => {
    const y = gap + i * (barH + gap);
    const targetW = Math.max(2, item.score * barMaxW);
    const color = item.score >= 0.85 ? '#10b981' : item.score >= 0.7 ? '#f59e0b' : '#f43f5e';
    const tip = item.nameEn ? `${item.name}(${item.nameEn}): ${item.score.toFixed(3)}` : `${item.name}: ${item.score.toFixed(3)}`;
    const groupPrefix = item.group === 'rag'
      ? `<tspan fill="#0284c7" font-weight="700" font-size="9">RAG </tspan>`
      : item.group === 'quality'
        ? `<tspan fill="#7c3aed" font-weight="700" font-size="9">품질 </tspan>`
        : '';
    bars += `
<text x="${labelW-6}" y="${(y+barH/2+1).toFixed(1)}" text-anchor="end" dominant-baseline="middle" font-size="11" fill="#475569">${groupPrefix}${item.name}</text>
<rect x="${labelW}" y="${y}" width="${barMaxW}" height="${barH}" rx="4" fill="#f1f5f9"/>
<rect class="bar-fill" x="${labelW}" y="${y}" width="${targetW.toFixed(1)}" height="${barH}" rx="4" fill="${color}"
  style="clip-path:inset(0 100% 0 0 round 4px);cursor:pointer;transition:opacity .15s"
  data-delay="${80 + i * 100}"
  onmouseover="this.style.opacity='.7';showTip(event,'${tip}')" onmouseout="this.style.opacity='1';hideTip()"/>
<text x="${(labelW + targetW + 5).toFixed(1)}" y="${(y+barH/2+1).toFixed(1)}" dominant-baseline="middle" font-size="11" fill="#1e293b" font-weight="600">${item.score.toFixed(3)}</text>`;
  });

  // 범례 — 우측 3항목 균등 배치
  const lA = W - 148, lB = W - 96, lC = W - 44;
  const legend = `
<circle cx="${lA}" cy="${legendY+5}" r="4" fill="#10b981"/>
<text x="${lA+8}" y="${legendY+9}" font-size="9" fill="#64748b">≥ 0.85</text>
<circle cx="${lB}" cy="${legendY+5}" r="4" fill="#f59e0b"/>
<text x="${lB+8}" y="${legendY+9}" font-size="9" fill="#64748b">≥ 0.70</text>
<circle cx="${lC}" cy="${legendY+5}" r="4" fill="#f43f5e"/>
<text x="${lC+8}" y="${legendY+9}" font-size="9" fill="#64748b">&lt; 0.70</text>`;

  return `<svg class="bars-svg" width="${W}" height="${totalH}" viewBox="0 0 ${W} ${totalH}" xmlns="http://www.w3.org/2000/svg">
${bars}
${legend}
</svg>`;
}

// ─────────────────────────────────────────────────────────────────────────────

function buildHTMLContent(data: EvaluationData): string {
  const timestamp = toKST(data.metadata?.timestamp);
  const qaModel   = data.metadata?.qa_model   || data.metadata?.model || 'N/A';
  const evalModel = data.metadata?.eval_model || data.metadata?.model || 'N/A';
  const source    = data.metadata?.source ?? 'N/A';

  const intentColorsMap: Record<string, string> = {
    fact:       '#3b7dd8',
    purpose:    '#a855b5',
    how:        '#16a35a',
    condition:  '#d97706',
    comparison: '#4f46e5',
    list:       '#0891b2',
    factoid:    '#3b7dd8',
    numeric:    '#ca8a04',
    procedure:  '#4f46e5',
    why:        '#a855b5',
    definition: '#0284c7',
    boolean:    '#9333ea',
    summary:    '#0891b2',
    confirmation: '#9333ea',
  };

  const treemapSVG = svgTreemap(data.intentDistribution, intentColorsMap);
  const radialSVG  = svgRadialGrid(data.layer1Stats);
  const barsSVG    = svgBars(data.llmQualityScores);

  return `<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <title>QA Evaluation Report</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #1e293b; line-height: 1.6; }
        .container { max-width: 1200px; margin: 0 auto; padding: 40px 20px; }
        header { background: white; padding: 30px; border-radius: 12px; margin-bottom: 30px; box-shadow: 0 1px 3px rgba(0,0,0,.1); border-left: 4px solid #4f46e5; }
        h1 { font-size: 26px; margin-bottom: 8px; }
        .metadata { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-top: 20px; padding-top: 20px; border-top: 1px solid #e2e8f0; }
        .metadata-item .label { color: #64748b; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px; }
        .metadata-item .value { color: #1e293b; font-weight: 600; font-size: 14px; }
        section { margin-bottom: 30px; }
        section h2 { font-size: 18px; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #e2e8f0; }
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px; }
        .stat-card { background: white; padding: 18px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.08); border-left: 4px solid #4f46e5; }
        .stat-label { color: #64748b; font-size: 11px; text-transform: uppercase; font-weight: 600; margin-bottom: 6px; }
        .stat-value { font-size: 22px; font-weight: 700; }
        table { width: 100%; border-collapse: collapse; background: white; border-radius: 10px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
        thead { background: #f1f5f9; }
        th { padding: 12px 14px; text-align: center; font-weight: 600; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; cursor: pointer; user-select: none; white-space: nowrap; }
        th:hover { background: #e2e8f0; }
        th .sort-icon { margin-left: 4px; font-size: 10px; color: #94a3b8; }
        th.sort-active { color: #4f46e5; }
        th.sort-active .sort-icon { color: #4f46e5; }
        td { padding: 10px 14px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: middle; height: 68px; max-height: 68px; overflow: hidden; }
        .cell-clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-height: 44px; }
        .cell-center { text-align: center; }
        tbody tr:last-child td { border-bottom: none; }
        tbody tr:hover { background: #f8fafc; }
        .intent-badge { display: inline-block; padding: 3px 0; border-radius: 5px; font-size: 11px; font-weight: 700; border: 1px solid; min-width: 52px; text-align: center; }
        .score-pass { color: #059669; font-weight: 600; font-family: monospace; }
        .score-fail { color: #dc2626; font-weight: 700; font-family: monospace; }
        .status-pass { display: inline-block; padding: 3px 10px; background: #d1fae5; color: #047857; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid #a7f3d0; }
        .status-hold { display: inline-block; padding: 3px 10px; background: #fef3c7; color: #92400e; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid #fde68a; }
        .status-fail { display: inline-block; padding: 3px 10px; background: #fee2e2; color: #991b1b; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid #fecaca; }
        .failure-hallucination      { display: inline-block; padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid #fecaca; background: #fff1f2; color: #be123c; }
        .failure-faithfulness_error { display: inline-block; padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid #fed7aa; background: #fff7ed; color: #c2410c; }
        .failure-poor_context       { display: inline-block; padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid #bae6fd; background: #f0f9ff; color: #0369a1; }
        .failure-retrieval_miss     { display: inline-block; padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid #fde68a; background: #fffbeb; color: #92400e; }
        .failure-ambiguous_question { display: inline-block; padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid #fef08a; background: #fefce8; color: #854d0e; }
        .failure-bad_chunk          { display: inline-block; padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid #e2e8f0; background: #f8fafc; color: #475569; }
        .failure-evaluation_error   { display: inline-block; padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid #e9d5ff; background: #faf5ff; color: #7e22ce; }
        .failure-low_quality        { display: inline-block; padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid #fbcfe8; background: #fdf2f8; color: #be185d; }
        .failure-syntax_error       { display: inline-block; padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid #fca5a5; background: #fef2f2; color: #b91c1c; }
        .failure-none { color: #cbd5e1; font-size: 12px; }
        .failure-callout { border-radius: 10px; padding: 12px 16px; margin-bottom: 16px; border: 1px solid; }
        .failure-callout .fc-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; opacity: .65; margin-bottom: 4px; }
        .failure-callout .fc-type  { font-weight: 700; font-size: 13px; margin-bottom: 3px; }
        .failure-callout .fc-reason{ font-size: 12px; opacity: .8; line-height: 1.5; }
        footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; text-align: center; color: #94a3b8; font-size: 12px; }
        tbody tr.qa-row { cursor: pointer; }
        tbody tr.qa-row:hover { background: #f0f9ff !important; }
        .pg-wrap { display:flex;align-items:center;justify-content:space-between;margin-top:14px;padding:0 2px; }
        .pg-range { font-size:13px;color:#64748b; }
        .pg-nav { display:flex;align-items:center;gap:6px; }
        .pg-btn { display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:1px solid #e2e8f0;border-radius:6px;background:white;cursor:pointer;font-size:14px;color:#475569;transition:all .15s;line-height:1; }
        .pg-btn:hover:not(:disabled) { background:#f1f5f9;color:#1e293b; }
        .pg-btn:disabled { opacity:.35;cursor:not-allowed; }
        .pg-info { font-size:13px;color:#475569;font-weight:500;min-width:48px;text-align:center; }
        #qa-detail-view { background:white;border-radius:12px;padding:28px 32px;box-shadow:0 1px 3px rgba(0,0,0,.08); }
        .detail-back { display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border:1px solid #e2e8f0;border-radius:8px;background:white;cursor:pointer;font-size:13px;font-weight:500;color:#475569;margin-bottom:20px;transition:all .15s; }
        .detail-back:hover { background:#f1f5f9; }
        .detail-qa-box { border-radius:12px;padding:16px;border:1px solid;margin-bottom:12px; }
        .detail-qa-box-q   { background:#f8fafc;border-color:#f1f5f9; }
        .detail-qa-box-a   { background:rgba(238,242,255,0.6);border-color:#e0e7ff; }
        .detail-qa-box-ctx { background:rgba(255,251,235,0.5);border-color:#fde68a; }
        .detail-qa-label { font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.025em;margin-bottom:8px; }
        .detail-qa-label-q   { color:#94a3b8; }
        .detail-qa-label-a   { color:#818cf8; }
        .detail-qa-label-ctx { color:#f59e0b; }
        .detail-qa-text { font-size:14px;color:#1e293b;line-height:1.65; }
        .detail-context-text { font-size:13px;color:#475569;line-height:1.6;max-height:160px;overflow-y:auto; }
        .detail-section { border-radius:12px;padding:0;margin-bottom:0;overflow:hidden; }
        .detail-section-rag { background:rgba(240,249,255,0.4);border:1px solid #bae6fd; }
        .detail-section-qual { background:rgba(245,243,255,0.4);border:1px solid #ddd6fe; }
        .detail-section-header { display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid; }
        .detail-section-rag .detail-section-header { border-color:#e0f2fe; }
        .detail-section-qual .detail-section-header { border-color:#ede9fe; }
        .detail-section-title { font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.025em;margin:0; }
        .detail-section-rag .detail-section-title { color:#0284c7; }
        .detail-section-qual .detail-section-title { color:#7c3aed; }
        .detail-section-body { padding:0 16px; }
        .detail-metric { display: flex; align-items: flex-start; gap: 15px; padding: 12px 0; border-bottom: 1px solid; transition: background 0.2s; }
        .detail-section-rag .detail-section-body .detail-metric { border-color:#e0f2fe; }
        .detail-section-qual .detail-section-body .detail-metric { border-color:#ede9fe; }
        .detail-metric:last-child { border-bottom:none; }
        .detail-metric-name { width: 160px; shrink: 0; font-weight: 700; color: #64748b; font-size: 12px; }
        .detail-metric-score { width: 60px; shrink: 0; font-family: monospace; font-weight: 800; font-size: 13px; text-align: center; }
        .detail-metric-reason { flex: 1; color: #334155; line-height: 1.6; font-size: 12px; padding-left: 15px; border-left: 1px solid #f1f5f9; }
        .score-emerald { color: #059669; }
        .score-amber   { color: #d97706; }
        .score-rose    { color: #e11d48; }
        .score-none    { color: #cbd5e1; }
        .detail-failure-callout { background:#fff1f2;border:1px solid #fecaca;border-radius:10px;padding:14px 18px;margin-bottom:16px; }
        .detail-failure-callout-title { font-size:12px;font-weight:700;color:#991b1b;margin-bottom:4px; }
        .detail-failure-callout-text { font-size:13px;color:#dc2626;line-height:1.55; }
        @media print { body { background: white; } section { page-break-inside: avoid; } }
        .chart-card { background: white; padding: 20px 20px 16px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,.08); display: flex; flex-direction: column; align-items: flex-start; }
        .chart-card-inner { width: 100%; display: flex; flex-direction: column; align-items: center; }
        .chart-title { font-size: 15px; font-weight: 600; color: #1e293b; display: flex; align-items: center; gap: 6px; margin-bottom: 2px; }
        .chart-sub { font-size: 11px; color: #64748b; margin-bottom: 10px; }
    </style>
</head>
<body>
<div class="container">
    <header>
        <h1>📊 QA Evaluation Report</h1>
        <p style="color:#64748b;font-size:13px">QA 데이터셋 품질 평가 결과 리포트</p>
        <div class="metadata">
            <div class="metadata-item"><div class="label">QA 생성 모델</div><div class="value">${qaModel}</div></div>
            <div class="metadata-item"><div class="label">평가 모델</div><div class="value">${evalModel}</div></div>
            <div class="metadata-item"><div class="label">출처 문서</div><div class="value">${source}</div></div>
            <div class="metadata-item"><div class="label">평가 일시</div><div class="value">${timestamp}</div></div>
        </div>
    </header>

    <section>
        <h2>📈 요약 통계</h2>
        <div class="stats-grid">
            ${data.summaryStats.map((s) => `<div class="stat-card"><div class="stat-label">${s.label}</div><div class="stat-value">${s.value}</div></div>`).join('')}
        </div>
    </section>

    <section>
        <h2>📊 시각화 차트</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px;">
            <div class="chart-card">
                <div class="chart-title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#06b6d4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
                  질문 의도 분포
                </div>
                <div class="chart-sub">질문 의도 분포</div>
                <div class="chart-card-inner" style="margin-top:10px">${treemapSVG}</div>
            </div>
            <div class="chart-card">
                <div class="chart-title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  데이터 통계
                </div>
                <div class="chart-sub">구조적·통계적 검증</div>
                <div class="chart-card-inner">${radialSVG}</div>
            </div>
            <div class="chart-card">
                <div class="chart-title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
                  통합 품질 평가 점수
                </div>
                <div class="chart-sub">RAG Triad + 품질 평가 통합 점수</div>
                <div class="chart-card-inner" style="margin-top:10px">${barsSVG}</div>
            </div>
        </div>
    </section>


    <section>
        <h2>📋 QA 상세 평가 결과</h2>
        <div id="qa-list-view">
            <table id="qa-table">
                <thead><tr>
                  <th onclick="sortTable('id')"      id="th-id">ID<span class="sort-icon">⇅</span></th>
                  <th onclick="sortTable('intent')"  id="th-intent">의도<span class="sort-icon">⇅</span></th>
                  <th onclick="sortTable('q')"       id="th-q">질문<span class="sort-icon">⇅</span></th>
                  <th onclick="sortTable('a')"       id="th-a">답변<span class="sort-icon">⇅</span></th>
                  <th onclick="sortTable('quality')" id="th-quality">품질<span class="sort-icon">⇅</span></th>
                  <th onclick="sortTable('triad')"   id="th-triad">Triad<span class="sort-icon">⇅</span></th>
                  <th onclick="sortTable('status')"  id="th-status">상태<span class="sort-icon">⇅</span></th>
                  <th onclick="sortTable('failure')" id="th-failure">실패유형<span class="sort-icon">⇅</span></th>
                </tr></thead>
                <tbody id="qa-tbody"></tbody>
            </table>
            <div class="pg-wrap">
                <span class="pg-range" id="pg-range"></span>
                <div class="pg-nav">
                    <button class="pg-btn" id="pg-prev" onclick="changePage(-1)">&#8249;</button>
                    <span class="pg-info" id="pg-info"></span>
                    <button class="pg-btn" id="pg-next" onclick="changePage(1)">&#8250;</button>
                </div>
            </div>
        </div>
        <div id="qa-detail-view" style="display:none"></div>
    </section>

    <footer>Generated on ${timestamp} · Auto Evaluation Dashboard</footer>
</div>

<div id="tip" style="position:fixed;pointer-events:none;display:none;background:#1e293b;color:#f8fafc;padding:6px 11px;border-radius:7px;font-size:12px;font-weight:500;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,.25);white-space:nowrap;"></div>
<script>
function showTip(e,t){var el=document.getElementById('tip');el.textContent=t;el.style.display='block';el.style.left=(e.clientX+14)+'px';el.style.top=(e.clientY-10)+'px';}
function hideTip(){document.getElementById('tip').style.display='none';}
document.addEventListener('mousemove',function(e){var el=document.getElementById('tip');if(el.style.display!=='none'){el.style.left=(e.clientX+14)+'px';el.style.top=(e.clientY-10)+'px';}});

// Radial Grid 애니메이션은 SVG 내부에 선언됨 (animate tag)

function animateBars(){
  document.querySelectorAll('.bar-fill').forEach(function(bar){
    var delay=+(bar.getAttribute('data-delay')||0);
    setTimeout(function(){
      bar.style.transition='clip-path 700ms ease-out';
      bar.style.clipPath='inset(0 0% 0 0 round 4px)';
    },delay);
  });
}

function initAnimations(){
  // animateRadar(); // 제거됨
  animateBars();
  renderQATable(0);
}
window.onload = initAnimations;

var QA_DATA=${JSON.stringify(data.detailedQA).replace(/<\/script>/gi,'<\\/script>')};
var QA_PAGE_SIZE=5;
var qaCurrentPage=0;
var qaSortCol='id';
var qaSortDir='asc';
var qaSortedData=QA_DATA.slice().sort(function(a,b){return (a.id||0)-(b.id||0);});
var INTENT_KR_JS={fact:'사실형',purpose:'원인형',how:'방법형',condition:'조건형',comparison:'비교형',list:'열거형',factoid:'사실형',numeric:'수치형',procedure:'절차형',why:'원인형',definition:'정의형',boolean:'확인형'};
var INTENT_COLORS_JS={fact:'#3b82f6',purpose:'#d946ef',how:'#22c55e',condition:'#f59e0b',comparison:'#6366f1',list:'#06b6d4',factoid:'#3b82f6',numeric:'#eab308',procedure:'#6366f1',why:'#d946ef',definition:'#0ea5e9',boolean:'#c026d3'};
var FAILURE_KR_JS={hallucination:'환각오류',faithfulness_error:'근거오류',poor_context:'문맥부족',retrieval_miss:'검색오류',ambiguous_question:'질문모호',bad_chunk:'불량청크',evaluation_error:'평가오류',low_quality:'품질미달',syntax_error:'구문오류'};
var STATUS_ORDER={성공:0,보류:1,실패:2};

function escHtml(s){if(!s)return'-';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function scoreColor(v){return v>=0.85?'#059669':v>=0.7?'#d97706':'#dc2626';}
function qaStatus(qa){
  if (!qa) return '실패';
  var l2 = (qa.l2_avg === undefined || qa.l2_avg === null) ? 0 : qa.l2_avg;
  var tr = (qa.triad_avg === undefined || qa.triad_avg === null) ? 0 : qa.triad_avg;
  var qFail = l2 < 0.7;
  var rFail = tr < 0.7;
  
  if (qFail && rFail) return '실패';
  
  var hasError = (qa.pass === false) || (qa.failure_types && qa.failure_types.length > 0);
  if (!qFail && !rFail && hasError) return '보류';
  
  if (qFail || rFail) return '보류';
  return '성공';
}

function sortTable(col){
  if(qaSortCol===col){qaSortDir=qaSortDir==='asc'?'desc':'asc';}
  else{qaSortCol=col;qaSortDir='asc';}
  qaSortedData=QA_DATA.slice().sort(function(a,b){
    var av,bv;
    if(col==='id'){av=a.id;bv=b.id;}
    else if(col==='intent'){av=a.intent||'';bv=b.intent||'';}
    else if(col==='q'){av=a.q||'';bv=b.q||'';}
    else if(col==='a'){av=a.a||'';bv=b.a||'';}
    else if(col==='quality'){av=(a.l2_avg===undefined?-1:a.l2_avg);bv=(b.l2_avg===undefined?-1:b.l2_avg);}
    else if(col==='triad'){av=(a.triad_avg===undefined?-1:a.triad_avg);bv=(b.triad_avg===undefined?-1:b.triad_avg);}
    else if(col==='status'){
      var as=qaStatus(a),bs=qaStatus(b);
      av=(STATUS_ORDER[as]===undefined?9:STATUS_ORDER[as]);
      bv=(STATUS_ORDER[bs]===undefined?9:STATUS_ORDER[bs]);
    }
    else if(col==='failure'){av=a.primary_failure||'';bv=b.primary_failure||'';}
    else return 0;
    if(av<bv)return qaSortDir==='asc'?-1:1;
    if(av>bv)return qaSortDir==='asc'?1:-1;
    return 0;
  });
  document.querySelectorAll('thead th').forEach(function(th){
    th.classList.remove('sort-active');
    var icon=th.querySelector('.sort-icon');
    if(icon)icon.textContent='⇅';
  });
  var activeTh=document.getElementById('th-'+col);
  if(activeTh){
    activeTh.classList.add('sort-active');
    var icon=activeTh.querySelector('.sort-icon');
    if(icon)icon.textContent=qaSortDir==='asc'?'▲':'▼';
  }
  renderQATable(0);
}

function renderQATable(page){
  qaCurrentPage=page;
  var data=qaSortedData;
  var start=page*QA_PAGE_SIZE,end=Math.min(start+QA_PAGE_SIZE,data.length);
  var totalPages=Math.ceil(data.length/QA_PAGE_SIZE)||1;
  var rows='';
  for(var i=start;i<end;i++){
    var qa=data[i];
    var statusLabel=qaStatus(qa);
    var statusCls=statusLabel==='실패'?'status-fail':statusLabel==='보류'?'status-hold':'status-pass';
    var color=INTENT_COLORS_JS[qa.intent]||'#4f46e5';
    var failKey=qa.primary_failure||null;
    var failBadge=failKey?'<span class="failure-'+failKey+'">'+(FAILURE_KR_JS[failKey]||failKey)+'</span>':'<span class="failure-none">-</span>';
    var origIdx=QA_DATA.indexOf(qa);
    var qF = (qa.l2_avg || 0) < 0.7, rF = (qa.triad_avg || 0) < 0.7;
    rows+='<tr class="qa-row" onclick="showQADetail('+origIdx+')">'
      +'<td class="cell-center"><strong>'+qa.id+'</strong></td>'
      +'<td class="cell-center"><div class="intent-badge" style="background:'+color+'18;border-color:'+color+'35;color:'+color+'">'+(INTENT_KR_JS[qa.intent]||qa.intent)+'</div></td>'
      +'<td style="max-width:260px"><div class="cell-clamp">'+escHtml(qa.q)+'</div></td>'
      +'<td style="max-width:240px;color:#475569"><div class="cell-clamp">'+escHtml(qa.a||'-')+'</div></td>'
      +'<td class="cell-center"><span class="'+(qF?'score-fail':'score-pass')+'"> ' + (qa.l2_avg || 0).toFixed(3) + '</span></td>'
      +'<td class="cell-center"><span class="'+(rF?'score-fail':'score-pass')+'"> ' + (qa.triad_avg || 0).toFixed(3) + '</span></td>'
      +'<td class="cell-center"><span class="'+statusCls+'">'+statusLabel+'</span></td>'
      +'<td class="cell-center">'+failBadge+'</td>'
      +'</tr>';
  }
  document.getElementById('qa-tbody').innerHTML=rows;
  document.getElementById('pg-info').textContent=(page+1)+' / '+totalPages;
  document.getElementById('pg-range').textContent=(start+1)+'–'+end+' / '+data.length+'개';
  document.getElementById('pg-prev').disabled=page===0;
  document.getElementById('pg-next').disabled=end>=data.length;
  document.getElementById('qa-list-view').style.display='';
  document.getElementById('qa-detail-view').style.display='none';
}

function changePage(delta){
  var total=Math.ceil(qaSortedData.length/QA_PAGE_SIZE)||1;
  var next=qaCurrentPage+delta;
  if(next>=0&&next<total)renderQATable(next);
}

var qaCurrentDetailOrigIdx=0;

function showQADetail(idx){
  qaCurrentDetailOrigIdx=idx;
  var qa=QA_DATA[idx];
  var statusLabel=qaStatus(qa);
  var statusCls=statusLabel==='실패'?'status-fail':statusLabel==='보류'?'status-hold':'status-pass';
  var color=INTENT_COLORS_JS[qa.intent]||'#4f46e5';
  var failKey=qa.primary_failure||null;
  // failure 타입별 callout 배경/보더/텍스트 색상
  var FAILURE_CALLOUT_STYLE={
    hallucination:      {bg:'#fff1f2',bd:'#fecaca',tx:'#be123c'},
    faithfulness_error: {bg:'#fff7ed',bd:'#fed7aa',tx:'#c2410c'},
    poor_context:       {bg:'#f0f9ff',bd:'#bae6fd',tx:'#0369a1'},
    retrieval_miss:     {bg:'#fffbeb',bd:'#fde68a',tx:'#92400e'},
    ambiguous_question: {bg:'#fefce8',bd:'#fef08a',tx:'#854d0e'},
    bad_chunk:          {bg:'#f8fafc',bd:'#e2e8f0',tx:'#475569'},
    evaluation_error:   {bg:'#faf5ff',bd:'#e9d5ff',tx:'#7e22ce'},
    low_quality:        {bg:'#fdf2f8',bd:'#fbcfe8',tx:'#be185d'},
    syntax_error:       {bg:'#fef2f2',bd:'#fca5a5',tx:'#b91c1c'},
  };
  var failureCallout='';
  if(failKey){
    var fcs=FAILURE_CALLOUT_STYLE[failKey]||{bg:'#f8fafc',bd:'#e2e8f0',tx:'#475569'};
    failureCallout='<div class="failure-callout" style="background:'+fcs.bg+';border-color:'+fcs.bd+';color:'+fcs.tx+'">'
      +'<p class="fc-label">주요 실패 유형</p>'
      +'<p class="fc-type">'+(FAILURE_KR_JS[failKey]||failKey)+'</p>'
      +(qa.failure_reason?'<p class="fc-reason">'+escHtml(qa.failure_reason)+'</p>':'')
      +'</div>';
  }
  // 구형 데이터 판별: factuality_reason / specificity_reason / conciseness_reason 존재 여부
  var isLegacy=!!(qa.factuality_reason||qa.specificity_reason||qa.conciseness_reason);
  var ragMetrics=[
    {name:'관련성 (Answer Relevance)',  score: qa.relevance,         reason:qa.relevance_reason},
    {name:'근거성 (Groundedness)',      score: qa.groundedness,      reason:qa.groundedness_reason},
    ...(qa.clarity_reason
      ? [{name:'명확성 (Clarity)',      score: qa.clarity,           reason:qa.clarity_reason}]
      : qa.context_relevance_reason
        ? [{name:'맥락성 (Context Relevance)', score: qa.context_relevance, reason:qa.context_relevance_reason}]
        : []
    )
  ];
  // 신규: 완전성만 / 구형: 사실성·완전성·구체성·간결성
  var qualMetrics=isLegacy?[
    {name:'사실성 (Factuality)',   score: qa.factuality,   reason:qa.factuality_reason},
    {name:'완전성 (Completeness)', score: qa.completeness, reason:qa.completeness_reason},
    {name:'구체성 (Specificity)',   score: qa.specificity,   reason:qa.specificity_reason},
    {name:'간결성 (Conciseness)',   score: qa.conciseness,   reason:qa.conciseness_reason}
  ]:[
    {name:'완전성 (Completeness)', score: qa.completeness, reason:qa.completeness_reason}
  ];
  var allMetrics=ragMetrics.concat(qualMetrics);
  var allRows=allMetrics.map(function(m){
    var s = m.score;
    var sStr = (s !== undefined && s !== null) ? s.toFixed(3) : '-';
    var sCls = (s !== undefined && s !== null) ? (s >= 0.85 ? 'score-emerald' : s >= 0.7 ? 'score-amber' : 'score-rose') : 'score-none';
    
    return '<div class="detail-metric">'
      +'<div class="detail-metric-name">'+m.name+'</div>'
      +'<div class="detail-metric-score '+sCls+'">'+sStr+'</div>'
      +(m.reason?'<div class="detail-metric-reason">'+escHtml(m.reason)+'</div>':'<div class="detail-metric-reason" style="color:#cbd5e1">사유 없음</div>')
      +'</div>';
  }).join('');
  var scoreHeader='';
  if(isLegacy){
    // 구형(7개): RAG + 품질 각각 표시
    scoreHeader=''
      +(qa.triad_avg!=null?'<span style="font-size:10px;color:#64748b">RAG</span> <span style="font-family:monospace;font-size:12px;font-weight:700;color:#0284c7">'+qa.triad_avg.toFixed(3)+'</span>':'')
      +(qa.triad_avg!=null&&qa.l2_avg!=null?' <span style="color:#cbd5e1;margin:0 4px">·</span> ':'')
      +(qa.l2_avg!=null?'<span style="font-size:10px;color:#64748b">품질</span> <span style="font-family:monospace;font-size:12px;font-weight:700;color:#7c3aed">'+qa.l2_avg.toFixed(3)+'</span>':'');
  } else {
    // 신규(4개): (rag×3 + quality) / 4 단일 점수
    var unifiedScore=((qa.triad_avg||0)*3+(qa.l2_avg||0))/4;
    var uColor=unifiedScore>=0.85?'#059669':unifiedScore>=0.7?'#d97706':'#e11d48';
    scoreHeader='<span style="font-family:monospace;font-size:14px;font-weight:900;color:'+uColor+'">'+unifiedScore.toFixed(3)+'</span>';
  }
  var html='<button class="detail-back" onclick="showQAList()">← 목록으로</button>'
    +'<div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;flex-wrap:wrap">'
    +'<strong style="font-size:20px;color:#1e293b">#'+qa.id+'</strong>'
    +'<div class="intent-badge" style="background:'+color+'18;border-color:'+color+'35;color:'+color+'">'+(INTENT_KR_JS[qa.intent]||qa.intent)+'</div>'
    +'<span class="'+statusCls+'">'+statusLabel+'</span>'
    +'</div>'
    +failureCallout
    +'<div class="detail-qa-box detail-qa-box-q">'
    +'<p class="detail-qa-label detail-qa-label-q">질문</p>'
    +'<p class="detail-qa-text">'+escHtml(qa.q)+'</p>'
    +'</div>'
    +'<div class="detail-qa-box detail-qa-box-a">'
    +'<p class="detail-qa-label detail-qa-label-a">답변</p>'
    +'<p class="detail-qa-text" style="color:#475569">'+escHtml(qa.a||'-')+'</p>'
    +'</div>'
    +(qa.context?'<div class="detail-qa-box detail-qa-box-ctx"><p class="detail-qa-label detail-qa-label-ctx">컨텍스트</p><p class="detail-context-text">'+escHtml(qa.context)+'</p></div>':'')
    +'<div style="margin-top:4px">'
    +'<div class="detail-section detail-section-qual">'
    +'<div class="detail-section-header"><p class="detail-section-title">품질 평가</p><div style="display:flex;align-items:center;gap:4px">'+scoreHeader+'</div></div>'
    +'<div class="detail-section-body">'+allRows+'</div>'
    +'</div>'
    +'</div>'
    +(function(){
      var sortedPos=qaSortedData.indexOf(QA_DATA[idx]);
      var hasPrev=sortedPos>0;
      var hasNext=sortedPos<qaSortedData.length-1;
      var prevIdx=hasPrev?QA_DATA.indexOf(qaSortedData[sortedPos-1]):-1;
      var nextIdx=hasNext?QA_DATA.indexOf(qaSortedData[sortedPos+1]):-1;
      return '<div style="display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:16px;padding-top:12px;border-top:1px solid #f1f5f9">'
        +'<span style="font-size:12px;color:#94a3b8">'+(sortedPos+1)+' / '+qaSortedData.length+'</span>'
        +'<button class="pg-btn" '+(hasPrev?'onclick="showQADetail('+prevIdx+')"':'disabled')+'>&#8592;</button>'
        +'<button class="pg-btn" '+(hasNext?'onclick="showQADetail('+nextIdx+')"':'disabled')+'>&#8594;</button>'
        +'</div>';
    })();
  document.getElementById('qa-detail-view').innerHTML=html;
  document.getElementById('qa-list-view').style.display='none';
  document.getElementById('qa-detail-view').style.display='';
  window.scrollTo({top:document.getElementById('qa-detail-view').offsetTop-20,behavior:'smooth'});
}

function showQAList(){
  document.getElementById('qa-list-view').style.display='';
  document.getElementById('qa-detail-view').style.display='none';
}

window.addEventListener('load',function(){animateBars();animateDonut();animateRadar();renderQATable(0);});
</script>
</body>
</html>`;
}

export function exportToHTML(data: EvaluationData): void {
  const htmlContent = buildHTMLContent(data);
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', `evaluation-report-${new Date().toISOString().slice(0, 10)}.html`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export evaluation results to JSON (정제된 구조)
 */
export function exportToJSON(data: EvaluationData): void {
  const qaModel   = data.metadata?.qa_model   || data.metadata?.model || '-';
  const evalModel = data.metadata?.eval_model || data.metadata?.model || '-';

  const cleaned = {
    metadata: {
      qa_model:   qaModel,
      eval_model: evalModel,
      timestamp:  data.metadata?.timestamp ?? new Date().toISOString(),
      source:     data.metadata?.source ?? '-',
    },
    // icon / color / bg 제거, label + value만
    summaryStats: data.summaryStats.map(({ label, value }) => ({ label, value })),
    // A → score, fullMark 제거
    layer1Stats: data.layer1Stats.map(({ subject, A }) => ({ subject, score: +A.toFixed(3) })),
    // name/label/krLabel 통합 → "factoid(사실형)" 형식
    intentDistribution: data.intentDistribution.map((d) => ({
      label: d.krLabel ? `${d.name}(${d.krLabel})` : (d.label ?? d.name),
      count: d.value,
    })),
    // name + nameEn → "사실성(Factuality)" 형식
    llmQualityScores: data.llmQualityScores.map((s) => ({
      metric: s.nameEn ? `${s.name}(${s.nameEn})` : s.name,
      score:  +s.score.toFixed(4),
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
        quality_avg: +qa.l2_avg.toFixed(4),
        triad_avg:   +qa.triad_avg.toFixed(4),
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

/**
 * Export evaluation results to ZIP (XLSX + HTML 묶음)
 */
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
