/**
 * Data-driven insights computed from the agency's own history (no outside service needed):
 *  - learned lead scoring (win rates by source, destination, budget, lead time — naive Bayes with smoothing)
 *  - revenue forecast (trend + seasonality) and weighted pipeline
 *  - rising destinations and package launch suggestions
 *  - best hour to message each audience
 *  - campaign ROI
 */
import { addDays, daysBetween, isoDate, lastMonths, monthKey, type ISODate } from "./dates.js";
import { type Lead } from "./entities.js";
import { type Store } from "./store.js";

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const clampP = (p: number) => Math.min(0.97, Math.max(0.03, p));

function budgetBand(l: Pick<Lead, "budget" | "pax">): string {
  if (!l.budget) return "no budget";
  const pp = l.budget / 100 / Math.max(1, l.pax.adults + l.pax.children);
  return pp < 15_000 ? "under ₹15k pp" : pp < 40_000 ? "₹15k–40k pp" : pp < 80_000 ? "₹40k–80k pp" : "₹80k+ pp";
}

function leadTimeBand(l: Pick<Lead, "travelDate" | "createdAt">): string {
  if (!l.travelDate) return "no date";
  const d = daysBetween(l.createdAt.slice(0, 10), l.travelDate);
  return d < 15 ? "under 2 weeks" : d < 45 ? "2–6 weeks" : d < 120 ? "6 weeks–4 months" : "4+ months";
}

const FEATURES: { key: string; label: string; of: (l: Lead) => string }[] = [
  { key: "source", label: "Source", of: (l) => l.source.replace(/_/g, " ") },
  { key: "destination", label: "Destination", of: (l) => l.destination || "not given" },
  { key: "budget", label: "Budget", of: budgetBand },
  { key: "leadTime", label: "Booking window", of: leadTimeBand },
  { key: "service", label: "Service", of: (l) => l.service },
];

export interface LeadModel {
  trainedOn: number;
  baseRate: number;
  ready: boolean;
  factors: { feature: string; value: string; winRate: number; n: number; lift: number }[];
}

/** Learn win rates from closed leads (won vs lost). Needs 12+ closed leads to be "ready". */
export function trainLeadModel(leads: Lead[]): LeadModel {
  const closed = leads.filter((l) => l.stage === "won" || l.stage === "lost");
  const wins = closed.filter((l) => l.stage === "won").length;
  const baseRate = clampP((wins + 1) / (closed.length + 2));
  const factors: LeadModel["factors"] = [];
  for (const f of FEATURES) {
    const groups = new Map<string, { n: number; w: number }>();
    for (const l of closed) {
      const v = f.of(l);
      const g = groups.get(v) ?? { n: 0, w: 0 };
      g.n++;
      if (l.stage === "won") g.w++;
      groups.set(v, g);
    }
    for (const [value, g] of groups) {
      // Laplace smoothing towards the base rate (strength 3)
      const winRate = clampP((g.w + 3 * baseRate) / (g.n + 3));
      factors.push({ feature: f.label, value, winRate, n: g.n, lift: winRate / baseRate });
    }
  }
  factors.sort((a, b) => Math.abs(Math.log(b.lift)) - Math.abs(Math.log(a.lift)));
  return { trainedOn: closed.length, baseRate, ready: closed.length >= 12, factors };
}

/** Probability (0–100) that an open lead converts, with the reasons that moved it most. */
export function predictLead(model: LeadModel, l: Lead): { chance: number; reasons: string[] } {
  let x = logit(model.baseRate);
  const moves: { text: string; delta: number }[] = [];
  for (const f of FEATURES) {
    const v = f.of(l);
    const fac = model.factors.find((k) => k.feature === f.label && k.value === v);
    if (!fac || fac.n < 2) continue;
    const delta = 0.7 * (logit(fac.winRate) - logit(model.baseRate));
    x += delta;
    moves.push({ text: `${f.label} "${v}" wins ${Math.round(fac.winRate * 100)}% of the time (${fac.n} past leads)`, delta });
  }
  // Engagement signal from the rule-based score
  x += ((l.score - 50) / 50) * 0.5;
  moves.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  // Never claim certainty: a lead is at most 95% and at least 3% likely
  return { chance: Math.min(95, Math.max(3, Math.round(sigmoid(x) * 100))), reasons: moves.slice(0, 3).map((m) => `${m.delta >= 0 ? "▲" : "▼"} ${m.text}`) };
}

