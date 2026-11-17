// 평가 v2 전용 화면 조각 — 기획: docs/Plan/PLAN_261117_EVAL_V2_UI.md
import { useState } from 'react';
import { ShieldCheck, ChevronDown, AlertTriangle, Languages, Quote, CheckCircle2 } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import type { QAPreviewItem, V2Validation, V2JudgeSummary } from '@/src/types/evaluation';
import {
  FAILURE_CONFIG, LANGUAGE_POLICY_LABEL, LANGUAGE_CHECK_LABEL, V2_DIMENSIONS, VALIDATION_WARNING_LABEL,
} from '@/src/types/evaluation';
import { getScoreColor } from '@/src/lib/evalScoreUtils';
import { IntentTreemap } from '@/src/components/evaluation/charts/IntentTreemap';
import { ChartInfoTooltip } from '@/src/components/evaluation/shared';

export function failureLabel(k: string): string {
  return FAILURE_CONFIG[k]?.label ?? k;
}

export function V2Badge({ version }: { version: 'v1' | 'v2' }) {
  return (
    <span
      title={version === 'v2' ? '평가 v2: 데이터 검증 → 통합 Judge' : '평가 v1: 구문·통계·RAG Triad·완전성'}
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border tracking-wide',
        version === 'v2'
          ? 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-200 dark:border-indigo-500/30'
          : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-white/5 dark:text-slate-400 dark:border-white/10',
      )}
    >
      {version === 'v2' ? '평가 v2' : '평가 v1'}
    </span>
  );
}

type GaugeTone = 'ok' | 'warn' | 'fail';
const TONE: Record<GaugeTone, { ring: string; text: string; label: string }> = {
  ok:   { ring: 'text-emerald-500 dark:text-emerald-400', text: 'text-emerald-600 dark:text-emerald-400', label: '정상' },
  warn: { ring: 'text-amber-500 dark:text-amber-400',     text: 'text-amber-600 dark:text-amber-400',     label: '주의' },
  fail: { ring: 'text-rose-500 dark:text-rose-400',       text: 'text-rose-600 dark:text-rose-400',       label: '실패' },
};

/** 상태 게이지 — v1 MetricRadialGauge와 같은 링 모양. 점수가 아니라 상태(정상·주의·실패)를 색으로 표시한다 */
function StatusGauge({ ratio, label, detail, tone }: { ratio: number; label: string; detail: string; tone: GaugeTone }) {
  const r = 42;
  const circ = 2 * Math.PI * r;
  const clamped = Math.min(Math.max(ratio, 0), 1);
  const t = TONE[tone];
  return (
    <div className="flex flex-col items-center text-center min-w-0">
      <div className="relative w-20 h-20 lg:w-24 lg:h-24" role="img" aria-label={`${label} ${(clamped * 100).toFixed(0)}% (${t.label})`}>
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="5" className="text-slate-200 dark:text-white/10" />
          <circle cx="50" cy="50" r={r} fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={circ * (1 - clamped)}
            className={cn('transition-[stroke-dashoffset] duration-1000 ease-out', t.ring)} />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-lg lg:text-xl font-black text-slate-800 dark:text-white tracking-tight">
          {(clamped * 100).toFixed(0)}%
        </span>
      </div>
      <p className="mt-2 text-xs font-bold text-slate-700 dark:text-slate-200">{label}</p>
      <p className={cn('text-[11px] break-keep', tone === 'ok' ? 'text-slate-500 dark:text-slate-400' : t.text)}>{detail}</p>
    </div>
  );
}

const SMALL_SAMPLE = 20;
// 수정 전(2026-11-17) 저장된 v2 결과는 문서 분포가 청크 ID(UUID) 기준이다. 문서로 보이지 않게 거른다
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isDocName = (k?: string | null) => !!k && !UUID_RE.test(k);

