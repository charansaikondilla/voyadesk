import { useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, Award, BarChart3, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Filter, IndianRupee, Info, Lightbulb, Megaphone,
  PiggyBank, Plus, Sparkles, Target, ThumbsDown, Trash2, TrendingUp, Users, Workflow, XCircle, CheckCircle2,
} from "lucide-react";
import { LEAD_SOURCES, type ChannelSpend, type LeadSource, type MarketingFunnel } from "@voyadesk/core";
import { api } from "../../lib/api";
import { useList, useMutation, useReport } from "../../lib/hooks";
import { formatCompact, money, SOURCE_LABEL } from "../../lib/format";
import { RankBars } from "../charts";
import { Badge, Button, ButtonLink, Card, CardTitle, Confirm, Empty, ErrorNote, IconChip, Input, Modal, MoneyInput, Segmented, Skeleton, Stat, cx } from "../ui";
import { bpsPct, hourText, minsText, monthKey, monthLong, plural, roiText, shiftMonth, trendOf, TrendArrow, useAccess } from "./kit";

export type Days = 7 | 30 | 90 | 365;
const RANGES: { value: Days; label: string }[] = [{ value: 7, label: "7d" }, { value: 30, label: "30d" }, { value: 90, label: "90d" }, { value: 365, label: "1y" }];
const RANGE_WORDS: Record<Days, string> = { 7: "last 7 days", 30: "last 30 days", 90: "last 90 days", 365: "last 12 months" };
/** Channels you usually pay for: we nudge when their spend for the month is missing. */
const PAID: LeadSource[] = ["meta_ads", "google_ads", "instagram", "landing_page", "website", "email", "whatsapp"];
const STAGE_COLOR: Record<string, string> = { leads: "#3a6cf2", contacted: "#0891b2", quoted: "#7c3aed", won: "#059669" };

export function useRange(): [Days, (d: Days) => void] {
  const [params, setParams] = useSearchParams();
  const raw = Number(params.get("days"));
  const days: Days = raw === 7 || raw === 90 || raw === 365 ? raw : 30;
  const set = (d: Days) => setParams((p) => { const n = new URLSearchParams(p); if (d === 30) n.delete("days"); else n.set("days", String(d)); return n; }, { replace: true });
  return [days, set];
}

export function RangePicker({ value, onChange }: { value: Days; onChange: (d: Days) => void }) {
  return <Segmented label="Date range" size="sm" options={RANGES} value={value} onChange={onChange} />;
}

/* ───────────────────────── Overview tab ───────────────────────── */

