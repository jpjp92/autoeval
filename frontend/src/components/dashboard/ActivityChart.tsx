import { useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

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
    <div style={{
      backgroundColor: '#fff',
      borderRadius: '8px',
      border: '1px solid #e2e8f0',
      boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
      padding: '8px 12px',
      fontSize: '13px',
    }}>
      <p style={{ color: '#64748b', marginBottom: 4, fontWeight: 500 }}>{point.dateLabel}</p>
      {point.doc && (
        <p style={{ color: '#475569', marginBottom: 4, maxWidth: 220, wordBreak: 'break-all' }}>
          {point.doc}
        </p>
      )}
      <p style={{ color: '#6366f1', fontWeight: 700 }}>{point.score}%</p>
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
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">평가 점수 추이</h3>
          <p className="text-sm text-slate-500">최종 점수 비율 (%)</p>
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
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
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
              <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="4 4" />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone"
                dataKey="score"
                name="Final Score"
                stroke="#6366f1"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorScore)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
