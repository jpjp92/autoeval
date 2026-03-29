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
  factoid:    '사실형',
  numeric:    '수치형',
  procedure:  '절차형',
  why:        '원인형',
  definition: '정의형',
  boolean:    '확인형',
};

const FAILURE_KR: Record<string, string> = {
  hallucination:      '환각오류',
  faithfulness_error: '근거오류',
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

  statsRows.push(['[ 의도 분류 ]', '']);
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
    const qFail = qa.l2_avg    < 0.7;
    const rFail = qa.triad_avg < 0.7;
    const status = qFail && rFail ? '실패' : (qFail || rFail) ? '보류' : '성공';
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

function svgDonut(
  items: Array<{ name: string; krLabel?: string; label?: string; value: number }>,
  colorMap: Record<string, string>,
): string {
  const W = 260; const cx = 130; const cy = 90; const R = 70; const r = 44;
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total === 0) return `<svg width="${W}" height="200"></svg>`;

  // 슬라이스 paths (full angle — 애니메이션은 clipPath가 담당)
  let paths = ''; let angle = -Math.PI / 2;
  for (const item of items) {
    const sweep = (item.value / total) * 2 * Math.PI;
    if (sweep === 0) { angle += sweep; continue; }
    const end = angle + sweep;
    const lg = sweep > Math.PI ? 1 : 0;
    const c0 = Math.cos(angle), s0 = Math.sin(angle), c1 = Math.cos(end), s1 = Math.sin(end);
    const d = `M ${(cx+R*c0).toFixed(1)} ${(cy+R*s0).toFixed(1)} A ${R} ${R} 0 ${lg} 1 ${(cx+R*c1).toFixed(1)} ${(cy+R*s1).toFixed(1)} L ${(cx+r*c1).toFixed(1)} ${(cy+r*s1).toFixed(1)} A ${r} ${r} 0 ${lg} 0 ${(cx+r*c0).toFixed(1)} ${(cy+r*s0).toFixed(1)} Z`;
    const pct = ((item.value / total) * 100).toFixed(1);
    const lbl = item.krLabel ?? item.label ?? item.name;
    paths += `<path d="${d}" fill="${colorMap[item.name] ?? '#94a3b8'}" opacity="0.85" style="cursor:pointer;transition:opacity .15s" onmouseover="this.style.opacity=1;showTip(event,'${lbl}: ${item.value}개 (${pct}%)')" onmouseout="this.style.opacity=.85;hideTip()"/>`;
    angle = end;
  }

  // 4열 원형 범례 (평가 페이지 동일)
  const cols = 4; const colW = Math.floor(W / cols);
  const legendItems = items.map((item, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const lx = col * colW + 6, ly = 194 + row * 18;
    const lbl = item.krLabel ?? item.label ?? item.name;
    return `<circle cx="${lx+4}" cy="${ly-3}" r="4" fill="${colorMap[item.name] ?? '#94a3b8'}"/>
<text x="${lx+12}" y="${ly}" font-size="10" fill="#475569">${lbl}</text>`;
  }).join('');
  const legendRows = Math.ceil(items.length / cols);
  const H = 190 + legendRows * 18 + 8;

  // 애니메이션용 clipPath (초기: 점 → JS가 sweep 확장)
  const clipId = 'dc';
  const initX = (cx + R * Math.cos(-Math.PI / 2)).toFixed(1);
  const initY = (cy + R * Math.sin(-Math.PI / 2)).toFixed(1);

  return `<svg class="donut-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"
  data-cx="${cx}" data-cy="${cy}" data-r="${R}">
  <defs><clipPath id="${clipId}"><path class="donut-clip" d="M ${cx} ${cy} L ${initX} ${initY} Z"/></clipPath></defs>
  <g clip-path="url(#${clipId})">${paths}</g>
  ${legendItems}
</svg>`;
}

