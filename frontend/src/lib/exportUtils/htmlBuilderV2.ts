// 평가 v2 HTML 리포트 — 기획: docs/Plan/PLAN_261117_EVAL_V2_UI.md 3장
// 화면을 보지 않은 사람이 읽는다: 결론 → 요약 → 데이터 검증 → 불통과 QA(근거) → 전체 QA → 평가 기준
import { formatKST } from '@/src/lib/evalChartUtils';
import type { QAPreviewItem } from '@/src/types/evaluation';
import {
  FAILURE_CONFIG, INTENT_KR, INTENT_COLORS, LANGUAGE_POLICY_LABEL, LANGUAGE_CHECK_LABEL, V2_DIMENSIONS,
  VALIDATION_WARNING_LABEL, GRADE_WITHHELD_LABEL,
} from '@/src/types/evaluation';
import type { EvaluationData } from './types';
import { svgTreemap } from './htmlBuilder';

function esc(v: unknown): string {
  return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
const fl = (k: string) => FAILURE_CONFIG[k]?.label ?? k;
const num = (v: number | null | undefined, d = 3) => (v == null ? '-' : v.toFixed(d));

const STATUS_LABEL: Record<string, string> = {
  pass: '통과', fail: '불통과', hard_fail: '근거·수치 오류', error: '평가 실패', skipped: '제외(구문)', missing: '결과 없음',
};
const VERDICT_LABEL: Record<string, string> = { supported: '지지', unsupported: '근거 없음', contradicted: '모순' };

function scoreClass(v: number | null | undefined, threshold = 0.7): string {
  if (v == null) return 'muted';
  return v >= 0.85 ? 'good' : v >= threshold ? 'mid' : 'bad';
}

function dimsHTML(qa: QAPreviewItem): string {
  return `<div class="dims">${V2_DIMENSIONS.map(d => {
    const v = qa[d.key] as number | undefined;
    return `<span class="dim ${v != null && v < d.threshold ? 'low' : ''}">${d.label} <b class="${scoreClass(v, d.threshold)}">${num(v, 2)}</b></span>`;
  }).join('')}</div>`;
}

function evidenceHTML(qa: QAPreviewItem, onlyProblems: boolean): string {
  const ev = (qa.evidence ?? []).filter(e => !onlyProblems || e.verdict !== 'supported');
  if (!ev.length) return '';
  return `<ul class="evidence">${ev.map(e => `
    <li><span class="verdict v-${esc(e.verdict)}">${VERDICT_LABEL[e.verdict] ?? esc(e.verdict)}</span>
      <div><p class="claim">${esc(e.claim)}</p>${e.source ? `<p class="source">“${esc(e.source)}”</p>` : ''}</div></li>`).join('')}</ul>`;
}

function langHTML(qa: QAPreviewItem): string {
  const checks = Object.entries(qa.language_checks ?? {});
  const policy = qa.language_policy ? LANGUAGE_POLICY_LABEL[qa.language_policy] ?? qa.language_policy : '';
  if (!policy && !checks.length) return '';
  return `<div class="chips">${policy ? `<span class="chip">${esc(policy)}${qa.source_language_from === 'inferred' ? ' · 원문 언어 판별값' : ''}</span>` : ''}${
    checks.map(([k, ok]) => `<span class="chip ${ok ? 'ok' : 'ng'}">${ok ? '✓' : '✕'} ${esc(LANGUAGE_CHECK_LABEL[k] ?? k)}</span>`).join('')}</div>`;
}

function failureChips(qa: QAPreviewItem): string {
  const keys = Array.from(new Set([...(qa.hard_fail_reasons ?? []), ...(qa.v2_failure_types ?? []), ...(qa.fail_reasons ?? [])]));
  if (qa.v2_status === 'error') keys.unshift('evaluation_error');
  if (qa.v2_status === 'skipped') keys.unshift('syntax_error');
  return keys.map(k => `<span class="chip ng">${esc(fl(k))}</span>`).join('');
}

function qaCard(qa: QAPreviewItem, n: number): string {
  return `<article class="qa-card">
    <header><span class="id">#${n}</span><span class="status s-${esc(qa.v2_status)}">${STATUS_LABEL[qa.v2_status ?? ''] ?? '-'}</span>
      <span class="score ${scoreClass(qa.qa_score)}">QA 점수 ${num(qa.qa_score)}</span>${failureChips(qa)}</header>
    <p class="q"><b>Q.</b> ${esc(qa.q)}</p>
    <p class="a"><b>A.</b> ${esc(qa.a)}</p>
    ${qa.reason || qa.failure_reason ? `<p class="reason">${esc(qa.reason || qa.failure_reason)}</p>` : ''}
    ${qa.v2_status === 'pass' || qa.v2_status === 'fail' || qa.v2_status === 'hard_fail' ? dimsHTML(qa) : ''}
    ${evidenceHTML(qa, true)}
    ${langHTML(qa)}
  </article>`;
}

// 앱 화면(lucide)과 같은 모양의 작은 아이콘
const svgI = (d: string) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  doc: svgI('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>'),
  check: svgI('<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>'),
  pulse: svgI('<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>'),
  shield: svgI('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M12 8v4M12 16h.01"/>'),
  shieldCheck: svgI('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>'),
  target: svgI('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>'),
};

