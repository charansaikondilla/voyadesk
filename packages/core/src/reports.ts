import { z } from "zod";
import { addDays, daysBetween, lastMonths, monthKey, type ISODate } from "./dates.js";
import { accountBalance, statement, trialBalance, type AccountCode, type LedgerEntry } from "./ledger.js";
import { type Minor } from "./money.js";
import { agentPosition } from "./actions.js";
import { aging, DomainError, LEAD_STAGES } from "./rules.js";
import { getSettings, mustGet, todayOf, type Ctx, type Store } from "./store.js";
import { type Role } from "./entities.js";

const outstanding = (i: { total: Minor; paid: Minor; credited: Minor }) => Math.max(0, i.total - i.paid - i.credited);
const inMonth = (d: string, key: string) => d.slice(0, 7) === key;

async function dashboard(s: Store, ctx: Ctx) {
  const settings = await getSettings(s, ctx.now);
  const today = todayOf(ctx, settings);
  const month = monthKey(today);
  const [leads, quotes, bookings, invoices, payments, bills, tasks, acts, visas, users, services] = await Promise.all([
    s.list("leads"), s.list("quotes"), s.list("bookings"), s.list("invoices"), s.list("payments"), s.list("supplierBills"),
    s.list("tasks"), s.list("activities"), s.list("visaCases"), s.list("users"), s.list("services"),
  ]);
  const open = leads.filter((l) => !["won", "lost"].includes(l.stage));
  const closed90 = leads.filter((l) => ["won", "lost"].includes(l.stage) && daysBetween(l.updatedAt.slice(0, 10), today) <= 90);
  const won90 = closed90.filter((l) => l.stage === "won").length;

  // First human response time per lead (minutes), last 30 days
  const responseMins: number[] = [];
  for (const l of leads.filter((x) => daysBetween(x.createdAt.slice(0, 10), today) <= 30)) {
    const first = acts.filter((a) => a.leadId === l.id && a.kind !== "system" && a.kind !== "quote_view").sort((a, b) => (a.at < b.at ? -1 : 1))[0];
    if (first) responseMins.push(Math.max(0, (Date.parse(first.at) - Date.parse(l.createdAt)) / 60_000));
  }
  const avgResponseMins = responseMins.length ? Math.round(responseMins.reduce((a, b) => a + b, 0) / responseMins.length) : null;

  const months = lastMonths(today, 6);
  const revenueTrend = months.map((m) => ({
    month: m,
    invoiced: invoices.filter((i) => inMonth(i.issueDate, m) && i.status !== "cancelled").reduce((a, i) => a + i.sell, 0),
    collected: payments.filter((p) => inMonth(p.date, m) && p.direction === "in" && p.purpose === "invoice").reduce((a, p) => a + p.amount, 0),
  }));

  const sourceCounts = new Map<string, number>();
  for (const l of leads.filter((x) => daysBetween(x.createdAt.slice(0, 10), today) <= 30)) sourceCounts.set(l.source, (sourceCounts.get(l.source) ?? 0) + 1);
  const destCounts = new Map<string, number>();
  for (const l of leads) if (l.destination) destCounts.set(l.destination, (destCounts.get(l.destination) ?? 0) + 1);

  const activeBookings = bookings.filter((b) => b.status !== "cancelled");
  const arrivals = activeBookings.filter((b) => b.startDate >= today && b.startDate <= addDays(today, 7)).sort((a, b) => (a.startDate < b.startDate ? -1 : 1));
  const departures = activeBookings.filter((b) => b.endDate >= today && b.endDate <= addDays(today, 7)).sort((a, b) => (a.endDate < b.endDate ? -1 : 1));
  const onTrip = activeBookings.filter((b) => b.startDate <= today && b.endDate >= today);
  const pendingServices = services.filter((sv) => sv.status === "pending" || sv.status === "requested");

  const openInvoices = invoices.filter((i) => i.status !== "cancelled" && outstanding(i) > 0);
  const myTasks = tasks.filter((t) => !t.done && (["owner", "admin"].includes(ctx.role) || t.assigneeId === ctx.userId)).sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1));

  const staff = users.filter((u) => ["sales", "owner", "admin"].includes(u.role)).map((u) => {
    const mine = leads.filter((l) => l.ownerId === u.id);
    const myBookings = bookings.filter((b) => b.ownerId === u.id && b.status !== "cancelled");
    return { userId: u.id, name: u.name, leads: mine.length, open: mine.filter((l) => !["won", "lost"].includes(l.stage)).length, won: mine.filter((l) => l.stage === "won").length, revenue: myBookings.reduce((a, b) => a + b.sellTotal, 0) };
  }).sort((a, b) => b.revenue - a.revenue);

  return {
    today,
    kpis: {
      newLeadsToday: leads.filter((l) => l.createdAt.slice(0, 10) === today).length,
      openLeads: open.length,
      hotLeads: open.filter((l) => l.temperature === "hot").length,
      agingLeads: open.filter((l) => l.lastActivityAt && daysBetween(l.lastActivityAt.slice(0, 10), today) > 3).length,
      quotesSentMonth: quotes.filter((q) => q.status !== "draft" && inMonth(q.updatedAt.slice(0, 10), month)).length,
      proposalViews: quotes.reduce((a, q) => a + q.views, 0),
      conversionRate: closed90.length ? Math.round((won90 / closed90.length) * 100) : null,
      bookingsMonth: bookings.filter((b) => inMonth(b.createdAt.slice(0, 10), month) && b.status !== "cancelled").length,
      revenueMonth: revenueTrend.at(-1)?.invoiced ?? 0,
      collectedMonth: revenueTrend.at(-1)?.collected ?? 0,
      receivables: openInvoices.reduce((a, i) => a + outstanding(i), 0),
      overdueReceivables: openInvoices.filter((i) => i.dueDate < today).reduce((a, i) => a + outstanding(i), 0),
      payablesDue: bills.filter((b) => b.status !== "paid").reduce((a, b) => a + b.amount - b.paid, 0),
      avgResponseMins,
      onTrip: onTrip.length,
      pendingServices: pendingServices.length,
      openVisaCases: visas.filter((v) => !["approved", "rejected", "delivered"].includes(v.status)).length,
    },
    pipeline: LEAD_STAGES.map((stage) => ({ stage, count: leads.filter((l) => l.stage === stage).length, value: leads.filter((l) => l.stage === stage).reduce((a, l) => a + (l.budget ?? 0), 0) })),
    sources: [...sourceCounts.entries()].map(([source, count]) => ({ source, count })).sort((a, b) => b.count - a.count),
    destinations: [...destCounts.entries()].map(([destination, count]) => ({ destination, count })).sort((a, b) => b.count - a.count).slice(0, 6),
    revenueTrend,
    arrivals: arrivals.slice(0, 8).map((b) => ({ id: b.id, number: b.number, contactName: b.contactName, destination: b.destination, date: b.startDate, pax: b.pax.adults + b.pax.children })),
    departures: departures.slice(0, 8).map((b) => ({ id: b.id, number: b.number, contactName: b.contactName, destination: b.destination, date: b.endDate, pax: b.pax.adults + b.pax.children })),
    tasks: myTasks.slice(0, 8),
    overdueTasks: myTasks.filter((t) => t.dueAt < ctx.now.toISOString()).length,
    activity: [...acts].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 10),
    visaByStatus: ["docs_pending", "docs_received", "submitted", "in_process", "approved", "rejected"].map((st) => ({ status: st, count: visas.filter((v) => v.status === st).length })),
    staff,
  };
}

