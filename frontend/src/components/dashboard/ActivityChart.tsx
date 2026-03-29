import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { cn } from "@/src/lib/utils";

interface ScoreTrendProps {
  scoreTrend?: Array<{
    date: string;
    score: number | null;
    grade: string;
    doc: string;
  }>;
  loading?: boolean;
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  return (
    <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-md rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-200/50 dark:shadow-black/50 p-3 text-sm animate-in zoom-in-95 duration-200">
      <p className="text-slate-500 dark:text-slate-400 font-medium mb-1 text-[13px]">{point.dateLabel}</p>
      {point.doc && (
        <p className="text-slate-700 dark:text-slate-200 mb-1 max-w-[220px] break-all text-[13px] leading-tight">
          {point.doc}
        </p>
      )}
      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-100 dark:border-slate-700">
        <span className="w-2 h-2 rounded-full bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.8)]" />
        <p className="text-indigo-600 dark:text-indigo-400 font-bold">{point.score}%</p>
      </div>
    </div>
  );
}

export function ActivityChart({ scoreTrend, loading }: ScoreTrendProps) {
  const chartData = (scoreTrend || []).map((item, idx) => {
    const d = item.date ? new Date(item.date) : null;
    const dateLabel = d
      ? `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')} ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
      : `#${idx + 1}`;
    const dayKey = d
      ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      : null;
    return {
      idx,
      dayKey,
      dateLabel,
      score: item.score != null ? +(item.score * 100).toFixed(1) : 0,
      doc: item.doc || '',
      grade: item.grade || '',
    };
  });

  // 날짜별 첫 번째 항목만 x축 레이블 표시 (idx → label 사전 계산)
  const xTickMap = useMemo(() => {
    const map = new Map<number, string>();
    const seen = new Set<string>();
    chartData.forEach((point) => {
      if (!point.dayKey) return;
      if (seen.has(point.dayKey)) return;
      seen.add(point.dayKey);
      const d = new Date(scoreTrend![point.idx].date);
      map.set(point.idx, `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`);
    });
    return map;
  }, [chartData, scoreTrend]);

  const xTickFormatter = (idx: number) => xTickMap.get(idx) ?? '';

  const isEmpty = chartData.length === 0;

  return (
    <div className="bg-white/80 dark:bg-white/5 backdrop-blur-sm p-6 rounded-2xl border border-white/60 dark:border-white/8 shadow-lg shadow-slate-200/40 dark:shadow-black/20 transition-all duration-300 hover:shadow-xl dark:hover:shadow-black/40">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">평가 점수 추이</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">최종 점수 비율 (%)</p>
        </div>
      </div>

      <div className="h-[300px] w-full">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
          </div>
        ) : isEmpty ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400">
            <p className="text-sm">평가 데이터가 없습니다</p>
            <p className="text-xs mt-1">QA 생성 및 평가를 실행하면 차트가 표시됩니다</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorScore" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0.01}/>
                </linearGradient>
              </defs>
              <XAxis
                dataKey="idx"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#94a3b8', fontSize: 12 }}
                dy={10}
                tickFormatter={xTickFormatter}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#94a3b8', fontSize: 12 }}
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
              />
              <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.15)" strokeDasharray="4 4" />
              <Tooltip 
                content={<CustomTooltip />} 
                cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }}
              />
              <Area
                type="monotone"
                dataKey="score"
                name="Final Score"
                stroke="#6366f1"
                strokeWidth={3}
                fillOpacity={1}
                fill="url(#colorScore)"
                activeDot={{ 
                  r: 6, 
                  fill: "#6366f1", 
                  stroke: "white", 
                  strokeWidth: 3, 
                  style: { filter: 'drop-shadow(0 0 6px rgba(99,102,241,0.6))' } 
                }}
                animationDuration={1500}
                animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