/** 앱의 상태 게이지와 같은 링 (정상·주의·실패 색) */
function ring(ratio: number, tone: 'good' | 'mid' | 'bad', label: string, detail: string): string {
  const r = 42, c = 2 * Math.PI * r, v = Math.min(Math.max(ratio, 0), 1);
  return `<div class="ring"><svg viewBox="0 0 100 100" role="img" aria-label="${esc(label)} ${(v * 100).toFixed(0)}%">
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--soft)" stroke-width="6"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="var(--${tone})" stroke-width="8" stroke-linecap="round"
      stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - v)).toFixed(2)}" transform="rotate(-90 50 50)"/>
    <text x="50" y="50" text-anchor="middle" dominant-baseline="central" font-size="20" font-weight="800" fill="var(--text)">${(v * 100).toFixed(0)}%</text>
  </svg><p class="rl">${esc(label)}</p><p class="rd ${tone === 'good' ? 'muted' : tone}">${esc(detail)}</p></div>`;
}

export function buildV2HTMLContent(data: EvaluationData): string {
  const v2 = data.v2!;
  const { validation, judge } = v2;
  const rows: QAPreviewItem[] = data.detailedQA.map(d => d.v2).filter(Boolean) as QAPreviewItem[];
  const total = validation.total;
  const timestamp = formatKST(data.metadata?.timestamp ?? new Date().toISOString());
  const failed = rows.filter(r => r.v2_status === 'hard_fail' || r.v2_status === 'fail');
  failed.sort((a, b) => Number(b.v2_status === 'hard_fail') - Number(a.v2_status === 'hard_fail') || (a.qa_score ?? 0) - (b.qa_score ?? 0));
  const grade = judge.grade ?? '보류';
  const failureEntries = Object.entries(judge.failure_counts).sort((a, b) => b[1] - a[1]);
  const intentEntries = Object.entries(validation.intent_distribution ?? {}).sort((a, b) => b[1] - a[1]);
  const policies = Object.entries(judge.by_language_policy ?? {});
  const qByIdx = new Map(rows.map(r => [r.qa_index, r]));
  const judgedRows = rows.filter(r => r.v2_status === 'pass' || r.v2_status === 'fail' || r.v2_status === 'hard_fail');
  const verdicts = [
    { key: 'pass', label: '통과', n: judge.pass_count, cls: 'f-good' },
    { key: 'fail', label: '불통과', n: Math.max(0, judge.judged_count - judge.pass_count - judge.hard_fail_count), cls: 'f-mid' },
    { key: 'hard_fail', label: '근거·수치 오류', n: judge.hard_fail_count, cls: 'f-bad' },
    { key: 'error', label: '평가 실패', n: judge.evaluation_error_count, cls: 'f-gray' },
    { key: 'skipped', label: '구문 제외', n: validation.invalid, cls: 'f-light' },
  ];
  const vTotal = Math.max(1, verdicts.reduce((a, v) => a + v.n, 0));
  const intentTotal = Math.max(1, intentEntries.reduce((a, e) => a + e[1], 0));
  const dupQA = validation.duplicate_qa_count ?? new Set(validation.duplicates.flatMap(d => [d.a, d.b])).size;
  // 수정 전 저장된 결과는 문서 분포가 청크 ID(UUID) 기준이다 — 문서로 보이지 않게 거른다
  const isDocName = (k?: string | null) => !!k && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k);
  const skew = (validation.warnings ?? []).filter(w => w.code === 'doc_skew' && isDocName(w.doc));
  const docs = Object.entries(validation.doc_distribution ?? {}).filter(([k]) => isDocName(k)).sort((a, b) => b[1] - a[1]);
  const docMax = Math.max(1, ...docs.map(d => d[1]));
  const allClear = !validation.invalid && !validation.duplicates.length && !skew.length;

  const tableRows = rows.map((r, i) => `
    <tr data-status="${esc(r.v2_status)}">
      <td class="c">${r.qa_index + 1}</td>
      <td class="c">${esc(INTENT_KR[r.intent] ?? r.intent ?? '-')}</td>
      <td><details><summary>${esc(r.q)}</summary>
        <div class="detail"><p class="a"><b>A.</b> ${esc(r.a)}</p>
        ${r.reason || r.failure_reason ? `<p class="reason">${esc(r.reason || r.failure_reason)}</p>` : ''}
        ${dimsHTML(r)}${evidenceHTML(r, false)}${langHTML(r)}</div></details></td>
      <td class="c mono ${scoreClass(r.qa_score)}">${num(r.qa_score)}</td>
      <td class="c"><span class="status s-${esc(r.v2_status)}">${STATUS_LABEL[r.v2_status ?? ''] ?? '-'}</span></td>
      <td>${failureChips(r) || '<span class="muted">-</span>'}</td>
      <td class="c">${esc(r.language_policy ? LANGUAGE_POLICY_LABEL[r.language_policy] ?? r.language_policy : '-')}</td>
    </tr>`).join('') || `<tr><td colspan="7" class="c muted">QA 상세 데이터가 없습니다.</td></tr>`;

  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QA 평가 리포트 (v2)</title>
