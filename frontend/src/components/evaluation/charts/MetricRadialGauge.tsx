import { useState, useEffect } from 'react';
import { Shuffle, Copy, Scale, ShieldCheck, Zap } from 'lucide-react';
import { cn } from '@/src/lib/utils';

export function MetricRadialGauge({ stat }: { stat: { subject: string; A: number } }) {
  const [val, setVal] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    // 10.0점 등 높은 점수에서도 0에서 차오르는 연출을 위해 매번 상태 초기화
    // stat 객체 전체를 감시하여 히스토리 전환 시 값이 같더라도 리셋 유도
    setIsReady(false);
    setVal(0);

    const t1 = setTimeout(() => setIsReady(true), 200);
    
    // 숫자 카운트업 (0 -> stat.A)
    const duration = 1200;
    const steps = 30;
    const increment = stat.A / steps || 0;
    let current = 0;
    
    const timer = setInterval(() => {
      current += increment;
      if (current >= stat.A) {
        setVal(stat.A);
        clearInterval(timer);
      } else {
        setVal(current);
      }
    }, duration / steps);

    return () => {
      clearTimeout(t1);
      clearInterval(timer);
    };
  }, [stat]); // stat.A 대신 stat 전체를 감시하여 히스토리 전환 대응

  const config: Record<string, { icon: any; lightColor: string; darkColor: string; bg: string; desc: string }> = {
    '다양성': { icon: Shuffle,       lightColor: '#0284c7', darkColor: '#38bdf8', bg: 'bg-sky-500/10',     desc: '데이터셋 내 질문 의도와 내용의 고른 분포' },
    '중복성': { icon: Copy,          lightColor: '#e67e22', darkColor: '#fbbf24', bg: 'bg-amber-500/10',   desc: '동일/유사한 의미를 가진 질문의 포함 정도' },
    '편향성': { icon: Scale,         lightColor: '#4f46e5', darkColor: '#a5b4fc', bg: 'bg-indigo-500/10',  desc: '특정 주제나 화자에 대한 편향성 여부' },
    '충족성': { icon: ShieldCheck,   lightColor: '#059669', darkColor: '#34d399', bg: 'bg-emerald-500/10', desc: '답변 도출을 위한 맥락 정보의 충분성'   },
  };
  const cfg = config[stat.subject] || { icon: Zap, lightColor: '#64748b', darkColor: '#94a3b8', bg: 'bg-slate-100', desc: '' };
  
  const r = 42;
  const circ = 2 * Math.PI * r;
  // 초기 로딩 중에는 전체 둘레로 설정하여 비워두고, 준비되면 목표치만큼 차오르게 함
  // 10.0점일 때도 비어있는 상태(circ)에서 목표치(targetOffset)까지 차오르게 함
  const targetOffset = circ * (1 - Math.min(Math.max(stat.A, 0), 10) / 10);
  const currentOffset = isReady ? targetOffset : circ;

  return (
    <div 
      className="flex flex-col items-center justify-center group/gauge relative"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Hover Tooltip */}
      {isHovered && (
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 z-50 pointer-events-none w-max">
          <div className="bg-white/95 dark:bg-slate-800/95 backdrop-blur-md px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-200/50 dark:shadow-black/50 animate-in fade-in zoom-in-95 duration-200 flex flex-col items-center">
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", cfg.bg, stat.subject === '다양성' && "text-sky-600 dark:text-sky-400", stat.subject === '중복성' && "text-amber-600 dark:text-amber-400", stat.subject === '편향성' && "text-indigo-600 dark:text-indigo-400", stat.subject === '충족성' && "text-emerald-600 dark:text-emerald-400")}>
                {stat.subject}
              </span>
              <span className="text-[10px] font-black text-slate-700 dark:text-slate-200">{stat.A.toFixed(1)} / 10.0</span>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 whitespace-nowrap">{cfg.desc}</p>
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white/95 dark:bg-slate-800/95 border-r border-b border-slate-200 dark:border-slate-700 rotate-45 invisible sm:visible" />
          </div>
        </div>
      )}

      <div className="relative w-24 h-24 flex items-center justify-center">
        <svg className="w-full h-full -rotate-90 transform" viewBox="0 0 100 100">
          <defs>
            <linearGradient id={`grad-${stat.subject}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.85" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
            </linearGradient>
          </defs>
          <circle
            cx="50" cy="50" r={r}
            stroke="currentColor"
            strokeWidth="4"
            fill="transparent"
            className="text-slate-200 dark:text-white/5 opacity-40 dark:opacity-100"
          />
          <circle
            cx="50" cy="50" r={r}
            stroke={`url(#grad-${stat.subject})`}
            strokeWidth="6"
            fill="transparent"
            strokeDasharray={circ}
            strokeDashoffset={currentOffset}
            strokeLinecap="round"
            className={cn(
              "transition-all duration-1000 cubic-bezier(0.34, 1.56, 0.64, 1)",
              stat.subject === '다양성' && "text-sky-500 dark:text-sky-400",
              stat.subject === '중복성' && "text-amber-500 dark:text-amber-400",
              stat.subject === '편향성' && "text-indigo-500 dark:text-indigo-400",
              stat.subject === '충족성' && "text-emerald-500 dark:text-emerald-400"
            )}
            style={{ 
              filter: isReady ? 'drop-shadow(0 0 3px currentColor)' : 'none',
              opacity: isReady ? 1 : 0
            }}
          />
          {/* Light mode 전용 선명한 보정 선 */}
          <circle
            cx="50" cy="50" r={r}
            stroke="currentColor"
            strokeWidth="6"
            fill="transparent"
            strokeDasharray={circ}
            strokeDashoffset={currentOffset}
            strokeLinecap="round"
            className={cn(
              "transition-all duration-1000 cubic-bezier(0.34, 1.56, 0.64, 1) dark:hidden",
              stat.subject === '다양성' && "text-sky-500",
              stat.subject === '중복성' && "text-amber-500",
              stat.subject === '편향성' && "text-indigo-500",
              stat.subject === '충족성' && "text-emerald-500"
            )}
            style={{ opacity: isReady ? 0.9 : 0 }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-black text-slate-800 dark:text-white leading-none tracking-tight">
            {val.toFixed(1)}
          </span>
          <div className={cn(
            "mt-1.5 p-1 rounded-md transform transition-all duration-300 group-hover/gauge:scale-110 group-hover/gauge:rotate-3 shadow-sm",
            cfg.bg,
            stat.subject === '다양성' && "text-sky-600 dark:text-sky-400",
            stat.subject === '중복성' && "text-amber-600 dark:text-amber-400",
            stat.subject === '편향성' && "text-indigo-600 dark:text-indigo-400",
            stat.subject === '충족성' && "text-emerald-600 dark:text-emerald-400"
          )}>
            <cfg.icon className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>
      <div className="mt-2 text-center">
        <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 tracking-tight">{stat.subject}</p>
      </div>
    </div>
  );
}
