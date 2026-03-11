import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const data = [
  { name: 'Mon', inputTokens: 1.2, outputTokens: 0.4 },
  { name: 'Tue', inputTokens: 2.1, outputTokens: 0.8 },
  { name: 'Wed', inputTokens: 1.8, outputTokens: 0.6 },
  { name: 'Thu', inputTokens: 3.5, outputTokens: 1.2 },
  { name: 'Fri', inputTokens: 4.2, outputTokens: 1.5 },
  { name: 'Sat', inputTokens: 1.5, outputTokens: 0.5 },
  { name: 'Sun', inputTokens: 0.8, outputTokens: 0.2 },
];

export function ActivityChart() {
  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Token Usage (Millions)</h3>
          <p className="text-sm text-slate-500">Input vs Output tokens over time</p>
        </div>
        <select className="text-sm border-slate-200 rounded-lg text-slate-600 focus:ring-indigo-500">
          <option>Last 7 days</option>
          <option>Last 30 days</option>
        </select>
      </div>
      
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorInput" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.2}/>
                <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
              </linearGradient>
              <linearGradient id="colorOutput" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
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
            />
            <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="4 4" />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: '#fff', 
                borderRadius: '8px', 
                border: '1px solid #e2e8f0',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' 
              }}
            />
            <Area 
              type="monotone" 
              dataKey="inputTokens" 
              name="Input Tokens (M)"
              stroke="#6366f1" 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorInput)" 
            />
            <Area 
              type="monotone" 
              dataKey="outputTokens" 
              name="Output Tokens (M)"
              stroke="#10b981" 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorOutput)" 
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
