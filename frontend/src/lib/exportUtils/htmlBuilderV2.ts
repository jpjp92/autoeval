// 평가 v2 HTML 리포트 — 기획: docs/Plan/PLAN_261117_EVAL_V2_UI.md 3장
// 화면을 보지 않은 사람이 읽는다: 결론 → 요약 → 데이터 검증 → 불통과 QA(근거) → 전체 QA → 평가 기준
import { formatKST } from '@/src/lib/evalChartUtils';
import type { QAPreviewItem } from '@/src/types/evaluation';
import {
  FAILURE_CONFIG, INTENT_KR, LANGUAGE_POLICY_LABEL, LANGUAGE_CHECK_LABEL, V2_DIMENSIONS,
  VALIDATION_WARNING_LABEL, GRADE_WITHHELD_LABEL,
} from '@/src/types/evaluation';
import type { EvaluationData } from './types';

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
  const intentMax = Math.max(1, ...intentEntries.map(e => e[1]));
  const policies = Object.entries(judge.by_language_policy ?? {});
  const qByIdx = new Map(rows.map(r => [r.qa_index, r]));
  const intentTotal = Math.max(1, intentEntries.reduce((a, e) => a + e[1], 0));
  const dupQA = validation.duplicate_qa_count ?? new Set(validation.duplicates.flatMap(d => [d.a, d.b])).size;
  const skew = (validation.warnings ?? []).filter(w => w.code === 'doc_skew');
  const docs = Object.entries(validation.doc_distribution ?? {}).sort((a, b) => b[1] - a[1]);
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
footer{color:var(--muted);font-size:12px;text-align:center;margin-top:24px}
@media print{body{background:#fff}section,.top{break-inside:auto;border-color:#ddd}.filters{display:none}details{display:block}details>*{display:block}}
</style>
</head>
<body><div class="wrap">

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

<section>
  <h2>요약</h2>
  <div class="cards">
    <div class="card"><p class="k">품질 통과</p><p class="v">${judge.pass_count} / ${judge.judged_count}</p><p class="s">통과율 ${judge.pass_rate.toFixed(1)}%</p></div>
    <div class="card"><p class="k">종합 등급</p><p class="v">${esc(grade)}</p><p class="s">${judge.grade_withheld ? esc(GRADE_WITHHELD_LABEL[judge.grade_withheld] ?? judge.grade_withheld) : `최종 점수 ${num(judge.final_score)}`}</p></div>
    <div class="card"><p class="k">근거·수치 오류</p><p class="v ${judge.hard_fail_count ? 'bad' : ''}">${judge.hard_fail_count}건</p><p class="s">점수와 관계없이 불통과</p></div>
    <div class="card"><p class="k">평가 실패</p><p class="v ${judge.evaluation_error_count ? 'mid' : ''}">${judge.evaluation_error_count}건</p><p class="s">점수 계산에서 제외</p></div>
    <div class="card"><p class="k">전체 QA</p><p class="v">${total}</p><p class="s">구문 정상 ${validation.valid}</p></div>
  </div>
</section>

<div class="grid2">
<section>
  <h2>AI 품질 평가 <span class="n">지표 평균 · 세로선은 기준값</span></h2>
  ${V2_DIMENSIONS.map(d => {
    const v = judge.averages?.[d.key];
    const cls = v == null ? 'f-acc' : v >= 0.85 ? 'f-good' : v >= d.threshold ? 'f-mid' : 'f-bad';
    return `<div class="bar"><span>${d.label}</span><span class="track"><span class="fill ${cls}" style="width:${((v ?? 0) * 100).toFixed(1)}%"></span><span class="th" style="left:${d.threshold * 100}%"></span></span><span class="val">${num(v)}</span></div>`;
  }).join('')}
  ${policies.length && !(policies.length === 1 && policies[0][0] === 'korean_native') ? `
  <p class="k" style="margin-top:12px;font-size:12px;color:var(--sub)">언어 조합 (원문→QA)</p>
  <div class="chips">${policies.map(([k, p]) => `<span class="chip">${esc(LANGUAGE_POLICY_LABEL[k] ?? k)} ${p.judged}건 · 통과 ${p.pass_rate.toFixed(0)}% · 평균 ${num(p.avg_qa_score)}</span>`).join('')}</div>` : ''}
  ${failureEntries.length ? `<p class="k" style="margin-top:12px;font-size:12px;color:var(--sub)">실패 유형</p>
  <div class="chips">${failureEntries.map(([k, n]) => `<span class="chip ng">${esc(fl(k))} ${n}</span>`).join('')}</div>` : ''}
</section>

<section>
  <h2>데이터 검증 <span class="n">형식 검사 · 중복 탐지 · 데이터 구성 진단 (품질 점수에 미반영)</span></h2>
  <div class="cards">
    <div class="card"><p class="k">구문 정상</p><p class="v ${validation.invalid ? 'bad' : 'good'}">${validation.valid} / ${validation.total}</p><p class="s">${validation.invalid ? `탈락 ${validation.invalid}건 · 평가에서 제외` : '탈락 없음'}</p></div>
    <div class="card"><p class="k">중복 의심</p><p class="v ${validation.duplicates.length ? 'mid' : 'good'}">${validation.duplicates.length}쌍</p><p class="s">관련 QA ${dupQA}개 · 유사도 0.7 이상</p></div>
  </div>
  <p class="${allClear ? 'okline' : 'warn'}">${allClear ? '✓ 구문 오류 및 중복 의심 없음' : [
    validation.invalid ? `⚠ 구문 탈락 ${validation.invalid}건` : '',
    validation.duplicates.length ? `⚠ 중복 의심 ${validation.duplicates.length}쌍` : '',
    ...skew.map(w => `⚠ ${esc(VALIDATION_WARNING_LABEL[w.code] ?? w.code)} — ${esc(w.doc)} ${((w.ratio ?? 0) * 100).toFixed(0)}%`),
  ].filter(Boolean).join(' · ')}</p>
  ${validation.duplicates.length ? `<ul class="dup">${validation.duplicates.slice(0, 20).map(d => `<li>#${d.a + 1} ↔ #${d.b + 1} <span class="muted">(유사도 ${d.similarity.toFixed(2)})</span><br>${esc(qByIdx.get(d.a)?.q ?? '')}<br><span class="muted">${esc(qByIdx.get(d.b)?.q ?? '')}</span></li>`).join('')}</ul>` : ''}
  ${intentEntries.length ? `<p class="k" style="margin-top:12px;font-size:12px;color:var(--sub)">질문 의도 분포</p>
  ${intentEntries.map(([k, n]) => `<div class="bar"><span>${esc(INTENT_KR[k] ?? k)}</span><span class="track"><span class="fill f-acc" style="width:${(n / intentMax * 100).toFixed(1)}%"></span></span><span class="val">${n} · ${(n / intentTotal * 100).toFixed(0)}%</span></div>`).join('')}
  <p class="s muted" style="font-size:11px">분포는 데이터 구성 정보이며 품질 판정이 아닙니다.${validation.total < 20 ? ` QA ${validation.total}개로 표본이 적어 참고용입니다.` : ''}</p>` : ''}
  ${docs.length >= 2 ? `<p class="k" style="margin-top:12px;font-size:12px;color:var(--sub)">문서별 QA</p>
  ${docs.map(([k, n]) => `<div class="bar"><span title="${esc(k)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(k)}</span><span class="track"><span class="fill f-acc" style="width:${(n / docMax * 100).toFixed(1)}%"></span></span><span class="val">${n}</span></div>`).join('')}` : ''}
</section>
</div>

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
(function(){var bs=document.querySelectorAll('.filters button'),rs=document.querySelectorAll('#rows tr[data-status]');
bs.forEach(function(b){b.addEventListener('click',function(){var f=b.getAttribute('data-f');
bs.forEach(function(x){x.setAttribute('aria-pressed',String(x===b))});
rs.forEach(function(r){r.style.display=(f==='all'||r.getAttribute('data-status')===f)?'':'none'})})})})();
</script>
</body></html>`;
}