async function pnl(s: Store, ctx: Ctx, p: { groupBy: "booking" | "destination" | "owner" | "agent" | "month"; from?: ISODate | null; to?: ISODate | null }) {
  const [bookings, users, agents] = await Promise.all([s.list("bookings"), s.list("users"), s.list("agents")]);
  const rows = bookings.filter((b) => b.status !== "cancelled" && (!p.from || b.startDate >= p.from) && (!p.to || b.startDate <= p.to));
  const groups = new Map<string, { key: string; label: string; bookings: number; sell: Minor; cost: Minor }>();
  for (const b of rows) {
    let key: string;
    let lbl: string;
    switch (p.groupBy) {
      case "destination": key = b.destination || "—"; lbl = key; break;
      case "owner": key = b.ownerId ?? "none"; lbl = users.find((u) => u.id === b.ownerId)?.name ?? "Unassigned"; break;
      case "agent": key = b.agentId ?? "direct"; lbl = agents.find((a) => a.id === b.agentId)?.name ?? "Direct (B2C)"; break;
      case "month": key = monthKey(b.startDate); lbl = key; break;
      default: key = b.id; lbl = `${b.number} · ${b.contactName}`;
    }
    const g = groups.get(key) ?? { key, label: lbl, bookings: 0, sell: 0, cost: 0 };
    g.bookings += 1;
    g.sell += b.sellTotal;
    g.cost += b.costTotal;
    groups.set(key, g);
  }
  const out = [...groups.values()].map((g) => ({ ...g, margin: g.sell - g.cost, marginPct: g.sell ? Math.round(((g.sell - g.cost) / g.sell) * 1000) / 10 : 0 })).sort((a, b) => b.margin - a.margin);
  const totals = out.reduce((t, g) => ({ bookings: t.bookings + g.bookings, sell: t.sell + g.sell, cost: t.cost + g.cost }), { bookings: 0, sell: 0, cost: 0 });
  void ctx;
  return { rows: out, totals: { ...totals, margin: totals.sell - totals.cost } };
}

