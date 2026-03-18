/**
 * Export utilities for evaluation results
 * Supports XLSX (2-sheet), HTML, and JSON formats
 */
import * as XLSX from 'xlsx';

export interface EvaluationData {
  summaryStats: Array<{ label: string; value: string; icon?: any; color?: string; bg?: string }>;
  layer1Stats: Array<{ subject: string; A: number; fullMark: number }>;
  intentDistribution: Array<{ name: string; label?: string; krLabel?: string; value: number }>;
  llmQualityScores: Array<{ name: string; nameEn?: string; score: number }>;
  detailedQA: Array<{
    id: number;
    q: string;
    a?: string;
    context?: string;
    intent: string;
    l2_avg: number;
    triad_avg: number;
    pass: boolean;
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
export function exportToCSV(data: EvaluationData): void {
  const wb = XLSX.utils.book_new();
  const evalDate = toKST(data.metadata?.timestamp);
  const qaModel   = data.metadata?.qa_model   ?? data.metadata?.model ?? '-';
  const evalModel = data.metadata?.eval_model ?? data.metadata?.model ?? '-';
  const source    = data.metadata?.source ?? '-';

  // ── Stats 시트 ──────────────────────────────────────────────────────────────
  const statsRows: (string | number)[][] = [];

  // 메타데이터 (최상단)
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

  statsRows.push(['[ 데이터셋 통계 (0-10) ]', '']);
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

  statsRows.push(['[ 품질 점수 (0-1) ]', '']);
  statsRows.push(['지표', '점수']);
  data.llmQualityScores.forEach((s) => {
    const displayName = s.nameEn ? `${s.name}(${s.nameEn})` : s.name;
    statsRows.push([displayName, +s.score.toFixed(4)]);
  });

  const wsStats = XLSX.utils.aoa_to_sheet(statsRows);
  wsStats['!cols'] = [{ wch: 28 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, wsStats, 'Stats');

  // ── Detail 시트 ─────────────────────────────────────────────────────────────
  const detailHeader = ['ID', '의도', 'Context', 'Question', 'Answer', '품질 점수', 'Triad 점수', '상태', '평가일시 (KST)'];
  const detailRows = data.detailedQA.map((qa) => {
    const qFail = qa.l2_avg    < 0.7;
    const rFail = qa.triad_avg < 0.7;
    const status = qFail && rFail ? '실패' : (qFail || rFail) ? '보류' : '성공';
    return [
      qa.id,
      qa.intent,
      qa.context ?? '',
      qa.q,
      qa.a ?? '',
      +qa.l2_avg.toFixed(4),
      +qa.triad_avg.toFixed(4),
      status,
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
    { wch: 22 },  // 평가일시
  ];
  XLSX.utils.book_append_sheet(wb, wsDetail, 'Detail');

  // ── 다운로드 ────────────────────────────────────────────────────────────────
  const filename = `qa-evaluation-${new Date().toISOString().slice(0, 10)}.xlsx`;
  XLSX.writeFile(wb, filename);
}

/**
 * Export evaluation results to HTML
 */
export function exportToHTML(data: EvaluationData): void {
  const timestamp = toKST(data.metadata?.timestamp);
  const qaModel   = data.metadata?.qa_model   ?? data.metadata?.model ?? 'N/A';
  const evalModel = data.metadata?.eval_model ?? data.metadata?.model ?? 'N/A';
  const source    = data.metadata?.source ?? 'N/A';

  const intentColorsMap: Record<string, string> = {
    factoid: '#06b6d4', numeric: '#eab308', procedure: '#3b82f6',
    why: '#d946ef', how: '#22c55e', definition: '#0ea5e9',
    list: '#f59e0b', boolean: '#c026d3',
  };

  const htmlContent = `<!DOCTYPE html>
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
        th { padding: 12px 14px; text-align: left; font-weight: 600; color: #64748b; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
        td { padding: 12px 14px; border-bottom: 1px solid #e2e8f0; font-size: 13px; }
        tbody tr:last-child td { border-bottom: none; }
        tbody tr:hover { background: #f8fafc; }
        .intent-badge { display: inline-block; padding: 3px 8px; border-radius: 5px; font-size: 10px; font-weight: 700; text-transform: uppercase; border: 1px solid; }
        .score-pass { color: #059669; font-weight: 600; font-family: monospace; }
        .score-fail { color: #dc2626; font-weight: 700; font-family: monospace; }
        .status-pass { display: inline-block; padding: 3px 10px; background: #d1fae5; color: #047857; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid #a7f3d0; }
        .status-hold { display: inline-block; padding: 3px 10px; background: #fef3c7; color: #92400e; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid #fde68a; }
        .status-fail { display: inline-block; padding: 3px 10px; background: #fee2e2; color: #991b1b; border-radius: 20px; font-size: 11px; font-weight: 600; border: 1px solid #fecaca; }
        footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; text-align: center; color: #94a3b8; font-size: 12px; }
        @media print { body { background: white; } section { page-break-inside: avoid; } }
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
        <h2>🎯 데이터셋 통계 (0–10)</h2>
        <table>
            <thead><tr><th>지표</th><th>점수</th><th>비율</th></tr></thead>
            <tbody>
                ${data.layer1Stats.map((s) => `<tr><td><strong>${s.subject}</strong></td><td>${s.A.toFixed(2)}</td><td>${((s.A / s.fullMark) * 100).toFixed(1)}%</td></tr>`).join('')}
            </tbody>
        </table>
    </section>

    <section>
        <h2>⭐ 품질 점수 (0–1)</h2>
        <table>
            <thead><tr><th>지표</th><th>점수</th><th>평가</th></tr></thead>
            <tbody>
                ${data.llmQualityScores.map((s) => {
                  const displayName = s.nameEn ? `${s.name}(${s.nameEn})` : s.name;
                  const cls = s.score >= 0.85 ? 'status-pass' : s.score >= 0.7 ? 'status-pass' : 'status-fail';
                  const label = s.score >= 0.85 ? '우수' : s.score >= 0.7 ? '양호' : '미흡';
                  return `<tr><td><strong>${displayName}</strong></td><td><span class="${s.score >= 0.7 ? 'score-pass' : 'score-fail'}">${s.score.toFixed(3)}</span></td><td><span class="${cls}">${label}</span></td></tr>`;
                }).join('')}
            </tbody>
        </table>
    </section>

    <section>
        <h2>📋 QA 상세 평가 결과</h2>
        <table>
            <thead><tr><th>ID</th><th>의도</th><th>질문</th><th>답변</th><th>품질</th><th>Triad</th><th>상태</th></tr></thead>
            <tbody>
                ${data.detailedQA.map((qa) => {
                  const qFail = qa.l2_avg < 0.7;
                  const rFail = qa.triad_avg < 0.7;
                  const statusLabel = qFail && rFail ? '실패' : (qFail || rFail) ? '보류' : '성공';
                  const statusCls   = qFail && rFail ? 'status-fail' : (qFail || rFail) ? 'status-hold' : 'status-pass';
                  return `<tr>
                    <td><strong>${qa.id}</strong></td>
                    <td><div class="intent-badge" style="background:${intentColorsMap[qa.intent] || '#4f46e5'}18;border-color:${intentColorsMap[qa.intent] || '#4f46e5'}35;color:${intentColorsMap[qa.intent] || '#4f46e5'}">${qa.intent}</div></td>
                    <td style="max-width:280px">${qa.q}</td>
                    <td style="max-width:240px;color:#475569">${qa.a ?? '-'}</td>
                    <td><span class="${qFail ? 'score-fail' : 'score-pass'}">${qa.l2_avg.toFixed(3)}</span></td>
                    <td><span class="${rFail ? 'score-fail' : 'score-pass'}">${qa.triad_avg.toFixed(3)}</span></td>
                    <td><span class="${statusCls}">${statusLabel}</span></td>
                  </tr>`;
                }).join('')}
            </tbody>
        </table>
    </section>

    <footer>Generated on ${timestamp} · Auto Evaluation Dashboard</footer>
</div>
</body>
</html>`;

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
  const qaModel   = data.metadata?.qa_model   ?? data.metadata?.model ?? '-';
  const evalModel = data.metadata?.eval_model ?? data.metadata?.model ?? '-';

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
