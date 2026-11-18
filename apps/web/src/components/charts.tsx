import { formatCompact, formatMonth } from "@voyadesk/core";

/** Grouped bars over months (invoiced vs collected), hand-drawn SVG so it stays light and themeable. */
export function MonthBars({ data, series }: { data: { month: string; [k: string]: number | string }[]; series: { key: string; label: string; color: string }[] }) {
  const W = 560;
  const H = 200;
  const pad = { l: 44, r: 8, t: 10, b: 26 };
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
  const nice = niceMax(max);
  const gw = (W - pad.l - pad.r) / Math.max(1, data.length);
  const bw = Math.min(22, (gw - 12) / series.length);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / nice);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * nice);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Monthly trend chart">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#e9edf3" strokeDasharray={t === 0 ? undefined : "3 4"} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="#8a96a6">{formatCompact(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x0 = pad.l + i * gw + (gw - bw * series.length - 4 * (series.length - 1)) / 2;
          return (
            <g key={d.month}>
              {series.map((s, j) => {
                const v = Number(d[s.key]) || 0;
                return <rect key={s.key} x={x0 + j * (bw + 4)} y={y(v)} width={bw} height={Math.max(0, y(0) - y(v))} rx="4" fill={s.color}><title>{`${s.label}: ${formatCompact(v)}`}</title></rect>;
              })}
              <text x={pad.l + i * gw + gw / 2} y={H - 8} textAnchor="middle" fontSize="10.5" fill="#5f6b7a">{formatMonth(String(d.month))}</text>
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-xs text-ink-600">
        {series.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}
      </div>
    </div>
  );
}

function niceMax(v: number) {
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const n = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return n * exp;
}

/** Horizontal bars for ranked categories (lead sources, destinations). */
export function RankBars({ items, format = (v) => String(v), color = "#1d5fd1" }: { items: { label: string; value: number }[]; format?: (v: number) => string; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.length === 0) return <div className="py-6 text-center text-sm text-ink-500">No data yet</div>;
  return (
    <div className="space-y-2.5">
      {items.map((i) => (
        <div key={i.label}>
          <div className="mb-1 flex justify-between text-sm"><span className="text-ink-700">{i.label}</span><span className="font-medium tabular-nums text-ink-900">{format(i.value)}</span></div>
          <div className="h-1.5 rounded-full bg-slate-100"><div className="h-1.5 rounded-full transition-[width] duration-500" style={{ width: `${(i.value / max) * 100}%`, background: color }} /></div>
        </div>
      ))}
    </div>
  );
}

/** Pipeline funnel: each stage as wide as its count against the largest, with step-to-step conversion. */
export function Funnel({ stages }: { stages: { label: string; count: number; tone: string }[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count));
  return (
    <div className="space-y-2">
      {stages.map((s, i) => {
        const prev = stages[i - 1];
        const conv = prev && prev.count > 0 && s.label !== "Lost" ? Math.round((s.count / prev.count) * 100) : null;
        return (
          <div key={s.label} className="flex items-center gap-3">
            <span className="w-[92px] shrink-0 text-xs font-medium text-ink-600">{s.label}</span>
            <div className="h-7 flex-1 rounded-md bg-slate-50">
              <div className="flex h-7 items-center rounded-md px-2 text-xs font-semibold text-white transition-[width] duration-500" style={{ width: `${Math.max(9, (s.count / max) * 100)}%`, background: s.tone }}>{s.count}</div>
            </div>
            <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-ink-400">{conv === null ? "" : `${conv}%`}</span>
          </div>
        );
      })}
    </div>
  );
}
