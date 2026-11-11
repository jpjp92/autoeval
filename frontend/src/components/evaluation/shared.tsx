import { Info } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/src/lib/utils';

// ─── 공통 툴팁 wrapper ────────────────────────────────────────────────────────
export const TooltipCard = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-md px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-200/50 dark:shadow-black/50 animate-in zoom-in-95 duration-200">
    {children}
  </div>
);

const VIEWPORT_GUTTER = 8;

// ─── 차트 정보 툴팁 ──────────────────────────────────────────────────────────
// Opens on hover (desktop) or tap (touch). While open, the panel is shifted
// horizontally so it never leaves the viewport on narrow screens.
export function ChartInfoTooltip({ title, items }: {
  title: string;
  items: Array<{ label?: string; text: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hoveredRef = useRef(false);

  useLayoutEffect(() => {
    if (!open || !panelRef.current) { setShift(0); return; }
    const rect = panelRef.current.getBoundingClientRect();
    const base = rect.left - shift; // position without the current shift
    const width = rect.width;
    const maxLeft = window.innerWidth - VIEWPORT_GUTTER - width;
    const target = Math.min(Math.max(base, VIEWPORT_GUTTER), maxLeft);
    setShift(Math.round(target - base));
  }, [open]); // measure once per open; `shift` is read only to undo itself

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e.type === 'pointerdown' && rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative flex-shrink-0"
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') { hoveredRef.current = true; setOpen(true); } }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') { hoveredRef.current = false; setOpen(false); } }}
    >
      <button
        type="button"
        aria-label={`${title} 설명`}
        aria-expanded={open}
        // A mouse click arrives after hover already opened it; keep it open.
        onClick={() => setOpen(v => hoveredRef.current ? true : !v)}
        className="-m-2 p-2 rounded-full focus-visible:outline-2 focus-visible:outline-indigo-500"
      >
        <Info className={cn('w-3.5 h-3.5 transition-colors', open ? 'text-indigo-400' : 'text-slate-300')} />
      </button>
      <div
        ref={panelRef}
        role="tooltip"
        style={{ transform: `translateX(${shift}px)` }}
        className={cn(
          'absolute right-[-8px] top-6 w-64 max-w-[calc(100vw-16px)] bg-white/95 dark:bg-slate-800/95 backdrop-blur-md rounded-xl p-3.5 z-50 transition-opacity duration-200 pointer-events-none shadow-xl shadow-slate-200/50 dark:shadow-black/50 border border-slate-200/70 dark:border-white/10',
          open ? 'visible opacity-100' : 'invisible opacity-0'
        )}
      >
        {shift === 0 && (
          <div className="absolute -top-[5px] right-[10px] w-3 h-3 bg-white/95 dark:bg-slate-800/95 border-t border-l border-slate-200/70 dark:border-white/10 rotate-45 rounded-sm" />
        )}
        <p className="text-[11px] lg:text-[12px] font-bold text-slate-800 dark:text-slate-100 mb-2 relative z-10">{title}</p>
        <div className="space-y-1.5 relative z-10">
          {items.map((item, i) => (
            <div key={i} className="flex gap-2 text-[11px] leading-relaxed">
              {item.label && (
                <span className="font-semibold text-indigo-600 dark:text-indigo-400 shrink-0">{item.label}</span>
              )}
              <span className="text-slate-600 dark:text-slate-300 font-medium">{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
