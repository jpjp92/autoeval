import { useState, useEffect, useRef } from 'react';
import { cn } from '@/src/lib/utils';
import { SCORE_THRESHOLDS } from '@/src/lib/evalScoreUtils';

export function QualityScoreChart({ data }: { data: Array<{ name: string; nameEn: string; score: number; group: 'rag' | 'quality' }> }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [animated, setAnimated]     = useState(false);
  const containerRef  = useRef<HTMLDivElement>(null);
  const timerRef      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevKeyRef    = useRef<string | null>(null);
  const wasHiddenRef  = useRef(true); // hidden 탭에서 시작 가정

  // 애니메이션 트리거
  const triggerFnRef = useRef(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setAnimated(false);
    timerRef.current = setTimeout(() => setAnimated(true), 150);
  });

  // data 실제 값이 바뀔 때 재애니메이션
  useEffect(() => {
    const key = data.map((d) => d.score.toFixed(4)).join(',');
    if (key === '' || prevKeyRef.current === key) return;
    prevKeyRef.current = key;
    triggerFnRef.current();
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // 탭 전환으로 컨테이너가 hidden→visible 될 때 재애니메이션
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const visible = el.offsetWidth > 0;
      if (visible && wasHiddenRef.current) {
        wasHiddenRef.current = false;
        triggerFnRef.current();
      } else if (!visible) {
        wasHiddenRef.current = true;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  return (
    <div ref={containerRef} className="space-y-3.5 mt-2">
      {data.map((item, i) => {
        const isHigh = item.score >= SCORE_THRESHOLDS.high;
        const isMid  = item.score >= SCORE_THRESHOLDS.mid;
        const colorClass = isHigh ? 'from-emerald-400 to-teal-500' : isMid ? 'from-amber-400 to-orange-500' : 'from-rose-400 to-red-500';
        const glowClass  = isHigh ? 'shadow-[0_0_12px_rgba(16,185,129,0.3)]' : isMid ? 'shadow-[0_0_12px_rgba(245,158,11,0.3)]' : 'shadow-[0_0_12px_rgba(244,63,94,0.3)]';
        const isRag = item.group === 'rag';
        const targetW = Math.min(item.score * 100, 100);

        return (
          <div 
            key={item.name} 
            className="group/item relative bg-slate-50/50 dark:bg-white/3 border border-slate-100 dark:border-white/5 p-3.5 rounded-xl transition-all duration-300 hover:bg-white dark:hover:bg-white/8 hover:shadow-md hover:-translate-y-0.5 animate-in fade-in slide-in-from-right-4 fill-mode-both"
            style={{ animationDelay: `${i * 100}ms` }}
            onMouseEnter={() => setHoveredIdx(i)}
            onMouseLeave={() => setHoveredIdx(null)}
          >
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-2.5">
                <span className={cn(
                  "px-2 py-0.5 rounded-md text-[9px] font-black tracking-widest uppercase border backdrop-blur-sm shadow-sm",
                  isRag ? "bg-blue-500/10 text-blue-500 border-blue-500/20" : "bg-purple-500/10 text-purple-500 border-purple-500/20"
                )}>
                  {isRag ? 'RAG' : '품질'}
                </span>
                <span className="text-[13px] font-bold text-slate-700 dark:text-slate-200">{item.name}</span>
              </div>
              <span className={cn("font-mono text-sm font-black transition-colors duration-500", isHigh ? 'text-emerald-500' : isMid ? 'text-amber-500' : 'text-rose-500')}>
                {item.score.toFixed(3)}
              </span>
            </div>
            <div className="relative h-2 w-full bg-slate-200/50 dark:bg-white/5 rounded-full overflow-hidden shadow-inner">
              <div 
                className={cn("absolute inset-y-0 left-0 bg-gradient-to-r transition-all duration-1000 ease-out rounded-full ring-1 ring-white/10", colorClass, glowClass)}
                style={{ width: `${(animated ? targetW : 0).toFixed(1)}%` }}
              >
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1.5 h-1.5 bg-white rounded-full shadow-lg opacity-80 group-hover/item:scale-150 transition-transform duration-500" />
              </div>
            </div>
          </div>
        );
      })}
      <div className="flex items-center justify-end gap-5 pt-2 text-[10px] font-bold tracking-tight text-slate-400 dark:text-slate-500 uppercase">
        <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" /> ≥ 0.85</div>
        <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.5)]" /> ≥ 0.70</div>
        <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.5)]" /> &lt; 0.70</div>
      </div>
    </div>
  );
}
