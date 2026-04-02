import { useState } from 'react';
import { Tooltip, ResponsiveContainer, Treemap } from 'recharts';
import { INTENT_COLORS, INTENT_DESCRIPTIONS } from '@/src/types/evaluation';
import { TooltipCard } from '@/src/components/evaluation/shared';

// ─── 커스텀 툴팁 (Treemap hover) ────────────────────────────────────────────
const IntentTreemapTooltip = ({ active, payload }: any) => {
  if (active && payload?.length) {
    const d = payload[0].payload;
    const total = d.root?.value ?? d.value;
    const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
    const desc = INTENT_DESCRIPTIONS[d.name] ?? '';
    return (
      <TooltipCard>
        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100">
          {d.krLabel ?? d.name}
          <span className="text-slate-400 dark:text-slate-500 font-normal ml-1">({d.name})</span>
        </p>
        {desc && <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{desc}</p>}
        <div className="flex items-center gap-3 mt-1.5 pt-1.5 border-t border-slate-100 dark:border-white/10">
          <span className="text-[11px] text-slate-500 dark:text-slate-400">수량: <span className="font-bold text-slate-700 dark:text-slate-200">{d.value}개</span></span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">비중: <span className="font-bold text-indigo-600 dark:text-indigo-400">{pct}%</span></span>
        </div>
      </TooltipCard>
    );
  }
  return null;
};

// ─── Intent Treemap 차트 ────────────────────────────────────────────────────
export function IntentTreemap({ data }: { data: Array<{ name: string; krLabel: string; value: number }> }) {
  const [hoveredName, setHoveredName] = useState<string | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0);

  // recharts Treemap 데이터
  const treemapData = [{
    name: 'root',
    children: data.map(d => ({
      name:    d.name,
      krLabel: d.krLabel,
      value:   d.value,
      fill:    INTENT_COLORS[d.name] ?? '#94a3b8',
      root:    { value: total },
    })),
  }];

  const CustomCell = (props: any) => {
    const { x, y, width, height, name, krLabel, value, fill, depth } = props;
    if (depth === 0 || !name || name === 'root') return null;

    const isHovered = hoveredName === name;
    const pct       = total > 0 ? Math.round((value / total) * 100) : 0;
    const area      = width * height;

    const tier = area > 12000 ? 5 : area > 5000 ? 4 : area > 2200 ? 3 : area > 900 ? 2 : 1;

    const showPct   = width > 22 && height > 16;
    const showLabel = tier >= 3 && height > 32; 

    const pctSize   = [0, 8, 10, 12, 16, 18][tier]; 
    const lblSize   = [0, 0,  0, 8.5, 10, 11][tier];
    const sw        = tier <= 2 ? 1.5 : 3;

    const font = "'Inter', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    const textShadow = '0 1px 3px rgba(0,0,0,0.45), 0 0 1px rgba(0,0,0,0.3)';

    return (
      <g
        onMouseEnter={() => setHoveredName(name)}
        onMouseLeave={() => setHoveredName(null)}
        className="cursor-pointer group/cell"
      >
        <rect
          x={x + 1.5} y={y + 1.5}
          width={Math.max(0, width - 3)}
          height={Math.max(0, height - 3)}
          fill={fill}
          rx={8} ry={8}
          className="transition-all duration-300"
          style={{ 
            filter: isHovered
              ? 'brightness(1.12) saturate(1.15) drop-shadow(0 6px 16px rgba(0,0,0,0.22))'
              : 'brightness(1.0)',
            stroke: isHovered ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.15)',
            strokeWidth: isHovered ? 2.5 : 1
          }}
        />

        {showPct && (
          <text
            x={x + width / 2}
            y={y + (showLabel ? height / 2 - (pctSize * 0.4) : height / 2 + (pctSize * 0.4))}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#ffffff"
            fontSize={pctSize}
            fontWeight={800}
            fontFamily={font}
            paintOrder="stroke"
            stroke="rgba(0,0,0,0.25)"
            strokeWidth={sw}
            strokeLinejoin="round"
            className="pointer-events-none select-none transition-opacity duration-500"
            style={{ filter: `drop-shadow(${textShadow})` }}
          >
            {pct}%
          </text>
        )}

        {showLabel && (
          <text
            x={x + width / 2}
            y={y + height / 2 + (showPct ? pctSize * 0.6 : lblSize * 0.5)}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="rgba(255,255,255,0.92)"
            fontSize={lblSize}
            fontWeight={700}
            fontFamily={font}
            paintOrder="stroke"
            stroke="rgba(0,0,0,0.15)"
            strokeWidth="1.5px"
            className="pointer-events-none select-none transition-opacity duration-500"
            style={{ filter: `drop-shadow(${textShadow})` }}
          >
            {krLabel ?? name}
          </text>
        )}
      </g>
    );
  };

  if (data.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-xs text-slate-400">데이터 없음</div>;
  }

  return (
    <div
      className="flex-1 min-h-[240px] mt-1 animate-in fade-in zoom-in-95 duration-500"
      style={{ animationFillMode: 'both' }}
    >
      <ResponsiveContainer width="100%" height="100%">
        <Treemap
          data={treemapData}
          dataKey="value"
          aspectRatio={4 / 3}
          stroke="transparent"
          content={<CustomCell />}
          isAnimationActive={false}
        >
          <Tooltip content={<IntentTreemapTooltip />} isAnimationActive={false} />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}
