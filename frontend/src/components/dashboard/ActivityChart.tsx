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

export function ActivityChart({ scoreTrend, loading }: ScoreTrendProps) {
  const chartData = (scoreTrend || []).map((item, idx) => {
    const d = item.date ? new Date(item.date) : null;
    const label = d
      ? `${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getDate().toString().padStart(2, '0')}`
      : `#${idx + 1}`;
    return {
      name: label,
      score: item.score != null ? +(item.score * 100).toFixed(1) : 0,
      doc: item.doc || '',
      grade: item.grade || '',
    };
  });

  const isEmpty = chartData.length === 0;

  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">평가 점수 추이</h3>
          <p className="text-sm text-slate-500">Final Score (%) per evaluation</p>
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
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#94a3b8', fontSize: 12 }}
                dy={10}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: '#94a3b8', fontSize: 12 }}
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
              />
              <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="4 4" />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#fff',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                }}
                formatter={(value: number) => [`${value}%`, 'Score']}
                labelFormatter={(label) => {
                  const item = chartData.find((d) => d.name === label);
                  return item?.doc ? `${label} — ${item.doc}` : label;
                }}
              />
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