async function agingReport(s: Store, ctx: Ctx) {
  const settings = await getSettings(s, ctx.now);
  const today = todayOf(ctx, settings);
  const [invoices, bills] = await Promise.all([s.list("invoices"), s.list("supplierBills")]);
  const open = invoices.filter((i) => i.status !== "cancelled" && outstanding(i) > 0);
  const byParty = new Map<string, { party: string; partyType: string; items: { dueDate: string; outstanding: Minor }[] }>();
  for (const i of open) {
    const k = `${i.partyType}:${i.partyId ?? i.partyName}`;
    const g = byParty.get(k) ?? { party: i.partyName, partyType: i.partyType, items: [] };
    g.items.push({ dueDate: i.dueDate, outstanding: outstanding(i) });
    byParty.set(k, g);
  }
  const openBills = bills.filter((b) => b.status !== "paid");
  const bySupplier = new Map<string, { party: string; items: { dueDate: string; outstanding: Minor }[] }>();
  for (const b of openBills) {
    const g = bySupplier.get(b.supplierId) ?? { party: b.supplierName, items: [] };
    g.items.push({ dueDate: b.dueDate, outstanding: b.amount - b.paid });
    bySupplier.set(b.supplierId, g);
  }
  return {
    asOf: today,
    receivables: aging(open.map((i) => ({ dueDate: i.dueDate, outstanding: outstanding(i) })), today),
    payables: aging(openBills.map((b) => ({ dueDate: b.dueDate, outstanding: b.amount - b.paid })), today),
    receivablesByParty: [...byParty.values()].map((g) => ({ party: g.party, partyType: g.partyType, ...aging(g.items, today) })).sort((a, b) => b.total - a.total),
    payablesByParty: [...bySupplier.values()].map((g) => ({ party: g.party, ...aging(g.items, today) })).sort((a, b) => b.total - a.total),
  };
}

