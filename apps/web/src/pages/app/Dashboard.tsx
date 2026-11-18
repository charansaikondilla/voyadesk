import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle, ArrowRight, Banknote, Briefcase, CheckCircle2, Circle, Clock, CreditCard, Flame, HandCoins, Landmark, MapPin, PlaneLanding,
  PlaneTakeoff, Plus, Stamp, Target, Timer, TrendingUp, Users, Wallet,
} from "lucide-react";
import { canRead, formatDate, type Activity, type Role, type Task } from "@voyadesk/core";
import { api } from "../../lib/api";
import { useAction, useList, useReport } from "../../lib/hooks";
import { useSession } from "../../lib/session";
import { formatCompact, money, relTime, SOURCE_LABEL, titleCase } from "../../lib/format";
import { Avatar, Button, ButtonLink, Card, CardTitle, ErrorNote, Progress, Skeleton, Stat, StatusBadge, cx } from "../../components/ui";
import { Funnel, MonthBars, RankBars } from "../../components/charts";
import { AttentionPanel } from "../../components/plus";
import { CreatePaymentLinkModal, outstanding } from "../../components/paylinks";

export interface DashboardData {
  today: string;
  kpis: {
    newLeadsToday: number; openLeads: number; hotLeads: number; agingLeads: number; quotesSentMonth: number; proposalViews: number;
    conversionRate: number | null; bookingsMonth: number; revenueMonth: number; collectedMonth: number; receivables: number;
    overdueReceivables: number; payablesDue: number; avgResponseMins: number | null; onTrip: number; pendingServices: number; openVisaCases: number;
  };
  pipeline: { stage: string; count: number; value: number }[];
  sources: { source: string; count: number }[];
  destinations: { destination: string; count: number }[];
  revenueTrend: { month: string; invoiced: number; collected: number }[];
  arrivals: { id: string; number: string; contactName: string; destination: string; date: string; pax: number }[];
  departures: { id: string; number: string; contactName: string; destination: string; date: string; pax: number }[];
  tasks: Task[];
  overdueTasks: number;
  activity: Activity[];
  visaByStatus: { status: string; count: number }[];
  staff: { userId: string; name: string; leads: number; open: number; won: number; revenue: number }[];
}

const STAGE_COLORS: Record<string, string> = { new: "#3a6cf2", contacted: "#0891b2", quoted: "#7c3aed", negotiation: "#d97706", won: "#059669", lost: "#94a3b8" };

