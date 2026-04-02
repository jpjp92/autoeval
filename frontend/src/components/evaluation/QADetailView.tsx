import { ArrowLeft } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import type { QAPreviewItem } from '@/src/types/evaluation';
import { INTENT_KR, INTENT_COLORS, STATUS_CONFIG, FAILURE_CONFIG } from '@/src/types/evaluation';
import { getScoreColor, getQAStatus } from '@/src/lib/evalScoreUtils';

export function QADetailView({ qa, onBack }: { qa: QAPreviewItem; onBack: () => void }) {
  const status = getQAStatus(qa);
  const cfg    = STATUS_CONFIG[status];

  // RAG 차원
  const ragDimensions = [
    { label: '관련성', score: qa.relevance,         reason: qa.relevance_reason },
    { label: '근거성', score: qa.groundedness,       reason: qa.groundedness_reason },
    { label: '맥락성', score: qa.context_relevance,  reason: qa.context_relevance_reason },
  ].filter(r => r.reason);

  // Quality 차원
  const qualityDimensions = [
    { label: '완전성', score: qa.completeness, reason: qa.completeness_reason },
  ].filter(r => r.reason);

  // 통합 차원 목록
  const allDimensions = [...ragDimensions, ...qualityDimensions];

  const scoreColor = getScoreColor;

  return (
    <div className="p-5 space-y-4 animate-in fade-in slide-in-from-right-8 duration-300">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-all hover:-translate-x-1 active:scale-[0.98]"
        >
          <ArrowLeft className="w-4 h-4" /> 목록으로
        </button>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 dark:text-slate-500 font-mono">#{qa.qa_index + 1}</span>
          {qa.intent && (
            <span
              className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border"
              style={{
                backgroundColor: `${INTENT_COLORS[qa.intent] ?? '#94a3b8'}18`,
                color:           INTENT_COLORS[qa.intent] ?? '#64748b',
                borderColor:     `${INTENT_COLORS[qa.intent] ?? '#94a3b8'}35`,
              }}
            >
              {INTENT_KR[qa.intent] ?? qa.intent}
            </span>
          )}
          <span className={cn('px-2.5 py-0.5 text-xs font-semibold rounded-full border', cfg.className)}>
            {cfg.label}
          </span>
        </div>
      </div>

      {/* 실패 유형 callout — primary_failure 있을 때만 */}
      {qa.primary_failure && (
        <div className="rounded-xl border border-rose-200 dark:border-rose-500/20 overflow-hidden relative">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-rose-500/50" />
          <div className="px-4 py-1.5 bg-rose-50/50 dark:bg-rose-950/30 border-b border-rose-100 dark:border-rose-500/10">
            <p className="text-[10px] font-bold uppercase tracking-widest text-rose-600/80 dark:text-rose-400">주요 실패 유형</p>
          </div>
          <div className="p-4 text-xs space-y-1">
            <p className="font-semibold text-rose-700 dark:text-rose-300">{FAILURE_CONFIG[qa.primary_failure]?.label ?? qa.primary_failure}</p>
            {qa.failure_reason && <p className="text-slate-600 dark:text-slate-400 leading-relaxed">{qa.failure_reason}</p>}
            {(qa.failure_types?.length ?? 0) > 1 && (
              <p className="text-slate-400 dark:text-slate-500 text-[10px] pt-1">
                전체 실패 항목: {qa.failure_types!.map(f => FAILURE_CONFIG[f]?.label ?? f).join(', ')}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Q / A / Context */}
      <div className="space-y-3">
        {/* 질문 */}
        <div className="bg-slate-50 dark:bg-slate-900/40 rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden relative">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-slate-400/50" />
          <div className="px-4 py-1.5 bg-slate-100/50 dark:bg-white/5 border-b border-slate-200 dark:border-white/5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">질문</p>
          </div>
          <div className="p-4">
            <p className="text-sm text-slate-800 dark:text-slate-100 leading-relaxed font-medium">{qa.q}</p>
          </div>
        </div>

        {/* 답변 */}
        {qa.a ? (
          <div className="bg-indigo-50/60 dark:bg-indigo-950/20 rounded-xl border border-indigo-100 dark:border-indigo-500/20 overflow-hidden relative">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500/50" />
            <div className="px-4 py-1.5 bg-indigo-50/50 dark:bg-indigo-950/30 border-b border-indigo-100 dark:border-indigo-500/10">
              <p className="text-[10px] font-bold uppercase tracking-widest text-indigo-500 dark:text-indigo-400">답변</p>
            </div>
            <div className="p-4">
              <p className="text-sm text-slate-700 dark:text-indigo-100 leading-relaxed font-medium">{qa.a}</p>
            </div>
          </div>
        ) : (
          <div className="rounded-xl p-4 border border-dashed border-slate-200 dark:border-white/10 text-center text-xs text-slate-400 dark:text-slate-500">
            답변 데이터 없음
          </div>
        )}

        {/* 컨텍스트 */}
        {qa.context && (
          <div className="bg-teal-50/50 dark:bg-teal-950/20 rounded-xl border border-teal-100 dark:border-teal-500/20 overflow-hidden relative">
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-teal-500/50" />
            <div className="px-4 py-1.5 bg-teal-50/50 dark:bg-teal-950/30 border-b border-teal-100 dark:border-teal-500/10">
              <p className="text-[10px] font-bold uppercase tracking-widest text-teal-500 dark:text-teal-400">컨텍스트</p>
            </div>
            <div className="p-4">
              <p className="text-sm text-slate-600 dark:text-teal-100/80 leading-relaxed">{qa.context}</p>
            </div>
          </div>
        )}
      </div>

      {/* 품질 평가 — RAG Triad + Quality 통합 섹션 */}
      {(qa.rag_avg != null || qa.quality_avg != null || allDimensions.length > 0) && (
        <div className="bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden relative">
          {/* 포인트 악센트 */}
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-violet-500/50" />
          
          <div className="flex items-center justify-between px-4 py-1.5 bg-slate-100/50 dark:bg-white/5 border-b border-slate-200 dark:border-white/5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">품질 평가 결과</p>
            <div className="flex items-center gap-3">
              {(() => {
                const r = qa.rag_avg ?? 0;
                const q = qa.quality_avg ?? 0;
                const unified = (r * 3 + q) / 4;
                return (
                  <span className={cn('font-black font-mono text-lg', scoreColor(unified))}>
                    {unified.toFixed(3)}
                  </span>
                );
              })()}
            </div>
          </div>
          {allDimensions.length > 0 && (
            <div className="divide-y divide-slate-100 dark:divide-white/5 border-t border-slate-200 dark:border-white/5">
              {/* 테두리 헤더(옵션)가 없으므로 첫 행 패딩 조정 */}
              {allDimensions.map(({ label, score, reason }) => (
                <div key={label} className="flex items-start gap-4 px-4 py-3 text-[12px] group hover:bg-white/40 dark:hover:bg-white/5 transition-colors">
                  <span className="shrink-0 font-bold text-slate-500 dark:text-slate-400 w-16">{label}</span>
                  <span className={cn('shrink-0 font-mono font-bold w-14 text-center', score != null ? scoreColor(score) : 'text-slate-300 dark:text-slate-600')}>
                    {score != null ? score.toFixed(3) : '-'}
                  </span>
                  <span className="flex-1 text-slate-600 dark:text-slate-300 leading-relaxed pl-2 border-l border-slate-100 dark:border-white/5">
                    {reason}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