/** 데이터 검증 카드 — 진단 정보(점수에 반영하지 않음): 상태 게이지 2개 + 상태 줄 (+ 문서가 2개 이상이면 문서별 QA) */
export function ValidationCard({
  validation, intentDistribution, onShowDuplicates,
}: {
  validation: V2Validation;
  intentDistribution: { name: string; krLabel?: string; value: number }[];
  onShowDuplicates?: () => void;
}) {
  const intentTotal = intentDistribution.reduce((n, d) => n + d.value, 0);
  const total = Math.max(validation.total, 1);
  const pairs = validation.duplicates?.length ?? 0;
  // 쌍 수와 QA 수는 다르다. 이전 결과에 duplicate_qa_count가 없으면 쌍에서 계산한다
  const dupQA = validation.duplicate_qa_count
    ?? new Set((validation.duplicates ?? []).flatMap(d => [d.a, d.b])).size;
  const syntaxTone: GaugeTone = validation.invalid > 0 ? 'fail' : 'ok';
  const dupTone: GaugeTone = dupQA > 0 ? 'warn' : 'ok';
  const skew = (validation.warnings ?? []).filter(w => w.code === 'doc_skew' && isDocName(w.doc));
  const docs = Object.entries(validation.doc_distribution ?? {}).filter(([k]) => isDocName(k)).sort((a, b) => b[1] - a[1]);
  const docMax = Math.max(1, ...docs.map(d => d[1]));
  const allClear = validation.invalid === 0 && pairs === 0 && skew.length === 0;

  return (
    <div className="bg-white dark:bg-white/5 p-4 lg:p-6 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm flex flex-col">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" /> 데이터 검증
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 break-keep">형식 검사 · 중복 탐지 · 데이터 구성 진단 (품질 점수에 미반영)</p>
        </div>
        <ChartInfoTooltip
          title="데이터 검증"
          items={[
            { text: '필수 필드·길이 검사에서 떨어진 QA는 품질 평가에서 제외합니다.' },
            { label: '중복 의심', text: '질문 문자열 유사도 0.7 이상인 쌍. 의미상 중복을 확정하지는 않습니다.' },
            { label: '의도 분포', text: '데이터 구성 정보입니다. 고르지 않아도 품질이 낮다는 뜻은 아닙니다.' },
          ]}
        />
      </div>

      {/* 상태 게이지 2개 */}
      <div>
        <div className="grid grid-cols-2 gap-3 w-full py-2">
          <StatusGauge
            ratio={validation.valid / total}
            label="구문 정상"
            detail={validation.invalid ? `${validation.valid} / ${validation.total}개 · 탈락 ${validation.invalid}` : `${validation.valid} / ${validation.total}개`}
            tone={syntaxTone}
          />
          <StatusGauge
            ratio={1 - dupQA / total}
            label="중복 의심 없음"
            detail={pairs ? `중복 의심 ${pairs}쌍 · QA ${dupQA}개` : '중복 의심 0쌍'}
            tone={dupTone}
          />
        </div>
      </div>

      {/* 질문 의도 분포 — 트리맵(고정 높이, 의도 색은 v1과 같다) */}
      {intentDistribution.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/5">
          <div className="flex items-baseline justify-between mb-1">
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">질문 의도 분포</p>
            <span className="text-[10px] text-slate-400 dark:text-slate-500">QA {intentTotal}개</span>
          </div>
          <IntentTreemap data={intentDistribution as any} height={160} />
          {validation.total < SMALL_SAMPLE && (
            <p className="mt-1.5 text-[10px] text-slate-400 dark:text-slate-500">QA 수가 적어 분포는 참고용입니다.</p>
          )}
        </div>
      )}

      {/* 문서별 QA — 문서가 2개 이상일 때만 */}
      {docs.length >= 2 && (
        <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/5 space-y-1.5">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">문서별 QA</p>
          {docs.slice(0, 5).map(([name, n]) => (
            <div key={name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-[11px]">
              <div className="min-w-0">
                <p className="truncate text-slate-600 dark:text-slate-300" title={name}>{name}</p>
                <div className="h-1.5 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full bg-indigo-400" style={{ width: `${(n / docMax) * 100}%` }} />
                </div>
              </div>
              <span className="font-mono text-slate-500 dark:text-slate-400">{n}</span>
            </div>
          ))}
        </div>
      )}

      {/* 상태 줄 — 카드가 옆 카드 높이로 늘어나면 맨 아래에 붙는다 */}
      <div className="mt-auto pt-3"><div className="pt-3 border-t border-slate-100 dark:border-white/5">
        {allClear ? (
          <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="w-4 h-4" /> 구문 오류 및 중복 의심 없음
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {validation.invalid > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-500/20">
                <AlertTriangle className="w-3 h-3" /> 구문 탈락 {validation.invalid}건
              </span>
            )}
            {pairs > 0 && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-500/20">
                <AlertTriangle className="w-3 h-3" /> 중복 의심 {pairs}쌍
                {onShowDuplicates && (
                  <button onClick={onShowDuplicates} className="ml-1 underline underline-offset-2">보기</button>
                )}
              </span>
            )}
            {skew.map((w, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-semibold bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-500/20">
                <AlertTriangle className="w-3 h-3" /> {VALIDATION_WARNING_LABEL[w.code] ?? w.code} {((w.ratio ?? 0) * 100).toFixed(0)}%
              </span>
            ))}
          </div>
        )}
      </div></div>
    </div>
  );
}