/* ───────────────────────── forecasting ───────────────────────── */

export interface Forecast {
  history: { month: string; revenue: number; bookings: number }[];
  next: { month: string; revenue: number; low: number; high: number }[];
  method: string;
}

/** Monthly revenue forecast: least-squares trend × same-month seasonality (when a year of data exists). */
export function forecastRevenue(bookings: { createdAt: string; sellTotal: number; status: string }[], today: ISODate, horizon = 3): Forecast {
  const months = lastMonths(today, 12);
  const live = bookings.filter((b) => b.status !== "cancelled");
  const history = months.map((m) => {
    const rows = live.filter((b) => monthKey(b.createdAt.slice(0, 10)) === m);
    return { month: m, revenue: rows.reduce((s, b) => s + b.sellTotal, 0), bookings: rows.length };
  });
  const ys = history.map((h) => h.revenue);
  const n = ys.length;
  const xs = ys.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0) || 1;
  const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i]! - my), 0) / sxx;
  const intercept = my - slope * mx;
  const resid = Math.sqrt(xs.reduce((s, x, i) => s + (ys[i]! - (intercept + slope * x)) ** 2, 0) / Math.max(1, n - 2));
  const nonZero = ys.filter((y) => y > 0).length;
  const next: Forecast["next"] = [];
  let cursor = today;
  for (let k = 1; k <= horizon; k++) {
    cursor = addDays(cursor.slice(0, 8) + "01", 32);
    const month = monthKey(cursor);
    const trend = Math.max(0, intercept + slope * (n - 1 + k));
    // Seasonality: same calendar month last year relative to the yearly mean
    const lastYear = history.find((h) => h.month.slice(5) === month.slice(5));
    const season = lastYear && my > 0 && nonZero >= 10 ? Math.min(1.8, Math.max(0.5, lastYear.revenue / my)) : 1;
    const toRupee = (x: number) => Math.round(x / 100) * 100;
    const value = toRupee(trend * season);
    next.push({ month, revenue: value, low: Math.max(0, toRupee(value - 1.28 * resid)), high: toRupee(value + 1.28 * resid) });
  }
  return { history, next, method: nonZero >= 10 ? "12-month trend × seasonality, 80% band" : "Trend of the last 12 months (needs more history for seasonality), 80% band" };
}

const STAGE_BASE: Record<string, number> = { new: 0.12, contacted: 0.2, quoted: 0.35, negotiation: 0.55 };

/** Expected revenue from open leads: value × win chance for their stage (learned when history allows). */
export function weightedPipeline(leads: Lead[], avgBookingValue: number): { stage: string; open: number; value: number; chance: number; expected: number }[] {
  const closed = leads.filter((l) => l.stage === "won" || l.stage === "lost");
  const winRateOverall = closed.length ? closed.filter((l) => l.stage === "won").length / closed.length : 0.25;
  return ["new", "contacted", "quoted", "negotiation"].map((stage) => {
    const open = leads.filter((l) => l.stage === stage);
    const value = open.reduce((s, l) => s + (l.budget ?? avgBookingValue), 0);
    const chance = Math.min(0.9, (STAGE_BASE[stage]! * 0.5) + (winRateOverall * (STAGE_BASE[stage]! / 0.3) * 0.5));
    return { stage, open: open.length, value, chance: Math.round(chance * 100), expected: Math.round((value * chance) / 100) * 100 };
  });
}

/* ───────────────────────── trends ───────────────────────── */

export interface DestinationTrend {
  destination: string;
  last30: number;
  prev30: number;
  growth: number;
  hasPackage: boolean;
  peakMonth: string | null;
}