export function MarketingOverview({ onNewCampaign }: { onNewCampaign?: () => void }) {
  const [days, setDays] = useRange();
  const access = useAccess();
  const report = useReport<MarketingFunnel>("marketingFunnel", { days });
  const canSpend = access.read("channelSpend");
  const spend = useList("channelSpend", canSpend);
  const [spendOpen, setSpendOpen] = useState(false);
  const r = report.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink-900">How marketing is performing</h2>
          <p className="text-[13px] text-ink-500">{r ? `${RANGE_WORDS[days]} · compared with the ${days === 365 ? "12 months" : `${days} days`} before` : `Leads, cost and revenue for the ${RANGE_WORDS[days]}`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RangePicker value={days} onChange={setDays} />
          {canSpend && access.write("channelSpend") && <Button size="sm" variant="secondary" icon={<IndianRupee className="size-3.5" />} onClick={() => setSpendOpen(true)}>Ad spend</Button>}
        </div>
      </div>

      {report.error && !r ? (
        <ErrorNote message={report.error.status === 404 ? "The marketing funnel report isn't available yet. Your campaigns, audiences and journeys still work from the other tabs." : report.error.status === 403 ? "Marketing performance is visible to owners, admins and the marketing team." : report.error.message} onRetry={report.reload} />
      ) : !r ? <OverviewSkeleton /> : (
        <>
          <Kpis r={r} canSpend={canSpend} onSpend={() => setSpendOpen(true)} />
          <div className="grid gap-4 lg:grid-cols-5">
            <Card className="lg:col-span-3"><FunnelCard r={r} /></Card>
            <Card className="lg:col-span-2"><InsightsCard r={r} /></Card>
          </div>
          {canSpend && <SpendNudge r={r} spend={spend.data ?? []} onOpen={access.write("channelSpend") ? () => setSpendOpen(true) : undefined} />}
          <ChannelsCard r={r} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardTitle icon={<BarChart3 className="size-[18px]" />} title="Leads vs bookings by week" subtitle={`${plural(r.totals.leads, "lead")} and ${plural(r.totals.won, "booking")} in the ${RANGE_WORDS[days]}`} />
              <WeeklyBars data={r.weekly} />
            </Card>
            <Card>
              <CardTitle icon={<ThumbsDown className="size-[18px]" />} title="Why leads were lost" subtitle="Fix the top reason first" />
              {r.lostReasons.length ? <RankBars items={r.lostReasons.slice(0, 6).map((x) => ({ label: x.reason, value: x.count }))} color="#94a3b8" /> : <p className="py-6 text-center text-sm text-ink-500">No lost leads in this period.</p>}
            </Card>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <BestHourCard r={r} onNewCampaign={onNewCampaign} />
            <AutomationCard r={r} />
          </div>
        </>
      )}
      {canSpend && <AdSpendModal open={spendOpen} onClose={() => setSpendOpen(false)} rows={spend.data} loading={!spend.data && !spend.error} />}
    </div>
  );
}

function OverviewSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading marketing report">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[108px] rounded-xl" />)}</div>
      <div className="grid gap-4 lg:grid-cols-5"><Skeleton className="h-[260px] rounded-xl lg:col-span-3" /><Skeleton className="h-[260px] rounded-xl lg:col-span-2" /></div>
      <Skeleton className="h-[280px] rounded-xl" />
    </div>
  );
}

function Kpis({ r, canSpend, onSpend }: { r: MarketingFunnel; canSpend: boolean; onSpend: () => void }) {
  const t = r.totals;
  const prevConv = t.prevLeads ? Math.round((t.prevWon / t.prevLeads) * 10000) : 0;
  const convTrend = t.prevLeads ? trendOf(t.conversionBps, prevConv) : undefined;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Stat label="Leads" value={t.leads.toLocaleString("en-IN")} icon={<Users />} to="/app/leads" trend={trendOf(t.leads, t.prevLeads)} hint="vs previous period" />
      <Stat label="Cost per lead" value={t.cpl === null ? "—" : money(t.cpl)} icon={<PiggyBank />}
        hint={t.spend ? `${formatCompact(t.spend)} spent` : canSpend ? <button type="button" onClick={onSpend} className="font-medium text-brand-700 hover:underline">Add ad spend</button> : "No spend recorded"} />
      <Stat label="Lead → booking" value={bpsPct(t.conversionBps)} icon={<Target />} trend={convTrend} hint={`${plural(t.won, "booking")}`} />
      <Stat label="Revenue booked" value={formatCompact(t.revenue)} tone="good" icon={<TrendingUp />} trend={trendOf(t.revenue, t.prevRevenue)} hint={t.avgDealSize ? `avg ${formatCompact(t.avgDealSize)}` : undefined} />
      <div className="col-span-2 lg:col-span-1">
        <Stat label="Return on spend" value={roiText(t.roiPct)} tone={t.roiPct === null ? "default" : t.roiPct >= 0 ? "good" : "bad"} icon={<Award />}
          hint={t.roiPct === null ? "Needs ad spend to calculate" : `${formatCompact(t.pipelineValue)} still in pipeline`} />
      </div>
    </div>
  );
}

/* ───────────────────────── funnel ───────────────────────── */