/** 언어 조합 분포 — 한→한만 있으면 숨긴다 */
export function LanguagePolicyRow({ judge }: { judge: V2JudgeSummary }) {
  const entries = Object.entries(judge.by_language_policy ?? {});
  if (!entries.length || (entries.length === 1 && entries[0][0] === 'korean_native')) return null;
  return (
    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-white/5">
      <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1 mb-1.5"><Languages className="w-3.5 h-3.5" /> 언어 조합 (원문→QA)</p>
      <div className="flex flex-wrap gap-1.5">
        {entries.map(([k, v]) => (
          <span key={k} className="px-2 py-0.5 rounded-full border text-[10px] font-semibold bg-slate-50 dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300">
            {LANGUAGE_POLICY_LABEL[k] ?? k} {v.judged} · 통과 {v.pass_rate.toFixed(0)}%
          </span>
        ))}
      </div>
    </div>
  );
}

/** 실패 유형 칩 — 누르면 표를 거른다 */
export function FailureChips({
  counts, active, onSelect,
}: {
  counts: Record<string, number>;
  active: string | null;
  onSelect: (k: string | null) => void;
}) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  return (
    <div className="bg-white dark:bg-white/5 px-4 py-3 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 mr-1">실패 유형</span>
      {entries.map(([k, n]) => {
        const cfg = FAILURE_CONFIG[k];
        const isActive = active === k;
        return (
          <button
            key={k}
            onClick={() => onSelect(isActive ? null : k)}
            aria-pressed={isActive}
            className={cn(
              'px-2 py-0.5 rounded-full border text-[11px] font-semibold transition-all',
              cfg?.className ?? 'bg-slate-50 text-slate-600 border-slate-200',
              isActive ? 'ring-2 ring-indigo-400 ring-offset-1 dark:ring-offset-slate-900' : 'opacity-90 hover:opacity-100',
            )}
          >
            {failureLabel(k)} {n}
          </button>
        );
      })}
      {active && (
        <button onClick={() => onSelect(null)} className="ml-1 text-[11px] text-slate-500 dark:text-slate-400 hover:underline">필터 해제</button>
      )}
    </div>
  );
}

export function qaFailureKeys(qa: QAPreviewItem): string[] {
  return [...(qa.hard_fail_reasons ?? []), ...(qa.v2_failure_types ?? []), ...(qa.fail_reasons ?? [])];
}

const VERDICT_STYLE: Record<string, { label: string; className: string }> = {
  supported:    { label: '지지',     className: 'text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-300 dark:bg-emerald-950/30 dark:border-emerald-500/20' },
  unsupported:  { label: '근거 없음', className: 'text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-300 dark:bg-amber-950/30 dark:border-amber-500/20' },
  contradicted: { label: '모순',     className: 'text-rose-700 bg-rose-50 border-rose-200 dark:text-rose-300 dark:bg-rose-950/30 dark:border-rose-500/20' },
};