export function destinationTrends(leads: Lead[], packages: { destination: string; published: boolean }[], today: ISODate): DestinationTrend[] {
  const d30 = addDays(today, -30);
  const d60 = addDays(today, -60);
  const by = new Map<string, Lead[]>();
  for (const l of leads) if (l.destination) by.set(l.destination, [...(by.get(l.destination) ?? []), l]);
  return [...by.entries()].map(([destination, rows]) => {
    const last30 = rows.filter((l) => l.createdAt.slice(0, 10) > d30).length;
    const prev30 = rows.filter((l) => l.createdAt.slice(0, 10) > d60 && l.createdAt.slice(0, 10) <= d30).length;
    const months = new Map<string, number>();
    for (const l of rows) if (l.travelDate) months.set(l.travelDate.slice(5, 7), (months.get(l.travelDate.slice(5, 7)) ?? 0) + 1);
    const peak = [...months.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      destination, last30, prev30, growth: prev30 ? Math.round(((last30 - prev30) / prev30) * 100) : last30 > 0 ? 100 : 0,
      hasPackage: packages.some((p) => p.published && p.destination.toLowerCase() === destination.toLowerCase()), peakMonth: peak ? peak[0] : null,
    };
  }).sort((a, b) => b.last30 - a.last30 || b.growth - a.growth);
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function launchSuggestions(trends: DestinationTrend[]): string[] {
  const out: string[] = [];
  for (const t of trends.slice(0, 8)) {
    if (t.last30 >= 2 && !t.hasPackage) out.push(`Publish a ${t.destination} package: ${t.last30} enquiries in the last 30 days and no published package.`);
    if (t.growth >= 50 && t.last30 >= 2) out.push(`${t.destination} enquiries are up ${t.growth}% on the previous 30 days — run a campaign to past travellers this week.`);
    if (t.peakMonth) {
      const peak = Number(t.peakMonth);
      out.push(`Most ${t.destination} travellers go in ${MONTH[peak - 1]}. Launch offers about 8 weeks earlier, in ${MONTH[(peak + 9) % 12]}.`);
    }
  }
  return [...new Set(out)].slice(0, 6);
}

/** Hour of day (local) when customers message most — the best time to send a campaign. */
export function bestSendHour(inbound: { at: string }[], tzOffsetMinutes = 330): { hour: number; label: string; sample: number } {
  const counts = new Array<number>(24).fill(0);
  for (const m of inbound) {
    const t = new Date(m.at).getTime() + tzOffsetMinutes * 60_000;
    counts[new Date(t).getUTCHours()]! += 1;
  }
  const sample = counts.reduce((a, b) => a + b, 0);
  const hour = sample >= 5 ? counts.indexOf(Math.max(...counts)) : 19;
  const label = `${((hour + 11) % 12) + 1}:00 ${hour < 12 ? "AM" : "PM"}`;
  return { hour, label, sample };
}

/** Next date-time (UTC ISO) at the given local hour, today or tomorrow. */
export function nextAtHour(now: Date, hour: number, tzOffsetMinutes = 330): string {
  const local = new Date(now.getTime() + tzOffsetMinutes * 60_000);
  const target = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, 0, 0));
  let t = target.getTime() - tzOffsetMinutes * 60_000;
  if (t <= now.getTime()) t += 86_400_000;
  return new Date(t).toISOString();
}

/* ───────────────────────── campaign ROI ───────────────────────── */

export async function campaignRoi(store: Store) {
  const [campaigns, leads, bookings, outbox] = await Promise.all([store.list("campaigns"), store.list("leads"), store.list("bookings"), store.list("outbox")]);
  return campaigns.map((c) => {
    const ls = leads.filter((l) => l.campaignId === c.id);
    const won = ls.filter((l) => l.bookingId);
    const revenue = won.reduce((s, l) => s + (bookings.find((b) => b.id === l.bookingId && b.status !== "cancelled")?.sellTotal ?? 0), 0);
    const msgs = outbox.filter((o) => o.campaignId === c.id);
    return {
      id: c.id, name: c.name, channel: c.channel, status: c.status, sent: c.sentCount,
      delivered: msgs.filter((o) => ["delivered", "read"].includes(o.status)).length, read: msgs.filter((o) => o.status === "read").length,
      leads: ls.length, bookings: won.length, revenue, cost: c.cost, roi: c.cost > 0 ? Math.round(((revenue - c.cost) / c.cost) * 100) : null,
    };
  });
}

export function todayIso(now: Date): ISODate {
  return isoDate(now);
}