async function gstReport(s: Store, ctx: Ctx, p: { months?: number }) {
  const settings = await getSettings(s, ctx.now);
  const today = todayOf(ctx, settings);
  const [invoices, cns] = await Promise.all([s.list("invoices"), s.list("creditNotes")]);
  const months = lastMonths(today, p.months ?? 6);
  const rows = months.map((m) => {
    const inv = invoices.filter((i) => inMonth(i.issueDate, m));
    const notes = cns.filter((c) => inMonth(c.date, m));
    return {
      month: m, invoices: inv.length, taxable: inv.reduce((a, i) => a + i.sell, 0), cgst: inv.reduce((a, i) => a + i.cgst, 0),
      sgst: inv.reduce((a, i) => a + i.sgst, 0), igst: inv.reduce((a, i) => a + i.igst, 0), gst: inv.reduce((a, i) => a + i.gst, 0),
      creditNotes: notes.reduce((a, c) => a + c.amount, 0),
    };
  });
  const tcsRows = months.map((m) => {
    const inv = invoices.filter((i) => inMonth(i.issueDate, m) && i.tcs > 0);
    return { month: m, invoices: inv.length, collectedOn: inv.reduce((a, i) => a + i.total - i.tcs, 0), tcs: inv.reduce((a, i) => a + i.tcs, 0) };
  });
  const tcsInvoices = invoices.filter((i) => i.tcs > 0).map((i) => ({ number: i.number, date: i.issueDate, party: i.partyName, pan: i.pan, amount: i.total - i.tcs, tcs: i.tcs }));
  return { gst: rows, tcs: tcsRows, tcsInvoices };
}

async function operations(s: Store, ctx: Ctx, p: { from?: ISODate | null; days?: number }) {
  const settings = await getSettings(s, ctx.now);
  const from = p.from ?? todayOf(ctx, settings);
  const to = addDays(from, (p.days ?? 7) - 1);
  const [bookings, services, assignments, resources, suppliers] = await Promise.all([s.list("bookings"), s.list("services"), s.list("assignments"), s.list("resources"), s.list("suppliers")]);
  const live = new Map(bookings.filter((b) => b.status !== "cancelled").map((b) => [b.id, b]));
  const items = services.filter((sv) => sv.status !== "cancelled" && live.has(sv.bookingId) && sv.date >= from && sv.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.type.localeCompare(b.type)))
    .map((sv) => {
      const b = live.get(sv.bookingId)!;
      const as = assignments.filter((a) => a.serviceId === sv.id).map((a) => resources.find((r) => r.id === a.resourceId)?.name ?? "—");
      return { ...sv, bookingNumber: b.number, contactName: b.contactName, pax: b.pax.adults + b.pax.children, supplierName: suppliers.find((x) => x.id === sv.supplierId)?.name ?? "", assigned: as };
    });
  return {
    from, to, items,
    arrivals: [...live.values()].filter((b) => b.startDate >= from && b.startDate <= to),
    departures: [...live.values()].filter((b) => b.endDate >= from && b.endDate <= to),
    unassignedTransfers: items.filter((i) => ["transfer", "sightseeing"].includes(i.type) && i.assigned.length === 0).length,
    unconfirmed: items.filter((i) => i.status !== "confirmed").length,
  };
}

async function visaReport(s: Store) {
  const cases = await s.list("visaCases");
  const countries = new Map<string, { country: string; total: number; approved: number; rejected: number; open: number; revenue: Minor }>();
  for (const c of cases) {
    const g = countries.get(c.country) ?? { country: c.country, total: 0, approved: 0, rejected: 0, open: 0, revenue: 0 };
    g.total += 1;
    if (c.status === "approved" || c.status === "delivered") g.approved += 1;
    else if (c.status === "rejected") g.rejected += 1;
    else g.open += 1;
    g.revenue += c.fee;
    countries.set(c.country, g);
  }
  return { byCountry: [...countries.values()].sort((a, b) => b.total - a.total), total: cases.length };
}

async function campaignReport(s: Store) {
  const [campaigns, leads] = await Promise.all([s.list("campaigns"), s.list("leads")]);
  return {
    rows: campaigns.map((c) => ({ id: c.id, name: c.name, channel: c.channel, status: c.status, sent: c.sentCount, cost: c.cost, leads: c.leadCount })),
    leadsBySource: Object.entries(leads.reduce<Record<string, number>>((acc, l) => ({ ...acc, [l.source]: (acc[l.source] ?? 0) + 1 }), {})).map(([source, count]) => ({ source, count })),
  };
}