function FunnelCard({ r }: { r: MarketingFunnel }) {
  const stages = r.stages;
  const max = Math.max(1, ...stages.map((s) => s.count));
  const drops = stages.map((s, i) => {
    const prev = stages[i - 1];
    return prev && prev.count > 0 ? Math.round(((prev.count - s.count) / prev.count) * 100) : null;
  });
  const worst = drops.reduce<number>((w, d, i) => (d !== null && (w < 0 || d > (drops[w] ?? -1)) ? i : w), -1);
  return (
    <>
      <CardTitle icon={<Filter className="size-[18px]" />} title="Lead funnel" subtitle={r.totals.avgDaysToWin ? `Leads take about ${Math.round(r.totals.avgDaysToWin)} days to book` : "Where leads drop off between stages"}
        action={<Link to="/app/leads" className="text-[13px] font-medium text-brand-700 hover:underline">Open pipeline</Link>} />
      {stages.length === 0 || max <= 0 ? <p className="py-8 text-center text-sm text-ink-500">No leads in this period yet.</p> : (
        <ol className="space-y-1">
          {stages.map((s, i) => {
            const w = Math.max(14, (s.count / max) * 100);
            const fromTop = stages[0]?.count ? Math.round((s.count / stages[0].count) * 100) : 0;
            const drop = drops[i];
            return (
              <li key={s.key}>
                {drop !== null && drop !== undefined && (
                  <div className="flex items-center gap-2 py-1 pl-[104px] text-[11px] text-ink-500 sm:pl-[120px]">
                    <ChevronDown className="size-3 text-ink-300" />
                    <span className={cx("tabular-nums", i === worst && drop > 0 ? "font-semibold text-amber-700" : "")}>{drop > 0 ? `${drop}% drop off` : "no drop off"}</span>
                    {i === worst && drop > 0 && <Badge tone="amber">Biggest leak</Badge>}
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className="w-[92px] shrink-0 sm:w-[108px]">
                    <div className="text-[13px] font-medium text-ink-800">{s.label}</div>
                    <div className="text-[11px] tabular-nums text-ink-400">{formatCompact(s.value)}</div>
                  </div>
                  <div className="relative h-9 flex-1 rounded-lg bg-slate-50">
                    <div className="absolute inset-y-0 left-1/2 flex -translate-x-1/2 items-center justify-center rounded-lg transition-[width] duration-500" style={{ width: `${w}%`, background: STAGE_COLOR[s.key] ?? "#3a6cf2" }}>
                      <span className="px-2 text-sm font-semibold tabular-nums text-white">{s.count.toLocaleString("en-IN")}</span>
                    </div>
                  </div>
                  <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-ink-500" title="Share of all leads">{i === 0 ? "100%" : `${fromTop}%`}</span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

/* ───────────────────────── insights ───────────────────────── */

function InsightsCard({ r }: { r: MarketingFunnel }) {
  const icon = { good: <CheckCircle2 className="size-4 text-emerald-600" />, warn: <AlertTriangle className="size-4 text-amber-600" />, info: <Info className="size-4 text-brand-600" /> };
  return (
    <>
      <CardTitle icon={<Lightbulb className="size-[18px]" />} title="What to do next" subtitle="Spotted in your numbers" />
      {r.insights.length === 0 ? (
        <div className="flex flex-col items-center py-8 text-center"><Sparkles className="mb-2 size-6 text-ink-300" /><p className="text-sm text-ink-500">Nothing needs your attention. Keep the campaigns going.</p></div>
      ) : (
        <ul className="-mx-1.5 space-y-0.5">
          {r.insights.map((x, i) => {
            const body = (
              <>
                <span className="mt-0.5 shrink-0">{icon[x.tone]}</span>
                <span className="flex-1 text-sm leading-5 text-ink-800">{x.text}</span>
                {x.to && <ArrowRight className="mt-0.5 size-4 shrink-0 text-ink-300 transition group-hover:translate-x-0.5 group-hover:text-brand-600" />}
              </>
            );
            return (
              <li key={i}>
                {x.to ? <Link to={x.to} className="group flex items-start gap-2.5 rounded-lg px-1.5 py-2 hover:bg-slate-50">{body}</Link> : <div className="flex items-start gap-2.5 px-1.5 py-2">{body}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/* ───────────────────────── channels ───────────────────────── */

type SortKey = "leads" | "conversionBps" | "revenue" | "spend" | "cpl" | "roiPct" | "responseMins";
const COLS: { key: SortKey; label: string; lowIsGood?: boolean }[] = [
  { key: "leads", label: "Leads" }, { key: "conversionBps", label: "Conversion" }, { key: "revenue", label: "Revenue" }, { key: "spend", label: "Spend" },
  { key: "cpl", label: "Cost / lead", lowIsGood: true }, { key: "roiPct", label: "ROI" }, { key: "responseMins", label: "Response", lowIsGood: true },
];

function ChannelsCard({ r }: { r: MarketingFunnel }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "leads", dir: "desc" });
  const rows = useMemo(() => {
    const v = (x: MarketingFunnel["channels"][number]) => x[sort.key];
    return [...r.channels].sort((a, b) => {
      const va = v(a); const vb = v(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1; // unknowns always last
      if (vb === null) return -1;
      return sort.dir === "asc" ? va - vb : vb - va;
    });
  }, [r.channels, sort]);

  // Best / worst: judged on ROI when there's spend, otherwise on conversion; ignore channels with too few leads to matter
  const { best, worst } = useMemo(() => {
    const enough = r.channels.filter((c) => c.leads >= Math.max(3, Math.round(r.totals.leads * 0.05)));
    const withRoi = enough.filter((c) => c.roiPct !== null);
    const pool = withRoi.length >= 2 ? withRoi : enough;
    const score = (c: MarketingFunnel["channels"][number]) => (withRoi.length >= 2 ? c.roiPct ?? 0 : c.conversionBps);
    if (pool.length < 2) return { best: null as string | null, worst: null as string | null };
    const s = [...pool].sort((a, b) => score(b) - score(a));
    return { best: s[0]!.source as string, worst: s[s.length - 1]!.source as string };
  }, [r.channels, r.totals.leads]);

  const toggle = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === "desc" ? "asc" : "desc") : COLS.find((c) => c.key === key)?.lowIsGood ? "asc" : "desc" }));
  const cell = (c: MarketingFunnel["channels"][number], k: SortKey): ReactNode => {
    switch (k) {
      case "leads": return <span className="inline-flex items-center gap-1.5"><span className="font-semibold">{c.leads}</span><TrendArrow cur={c.leads} prev={c.prevLeads} label={`Previous period: ${c.prevLeads} leads`} /></span>;
      case "conversionBps": return <span title={`${c.won} of ${c.leads} booked`}>{bpsPct(c.conversionBps)}</span>;
      case "revenue": return formatCompact(c.revenue);
      case "spend": return c.spend ? formatCompact(c.spend) : <span className="text-ink-400">—</span>;
      case "cpl": return c.cpl === null ? <span className="text-ink-400">—</span> : money(c.cpl);
      case "roiPct": return c.roiPct === null ? <span className="text-ink-400">—</span> : <span className={c.roiPct >= 0 ? "font-semibold text-emerald-700" : "font-semibold text-rose-700"}>{roiText(c.roiPct)}</span>;
      case "responseMins": return <span className={c.responseMins !== null && c.responseMins > 60 ? "text-amber-700" : ""}>{minsText(c.responseMins)}</span>;
    }
  };
  const tag = (src: string) => src === best ? <Badge tone="green" dot>Best</Badge> : src === worst ? <Badge tone="amber" dot>Needs work</Badge> : null;

  return (
    <Card padded={false}>
      <div className="p-4 pb-0 sm:p-5 sm:pb-0">
        <CardTitle icon={<Megaphone className="size-[18px]" />} title="Channels" subtitle="Where leads come from, what they cost and what they bring back. Tap a column to sort." />
      </div>
      {rows.length === 0 ? <div className="px-5 pb-5"><Empty icon={<Megaphone />} title="No leads in this period">Leads from WhatsApp, ads, your website and walk-ins will show up here by channel.</Empty></div> : (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="border-y border-line bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500">
                <tr>
                  <th scope="col" className="px-5 py-2.5">Channel</th>
                  {COLS.map((c) => (
                    <th key={c.key} scope="col" className="px-3 py-2.5 text-right" aria-sort={sort.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                      <button type="button" onClick={() => toggle(c.key)} className="inline-flex items-center gap-1 uppercase tracking-[0.06em] hover:text-ink-800">
                        {c.label}{sort.key === c.key ? (sort.dir === "asc" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />) : <ChevronDown className="size-3 opacity-30" />}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line/80">
                {rows.map((c) => (
                  <tr key={c.source} className={cx("transition-colors hover:bg-slate-50/60", c.source === best && "bg-emerald-50/40", c.source === worst && "bg-amber-50/40")}>
                    <td className="px-5 py-3">
                      <span className="font-medium text-ink-900">{c.label || SOURCE_LABEL[c.source]}</span>
                      <span className="ml-2 align-middle">{tag(c.source)}</span>
                    </td>
                    {COLS.map((k) => <td key={k.key} className="px-3 py-3 text-right tabular-nums text-ink-800">{cell(c, k.key)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="md:hidden">
            <div className="no-scrollbar flex gap-1 overflow-x-auto px-4 pb-3">
              <span className="self-center pr-1 text-xs text-ink-500">Sort</span>
              {COLS.map((c) => (
                <button key={c.key} type="button" onClick={() => toggle(c.key)} aria-pressed={sort.key === c.key}
                  className={cx("inline-flex shrink-0 items-center gap-0.5 rounded-full px-2.5 py-1 text-xs font-medium", sort.key === c.key ? "bg-ink-900 text-white" : "bg-slate-100 text-ink-600")}>
                  {c.label}{sort.key === c.key && (sort.dir === "asc" ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />)}
                </button>
              ))}
            </div>
            <ul className="divide-y divide-line border-t border-line">
              {rows.map((c) => (
                <li key={c.source} className={cx("px-4 py-3", c.source === best && "bg-emerald-50/40", c.source === worst && "bg-amber-50/40")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-ink-900">{c.label || SOURCE_LABEL[c.source]}</span>
                    {tag(c.source)}
                  </div>
                  <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
                    {COLS.map((k) => (
                      <div key={k.key} className="min-w-0">
                        <dt className="text-[11px] text-ink-500">{k.label}</dt>
                        <dd className="truncate tabular-nums text-ink-900">{cell(c, k.key)}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </Card>
  );
}

/* ───────────────────────── weekly chart ───────────────────────── */

function WeeklyBars({ data }: { data: MarketingFunnel["weekly"] }) {
  if (data.length === 0) return <p className="py-8 text-center text-sm text-ink-500">No weeks to show yet.</p>;
  const W = 560; const H = 190;
  const pad = { l: 28, r: 6, t: 10, b: 24 };
  const max = Math.max(1, ...data.map((d) => d.leads));
  const nice = max <= 5 ? 5 : Math.ceil(max / 5) * 5;
  const gw = (W - pad.l - pad.r) / data.length;
  const bw = Math.max(2, Math.min(18, gw * 0.36));
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / nice);
  const every = Math.ceil(data.length / 8);
  const label = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Leads and bookings per week">
        {[0, 0.5, 1].map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t * nice)} y2={y(t * nice)} stroke="#e9edf3" strokeDasharray={t === 0 ? undefined : "3 4"} />
            <text x={pad.l - 6} y={y(t * nice) + 4} textAnchor="end" fontSize="10" fill="#8a96a6">{Math.round(t * nice)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const x = pad.l + i * gw + gw / 2;
          return (
            <g key={d.week}>
              <rect x={x - bw - 1} y={y(d.leads)} width={bw} height={Math.max(0, y(0) - y(d.leads))} rx={Math.min(3, bw / 2)} fill="#91b3fc"><title>{`Week of ${label(d.week)}: ${d.leads} leads`}</title></rect>
              <rect x={x + 1} y={y(d.won)} width={bw} height={Math.max(0, y(0) - y(d.won))} rx={Math.min(3, bw / 2)} fill="#059669"><title>{`Week of ${label(d.week)}: ${d.won} bookings · ${formatCompact(d.revenue)}`}</title></rect>
              {i % every === 0 && <text x={x} y={H - 7} textAnchor="middle" fontSize="10" fill="#5f6b7a">{label(d.week)}</text>}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-4 text-xs text-ink-600">
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-[#91b3fc]" />Leads</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-emerald-600" />Bookings</span>
      </div>
    </div>
  );
}

/* ───────────────────────── best hour + automation ───────────────────────── */

function BestHourCard({ r, onNewCampaign }: { r: MarketingFunnel; onNewCampaign?: () => void }) {
  const h = r.bestSendHour;
  return (
    <Card>
      <CardTitle icon={<Clock className="size-[18px]" />} title="Best time to send" subtitle={h.sample ? `Based on when ${plural(h.sample, "customer message")} came in` : "We'll learn this from customer replies"} />
      <div className="flex items-center gap-4">
        <IconChip tone="violet" size="lg"><Clock /></IconChip>
        <div className="min-w-0 flex-1">
          <div className="text-2xl font-semibold tracking-tight text-ink-900">{h.sample ? `Around ${hourText(h.hour)}` : "—"}</div>
          <p className="text-[13px] text-ink-500">{h.sample ? "Customers are most likely to read and reply then. “Send at best time” schedules for this hour." : "Until then campaigns go out at the default hour."}</p>
        </div>
      </div>
      {onNewCampaign && <Button className="mt-4" size="sm" variant="soft" icon={<Plus className="size-3.5" />} onClick={onNewCampaign}>Plan a campaign</Button>}
    </Card>
  );
}

function AutomationCard({ r }: { r: MarketingFunnel }) {
  const a = r.automation;
  return (
    <Card>
      <CardTitle icon={<Workflow className="size-[18px]" />} title="Automations" subtitle="Follow-ups and reminders running on their own"
        action={<ButtonLink to="/app/automations" size="sm" variant="ghost" icon={<ArrowRight className="size-3.5" />}>Open</ButtonLink>} />
      <div className="grid grid-cols-3 gap-3">
        <MiniStat label="Active" value={`${a.active}/${a.total}`} />
        <MiniStat label="Runs · 30d" value={a.runs30d.toLocaleString("en-IN")} />
        <MiniStat label="Messages · 30d" value={a.messages30d.toLocaleString("en-IN")} />
      </div>
      {a.failed30d > 0 ? (
        <Link to="/app/automations" className="mt-3 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2 text-[13px] font-medium text-rose-800 hover:bg-rose-100"><XCircle className="size-4" />{plural(a.failed30d, "run")} failed in the last 30 days — review</Link>
      ) : a.total === 0 ? (
        <Link to="/app/automations" className="mt-3 flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-[13px] font-medium text-brand-800 hover:bg-brand-100"><Sparkles className="size-4" />Install a ready-made recipe in two clicks</Link>
      ) : <p className="mt-3 text-[13px] text-emerald-700">All runs succeeded in the last 30 days.</p>}
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: ReactNode }) {
  return <div className="rounded-lg bg-slate-50 px-3 py-2"><div className="text-[11px] text-ink-500">{label}</div><div className="text-lg font-semibold tabular-nums text-ink-900">{value}</div></div>;
}

/* ───────────────────────── ad spend ───────────────────────── */

function SpendNudge({ r, spend, onOpen }: { r: MarketingFunnel; spend: ChannelSpend[]; onOpen?: () => void }) {
  const month = monthKey();
  const recorded = new Set(spend.filter((s) => s.month === month).map((s) => s.source));
  const active = new Set(r.channels.filter((c) => c.leads > 0).map((c) => c.source));
  const missing = PAID.filter((s) => active.has(s) && !recorded.has(s));
  const total = spend.filter((s) => s.month === month).reduce((a, s) => a + s.amount, 0);
  if (missing.length === 0 && total === 0 && !onOpen) return null;
  return (
    <div className={cx("flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center", missing.length ? "border-amber-200 bg-amber-50/60" : "border-line bg-white shadow-card")}>
      <IconChip tone={missing.length ? "amber" : "green"}><IndianRupee /></IconChip>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink-900">{missing.length ? `No ${monthLong(month).split(" ")[0]} spend recorded for ${missing.map((s) => SOURCE_LABEL[s]).join(", ")}` : `${money(total)} ad spend recorded for ${monthLong(month)}`}</div>
        <p className="text-[13px] text-ink-600">{missing.length ? "Cost per lead and ROI for these channels stay blank until you add what you paid." : "Cost per lead and ROI are calculated from these amounts."}</p>
      </div>
      {onOpen && <Button size="sm" variant={missing.length ? "primary" : "secondary"} onClick={onOpen}>{missing.length ? "Record spend" : "Edit spend"}</Button>}
    </div>
  );
}

interface Draft { amount: number | null; note: string }

/** Record what you paid each channel per month. Saving creates, updates or removes channelSpend rows. */
export function AdSpendModal({ open, onClose, rows, loading }: { open: boolean; onClose: () => void; rows: ChannelSpend[] | undefined; loading: boolean }) {
  const [month, setMonth] = useState(monthKey());
  const [drafts, setDrafts] = useState<Partial<Record<LeadSource, Draft>>>({});
  const [showAll, setShowAll] = useState(false);
  const [del, setDel] = useState<ChannelSpend | null>(null);
  const m = useMutation();
  const thisMonth = monthKey();
  const forMonth = useMemo(() => (rows ?? []).filter((r) => r.month === month), [rows, month]);
  const bySource = useMemo(() => {
    const map = new Map<LeadSource, ChannelSpend[]>();
    for (const r of forMonth) map.set(r.source, [...(map.get(r.source) ?? []), r]);
    return map;
  }, [forMonth]);
  const sources = useMemo(() => {
    const extra = LEAD_SOURCES.filter((s) => !PAID.includes(s));
    return showAll ? [...PAID, ...extra] : [...PAID, ...extra.filter((s) => bySource.has(s))];
  }, [showAll, bySource]);

  const valueOf = (s: LeadSource): Draft => drafts[s] ?? { amount: bySource.get(s)?.[0]?.amount ?? null, note: bySource.get(s)?.[0]?.note ?? "" };
  const dirty = (Object.keys(drafts) as LeadSource[]).filter((s) => {
    const d = drafts[s]!; const cur = bySource.get(s)?.[0];
    return cur ? d.amount !== cur.amount || d.note !== cur.note : (d.amount ?? 0) > 0;
  });
  const total = sources.reduce((a, s) => a + (valueOf(s).amount ?? 0) + (bySource.get(s)?.slice(1).reduce((x, r) => x + r.amount, 0) ?? 0), 0);
  const goMonth = (k: string) => { setMonth(k); setDrafts({}); };
  const close = () => { setDrafts({}); setMonth(thisMonth); onClose(); };

  const save = async () => {
    const ok = await m.run(async () => {
      for (const s of dirty) {
        const d = drafts[s]!; const cur = bySource.get(s)?.[0];
        if (cur && (d.amount === null || d.amount === 0)) await api.remove("channelSpend", cur.id);
        else if (cur) await api.update("channelSpend", cur.id, { amount: d.amount ?? 0, note: d.note });
        else if ((d.amount ?? 0) > 0) await api.create("channelSpend", { month, source: s, amount: d.amount ?? 0, note: d.note });
      }
      return true;
    }, `Spend saved for ${monthLong(month)}`);
    if (ok) setDrafts({});
  };

  return (
    <>
      <Modal open={open} onClose={close} size="lg" title="Ad & channel spend" description="Add what you paid each channel per month. We use it for cost per lead, cost per booking and ROI."
        footer={<>
          <span className="mr-auto self-center text-[13px] text-ink-600">Total {monthLong(month)}: <b className="tabular-nums text-ink-900">{money(total)}</b></span>
          <Button variant="secondary" onClick={close}>Close</Button>
          <Button busy={m.busy} disabled={dirty.length === 0} onClick={() => void save()}>{dirty.length ? `Save ${plural(dirty.length, "change")}` : "Saved"}</Button>
        </>}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" aria-label="Previous month" onClick={() => goMonth(shiftMonth(month, -1))}><ChevronLeft className="size-4" /></Button>
          <Input type="month" aria-label="Month" value={month} max={thisMonth} onChange={(e) => e.target.value && goMonth(e.target.value)} className="w-auto min-w-[160px]" />
          <Button size="sm" variant="secondary" aria-label="Next month" disabled={month >= thisMonth} onClick={() => goMonth(shiftMonth(month, 1))}><ChevronRight className="size-4" /></Button>
          {month !== thisMonth && <Button size="sm" variant="ghost" onClick={() => goMonth(thisMonth)}>This month</Button>}
          {dirty.length > 0 && <Badge tone="amber" dot className="ml-auto">Unsaved changes</Badge>}
        </div>
        {loading ? <div className="space-y-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-xl" />)}</div> : (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {sources.map((s) => {
              const v = valueOf(s);
              const existing = bySource.get(s) ?? [];
              const extra = existing.slice(1).reduce((a, r) => a + r.amount, 0);
              const missing = PAID.includes(s) && existing.length === 0 && !(drafts[s]?.amount);
              return (
                <li key={s} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[150px_150px_minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink-900">{SOURCE_LABEL[s]}</div>
                    <div className="text-[11px] text-ink-500">{existing.length ? (extra ? `+ ${money(extra)} in other entries` : "Recorded") : missing ? <span className="text-amber-700">Not recorded</span> : "Optional"}</div>
                  </div>
                  <div className="sm:order-none">
                    <MoneyInput aria-label={`${SOURCE_LABEL[s]} spend for ${monthLong(month)}`} value={v.amount} onChange={(amount) => setDrafts((d) => ({ ...d, [s]: { ...v, amount } }))} />
                  </div>
                  <Input aria-label={`${SOURCE_LABEL[s]} note`} placeholder="Note (e.g. Diwali boost)" value={v.note} maxLength={300} className="col-span-2 sm:col-span-1"
                    onChange={(e) => setDrafts((d) => ({ ...d, [s]: { ...v, note: e.target.value } }))} />
                  <div className="col-span-2 flex justify-end sm:col-span-1">
                    {existing[0] ? (
                      <button type="button" aria-label={`Delete ${SOURCE_LABEL[s]} spend`} title="Delete" onClick={() => setDel(existing[0]!)}
                        className="inline-flex size-8 items-center justify-center rounded-lg text-ink-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="size-4" /></button>
                    ) : <span className="hidden size-8 sm:block" />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button type="button" className="text-[13px] font-medium text-brand-700 hover:underline" onClick={() => setShowAll((x) => !x)}>{showAll ? "Show main channels only" : "Show all channels (referrals, walk-ins, IVR…)"}</button>
          <p className="text-xs text-ink-500">Tip: clear an amount and save to remove it.</p>
        </div>
      </Modal>
      <Confirm open={del !== null} onClose={() => setDel(null)} danger busy={m.busy} title="Delete this spend entry?" confirmLabel="Delete"
        message={del && <>{money(del.amount)} for <b>{SOURCE_LABEL[del.source]}</b> in {monthLong(del.month)} will be removed. Cost per lead and ROI will update.</>}
        onConfirm={async () => {
          if (!del) return;
          const ok = await m.run(() => api.remove("channelSpend", del.id).then(() => true), "Spend entry deleted");
          if (ok) { setDrafts((d) => { const n = { ...d }; delete n[del.source]; return n; }); setDel(null); }
        }} />
    </>
  );
}
