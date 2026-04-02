import { useRef, useEffect } from 'react';
import { Clock, History, ChevronDown } from 'lucide-react';
import { cn } from '@/src/lib/utils';
import type { HistoryItem } from '@/src/types/evaluation';
import { GRADE_COLOR } from '@/src/types/evaluation';
import { formatKST } from '@/src/lib/evalChartUtils';

export function HistoryDropdown({
  historyList, selectedHistoryId, showMenu, setShowMenu, onSelect,
}: {
  historyList: HistoryItem[];
  selectedHistoryId: string | null;
  showMenu: boolean;
  setShowMenu: (v: boolean) => void;
  onSelect: (item: HistoryItem) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu, setShowMenu]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center justify-center gap-1.5 w-28 py-2 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-600 transition-all duration-200 shadow-sm hover:-translate-y-0.5 active:scale-95"
      >
        <History className="w-3.5 h-3.5" />
        History
        <ChevronDown className={cn('w-3 h-3 transition-transform', showMenu && 'rotate-180')} />
      </button>
      {showMenu && (
        <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-lg z-[60] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-700/60">
            <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">평가 히스토리 ({historyList.length})</p>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {historyList.map((item) => (
              <button
                key={item.id}
                onClick={() => onSelect(item)}
                className={cn(
                  'w-full flex items-start gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/60 text-left border-b border-slate-50 dark:border-slate-700 last:border-b-0 transition-colors',
                  selectedHistoryId === item.id && 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-100 dark:border-indigo-500/20'
                )}
              >
                <Clock className="w-4 h-4 text-slate-400 dark:text-slate-500 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded border', GRADE_COLOR[item.final_grade] ?? 'text-slate-600 bg-slate-50 border-slate-200')}>
                      {item.final_grade}
                    </span>
                    <span className="text-xs font-mono text-slate-600 dark:text-slate-300">{item.final_score != null ? (item.final_score * 100).toFixed(1) + '점' : '-'}</span>
                    <span className="text-xs text-slate-400 dark:text-slate-500">{item.total_qa} QA</span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    {item.metadata?.generation_model ?? '-'}
                  </p>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">
                    {formatKST(item.created_at)}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
