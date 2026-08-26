

/** Palette used for categorical series; theme-aware via CSS variables where possible. */
export const SERIES_COLORS = [
  '#7c8cff', '#4fd1a5', '#f0b429', '#ff6b81', '#b98cff',
  '#4fd6e0', '#f78c6b', '#8fce5b', '#e879c0', '#69a8ff',
];

const niceMax = (v: number): number => {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * mag;
};

export interface Point {
  label: string;
  value: number;
}

/** Grouped bars — the income vs spending workhorse. */
export function GroupedBars({
  groups,
  series,
  height = 200,
  format,
}: {
  groups: string[];
  series: { name: string; color: string; values: number[] }[];
  height?: number;
  format: (n: number) => string;
}) {
  const W = 720;
  const H = height;
  const padL = 54;
  const padB = 24;
  const padT = 10;
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const innerW = W - padL - 8;
  const innerH = H - padB - padT;
  const groupW = innerW / Math.max(1, groups.length);
  const barW = Math.max(3, (groupW * 0.62) / series.length);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line className="grid-line" x1={padL} x2={W - 8} y1={padT + innerH * f} y2={padT + innerH * f} />
          <text x={padL - 8} y={padT + innerH * f + 3} textAnchor="end">
            {format(max * (1 - f))}
          </text>
        </g>
      ))}
      {groups.map((g, gi) => (
        <g key={g}>
          {series.map((s, si) => {
            const v = s.values[gi] ?? 0;
            const h = (Math.max(0, v) / max) * innerH;
            const x = padL + gi * groupW + groupW / 2 - (barW * series.length) / 2 + si * barW;
            return (
              <rect
                key={s.name}
                x={x}
                y={padT + innerH - h}
                width={Math.max(2, barW - 2)}
                height={Math.max(0, h)}
                rx={2}
                fill={s.color}
              >
                <title>{`${g} · ${s.name}: ${format(v)}`}</title>
              </rect>
            );
          })}
          <text x={padL + gi * groupW + groupW / 2} y={H - 7} textAnchor="middle">
            {g}
          </text>
        </g>
      ))}
    </svg>
  );
}

