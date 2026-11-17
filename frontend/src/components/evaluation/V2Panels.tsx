// 평가 v2 전용 화면 조각 — 기획: docs/Plan/PLAN_261117_EVAL_V2_UI.md
import { useState } from 'react';
import { ShieldCheck, ChevronDown, AlertTriangle, Languages, Quote } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import type { QAPreviewItem, V2Validation, V2JudgeSummary } from '@/src/types/evaluation';
import {
  FAILURE_CONFIG, LANGUAGE_POLICY_LABEL, LANGUAGE_CHECK_LABEL, V2_DIMENSIONS, VALIDATION_WARNING_LABEL,
} from '@/src/types/evaluation';
import { getScoreColor } from '@/src/lib/evalScoreUtils';
import { ChartInfoTooltip } from '@/src/components/evaluation/shared';
import { IntentTreemap } from '@/src/components/evaluation/charts/IntentTreemap';

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

function Stat({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'warn' | 'ok' }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-slate-500 dark:text-slate-400 break-keep">{label}</p>
      <p className={cn('text-lg font-bold font-mono',
        tone === 'warn' ? 'text-amber-600 dark:text-amber-400' : tone === 'ok' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-100')}>
        {value}
      </p>
    </div>
  );
}

/** 데이터 검증 카드 — 점수 없이 숫자와 경고만 */
export function ValidationCard({
  validation, intentDistribution, onShowDuplicates,
}: {
  validation: V2Validation;
  intentDistribution: any[];
  onShowDuplicates?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const dup = validation.duplicates?.length ?? 0;
  const warnings = (validation.warnings ?? []).filter(w => w.code !== 'syntax_invalid' && w.code !== 'duplicate_questions');
  return (
    <div className="bg-white dark:bg-white/5 p-4 lg:p-6 rounded-xl border border-slate-200 dark:border-white/10 shadow-sm flex flex-col">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" /> 데이터 검증
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">구문 · 중복 · 분포 (점수에 반영하지 않음)</p>
        </div>
        <ChartInfoTooltip
          title="데이터 검증"
          items={[
            { text: '필수 필드·길이 검사에서 떨어진 QA는 품질 평가에서 제외합니다.' },
            { label: '중복 의심', text: '질문 문자열 유사도 0.7 이상인 쌍' },
            { label: '문서 쏠림', text: '문서가 2개 이상일 때만 경고합니다.' },
          ]}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="구문 정상" value={`${validation.valid} / ${validation.total}`} tone={validation.invalid ? 'warn' : 'ok'} />
        <div className="min-w-0">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">중복 의심</p>
          <div className="flex items-baseline gap-2">
            <p className={cn('text-lg font-bold font-mono', dup ? 'text-amber-600 dark:text-amber-400' : 'text-slate-900 dark:text-slate-100')}>{dup}건</p>
            {dup > 0 && onShowDuplicates && (
              <button onClick={onShowDuplicates} className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">보기</button>
            )}
          </div>
        </div>
      </div>
      {warnings.length > 0 && (
        <ul className="mt-3 space-y-1">
          {warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
              <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" />
              <span className="break-keep">
                {VALIDATION_WARNING_LABEL[w.code] ?? w.code}
                {w.code === 'doc_skew' && w.ratio != null && ` — ${w.doc} ${(w.ratio * 100).toFixed(0)}%`}
              </span>
            </li>
          ))}
        </ul>
      )}
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="mt-auto pt-3 flex items-center gap-1 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
      >
        <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} /> 질문 의도 분포
      </button>
      {open && <div className="mt-2"><IntentTreemap data={intentDistribution} /></div>}
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