/** QA 상세 보기의 v2 평가 결과 */
export function V2DetailSection({ qa }: { qa: QAPreviewItem }) {
  const [showEvidence, setShowEvidence] = useState(true);
  if (qa.v2_status === 'skipped' || qa.v2_status === 'error' || qa.v2_status === 'missing') {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 dark:border-white/15 p-4 text-xs text-slate-600 dark:text-slate-300">
        {qa.v2_status === 'skipped' ? '구문 검증에서 제외되어 품질 평가를 하지 않았습니다.' : '평가 모델 응답을 받지 못해 점수를 매기지 않았습니다.'}
        {qa.failure_reason && <p className="mt-1 text-slate-500 dark:text-slate-400 [overflow-wrap:anywhere]">{qa.failure_reason}</p>}
      </div>
    );
  }
  const checks = Object.entries(qa.language_checks ?? {});
  const policy = qa.language_policy ? LANGUAGE_POLICY_LABEL[qa.language_policy] : null;
  return (
    <div className="bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden relative">
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-violet-500/50" />
      <div className="flex items-center justify-between px-4 py-1.5 bg-slate-100/50 dark:bg-white/5 border-b border-slate-200 dark:border-white/5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">AI 품질 평가</p>
        <span className={cn('font-black font-mono text-lg', getScoreColor(qa.qa_score ?? 0))}>{qa.qa_score != null ? qa.qa_score.toFixed(3) : '-'}</span>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {V2_DIMENSIONS.map(d => {
            const v = qa[d.key] as number | undefined;
            const low = v != null && v < d.threshold;
            return (
              <div key={d.key} className={cn('rounded-lg border px-2.5 py-1.5',
                low ? 'border-rose-200 bg-rose-50/60 dark:border-rose-500/20 dark:bg-rose-950/20' : 'border-slate-200 bg-white dark:border-white/10 dark:bg-white/5')}>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">{d.label}</p>
                <p className={cn('font-mono font-bold text-sm', v != null ? getScoreColor(v) : 'text-slate-400')}>{v != null ? v.toFixed(2) : '-'}</p>
              </div>
            );
          })}
        </div>
        {qa.reason && <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{qa.reason}</p>}
        {(policy || checks.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {policy && (
              <span className="px-2 py-0.5 rounded-full border text-[10px] font-semibold bg-white dark:bg-white/5 border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300">
                {policy}{qa.source_language_from === 'inferred' && <span className="font-normal text-slate-400"> · 원문 언어 판별값</span>}
              </span>
            )}
            {checks.map(([k, ok]) => (
              <span key={k} className={cn('px-2 py-0.5 rounded-full border text-[10px] font-semibold',
                ok ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/20 dark:text-emerald-300 dark:border-emerald-500/20'
                   : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/30 dark:text-rose-300 dark:border-rose-500/20')}>
                {ok ? '✓' : '✕'} {LANGUAGE_CHECK_LABEL[k] ?? k}
              </span>
            ))}
          </div>
        )}
        {(qa.evidence?.length ?? 0) > 0 && (
          <div>
            <button onClick={() => setShowEvidence(s => !s)} aria-expanded={showEvidence}
              className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
              <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showEvidence && 'rotate-180')} />
              주장별 근거 ({qa.evidence!.length})
            </button>
            {showEvidence && (
              <ul className="mt-2 space-y-2">
                {qa.evidence!.map((e, i) => {
                  const st = VERDICT_STYLE[e.verdict] ?? VERDICT_STYLE.unsupported;
                  return (
                    <li key={i} className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 p-2.5 text-[11px] lg:text-xs">
                      <div className="flex items-start gap-2">
                        <span className={cn('shrink-0 px-1.5 py-px rounded border text-[10px] font-bold', st.className)}>{st.label}</span>
                        <p className="text-slate-800 dark:text-slate-100 font-medium [overflow-wrap:anywhere]">{e.claim}</p>
                      </div>
                      {e.source && (
                        <p className="mt-1.5 flex items-start gap-1.5 text-slate-500 dark:text-slate-400 [overflow-wrap:anywhere]">
                          <Quote className="w-3 h-3 mt-0.5 shrink-0" /> {e.source}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── AI 품질 평가 카드 본문: 판정 누적 막대 + 지표 막대(기준선·기준 미달 건수) ───────────
const VERDICT_SEG: { key: string; label: string; cls: string }[] = [
  { key: 'pass',      label: '통과',          cls: 'bg-emerald-500 dark:bg-emerald-400' },
  { key: 'fail',      label: '불통과',        cls: 'bg-amber-400 dark:bg-amber-400' },
  { key: 'hard_fail', label: '근거·수치 오류', cls: 'bg-rose-500 dark:bg-rose-400' },
  { key: 'error',     label: '평가 실패',     cls: 'bg-slate-400 dark:bg-slate-500' },
  { key: 'skipped',   label: '구문 제외',     cls: 'bg-slate-200 dark:bg-white/20' },
];

export function V2QualityPanel({ judge, validation, rows }: { judge: V2JudgeSummary; validation: V2Validation; rows: QAPreviewItem[] }) {
  const counts: Record<string, number> = {
    pass: judge.pass_count,
    hard_fail: judge.hard_fail_count,
    fail: Math.max(0, judge.judged_count - judge.pass_count - judge.hard_fail_count),
    error: judge.evaluation_error_count,
    skipped: validation.invalid,
  };
  const total = Math.max(1, Object.values(counts).reduce((a, b) => a + b, 0));
  const judgedRows = rows.filter(r => r.eval_version === 'v2' && (r.v2_status === 'pass' || r.v2_status === 'fail' || r.v2_status === 'hard_fail'));

  return (
    // 카드가 왼쪽 데이터 검증 카드 높이로 늘어나면 지표 막대 간격이 고르게 넓어진다
    <div className="flex-1 flex flex-col gap-4">
      {/* 판정 구성 */}
      <div>
        <div className="flex items-baseline justify-between mb-1.5">
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">판정 구성</p>
          <span className="text-[10px] text-slate-400 dark:text-slate-500">QA {total}개</span>
        </div>
        <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"
          role="img" aria-label={VERDICT_SEG.map(v => `${v.label} ${counts[v.key]}`).join(', ')}>
          {VERDICT_SEG.filter(v => counts[v.key] > 0).map(v => (
            <div key={v.key} className={cn('h-full first:rounded-l-full last:rounded-r-full', v.cls)}
              style={{ width: `${(counts[v.key] / total) * 100}%` }} title={`${v.label} ${counts[v.key]}`} />
          ))}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-600 dark:text-slate-300">
          {VERDICT_SEG.filter(v => counts[v.key] > 0 || v.key === 'pass').map(v => (
            <li key={v.key} className="flex items-center gap-1.5">
              <span className={cn('w-2 h-2 rounded-full', v.cls)} />
              {v.label} <span className="font-mono font-semibold">{counts[v.key]}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* 지표 평균 + 기준선 + 기준 미달 건수 */}
      <div className="flex-1 flex flex-col justify-evenly gap-3 pt-3 border-t border-slate-100 dark:border-white/5">
        {V2_DIMENSIONS.map(d => {
          const v = judge.averages?.[d.key];
          const below = judgedRows.filter(r => (r[d.key] as number | undefined) != null && (r[d.key] as number) < d.threshold).length;
          const tone = v == null ? 'bg-slate-300' : v >= 0.85 ? 'bg-emerald-500 dark:bg-emerald-400' : v >= d.threshold ? 'bg-amber-400' : 'bg-rose-500';
          return (
            <div key={d.key}>
              <div className="flex items-baseline justify-between text-xs lg:text-sm">
                <span className="font-medium text-slate-700 dark:text-slate-200">{d.label}</span>
                <span className="flex items-baseline gap-2">
                  {judgedRows.length > 0 && (
                    <span className={cn('text-[10px]', below ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-slate-400 dark:text-slate-500')}>
                      기준 미달 {below}건
                    </span>
                  )}
                  <span className={cn('font-mono font-bold', v != null ? getScoreColor(v) : 'text-slate-400')}>{v != null ? v.toFixed(3) : '-'}</span>
                </span>
              </div>
              <div className="relative mt-1.5 h-2.5 rounded-full bg-slate-100 dark:bg-white/10"
                role="img" aria-label={`${d.label} 평균 ${v != null ? v.toFixed(2) : '-'}, 기준 ${d.threshold}`}>
                <div className={cn('h-full rounded-full transition-all duration-700', tone)} style={{ width: `${(v ?? 0) * 100}%` }} />
                <span className="absolute -top-1 -bottom-1 w-0.5 rounded bg-slate-500/70 dark:bg-white/60"
                  style={{ left: `${d.threshold * 100}%` }} title={`기준 ${d.threshold}`} />
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-[10px] text-slate-400 dark:text-slate-500">세로선은 지표별 기준값(근거성·정확성 0.6, 완전성 0.7, 질문 품질 0.5)입니다.</p>
    </div>
  );
}