<style>
:root{--bg:#f8fafc;--card:#fff;--text:#0f172a;--sub:#475569;--muted:#94a3b8;--line:#e2e8f0;--soft:#f1f5f9;
--good:#059669;--mid:#d97706;--bad:#e11d48;--accent:#4f46e5;--good-bg:#ecfdf5;--bad-bg:#fff1f2;--mid-bg:#fffbeb;--accent-bg:#eef2ff}
@media (prefers-color-scheme:dark){:root{--bg:#0b1120;--card:#111827;--text:#e5e7eb;--sub:#cbd5e1;--muted:#64748b;--line:#1f2937;--soft:#1e293b;
--good:#34d399;--mid:#fbbf24;--bad:#fb7185;--accent:#a5b4fc;--good-bg:#052e2b;--bad-bg:#3b0a17;--mid-bg:#3a2a05;--accent-bg:#1e1b4b}}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Apple SD Gothic Neo','Malgun Gothic',sans-serif;background:var(--bg);color:var(--text);line-height:1.6;font-size:14px}
.wrap{max-width:1120px;margin:0 auto;padding:32px 16px 64px}
section,.top{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px;margin-bottom:18px}
h1{font-size:22px;display:flex;flex-wrap:wrap;align-items:center;gap:8px}
h2{font-size:16px;margin-bottom:12px;display:flex;align-items:center;gap:8px}
h2 .n{font-size:12px;color:var(--muted);font-weight:500}
.badge{font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;background:var(--accent-bg);color:var(--accent);border:1px solid var(--line)}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px 16px;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
.meta div{min-width:0}.meta .k{font-size:11px;color:var(--muted)}.meta .v{font-weight:600;overflow-wrap:anywhere}
.conclusion{margin-top:14px;padding:12px 14px;border-radius:10px;background:var(--accent-bg);font-weight:600;word-break:keep-all}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.card{border:1px solid var(--line);border-radius:12px;padding:12px 14px;background:var(--card)}
.card .k{font-size:12px;color:var(--sub)}.card .v{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums}
.card .s{font-size:11px;color:var(--muted)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media (max-width:760px){.grid2{grid-template-columns:1fr}}
.bar{display:grid;grid-template-columns:84px 1fr 64px;align-items:center;gap:8px;margin:7px 0;font-size:13px}
.bar .track{height:12px;border-radius:6px;background:var(--soft);position:relative;overflow:hidden}
.bar .fill{position:absolute;inset:0 auto 0 0;border-radius:6px}
.bar .th{position:absolute;top:-2px;bottom:-2px;width:2px;background:var(--text);opacity:.35}
.bar .val{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}
.stack{display:flex;height:12px;border-radius:6px;overflow:hidden;background:var(--soft);margin:6px 0}
.f-gray{background:var(--muted)}.f-light{background:var(--line)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px;vertical-align:middle}
.f-good{background:var(--good)}.f-mid{background:var(--mid)}.f-bad{background:var(--bad)}.f-acc{background:var(--accent)}
.good{color:var(--good)}.mid{color:var(--mid)}.bad{color:var(--bad)}.muted{color:var(--muted)}
.chips{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}
.chip{display:inline-block;font-size:11px;font-weight:600;padding:1px 8px;border-radius:999px;border:1px solid var(--line);background:var(--soft);color:var(--sub);margin:1px 2px 1px 0}
.chip.ok{background:var(--good-bg);color:var(--good)}.chip.ng{background:var(--bad-bg);color:var(--bad)}
.warn{color:var(--mid);font-size:13px;margin-top:10px}
.okline{color:var(--good);font-size:13px;margin-top:10px;font-weight:600}
.bar .val{white-space:nowrap}
.dup{font-size:12px;margin-top:8px;border-top:1px dashed var(--line);padding-top:8px}
.dup li{list-style:none;margin:4px 0;overflow-wrap:anywhere}
.qa-card{border:1px solid var(--line);border-left:4px solid var(--bad);border-radius:10px;padding:12px 14px;margin-bottom:10px;break-inside:avoid;page-break-inside:avoid}
.qa-card header{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:6px}
.id{font-family:ui-monospace,monospace;color:var(--muted);font-size:12px}
.status{font-size:11px;font-weight:700;padding:1px 8px;border-radius:999px;border:1px solid var(--line)}
.s-pass{background:var(--good-bg);color:var(--good)}.s-fail{background:var(--mid-bg);color:var(--mid)}
.s-hard_fail{background:var(--bad-bg);color:var(--bad)}.s-error,.s-skipped,.s-missing{background:var(--soft);color:var(--sub)}
.score{font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}
.q{font-weight:600;overflow-wrap:anywhere}.a{color:var(--sub);overflow-wrap:anywhere}
.reason{margin-top:6px;font-size:13px;padding:6px 10px;border-radius:8px;background:var(--soft)}
.dims{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.dim{font-size:12px;padding:2px 8px;border:1px solid var(--line);border-radius:8px}.dim.low{border-color:var(--bad)}
.evidence{list-style:none;margin-top:8px;display:grid;gap:6px}
.evidence li{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;padding:6px 8px;border:1px solid var(--line);border-radius:8px}
.verdict{flex:none;font-size:10.5px;font-weight:700;padding:1px 6px;border-radius:6px}
.v-supported{background:var(--good-bg);color:var(--good)}.v-unsupported{background:var(--mid-bg);color:var(--mid)}.v-contradicted{background:var(--bad-bg);color:var(--bad)}
.claim{font-weight:600;overflow-wrap:anywhere}.source{color:var(--sub);overflow-wrap:anywhere}
.filters{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px}
.filters button{font:inherit;font-size:12px;padding:4px 10px;border-radius:999px;border:1px solid var(--line);background:var(--card);color:var(--sub);cursor:pointer}
.filters button[aria-pressed=true]{background:var(--accent-bg);color:var(--accent);border-color:var(--accent)}
.tablewrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px;min-width:720px}
th{font-size:12px;color:var(--sub);text-align:left;padding:8px;border-bottom:1px solid var(--line);background:var(--soft);white-space:nowrap}
td{padding:8px;border-bottom:1px solid var(--line);vertical-align:top}
td.c,th.c{text-align:center}.mono{font-family:ui-monospace,monospace}
summary{cursor:pointer;font-weight:500;overflow-wrap:anywhere}
.detail{margin-top:6px}
.appendix table{min-width:0}.appendix td,.appendix th{font-size:12.5px}
.kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:18px}
@media (max-width:860px){.kpis{grid-template-columns:repeat(2,minmax(0,1fr))}}
.kpi{display:flex;gap:12px;align-items:center;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;min-width:0}
.kpi .k{font-size:12.5px;color:var(--sub)}.kpi .v{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.3}
.kpi .s{font-size:11px;color:var(--muted)}
.ico{flex:none;width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center}
.i-indigo{background:#e0e7ff;color:#4f46e5}.i-emerald{background:#d1fae5;color:#059669}.i-rose{background:#ffe4e6;color:#e11d48}.i-amber{background:#fef3c7;color:#d97706}
@media (prefers-color-scheme:dark){.i-indigo{background:#1e1b4b;color:#a5b4fc}.i-emerald{background:#052e2b;color:#34d399}.i-rose{background:#3b0a17;color:#fb7185}.i-amber{background:#3a2a05;color:#fbbf24}}
.panel{display:flex;flex-direction:column}
.panel h2{margin-bottom:2px}.hico{display:inline-flex}.hico.good{color:var(--good)}.hico.acc{color:var(--accent)}.hico svg{width:18px;height:18px}
.sub{font-size:12px;color:var(--sub);margin-bottom:12px}
.label{font-size:12.5px;font-weight:700}
.small{font-size:11px}
.row-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:6px}
.divider{border-top:1px solid var(--line);margin:14px 0}
.rings{display:grid;grid-template-columns:1fr 1fr;gap:12px;text-align:center}
.ring svg{width:96px;height:96px}.ring .rl{font-size:12.5px;font-weight:700;margin-top:4px}.ring .rd{font-size:11px}
.treemap svg{width:100%;height:auto;display:block;max-height:200px}
.status{margin-top:auto;padding-top:12px;border-top:1px solid var(--line)}
.chip.warnc{background:var(--mid-bg);color:var(--mid)}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--sub)}
.metrics{flex:1;display:flex;flex-direction:column;justify-content:space-evenly;gap:12px;margin-bottom:10px}
.mname{font-size:13px;font-weight:600}
.mtrack{position:relative;height:10px;border-radius:5px;background:var(--soft)}
.mtrack .fill{position:absolute;inset:0 auto 0 0;border-radius:5px}
.mtrack .th{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--text);opacity:.4}
.ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dupbox{margin-top:10px;font-size:12px}.dupbox summary{cursor:pointer;color:var(--sub)}
.failrow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:12px 16px}
.grid2 section{margin-bottom:18px}
#tip{position:fixed;display:none;pointer-events:none;background:var(--card);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:4px 8px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,.12);z-index:10}
footer{color:var(--muted);font-size:12px;text-align:center;margin-top:24px}
@media print{body{background:#fff}section,.top{break-inside:auto;border-color:#ddd}.filters{display:none}details{display:block}details>*{display:block}}
</style>
</head>
<body><div id="tip"></div><div class="wrap">

<div class="top">
  <h1>QA 평가 리포트 <span class="badge">평가 v2 · ${esc(data.metadata?.judge_version ?? judge.judge_version)}</span></h1>
  <div class="meta">
    <div><p class="k">출처 문서</p><p class="v">${esc(data.metadata?.source ?? '-')}</p></div>
    <div><p class="k">QA 생성 모델</p><p class="v">${esc(data.metadata?.qa_model ?? '-')}</p></div>
    <div><p class="k">평가 모델</p><p class="v">${esc(data.metadata?.eval_model ?? '-')}</p></div>
    <div><p class="k">평가 일시</p><p class="v">${esc(timestamp)}</p></div>
  </div>
  <p class="conclusion">${esc(v2.conclusion)}</p>
</div>

<div class="kpis">
  <div class="kpi"><span class="ico i-indigo">${ICON.doc}</span><div><p class="k">전체 QA</p><p class="v">${total}</p><p class="s">구문 정상 ${validation.valid}</p></div></div>
  <div class="kpi"><span class="ico i-emerald">${ICON.check}</span><div><p class="k">품질 통과</p><p class="v">${judge.pass_count} / ${judge.judged_count}</p><p class="s">통과율 ${judge.pass_rate.toFixed(1)}%</p></div></div>
  <div class="kpi"><span class="ico i-rose">${ICON.pulse}</span><div><p class="k">종합 평가 등급</p><p class="v">${esc(grade)}</p><p class="s">${judge.grade_withheld ? esc(GRADE_WITHHELD_LABEL[judge.grade_withheld] ?? judge.grade_withheld) : `최종 점수 ${num(judge.final_score)}`}</p></div></div>
  <div class="kpi"><span class="ico i-amber">${ICON.shield}</span><div><p class="k">근거·수치 오류</p><p class="v ${judge.hard_fail_count ? 'bad' : ''}">${judge.hard_fail_count}건</p><p class="s">평가 실패 ${judge.evaluation_error_count}건</p></div></div>
</div>

<div class="grid2">
<section class="panel">
  <h2><span class="hico good">${ICON.shieldCheck}</span>데이터 검증</h2>
  <p class="sub">형식 검사 · 중복 탐지 · 데이터 구성 진단 (품질 점수에 미반영)</p>
  <div class="rings">
    ${ring(validation.valid / Math.max(validation.total, 1), validation.invalid ? 'bad' : 'good', '구문 정상', validation.invalid ? `${validation.valid} / ${validation.total}개 · 탈락 ${validation.invalid}` : `${validation.valid} / ${validation.total}개`)}
    ${ring(1 - dupQA / Math.max(validation.total, 1), dupQA ? 'mid' : 'good', '중복 의심 없음', validation.duplicates.length ? `중복 의심 ${validation.duplicates.length}쌍 · QA ${dupQA}개` : '중복 의심 0쌍')}
  </div>
  ${intentEntries.length ? `<div class="divider"></div>
  <div class="row-head"><p class="label">질문 의도 분포</p><span class="muted small">QA ${intentTotal}개</span></div>
  <div class="treemap">${svgTreemap(intentEntries.map(([k, n]) => ({ name: k, krLabel: INTENT_KR[k] ?? k, value: n })), INTENT_COLORS)}</div>
  ${validation.total < 20 ? '<p class="muted small">QA 수가 적어 분포는 참고용입니다.</p>' : ''}` : ''}
  ${docs.length >= 2 ? `<div class="divider"></div><p class="label">문서별 QA</p>
  ${docs.map(([k, n]) => `<div class="bar"><span title="${esc(k)}" class="ellipsis">${esc(k)}</span><span class="track"><span class="fill f-acc" style="width:${(n / docMax * 100).toFixed(1)}%"></span></span><span class="val">${n}</span></div>`).join('')}` : ''}
  ${validation.duplicates.length ? `<details class="dupbox"><summary>중복 의심 쌍 ${validation.duplicates.length}개 보기</summary><ul class="dup">${validation.duplicates.slice(0, 20).map(d => `<li>#${d.a + 1} ↔ #${d.b + 1} <span class="muted">(유사도 ${d.similarity.toFixed(2)})</span><br>${esc(qByIdx.get(d.a)?.q ?? '')}<br><span class="muted">${esc(qByIdx.get(d.b)?.q ?? '')}</span></li>`).join('')}</ul></details>` : ''}
  <div class="status">${allClear ? '<p class="okline">✓ 구문 오류 및 중복 의심 없음</p>' : `<div class="chips">${[
    validation.invalid ? `<span class="chip ng">⚠ 구문 탈락 ${validation.invalid}건</span>` : '',
    validation.duplicates.length ? `<span class="chip warnc">⚠ 중복 의심 ${validation.duplicates.length}쌍</span>` : '',
    ...skew.map(w => `<span class="chip warnc">⚠ ${esc(VALIDATION_WARNING_LABEL[w.code] ?? w.code)} ${((w.ratio ?? 0) * 100).toFixed(0)}%</span>`),
  ].join('')}</div>`}</div>
</section>

<section class="panel">
  <h2><span class="hico acc">${ICON.target}</span>AI 품질 평가</h2>
  <p class="sub">근거성 · 정확성 · 완전성 · 질문 품질 (평균, 0–1)</p>
  <div class="row-head"><p class="label">판정 구성</p><span class="muted small">QA ${vTotal}개</span></div>
  <div class="stack" role="img" aria-label="${verdicts.map(v => `${v.label} ${v.n}`).join(', ')}">${verdicts.filter(v => v.n).map(v => `<span class="${v.cls}" style="width:${(v.n / vTotal * 100).toFixed(2)}%" title="${v.label} ${v.n}"></span>`).join('')}</div>
  <div class="legend">${verdicts.filter(v => v.n || v.key === 'pass').map(v => `<span><i class="dot ${v.cls}"></i>${v.label} <b>${v.n}</b></span>`).join('')}</div>
  <div class="divider"></div>
  <div class="metrics">
  ${V2_DIMENSIONS.map(d => {
    const v = judge.averages?.[d.key];
    const below = judgedRows.filter(r => (r[d.key] as number | undefined) != null && (r[d.key] as number) < d.threshold).length;
    const cls = v == null ? 'f-acc' : v >= 0.85 ? 'f-good' : v >= d.threshold ? 'f-mid' : 'f-bad';
    return `<div class="metric"><div class="row-head"><span class="mname">${d.label}</span><span><span class="small ${below ? 'bad' : 'muted'}">기준 미달 ${below}건</span> <b class="mono ${scoreClass(v, d.threshold)}">${num(v)}</b></span></div>
      <div class="mtrack"><span class="fill ${cls}" style="width:${((v ?? 0) * 100).toFixed(1)}%"></span><span class="th" style="left:${d.threshold * 100}%"></span></div></div>`;
  }).join('')}
  </div>
  <p class="muted small">세로선은 지표별 기준값(근거성·정확성 0.6, 완전성 0.7, 질문 품질 0.5)입니다.</p>
  ${policies.length && !(policies.length === 1 && policies[0][0] === 'korean_native') ? `<div class="divider"></div><p class="label">언어 조합 (원문→QA)</p>
  <div class="chips">${policies.map(([k, p]) => `<span class="chip">${esc(LANGUAGE_POLICY_LABEL[k] ?? k)} ${p.judged}건 · 통과 ${p.pass_rate.toFixed(0)}%</span>`).join('')}</div>` : ''}
</section>
</div>

${failureEntries.length ? `<section class="failrow"><span class="label">실패 유형</span>${failureEntries.map(([k, n]) => `<span class="chip ng">${esc(fl(k))} ${n}</span>`).join('')}</section>` : ''}

<section>
  <h2>불통과 QA <span class="n">${failed.length}건 · 근거·수치 오류 먼저, 점수 낮은 순</span></h2>
  ${failed.length ? failed.map(r => qaCard(r, r.qa_index + 1)).join('') : '<p class="muted">불통과 QA가 없습니다.</p>'}
</section>

<section>
  <h2>전체 QA <span class="n">${rows.length}건 · 질문을 누르면 근거와 지표가 열립니다</span></h2>
  <div class="filters" role="group" aria-label="판정 필터">
    ${['all', 'pass', 'fail', 'hard_fail', 'error', 'skipped'].map(k => `<button type="button" data-f="${k}" aria-pressed="${k === 'all'}">${k === 'all' ? '전체' : STATUS_LABEL[k]} ${k === 'all' ? rows.length : rows.filter(r => r.v2_status === k).length}</button>`).join('')}
  </div>
  <div class="tablewrap"><table>
    <thead><tr><th class="c">ID</th><th class="c">의도</th><th>질문</th><th class="c">QA 점수</th><th class="c">판정</th><th>사유</th><th class="c">언어</th></tr></thead>
    <tbody id="rows">${tableRows}</tbody>
  </table></div>
</section>

<section class="appendix">
  <h2>평가 기준</h2>
  <table>
    <tr><th>QA 점수</th><td>${V2_DIMENSIONS.map(d => `${d.label} ${Math.round((judge.weights?.[d.key] ?? 0) * 100)}%`).join(' · ')}</td></tr>
    <tr><th>근거·수치 오류</th><td>근거성 또는 정확성 0.6 미만, 또는 원문과 모순되는 주장. 점수와 관계없이 불통과이며 최종 점수에 0.5배로 반영합니다.</td></tr>
    <tr><th>통과</th><td>근거·수치 오류가 없고, QA 점수 0.70 이상, 질문 품질 0.5 이상</td></tr>
    <tr><th>등급</th><td>A+ 0.95 · A 0.85 · B+ 0.75 · B 0.65 · C 0.50 · F 그 미만. 평가 실패가 20%를 넘으면 등급을 보류합니다.</td></tr>
    <tr><th>평가 실패</th><td>평가 모델 응답을 받지 못한 QA입니다. 임의 점수로 채우지 않고 점수 계산에서 뺍니다.</td></tr>
    <tr><th>언어 정책</th><td>원문 언어와 QA 언어 조합(한→한, 영→영, 영→한, 한→영)에 따라 검사 규칙을 더합니다. 점수 기준은 같습니다.</td></tr>
    <tr><th>데이터 검증</th><td>구문 탈락 QA는 평가에서 제외합니다. 중복·분포는 참고 정보이며 점수에 넣지 않습니다.</td></tr>
  </table>
</section>

<footer>AutoEval · 평가 v2 리포트</footer>
</div>
<script>
function showTip(e,t){var el=document.getElementById('tip');el.textContent=t;el.style.display='block';el.style.left=(e.clientX+14)+'px';el.style.top=(e.clientY-10)+'px';}
function hideTip(){document.getElementById('tip').style.display='none';}
(function(){var bs=document.querySelectorAll('.filters button'),rs=document.querySelectorAll('#rows tr[data-status]');
bs.forEach(function(b){b.addEventListener('click',function(){var f=b.getAttribute('data-f');
bs.forEach(function(x){x.setAttribute('aria-pressed',String(x===b))});
rs.forEach(function(r){r.style.display=(f==='all'||r.getAttribute('data-status')===f)?'':'none'})})})})();
</script>
</body></html>`;
}
