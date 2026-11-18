import { useState } from "react";
import { formatMonth } from "@voyadesk/core";
import { useReport } from "../../lib/hooks";
import { formatCompact, money, SOURCE_LABEL, titleCase } from "../../lib/format";
import { Card, CardTitle, ErrorNote, Loading, PageHeader, Select, Stat } from "../../components/ui";
import { MonthBars, RankBars } from "../../components/charts";
import { type DashboardData } from "./Dashboard";

interface PnlData { rows: { key: string; label: string; bookings: number; sell: number; cost: number; margin: number; marginPct: number }[]; totals: { bookings: number; sell: number; cost: number; margin: number } }
interface VisaData { byCountry: { country: string; total: number; approved: number; rejected: number; open: number; revenue: number }[]; total: number }

export function ReportsPage() {
  const [groupBy, setGroupBy] = useState("destination");
  const pnl = useReport<PnlData>("pnl", { groupBy });
  const dash = useReport<DashboardData>("dashboard");
  const visa = useReport<VisaData>("visa");
  if (pnl.error && !pnl.data) return <ErrorNote message={pnl.error.message} />;
  return (
    <div className="space-y-5">
      <PageHeader title="Reports" subtitle="Profit, growth and team performance from the same records your team works on." />
      {pnl.data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Bookings" value={pnl.data.totals.bookings} />
          <Stat label="Sales (ex-tax)" value={formatCompact(pnl.data.totals.sell)} />
          <Stat label="Supplier cost" value={formatCompact(pnl.data.totals.cost)} />
          <Stat label="Gross margin" value={formatCompact(pnl.data.totals.margin)} tone="good" hint={pnl.data.totals.sell ? `${((pnl.data.totals.margin / pnl.data.totals.sell) * 100).toFixed(1)}% of sales` : undefined} />
        </div>
      )}
      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 p-4 sm:p-5">
          <CardTitle title="Profit & loss" subtitle="Non-cancelled bookings, by travel date" />
          <Select aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value)} className="w-48"><option value="destination">By destination</option><option value="owner">By sales person</option><option value="agent">By agent / direct</option><option value="month">By month</option><option value="booking">By booking file</option></Select>
        </div>
        {!pnl.data ? <Loading /> : (
          <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-ink-500"><tr><th className="px-5 py-2">{titleCase(groupBy)}</th><th className="px-3 text-right">Files</th><th className="px-3 text-right">Sales</th><th className="px-3 text-right">Cost</th><th className="px-3 text-right">Margin</th><th className="px-5 text-right">Margin %</th></tr></thead>
            <tbody className="divide-y divide-line">{pnl.data.rows.map((r) => <tr key={r.key}><td className="px-5 py-2.5 font-medium">{groupBy === "month" ? formatMonth(r.label) : r.label}</td><td className="px-3 text-right">{r.bookings}</td><td className="px-3 text-right tabular-nums">{money(r.sell)}</td><td className="px-3 text-right tabular-nums">{money(r.cost)}</td><td className="px-3 text-right tabular-nums text-emerald-700">{money(r.margin)}</td><td className="px-5 text-right">{r.marginPct}%</td></tr>)}</tbody></table></div>
        )}
      </Card>
      {dash.data && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card><CardTitle title="Revenue trend" /><MonthBars data={dash.data.revenueTrend} series={[{ key: "invoiced", label: "Invoiced", color: "#1d5fd1" }, { key: "collected", label: "Collected", color: "#10b981" }]} /></Card>
          <Card><CardTitle title="Lead sources (30 days)" /><RankBars items={dash.data.sources.map((s) => ({ label: SOURCE_LABEL[s.source] ?? s.source, value: s.count }))} /></Card>
          <Card><CardTitle title="Revenue by sales person" /><RankBars color="#7c3aed" format={formatCompact} items={dash.data.staff.map((s) => ({ label: s.name, value: s.revenue }))} /></Card>
          {visa.data && <Card><CardTitle title="Visa by country" /><RankBars color="#0891b2" items={visa.data.byCountry.map((c) => ({ label: `${c.country} (${c.approved} approved, ${c.open} open)`, value: c.total }))} /></Card>}
        </div>
      )}
    </div>
  );
}