async function partyStatement(s: Store, ctx: Ctx, p: { partyType: "agent" | "customer" | "supplier"; partyId: string }) {
  if (ctx.role === "agent" && (p.partyType !== "agent" || p.partyId !== ctx.agentId)) throw new DomainError("You can only see your own statement.", 403);
  const entries = (await s.list("ledger")) as unknown as LedgerEntry[];
  const party = { type: p.partyType, id: p.partyId };
  const account: AccountCode = p.partyType === "supplier" ? "payable" : "receivable";
  const out: Record<string, unknown> = {
    account, lines: statement(entries, account, party), balance: accountBalance(entries, account, party),
    wallet: { lines: statement(entries, "wallet", party), balance: accountBalance(entries, "wallet", party) },
  };
  if (p.partyType === "agent") {
    const agent = await mustGet(s, "agents", p.partyId);
    const settings = await getSettings(s, ctx.now);
    out["position"] = await agentPosition(s, agent, todayOf(ctx, settings));
    out["agent"] = { id: agent.id, name: agent.name, creditLimit: agent.creditLimit, creditDays: agent.creditDays, blocked: agent.blocked, slab: agent.slab };
  }
  return out;
}

async function books(s: Store) {
  const entries = (await s.list("ledger")) as unknown as LedgerEntry[];
  const accounts: AccountCode[] = ["bank", "receivable", "wallet", "payable", "revenue", "cost_of_sales", "gst_output", "tcs_payable"];
  return { trial: trialBalance(entries), accounts: accounts.map((a) => ({ account: a, balance: accountBalance(entries, a) })), entries: entries.length };
}

export type ReportFn = (s: Store, ctx: Ctx, params: never) => Promise<unknown>;

const REPORTS: Record<string, { params: z.ZodTypeAny; roles: Role[] | "staff"; run: ReportFn }> = {
  dashboard: { params: z.object({}).passthrough(), roles: "staff", run: dashboard as ReportFn },
  pnl: { params: z.object({ groupBy: z.enum(["booking", "destination", "owner", "agent", "month"]).default("destination"), from: z.string().nullable().optional(), to: z.string().nullable().optional() }), roles: ["owner", "admin", "accounts"], run: pnl as ReportFn },
  aging: { params: z.object({}).passthrough(), roles: ["owner", "admin", "accounts"], run: agingReport as ReportFn },
  gst: { params: z.object({ months: z.number().int().min(1).max(24).optional() }), roles: ["owner", "admin", "accounts"], run: gstReport as ReportFn },
  operations: { params: z.object({ from: z.string().nullable().optional(), days: z.number().int().min(1).max(60).optional() }), roles: ["owner", "admin", "ops", "sales"], run: operations as ReportFn },
  visa: { params: z.object({}).passthrough(), roles: ["owner", "admin", "visa"], run: visaReport as ReportFn },
  campaigns: { params: z.object({}).passthrough(), roles: ["owner", "admin", "marketing"], run: campaignReport as ReportFn },
  statement: { params: z.object({ partyType: z.enum(["agent", "customer", "supplier"]), partyId: z.string().min(1) }), roles: ["owner", "admin", "accounts", "agent"], run: partyStatement as ReportFn },
  books: { params: z.object({}).passthrough(), roles: ["owner", "admin", "accounts"], run: books as ReportFn },
};

export const REPORT_NAMES = Object.keys(REPORTS);

/** Feature packs add reports here at import time. */
export function registerReports(map: Record<string, { params: z.ZodTypeAny; roles: Role[] | "staff"; run: ReportFn }>): void {
  Object.assign(REPORTS, map);
}

export async function runReport(store: Store, ctx: Ctx, name: string, raw: unknown): Promise<unknown> {
  const r = REPORTS[name];
  if (!r) throw new DomainError(`Unknown report "${name}"`, 404);
  const allowed = r.roles === "staff" ? !["agent", "driver"].includes(ctx.role) : r.roles.includes(ctx.role);
  if (!allowed) throw new DomainError("You don't have permission to see this report.", 403);
  const parsed = r.params.safeParse(raw ?? {});
  if (!parsed.success) throw new DomainError("Invalid report parameters", 422);
  return r.run(store, ctx, parsed.data as never);
}