function svgRadar(items: Array<{ subject: string; A: number; fullMark: number }>): string {
  const W = 260; const H = 246; const cx = 130; const cy = 100; const maxR = 74; const n = items.length;
  const ang = (i: number) => (i / n) * 2 * Math.PI - Math.PI / 2;
  const pt  = (i: number, rr: number): [number, number] => [cx + rr * Math.cos(ang(i)), cy + rr * Math.sin(ang(i))];

  let grid = '';
  for (let lv = 1; lv <= 4; lv++) {
    const rr = maxR * lv / 4;
    const pts = Array.from({ length: n }, (_, i) => pt(i, rr));
    grid += `<polygon points="${pts.map(([x,y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="${lv===4?'#f8fafc':'none'}" stroke="#e2e8f0" stroke-width="1"/>`;
  }
  let axes = '';
  for (let i = 0; i < n; i++) {
    const [ox, oy] = pt(i, maxR);
    axes += `<line x1="${cx}" y1="${cy}" x2="${ox.toFixed(1)}" y2="${oy.toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>`;
  }

  // 데이터 폴리곤: 애니메이션을 위해 center points로 시작, target을 data 속성에 저장
  const dpts = items.map((item, i) => pt(i, (item.A / item.fullMark) * maxR));
  const targetPts = JSON.stringify(dpts.map(([x,y]) => [+x.toFixed(2), +y.toFixed(2)]));
  const centerPts = Array.from({ length: n }, () => `${cx},${cy}`).join(' ');
  const polygon = `<polygon class="radar-polygon" points="${centerPts}" fill="#6366f1" fill-opacity="0.2" stroke="#6366f1" stroke-width="2" data-target='${targetPts}' data-cx="${cx}" data-cy="${cy}"/>`;

  // 점: center에서 시작
  const dots = items.map((item, i) => {
    const [tx, ty] = dpts[i];
    return `<circle class="radar-dot" cx="${cx}" cy="${cy}" r="5" fill="#6366f1" stroke="white" stroke-width="2" data-tx="${tx.toFixed(2)}" data-ty="${ty.toFixed(2)}" style="cursor:pointer;transition:r .15s" onmouseover="this.setAttribute('r','7');showTip(event,'${item.subject}: ${item.A.toFixed(2)} / ${item.fullMark}')" onmouseout="this.setAttribute('r','5');hideTip()"/>`;
  }).join('');

  const labels = items.map((item, i) => {
    const [lx, ly] = pt(i, maxR + 20);
    return `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="11" fill="#64748b" font-weight="500">${item.subject}</text>`;
  }).join('');

  // 통합 점수 (layer1Stats 평균)
  const intScore = (items.reduce((s, i) => s + i.A, 0) / items.length).toFixed(1);

  return `<svg class="radar-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
${grid}${axes}${polygon}${dots}${labels}
<text x="${cx}" y="${H-20}" text-anchor="middle" font-size="11" fill="#64748b">통합 점수:
  <tspan font-weight="700" fill="#6366f1"> ${intScore} / 10</tspan>
</text>
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
    // 신규 6종
    fact: '#3b82f6', purpose: '#d946ef', how: '#22c55e',
    condition: '#f59e0b', comparison: '#6366f1', list: '#06b6d4',
    // 구형 8종 (하위 호환)
    factoid: '#3b82f6', numeric: '#eab308', procedure: '#6366f1',
    why: '#d946ef', definition: '#0ea5e9', boolean: '#c026d3',
  };

  const donutSVG  = svgDonut(data.intentDistribution, intentColorsMap);
  const radarSVG  = svgRadar(data.layer1Stats);
  const barsSVG   = svgBars(data.llmQualityScores);

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
        .detail-metric { padding:10px 0;border-bottom:1px solid; }
        .detail-section-rag .detail-section-body .detail-metric { border-color:#e0f2fe; }
        .detail-section-qual .detail-section-body .detail-metric { border-color:#ede9fe; }
        .detail-metric { padding:8px 0;border-bottom:1px solid; }
        .detail-metric:last-child { border-bottom:none; }
        .detail-metric-name { font-size:13px;font-weight:600;color:#334155;margin-bottom:4px; }
        .detail-metric-reason { font-size:12px;color:#64748b;line-height:1.55; }
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
                  의도 분류
                </div>
                <div class="chart-sub">질문 유형 분포</div>
                <div class="chart-card-inner">${donutSVG}</div>
            </div>
            <div class="chart-card">
                <div class="chart-title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  데이터 통계
                </div>
                <div class="chart-sub">구조적·통계적 검증 (0–10)</div>
                <div class="chart-card-inner">${radarSVG}</div>
            </div>
            <div class="chart-card">
                <div class="chart-title">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
                  통합 품질 평가 점수
                </div>
                <div class="chart-sub">RAG Triad + 품질 평가 통합 점수</div>
                <div class="chart-card-inner">${barsSVG}</div>
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

function animateDonut(){
  document.querySelectorAll('.donut-svg').forEach(function(svg){
    var cx=+svg.getAttribute('data-cx'),cy=+svg.getAttribute('data-cy'),R=+svg.getAttribute('data-r');
    var clip=svg.querySelector('.donut-clip');
    if(!clip)return;
    var ix=(cx+R*Math.cos(-Math.PI/2)).toFixed(1),iy=(cy+R*Math.sin(-Math.PI/2)).toFixed(1);
    var st=null,dur=900;
    function step(ts){
      if(!st)st=ts;
      var t=Math.min((ts-st)/dur,1);
      var e=t<0.5?2*t*t:-1+(4-2*t)*t;
      if(t>=1){clip.setAttribute('d','M 0 0 H 9999 V 9999 H 0 Z');}
      else{
        var a=-Math.PI/2+e*2*Math.PI,lg=e>0.5?1:0;
        clip.setAttribute('d','M '+cx+' '+cy+' L '+ix+' '+iy+' A '+R+' '+R+' 0 '+lg+' 1 '+(cx+R*Math.cos(a)).toFixed(1)+' '+(cy+R*Math.sin(a)).toFixed(1)+' Z');
      }
      if(t<1)requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
}

function animateRadar(){
  document.querySelectorAll('.radar-polygon').forEach(function(poly){
    var cx=+poly.getAttribute('data-cx'),cy=+poly.getAttribute('data-cy');
    var targets=JSON.parse(poly.getAttribute('data-target'));
    var dots=poly.closest('svg').querySelectorAll('.radar-dot');
    var st=null,dur=900;
    function step(ts){
      if(!st)st=ts;
      var t=Math.min((ts-st)/dur,1);
      var e=t<0.5?2*t*t:-1+(4-2*t)*t;
      var pts=targets.map(function(p){return (cx+(p[0]-cx)*e).toFixed(2)+','+(cy+(p[1]-cy)*e).toFixed(2);});
      poly.setAttribute('points',pts.join(' '));
      dots.forEach(function(dot,i){
        if(i>=targets.length)return;
        var tx=+dot.getAttribute('data-tx'),ty=+dot.getAttribute('data-ty');
        dot.setAttribute('cx',(cx+(tx-cx)*e).toFixed(2));
        dot.setAttribute('cy',(cy+(ty-cy)*e).toFixed(2));
      });
      if(t<1)requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
}

function animateBars(){
  document.querySelectorAll('.bar-fill').forEach(function(bar){
    var delay=+(bar.getAttribute('data-delay')||0);
    setTimeout(function(){
      bar.style.transition='clip-path 700ms ease-out';
      bar.style.clipPath='inset(0 0% 0 0 round 4px)';
    },delay);
  });
}

var QA_DATA=${JSON.stringify(data.detailedQA).replace(/<\/script>/gi,'<\\/script>')};
var QA_PAGE_SIZE=5;
var qaCurrentPage=0;
var qaSortCol=null;
var qaSortDir='asc';
var qaSortedData=QA_DATA.slice();
var INTENT_KR_JS={fact:'사실형',purpose:'원인형',how:'방법형',condition:'조건형',comparison:'비교형',list:'열거형',factoid:'사실형',numeric:'수치형',procedure:'절차형',why:'원인형',definition:'정의형',boolean:'확인형'};
var INTENT_COLORS_JS={fact:'#3b82f6',purpose:'#d946ef',how:'#22c55e',condition:'#f59e0b',comparison:'#6366f1',list:'#06b6d4',factoid:'#3b82f6',numeric:'#eab308',procedure:'#6366f1',why:'#d946ef',definition:'#0ea5e9',boolean:'#c026d3'};
var FAILURE_KR_JS={hallucination:'환각오류',faithfulness_error:'근거오류',retrieval_miss:'검색오류',ambiguous_question:'질문모호',bad_chunk:'불량청크',evaluation_error:'평가오류',low_quality:'품질미달',syntax_error:'구문오류'};
var STATUS_ORDER={성공:0,보류:1,실패:2};

function escHtml(s){if(!s)return'-';return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function scoreColor(v){return v>=0.85?'#059669':v>=0.7?'#d97706':'#dc2626';}
function qaStatus(qa){var qF=qa.l2_avg<0.7,rF=qa.triad_avg<0.7;return qF&&rF?'실패':(qF||rF)?'보류':'성공';}

function sortTable(col){
  if(qaSortCol===col){qaSortDir=qaSortDir==='asc'?'desc':'asc';}
  else{qaSortCol=col;qaSortDir='asc';}
  qaSortedData=QA_DATA.slice().sort(function(a,b){
    var av,bv;
    if(col==='id'){av=a.id;bv=b.id;}
    else if(col==='intent'){av=a.intent||'';bv=b.intent||'';}
    else if(col==='q'){av=a.q||'';bv=b.q||'';}
    else if(col==='a'){av=a.a||'';bv=b.a||'';}
    else if(col==='quality'){av=a.l2_avg??-1;bv=b.l2_avg??-1;}
    else if(col==='triad'){av=a.triad_avg??-1;bv=b.triad_avg??-1;}
    else if(col==='status'){av=STATUS_ORDER[qaStatus(a)]??9;bv=STATUS_ORDER[qaStatus(b)]??9;}
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
    var qFail=qa.l2_avg<0.7,rFail=qa.triad_avg<0.7;
    var statusLabel=qFail&&rFail?'실패':(qFail||rFail)?'보류':'성공';
    var statusCls=qFail&&rFail?'status-fail':(qFail||rFail)?'status-hold':'status-pass';
    var color=INTENT_COLORS_JS[qa.intent]||'#4f46e5';
    var failKey=qa.primary_failure||null;
    var failBadge=failKey?'<span class="failure-'+failKey+'">'+(FAILURE_KR_JS[failKey]||failKey)+'</span>':'<span class="failure-none">-</span>';
    var origIdx=QA_DATA.indexOf(qa);
    rows+='<tr class="qa-row" onclick="showQADetail('+origIdx+')">'
      +'<td class="cell-center"><strong>'+qa.id+'</strong></td>'
      +'<td class="cell-center"><div class="intent-badge" style="background:'+color+'18;border-color:'+color+'35;color:'+color+'">'+(INTENT_KR_JS[qa.intent]||qa.intent)+'</div></td>'
      +'<td style="max-width:260px"><div class="cell-clamp">'+escHtml(qa.q)+'</div></td>'
      +'<td style="max-width:240px;color:#475569"><div class="cell-clamp">'+escHtml(qa.a||'-')+'</div></td>'
      +'<td class="cell-center"><span class="'+(qFail?'score-fail':'score-pass')+'">'+qa.l2_avg.toFixed(3)+'</span></td>'
      +'<td class="cell-center"><span class="'+(rFail?'score-fail':'score-pass')+'">'+qa.triad_avg.toFixed(3)+'</span></td>'
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
  var qFail=qa.l2_avg<0.7,rFail=qa.triad_avg<0.7;
  var statusLabel=qFail&&rFail?'실패':(qFail||rFail)?'보류':'성공';
  var statusCls=qFail&&rFail?'status-fail':(qFail||rFail)?'status-hold':'status-pass';
  var color=INTENT_COLORS_JS[qa.intent]||'#4f46e5';
  var failKey=qa.primary_failure||null;
  // failure 타입별 callout 배경/보더/텍스트 색상
  var FAILURE_CALLOUT_STYLE={
    hallucination:      {bg:'#fff1f2',bd:'#fecaca',tx:'#be123c'},
    faithfulness_error: {bg:'#fff7ed',bd:'#fed7aa',tx:'#c2410c'},
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
    {name:'관련성 (Answer Relevance)',reason:qa.relevance_reason},
    {name:'근거성 (Groundedness)',reason:qa.groundedness_reason},
    ...(qa.clarity_reason
      ? [{name:'명확성 (Clarity)',reason:qa.clarity_reason}]
      : qa.context_relevance_reason
        ? [{name:'맥락성 (Context Relevance)',reason:qa.context_relevance_reason}]
        : []
    )
  ];
  // 신규: 완전성만 / 구형: 사실성·완전성·구체성·간결성
  var qualMetrics=isLegacy?[
    {name:'사실성 (Factuality)',reason:qa.factuality_reason},
    {name:'완전성 (Completeness)',reason:qa.completeness_reason},
    {name:'구체성 (Specificity)',reason:qa.specificity_reason},
    {name:'간결성 (Conciseness)',reason:qa.conciseness_reason}
  ]:[
    {name:'완전성 (Completeness)',reason:qa.completeness_reason}
  ];
  var allMetrics=ragMetrics.concat(qualMetrics);
  var allRows=allMetrics.map(function(m){
    return '<div class="detail-metric">'
      +'<div class="detail-metric-name">'+m.name+'</div>'
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