export function TaskList({ tasks }: { tasks: Task[] }) {
  const { act } = useAction();
  if (tasks.length === 0) return (
    <div className="flex flex-col items-center py-6 text-center"><CheckCircle2 className="mb-2 size-7 text-emerald-500" /><p className="text-sm font-medium text-ink-800">You're all caught up</p><p className="text-xs text-ink-500">Nothing due. Nice.</p></div>
  );
  const now = new Date().toISOString();
  return (
    <ul className="-mx-1.5 space-y-0.5">
      {tasks.map((t) => {
        const late = !t.done && t.dueAt < now;
        return (
          <li key={t.id} className="group flex items-start gap-3 rounded-lg px-1.5 py-2 hover:bg-slate-50">
            <button aria-label={t.done ? "Mark not done" : "Mark done"} onClick={() => act("completeTask", { taskId: t.id, done: !t.done }, t.done ? "Task reopened" : "Task done")} className="mt-0.5 text-ink-300 transition-colors hover:text-emerald-600">
              {t.done ? <CheckCircle2 className="size-5 text-emerald-600" /> : <Circle className="size-5" />}
            </button>
            <div className="min-w-0 flex-1">
              <div className={cx("text-sm leading-5", t.done ? "text-ink-400 line-through" : "text-ink-900")}>
                {t.leadId ? <Link to={`/app/leads/${t.leadId}`} className="hover:text-brand-700">{t.title}</Link> : t.bookingId ? <Link to={`/app/bookings/${t.bookingId}`} className="hover:text-brand-700">{t.title}</Link> : t.visaCaseId ? <Link to={`/app/visa/${t.visaCaseId}`} className="hover:text-brand-700">{t.title}</Link> : t.title}
              </div>
              <div className={cx("mt-0.5 flex items-center gap-1 text-xs", late ? "font-medium text-rose-600" : "text-ink-500")}>
                <Clock className="size-3" />{late ? "Overdue · " : ""}{relTime(t.dueAt)}
                {t.priority === "high" && <span className="ml-1 rounded bg-rose-50 px-1 text-[10px] font-semibold uppercase text-rose-700">High</span>}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function ActivityFeed({ items }: { items: Activity[] }) {
  if (items.length === 0) return <p className="py-4 text-center text-sm text-ink-500">No activity yet.</p>;
  return (
    <ol className="relative space-y-4 before:absolute before:bottom-1 before:left-[5px] before:top-1 before:w-px before:bg-line">
      {items.map((a) => (
        <li key={a.id} className="relative flex gap-3 pl-0 text-sm">
          <span className={cx("relative z-[1] mt-1.5 size-[11px] shrink-0 rounded-full ring-[3px] ring-white", a.kind === "payment" ? "bg-emerald-500" : a.kind === "quote_view" ? "bg-violet-500" : a.kind === "system" ? "bg-slate-300" : "bg-brand-500")} />
          <div className="min-w-0">
            <div className="leading-5 text-ink-800">
              {a.leadId ? <Link to={`/app/leads/${a.leadId}`} className="hover:text-brand-700">{a.body}</Link> : a.bookingId ? <Link to={`/app/bookings/${a.bookingId}`} className="hover:text-brand-700">{a.body}</Link> : a.visaCaseId ? <Link to={`/app/visa/${a.visaCaseId}`} className="hover:text-brand-700">{a.body}</Link> : a.body}
            </div>
            <div className="mt-0.5 text-xs text-ink-500">{titleCase(a.kind)} · {relTime(a.at)}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Oldest money owed first, with a one-click payment link — the fastest way from "we're owed" to "we're paid". */
function MoneyToCollect() {
  const invoices = useList("invoices");
  const [preset, setPreset] = useState<{ kind: "invoice"; id: string } | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const due = (invoices.data ?? []).filter((i) => outstanding(i) > 0 && i.status !== "cancelled").sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const total = due.reduce((a, i) => a + outstanding(i), 0);
  return (
    <Card>
      <CardTitle title="Money to collect" subtitle={invoices.data ? `${due.length} invoice${due.length === 1 ? "" : "s"} · ${money(total)} outstanding` : "Loading…"}
        action={<Link to="/app/finance/links" className="text-[13px] font-medium text-brand-700 hover:underline">Payment links</Link>} />
      {!invoices.data ? <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div> : due.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><CheckCircle2 className="size-5 text-emerald-600" />Every invoice is paid. Great collections!</div>
      ) : (
        <ul className="-mx-1.5 space-y-0.5">
          {due.slice(0, 5).map((i) => {
            const late = i.dueDate < today;
            const pct = i.total ? ((i.paid + i.credited) / i.total) * 100 : 0;
            return (
              <li key={i.id} className="flex items-center gap-3 rounded-lg px-1.5 py-2 hover:bg-slate-50">
                <Avatar name={i.partyName} />
                <Link to={`/app/finance/invoices/${i.id}`} className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2"><span className="truncate text-sm font-medium text-ink-900">{i.partyName}</span><span className="shrink-0 text-sm font-semibold tabular-nums">{money(outstanding(i))}</span></span>
                  <span className="mt-1 flex items-center gap-2"><Progress value={pct} tone="green" className="flex-1" label="Paid" /><span className={cx("shrink-0 text-[11px]", late ? "font-medium text-rose-600" : "text-ink-500")}>{late ? "overdue" : "due"} {formatDate(i.dueDate)}</span></span>
                </Link>
                <Button size="sm" variant="soft" onClick={() => setPreset({ kind: "invoice", id: i.id })} aria-label={`Collect from ${i.partyName}`}><CreditCard className="size-3.5" /><span className="hidden sm:inline">Collect</span></Button>
              </li>
            );
          })}
        </ul>
      )}
      <CreatePaymentLinkModal open={preset !== null} onClose={() => setPreset(null)} preset={preset} />
    </Card>
  );
}

function TripList({ rows, kind }: { rows: DashboardData["arrivals"]; kind: "arr" | "dep" }) {
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-ink-500">None in the next 7 days.</p>;
  return (
    <ul className="-mx-1.5 space-y-0.5">
      {rows.map((b) => {
        const d = new Date(b.date + "T00:00:00");
        return (
          <li key={b.id}>
            <Link to={`/app/bookings/${b.id}`} className="flex items-center gap-3 rounded-lg px-1.5 py-2 hover:bg-slate-50">
              <span className={cx("flex w-11 shrink-0 flex-col items-center rounded-lg py-1 leading-none", kind === "arr" ? "bg-cyan-50 text-cyan-800" : "bg-violet-50 text-violet-800")}>
                <span className="text-[10px] font-semibold uppercase">{d.toLocaleDateString("en-IN", { month: "short" })}</span>
                <span className="text-base font-semibold tabular-nums">{d.getDate()}</span>
              </span>
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink-900">{b.contactName}</span><span className="flex items-center gap-1 truncate text-xs text-ink-500"><MapPin className="size-3" />{b.destination} · {b.pax} pax · {b.number}</span></span>
              <ArrowRight className="size-4 text-ink-300" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-hidden>
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-28 rounded-xl" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[108px] rounded-xl" />)}</div>
      <div className="grid gap-5 lg:grid-cols-3"><Skeleton className="h-72 rounded-xl lg:col-span-2" /><Skeleton className="h-72 rounded-xl" /></div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function DashboardPage() {
  const { user, settings, moduleOn } = useSession();
  const q = useReport<DashboardData>("dashboard");
  if (q.error && !q.data) return <ErrorNote message={q.error.message} onRetry={q.reload} />;
  if (!q.data || !user) return <DashboardSkeleton />;
  const d = q.data;
  const k = d.kpis;
  const role = user.role as Role;
  const isBoss = role === "owner" || role === "admin";
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const showSales = isBoss || role === "sales" || role === "marketing";
  const showMoney = isBoss || role === "accounts";
  const showOps = isBoss || role === "ops";
  const showVisa = (isBoss || role === "visa") && moduleOn("visa");
  const canCollect = moduleOn("finance") && canRead(role, "invoices") && canRead(role, "paymentLinks");
  const collectRate = k.revenueMonth ? Math.round((k.collectedMonth / k.revenueMonth) * 100) : null;

  return (
    <div className="space-y-6">
      {/* greeting */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[13px] font-medium text-ink-500">{formatDate(d.today)} · {settings?.companyName ?? ""}</p>
          <h1 className="mt-0.5 text-[24px] font-semibold tracking-[-0.02em] text-ink-900 sm:text-[28px]">{greet}, {user.name.split(" ")[0]}</h1>
          <p className="mt-1 text-sm text-ink-500">
            {d.overdueTasks > 0 ? <><Link to="/app/tasks" className="font-medium text-rose-600 hover:underline">{d.overdueTasks} overdue task{d.overdueTasks > 1 ? "s" : ""}</Link> · </> : null}
            {showSales && k.hotLeads > 0 ? <>{k.hotLeads} hot lead{k.hotLeads > 1 ? "s" : ""} to call · </> : null}
            {showOps && k.onTrip > 0 ? <>{k.onTrip} traveller group{k.onTrip > 1 ? "s" : ""} on trip now · </> : null}
            Here's your day.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canRead(role, "leads") && <ButtonLink to="/app/leads?new=1" variant="secondary" icon={<Plus className="size-4" />}>New lead</ButtonLink>}
          {canCollect && <ButtonLink to="/app/finance/links?new=1" icon={<CreditCard className="size-4" />}>Payment link</ButtonLink>}
        </div>
      </div>

      <AttentionPanel />


      {/* KPI rows, grouped by job */}
      {showSales && (
        <section aria-label="Sales">
          <SectionLabel icon={<Target className="size-3.5" />}>Sales</SectionLabel>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="New leads today" value={k.newLeadsToday} icon={<Users />} hint={`${k.openLeads} open in pipeline`} to="/app/leads" />
            <Stat label="Hot leads" value={k.hotLeads} tone={k.hotLeads ? "bad" : "default"} icon={<Flame />} hint={`${k.agingLeads} untouched for 3+ days`} to="/app/leads" />
            <Stat label="Conversion (90 days)" value={k.conversionRate === null ? "—" : `${k.conversionRate}%`} icon={<TrendingUp />} hint={`${k.quotesSentMonth} quotes sent this month`} to="/app/quotes" />
            <Stat label="First response" value={k.avgResponseMins === null ? "—" : `${k.avgResponseMins} min`} icon={<Timer />} tone={k.avgResponseMins !== null && k.avgResponseMins > 30 ? "warn" : "default"} hint={`${k.proposalViews} proposal views`} />
          </div>
        </section>
      )}
      {showMoney && (
        <section aria-label="Money">
          <SectionLabel icon={<Landmark className="size-3.5" />}>Money</SectionLabel>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Revenue this month" value={formatCompact(k.revenueMonth)} tone="good" icon={<Banknote />} hint={`${k.bookingsMonth} bookings`} to="/app/finance/invoices" />
            <Stat label="Collected this month" value={formatCompact(k.collectedMonth)} icon={<HandCoins />} hint={collectRate === null ? undefined : `${collectRate}% of this month's billing`} to="/app/finance/payments" />
            <Stat label="Receivables" value={formatCompact(k.receivables)} tone={k.overdueReceivables ? "warn" : "default"} icon={<Wallet />} hint={`${formatCompact(k.overdueReceivables)} overdue`} to="/app/finance/links" />
            <Stat label="Supplier payables" value={formatCompact(k.payablesDue)} icon={<Landmark />} to="/app/finance/payables" />
          </div>
        </section>
      )}
      {(showOps || showVisa) && (
        <section aria-label="Operations">
          <SectionLabel icon={<Briefcase className="size-3.5" />}>Operations</SectionLabel>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {showOps && <>
              <Stat label="Travelling now" value={k.onTrip} icon={<PlaneTakeoff />} to="/app/bookings" />
              <Stat label="Arrivals next 7 days" value={d.arrivals.length} icon={<PlaneLanding />} to="/app/operations" />
              <Stat label="Services to confirm" value={k.pendingServices} tone={k.pendingServices ? "warn" : "good"} icon={<CheckCircle2 />} hint={k.pendingServices ? "Hotels, transfers & tickets awaiting confirmation" : "All confirmed"} to="/app/operations" />
            </>}
            {showVisa && <Stat label="Open visa cases" value={k.openVisaCases} icon={<Stamp />} to="/app/visa" />}
          </div>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="min-w-0 space-y-5 lg:col-span-2">
          {showMoney && (
            <Card><CardTitle title="Revenue vs collections" subtitle="Invoiced sell value and money received, last 6 months" />
              <MonthBars data={d.revenueTrend} series={[{ key: "invoiced", label: "Invoiced", color: "#1d5fd1" }, { key: "collected", label: "Collected", color: "#10b981" }]} />
            </Card>
          )}
          {canCollect && <MoneyToCollect />}
          {showSales && (
            <div className="grid gap-5 sm:grid-cols-2">
              <Card><CardTitle title="Pipeline" subtitle="Open leads by stage" action={<Link to="/app/leads" className="text-[13px] font-medium text-brand-700 hover:underline">Open board</Link>} />
                <Funnel stages={d.pipeline.map((p) => ({ label: titleCase(p.stage), count: p.count, tone: STAGE_COLORS[p.stage] ?? "#64748b" }))} />
              </Card>
              <Card><CardTitle title="Lead sources" subtitle="Last 30 days" />
                <RankBars items={d.sources.map((s) => ({ label: SOURCE_LABEL[s.source] ?? s.source, value: s.count }))} />
              </Card>
            </div>
          )}
          {showOps && (
            <div className="grid gap-5 sm:grid-cols-2">
              <Card><CardTitle icon={<PlaneLanding className="size-[18px]" />} title="Arrivals" subtitle="Next 7 days" /><TripList rows={d.arrivals} kind="arr" /></Card>
              <Card><CardTitle icon={<PlaneTakeoff className="size-[18px]" />} title="Departures" subtitle="Next 7 days" /><TripList rows={d.departures} kind="dep" /></Card>
            </div>
          )}
          {showVisa && (
            <Card><CardTitle title="Visa desk" action={<Link to="/app/visa" className="text-[13px] font-medium text-brand-700 hover:underline">Open board</Link>} />
              <div className="flex flex-wrap gap-2">{d.visaByStatus.map((v) => <Link to="/app/visa" key={v.status} className="inline-flex items-center gap-2 rounded-xl border border-line px-3 py-2 text-sm transition hover:border-line-strong hover:bg-slate-50"><StatusBadge status={v.status} /><span className="font-semibold tabular-nums">{v.count}</span></Link>)}</div>
            </Card>
          )}
          {isBoss && d.staff.length > 0 && (
            <Card padded={false}>
              <div className="p-4 pb-0 sm:p-5 sm:pb-0"><CardTitle title="Team performance" subtitle="Leads owned, won and revenue booked" /></div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-y border-line bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-500"><tr><th className="px-5 py-2">Name</th><th className="px-3 py-2 text-right">Leads</th><th className="px-3 py-2 text-right">Open</th><th className="px-3 py-2 text-right">Won</th><th className="px-5 py-2 text-right">Revenue</th></tr></thead>
                  <tbody className="divide-y divide-line/80">{[...d.staff].sort((a, b) => b.revenue - a.revenue).map((s, i) => (
                    <tr key={s.userId}>
                      <td className="px-5 py-2.5"><span className="flex items-center gap-2.5"><Avatar name={s.name} size={6} /><span className="font-medium">{s.name}</span>{i === 0 && s.revenue > 0 && <span className="rounded bg-amber-50 px-1.5 text-[10px] font-semibold uppercase text-amber-700">Top</span>}</span></td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{s.leads}</td><td className="px-3 py-2.5 text-right tabular-nums">{s.open}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{s.won}</td><td className="px-5 py-2.5 text-right font-medium tabular-nums">{formatCompact(s.revenue)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
        <div className="min-w-0 space-y-5">
          <Card><CardTitle title="My tasks" subtitle={d.tasks.length ? `${d.tasks.filter((t) => !t.done).length} to do` : undefined} action={<Link to="/app/tasks" className="text-[13px] font-medium text-brand-700 hover:underline">All</Link>} /><TaskList tasks={d.tasks} /></Card>
          <Card><CardTitle title="Recent activity" /><ActivityFeed items={d.activity} /></Card>
          {(isBoss || role === "sales") && d.destinations.length > 0 && (
            <Card><CardTitle title="Top destinations" /><RankBars color="#7c3aed" items={d.destinations.map((x) => ({ label: x.destination, value: x.count }))} /></Card>
          )}
        </div>
      </div>
      <p className="text-center text-xs text-ink-400">Data mode: {api.mode === "demo" ? "browser demo" : "live server"}</p>
    </div>
  );
}

function SectionLabel({ children, icon }: { children: string; icon: ReactNode }) {
  return <h2 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-400">{icon}{children}</h2>;
}