/** Multi-series line chart with optional area fill on the first series. */
export function LineChart({
  labels,
  series,
  height = 220,
  format,
  area = false,
}: {
  labels: string[];
  series: { name: string; color: string; values: number[]; dashed?: boolean }[];
  height?: number;
  format: (n: number) => string;
  area?: boolean;
}) {
  const W = 720;
  const H = height;
  const padL = 56;
  const padB = 22;
  const padT = 10;
  const innerW = W - padL - 10;
  const innerH = H - padB - padT;
  const all = series.flatMap((s) => s.values);
  const max = niceMax(Math.max(1, ...all));
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const x = (i: number) => padL + (labels.length <= 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
  const y = (v: number) => padT + innerH - ((v - min) / span) * innerH;
  const every = Math.ceil(labels.length / 12);

  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img">
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line className="grid-line" x1={padL} x2={W - 10} y1={padT + innerH * f} y2={padT + innerH * f} />
          <text x={padL - 8} y={padT + innerH * f + 3} textAnchor="end">
            {format(min + span * (1 - f))}
          </text>
        </g>
      ))}
      {series.map((s, si) => {
        const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(v)}`).join(' ');
        return (
          <g key={s.name}>
            {area && si === 0 && (
              <path
                d={`${d} L${x(s.values.length - 1)},${y(min)} L${x(0)},${y(min)} Z`}
                fill={s.color}
                opacity={0.14}
              />
            )}
            <path
              d={d}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? '5 4' : undefined}
              strokeLinejoin="round"
            />
            {s.values.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={s.color}>
                <title>{`${labels[i]} · ${s.name}: ${format(v)}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
      {labels.map((l, i) =>
        i % every === 0 ? (
          <text key={l + i} x={x(i)} y={H - 6} textAnchor="middle">
            {l}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/** Donut with a centred headline — used for category mix and needs/wants/savings. */
export function Donut({
  slices,
  size = 190,
  thickness = 26,
  center,
  centerSub,
  format,
}: {
  slices: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
  center?: string;
  centerSub?: string;
  format?: (n: number) => string;
}) {
  const total = slices.reduce((a, s) => a + Math.max(0, s.value), 0);
  const r = size / 2 - thickness / 2;
  const c = size / 2;
  let angle = -Math.PI / 2;

  return (
    <svg className="chart" viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img">
      <circle cx={c} cy={c} r={r} fill="none" stroke="var(--surface-2)" strokeWidth={thickness} />
      {total > 0 &&
        slices.map((s) => {
          const frac = Math.max(0, s.value) / total;
          const sweep = frac * Math.PI * 2;
          const x1 = c + r * Math.cos(angle);
          const y1 = c + r * Math.sin(angle);
          const x2 = c + r * Math.cos(angle + sweep);
          const y2 = c + r * Math.sin(angle + sweep);
          const large = sweep > Math.PI ? 1 : 0;
          const d = `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2}`;
          angle += sweep;
          return (
            <path key={s.label} d={d} fill="none" stroke={s.color} strokeWidth={thickness}>
              <title>{`${s.label}: ${format ? format(s.value) : s.value} (${Math.round(frac * 100)}%)`}</title>
            </path>
          );
        })}
      {center && (
        <text x={c} y={c - 1} textAnchor="middle" style={{ fill: 'var(--text)', fontSize: 17, fontWeight: 650 }}>
          {center}
        </text>
      )}
      {centerSub && (
        <text x={c} y={c + 15} textAnchor="middle" style={{ fontSize: 10.5 }}>
          {centerSub}
        </text>
      )}
    </svg>
  );
}

/** Horizontal 100% stacked bar — compact enough to sit inside a card header. */
export function StackedBar({
  parts,
  format,
  height = 14,
}: {
  parts: { label: string; value: number; color: string }[];
  format: (n: number) => string;
  height?: number;
}) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.value), 0) || 1;
  return (
    <div style={{ display: 'flex', height, borderRadius: 999, overflow: 'hidden', background: 'var(--surface-2)' }}>
      {parts.map((p) => (
        <div
          key={p.label}
          title={`${p.label}: ${format(p.value)} (${Math.round((p.value / total) * 100)}%)`}
          style={{ width: `${(Math.max(0, p.value) / total) * 100}%`, background: p.color }}
        />
      ))}
    </div>
  );
}

export function Sparkline({
  values,
  color = 'var(--accent)',
  height = 34,
}: {
  values: number[];
  color?: string;
  height?: number;
}) {
  const W = 120;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const d = values
    .map((v, i) => {
      const x = (i / Math.max(1, values.length - 1)) * W;
      const y = height - ((v - min) / span) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${height}`} height={height} preserveAspectRatio="none">
      <path d={d} fill="none" stroke={color} strokeWidth={1.8} />
    </svg>
  );
}

/** Ranked horizontal bars, for category tables and payoff comparisons. */
export function RankedBars({
  rows,
  format,
  colorFor,
}: {
  rows: { label: string; value: number; sub?: string }[];
  format: (n: number) => string;
  colorFor?: (label: string, index: number) => string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="col gap-6">
      {rows.map((r, i) => (
        <div key={r.label} className="row" style={{ gap: 12 }}>
          <div className="truncate small" style={{ width: 150, flex: '0 0 150px' }} title={r.label}>
            {r.label}
          </div>
          <div className="bar" style={{ flex: 1 }}>
            <span
              style={{
                width: `${(r.value / max) * 100}%`,
                background: colorFor ? colorFor(r.label, i) : SERIES_COLORS[i % SERIES_COLORS.length],
              }}
            />
          </div>
          <div className="small num right" style={{ width: 96, flex: '0 0 96px' }}>
            {format(r.value)}
            {r.sub && <div className="tiny faint">{r.sub}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
