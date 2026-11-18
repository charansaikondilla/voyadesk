/**
 * Growth engine: automations ("When → If → Then") and the marketing funnel.
 *
 * Event triggers run right after the action that caused them (an after-hook reads the rows the action wrote, so every
 * code path that creates a lead or confirms a booking is covered). runJobs also sweeps the last 24 hours with the same
 * idempotency keys, which catches changes made outside actions (e.g. gateway webhooks). Time triggers run in runJobs.
 * Steps write through store helpers (never runAction), so automations can't trigger each other in loops, and a failing
 * step is recorded on the run instead of throwing (the user's own action is never rolled back by an automation).
 */
import { z } from "zod";
import { filterAudience, internals, registerActions, registerAfterHook, WHATSAPP_MARKETING_COST, type WriteRecord } from "../actions.js";
import { addDays, daysBetween, formatDate, isoDate, type ISODate } from "../dates.js";
import {
  AUTOMATION_TIME_TRIGGERS, AUTOMATION_TRIGGERS, schemas, type Automation, type AutomationField, type AutomationRun,
  type AutomationTrigger, type Booking, type Collection, type Entity, type Invoice, type Lead, type Quote, type Settings, type User, type VisaCase,
} from "../entities.js";
import { bestSendHour, campaignRoi } from "../insights.js";
import { pickChannel, queueMessage, T, type Channel } from "../messaging.js";
import { registerActionRoles } from "../permissions.js";
import { providersFor } from "../providers.js";
import { registerReports } from "../reports.js";
import { canTransition, DomainError, LEAD_FLOW, LEAD_SOURCES, LEAD_STAGES, type LeadSource, type LeadStage } from "../rules.js";
import { createRow, DEFAULT_SETTINGS, mustGet, patchRow, todayOf, type Ctx, type Store } from "../store.js";
import { createLink } from "./commerce.js";
import { AUTOMATION_TEMPLATES, TEMPLATE_ASSIGNEE_ROLES } from "./growthRecipes.js";
import type { AudiencePreview, AutomationTemplate, AutomationTestResult, ChannelRow, FunnelStage, MarketingFunnel } from "./growthTypes.js";
import { action, appLink, findContact, log, rupees } from "./shared.js";

const { outstandingOf, firstUserWithRole, segmentAudience } = internals;

type SubjectType = AutomationRun["subjectType"];
type Step = Automation["steps"][number];
type StepKind = Step["kind"];
type Fact = string | number | null;

const DAY = 86_400_000;
const isTime = (t: AutomationTrigger) => AUTOMATION_TIME_TRIGGERS.includes(t);
const OPEN_LEAD = (l: Lead) => l.stage !== "won" && l.stage !== "lost";
const firstName = (n: string) => n.trim().split(/\s+/)[0] ?? "";
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const CH: Record<Channel, string> = { whatsapp: "WhatsApp", email: "Email", sms: "SMS" };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 280);

/** Triggers that have something to collect money against (invoice, or a booking with one). */
export const PAYMENT_LINK_TRIGGERS: readonly AutomationTrigger[] = ["invoice_overdue", "booking_confirmed", "trip_upcoming", "quote_accepted"];

/** Plain-English "whenever …" for each event trigger (used in messages to the user). */
const WHENEVER: Record<AutomationTrigger, string> = {
  lead_created: "a new lead comes in", lead_stage_changed: "a lead moves to another stage", quote_sent: "a quote is sent",
  quote_accepted: "a customer accepts a quote", booking_confirmed: "a booking is confirmed", payment_received: "a payment is received",
  visa_status_changed: "a visa case changes status", lead_idle: "a lead goes quiet", quote_idle: "a quote gets no answer",
  invoice_overdue: "a payment is overdue", trip_upcoming: "a trip is coming up", trip_completed: "a trip ends",
};

export const SOURCE_LABEL: Record<LeadSource, string> = {
  whatsapp: "WhatsApp", website: "Website", meta_ads: "Meta Ads", google_ads: "Google Ads", instagram: "Instagram", ivr: "Phone calls",
  walk_in: "Walk-in", referral: "Referrals", repeat: "Repeat customers", b2b_agent: "B2B agents", email: "Email", landing_page: "Landing pages", other: "Other",
};

/* ───────────────────────── a cached view of the tenant's rows ───────────────────────── */

class World {
  private lists = new Map<Collection, Promise<unknown[]>>();
  private settingsRow: Promise<Settings> | null = null;
  constructor(readonly s: Store) {}
  list<C extends Collection>(c: C): Promise<Entity<C>[]> {
    let p = this.lists.get(c);
    if (!p) {
      p = this.s.list(c);
      this.lists.set(c, p);
    }
    return p as Promise<Entity<C>[]>;
  }
  async get<C extends Collection>(c: C, id: string | null | undefined): Promise<Entity<C> | undefined> {
    if (!id) return undefined;
    const p = this.lists.get(c);
    if (p) return ((await p) as Entity<C>[]).find((r) => r.id === id);
    return this.s.get(c, id);
  }
  dirty(...cs: Collection[]): void {
    for (const c of cs) this.lists.delete(c);
  }
  settings(): Promise<Settings> {
    this.settingsRow ??= readSettings(this.s);
    return this.settingsRow;
  }
}

/** Settings without creating the row (dry runs must never write). */
async function readSettings(s: Store): Promise<Settings> {
  const rows = await s.list("settings");
  if (rows[0]) return rows[0];
  return { ...schemas.settings.parse(DEFAULT_SETTINGS()), id: "settings", createdAt: "", updatedAt: "" } as Settings;
}

/* ───────────────────────── events ───────────────────────── */

interface Ev {
  trigger: AutomationTrigger;
  subjectType: SubjectType;
  subjectId: string;
  /** Unique part of the idempotency key (after automation id and trigger). */
  keyPart: string;
  reason: string;
  /** Overrides the subject's "amount" fact (e.g. the payment that was just received). */
  amount?: number;
  at: string;
}

const runKey = (a: Pick<Automation, "id">, ev: Ev) => `${a.id}|${ev.trigger}|${ev.keyPart}`.slice(0, 240);

type Row = Record<string, unknown>;
const str = (r: Row | null | undefined, k: string) => (r && typeof r[k] === "string" ? (r[k] as string) : null);

/** Turn the rows an action wrote into automation events. */
export function eventsFromWrites(writes: readonly WriteRecord[]): Ev[] {
  const out: Ev[] = [];
  for (const w of writes) {
    const a = w.after, b = w.before;
    const at = str(a, "updatedAt") ?? new Date().toISOString();
    if (w.collection === "leads") {
      if (!b) out.push({ trigger: "lead_created", subjectType: "lead", subjectId: w.id, keyPart: w.id, reason: `New ${SOURCE_LABEL[(str(a, "source") ?? "other") as LeadSource] ?? "lead"} enquiry`, at });
      const from = str(b, "stage") ?? "new", to = str(a, "stage") ?? "new";
      if (from !== to) out.push({ trigger: "lead_stage_changed", subjectType: "lead", subjectId: w.id, keyPart: `${w.id}|${to}|${at}`, reason: `Moved from ${from} to ${to}`, at });
    } else if (w.collection === "quotes") {
      const to = str(a, "status"), from = str(b, "status");
      if (to === "sent" && from !== "sent") out.push({ trigger: "quote_sent", subjectType: "quote", subjectId: w.id, keyPart: `${w.id}|v${Number(a["version"] ?? 1)}`, reason: `Quote ${str(a, "number") ?? ""} sent`, at });
      if (to === "accepted" && from !== "accepted") out.push({ trigger: "quote_accepted", subjectType: "quote", subjectId: w.id, keyPart: w.id, reason: `Quote ${str(a, "number") ?? ""} accepted`, at });
    } else if (w.collection === "bookings") {
      if (!b && str(a, "status") !== "cancelled") out.push({ trigger: "booking_confirmed", subjectType: "booking", subjectId: w.id, keyPart: w.id, reason: `Booking ${str(a, "number") ?? ""} confirmed`, at });
    } else if (w.collection === "payments") {
      const inv = str(a, "invoiceId");
      if (!b && inv && a["direction"] === "in" && a["purpose"] === "invoice") {
        out.push({ trigger: "payment_received", subjectType: "invoice", subjectId: inv, keyPart: w.id, reason: `Paid ${rupees(Number(a["amount"] ?? 0))}`, amount: Number(a["amount"] ?? 0), at });
      }
    } else if (w.collection === "visaCases") {
      const from = str(b, "status"), to = str(a, "status") ?? "";
      if (from !== to) out.push({ trigger: "visa_status_changed", subjectType: "visaCase", subjectId: w.id, keyPart: `${w.id}|${to}|${at}`, reason: `Visa ${str(a, "number") ?? ""}: ${to.replace(/_/g, " ")}`, at });
    }
  }
  return out;
}

/** Events of the last `sinceMs` that can be rebuilt reliably from the rows (used by the catch-up sweep and dry runs). */
async function recentEvents(w: World, trigger: AutomationTrigger, sinceIso: string): Promise<Ev[]> {
  const out: Ev[] = [];
  switch (trigger) {
    case "lead_created":
      for (const l of await w.list("leads")) if (l.createdAt >= sinceIso) out.push({ trigger, subjectType: "lead", subjectId: l.id, keyPart: l.id, reason: `New ${SOURCE_LABEL[l.source]} enquiry`, at: l.createdAt });
      break;
    case "lead_stage_changed":
      for (const l of await w.list("leads")) if (l.updatedAt >= sinceIso && l.stage !== "new") out.push({ trigger, subjectType: "lead", subjectId: l.id, keyPart: `${l.id}|${l.stage}|${l.updatedAt}`, reason: `Now ${l.stage}`, at: l.updatedAt });
      break;
    case "quote_sent":
      for (const q of await w.list("quotes")) if (q.status === "sent" && q.updatedAt >= sinceIso) out.push({ trigger, subjectType: "quote", subjectId: q.id, keyPart: `${q.id}|v${q.version}`, reason: `Quote ${q.number} sent`, at: q.updatedAt });
      break;
    case "quote_accepted":
      for (const q of await w.list("quotes")) if (q.status === "accepted" && q.updatedAt >= sinceIso) out.push({ trigger, subjectType: "quote", subjectId: q.id, keyPart: q.id, reason: `Quote ${q.number} accepted`, at: q.updatedAt });
      break;
    case "booking_confirmed":
      for (const b of await w.list("bookings")) if (b.createdAt >= sinceIso && b.status !== "cancelled") out.push({ trigger, subjectType: "booking", subjectId: b.id, keyPart: b.id, reason: `Booking ${b.number} confirmed`, at: b.createdAt });
      break;
    case "payment_received":
      for (const p of await w.list("payments")) {
        if (p.createdAt >= sinceIso && p.invoiceId && p.direction === "in" && p.purpose === "invoice") out.push({ trigger, subjectType: "invoice", subjectId: p.invoiceId, keyPart: p.id, reason: `Paid ${rupees(p.amount)}`, amount: p.amount, at: p.createdAt });
      }
      break;
    case "visa_status_changed":
      for (const v of await w.list("visaCases")) if (v.updatedAt >= sinceIso) out.push({ trigger, subjectType: "visaCase", subjectId: v.id, keyPart: `${v.id}|${v.status}|${v.updatedAt}`, reason: `Visa ${v.number}: ${v.status.replace(/_/g, " ")}`, at: v.updatedAt });
      break;
    default:
      break;
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}

/** Event triggers the 24-hour catch-up sweep can rebuild exactly (stage/visa changes need the previous state). */
const SWEEPABLE: readonly AutomationTrigger[] = ["lead_created", "quote_sent", "quote_accepted", "booking_confirmed", "payment_received"];

/** How far back a time trigger catches up (so a new automation doesn't message months-old records). */
const CATCH_UP_DAYS = 14;

/** Subjects a time trigger is due for right now. */
async function dueEvents(w: World, a: Pick<Automation, "trigger" | "days">, ctx: Ctx): Promise<Ev[]> {
  const settings = await w.settings();
  const today = todayOf(ctx, settings);
  const now = ctx.now.getTime();
  const n = a.days;
  const out: Ev[] = [];
  const within = (dueMs: number) => dueMs <= now && dueMs >= now - CATCH_UP_DAYS * DAY;
  switch (a.trigger) {
    case "lead_idle":
      for (const l of await w.list("leads")) {
        if (!OPEN_LEAD(l)) continue;
        const last = l.lastActivityAt ?? l.createdAt;
        if (!within(Date.parse(last) + n * DAY)) continue;
        const idle = Math.floor((now - Date.parse(last)) / DAY);
        out.push({ trigger: a.trigger, subjectType: "lead", subjectId: l.id, keyPart: `${l.id}|${last}`, reason: `No activity for ${idle} day${idle === 1 ? "" : "s"}`, at: last });
      }
      break;
    case "quote_idle":
      for (const q of await w.list("quotes")) {
        if (q.status !== "sent" && q.status !== "viewed") continue;
        if (!within(Date.parse(q.updatedAt) + n * DAY)) continue;
        const idle = Math.floor((now - Date.parse(q.updatedAt)) / DAY);
        out.push({ trigger: a.trigger, subjectType: "quote", subjectId: q.id, keyPart: `${q.id}|v${q.version}`, reason: `${q.status === "viewed" ? "Opened" : "Sent"} ${idle} day${idle === 1 ? "" : "s"} ago, no answer`, at: q.updatedAt });
      }
      break;
    case "invoice_overdue": {
      const bookings = await w.list("bookings");
      for (const inv of await w.list("invoices")) {
        const due = outstandingOf(inv);
        if (inv.partyType !== "customer" || inv.status === "cancelled" || due <= 0) continue;
        const late = daysBetween(inv.dueDate, today);
        if (late < Math.max(0, n) || (n === 0 && inv.dueDate > today)) continue;
        if (inv.bookingId && bookings.find((b) => b.id === inv.bookingId)?.status === "cancelled") continue;
        out.push({ trigger: a.trigger, subjectType: "invoice", subjectId: inv.id, keyPart: `${inv.id}|${inv.dueDate}`, reason: late === 0 ? `${rupees(due)} due today` : `${rupees(due)} overdue by ${late} day${late === 1 ? "" : "s"}`, at: inv.dueDate });
      }
      break;
    }
    case "trip_upcoming":
      for (const b of await w.list("bookings")) {
        if (b.status !== "confirmed") continue;
        const d = daysBetween(today, b.startDate);
        if (d < 0 || d > n) continue;
        out.push({ trigger: a.trigger, subjectType: "booking", subjectId: b.id, keyPart: `${b.id}|${b.startDate}`, reason: d === 0 ? "Travels today" : `Travels in ${d} day${d === 1 ? "" : "s"} (${formatDate(b.startDate)})`, at: b.startDate });
      }
      break;
    case "trip_completed":
      for (const b of await w.list("bookings")) {
        if (b.status === "cancelled") continue;
        const d = daysBetween(b.endDate, today);
        if (d < n || d > Math.min(60, n + CATCH_UP_DAYS)) continue;
        out.push({ trigger: a.trigger, subjectType: "booking", subjectId: b.id, keyPart: b.id, reason: d === 0 ? `Back from ${b.destination || "the trip"} today` : `Back from ${b.destination || "the trip"} ${d} day${d === 1 ? "" : "s"} ago`, at: b.endDate });
      }
      break;
    default:
      break;
  }
  return out.sort((x, y) => x.at.localeCompare(y.at));
}

/* ───────────────────────── subjects and facts ───────────────────────── */

interface Subject {
  type: SubjectType;
  id: string;
  name: string;
  phone: string;
  email: string;
  lead: Lead | null;
  quote: Quote | null;
  booking: Booking | null;
  invoice: Invoice | null;
  visa: VisaCase | null;
  ownerId: string | null;
  destination: string;
  date: ISODate | null;
  amount: number | null;
  facts: Record<Exclude<AutomationField, "country">, Fact>;
}

async function resolve(w: World, ev: Pick<Ev, "subjectType" | "subjectId" | "amount">): Promise<Subject | null> {
  let lead: Lead | null = null, quote: Quote | null = null, booking: Booking | null = null, invoice: Invoice | null = null, visa: VisaCase | null = null;
  switch (ev.subjectType) {
    case "lead": lead = (await w.get("leads", ev.subjectId)) ?? null; if (!lead) return null; break;
    case "quote":
      quote = (await w.get("quotes", ev.subjectId)) ?? null; if (!quote) return null;
      lead = (await w.get("leads", quote.leadId)) ?? null;
      booking = (await w.get("bookings", quote.bookingId)) ?? null;
      invoice = (await w.get("invoices", booking?.invoiceId)) ?? null;
      break;
    case "booking":
      booking = (await w.get("bookings", ev.subjectId)) ?? null; if (!booking) return null;
      lead = (await w.get("leads", booking.leadId)) ?? null;
      invoice = (await w.get("invoices", booking.invoiceId)) ?? null;
      break;
    case "invoice":
      invoice = (await w.get("invoices", ev.subjectId)) ?? null; if (!invoice) return null;
      booking = (await w.get("bookings", invoice.bookingId)) ?? null;
      lead = (await w.get("leads", booking?.leadId)) ?? null;
      break;
    case "visaCase": visa = (await w.get("visaCases", ev.subjectId)) ?? null; if (!visa) return null; break;
  }
  const holder = quote ?? booking ?? visa;
  let name = holder?.contactName ?? lead?.name ?? invoice?.partyName ?? "";
  let phone = holder?.phone ?? lead?.phone ?? "";
  let email = holder?.email ?? lead?.email ?? "";
  if (invoice && invoice.partyType === "agent" && ev.subjectType === "invoice") {
    const agent = await w.get("agents", invoice.partyId);
    if (agent) ({ name, phone, email } = { name: agent.contactName || agent.name, phone: agent.phone, email: agent.email });
  }
  const pax = quote?.pax ?? booking?.pax ?? lead?.pax ?? null;
  const ownerId = visa ? visa.assigneeId : quote?.ownerId ?? booking?.ownerId ?? lead?.ownerId ?? null;
  const destination = quote?.destination || booking?.destination || lead?.destination || visa?.country || "";
  const amount = ev.amount ?? (ev.subjectType === "invoice" ? (invoice ? outstandingOf(invoice) : null)
    : ev.subjectType === "quote" ? quote?.total ?? null
    : ev.subjectType === "booking" ? booking?.sellTotal ?? null
    : ev.subjectType === "visaCase" ? visa?.fee ?? null
    : lead?.budget ?? null);
  const date = ev.subjectType === "invoice" ? invoice?.dueDate ?? null
    : ev.subjectType === "quote" ? quote?.startDate ?? null
    : ev.subjectType === "booking" ? booking?.startDate ?? null
    : ev.subjectType === "visaCase" ? visa?.travelDate ?? null
    : lead?.travelDate ?? null;
  const status = ev.subjectType === "lead" ? lead!.stage : ev.subjectType === "quote" ? quote!.status : ev.subjectType === "booking" ? booking!.status
    : ev.subjectType === "invoice" ? invoice!.status : visa!.status;
  return {
    type: ev.subjectType, id: ev.subjectId, name, phone, email, lead, quote, booking, invoice, visa, ownerId, destination, date, amount,
    facts: {
      source: lead?.source ?? (booking?.agentId || quote?.agentId || visa?.agentId ? "b2b_agent" : null),
      destination, service: lead?.service ?? (visa ? "visa" : "holiday"), stage: lead?.stage ?? null, temperature: lead?.temperature ?? null,
      score: lead?.score ?? null, budget: lead?.budget ?? null, amount, ownerId, status,
      pax: visa ? visa.applicants.length : pax ? pax.adults + pax.children : null,
    },
  };
}

async function factOf(w: World, s: Subject, field: AutomationField): Promise<Fact> {
  if (field !== "country") return s.facts[field];
  if (s.visa) return s.visa.country;
  const d = s.destination.trim().toLowerCase();
  if (!d) return null;
  const pkg = (await w.list("packages")).find((p) => p.destination.toLowerCase() === d);
  if (pkg) return pkg.country;
  const hotel = (await w.list("hotels")).find((h) => h.city.toLowerCase() === d || h.country.toLowerCase() === d);
  return hotel?.country ?? s.destination;
}

function testCondition(c: Automation["conditions"][number], v: Fact): boolean {
  const want = c.value.trim().toLowerCase();
  const have = v === null || v === undefined ? "" : String(v).toLowerCase();
  switch (c.op) {
    case "eq": return have === want;
    case "neq": return have !== want;
    case "contains": return have.includes(want);
    case "gte": case "lte": {
      if (v === null || v === "" || Number.isNaN(Number(v)) || Number.isNaN(Number(c.value))) return false;
      return c.op === "gte" ? Number(v) >= Number(c.value) : Number(v) <= Number(c.value);
    }
  }
}

async function passes(w: World, s: Subject, conditions: Automation["conditions"]): Promise<boolean> {
  for (const c of conditions) if (!testCondition(c, await factOf(w, s, c.field))) return false;
  return true;
}

/* ───────────────────────── rendering ───────────────────────── */

interface RunState {
  s: Store;
  ctx: Ctx;
  w: World;
  settings: Settings;
  auto: Automation;
  ev: Ev;
  subj: Subject;
  /** Set by send_payment_link so later steps' {link} / {amount} point at the payment. */
  payUrl?: string;
  payAmount?: number;
}

async function ownerName(w: World, id: string | null): Promise<string> {
  const u = id ? await w.get("users", id) : undefined;
  return u?.name ?? "";
}

function linkPath(ctx: Ctx, subj: Subject, payUrl?: string): string | null {
  if (payUrl) return null;
  if (subj.type === "quote" && subj.quote?.shareToken) return `/p/${ctx.tenantId}/${subj.quote.shareToken}`;
  if (subj.type === "invoice") return `/my/${ctx.tenantId}`;
  if (subj.type === "visaCase" && subj.visa?.uploadToken) return `/visa-upload/${ctx.tenantId}/${subj.visa.uploadToken}`;
  return `/store/${ctx.tenantId}`;
}

async function render(r: Pick<RunState, "ctx" | "w" | "settings" | "subj" | "payUrl" | "payAmount">, text: string): Promise<string> {
  if (!text) return "";
  const s = r.subj;
  const path = linkPath(r.ctx, s, r.payUrl);
  const link = r.payUrl ?? appLink(r.settings, path!);
  const amount = r.payAmount ?? s.amount;
  const owner = firstName(await ownerName(r.w, s.ownerId)) || `the ${r.settings.companyName} team`;
  const vars: Record<string, string> = {
    name: firstName(s.name) || "there", destination: s.destination || "your trip", company: r.settings.companyName, link,
    amount: amount !== null && amount !== undefined ? rupees(amount) : "the amount due", owner, date: s.date ? formatDate(s.date) : "your travel date",
  };
  return text.replace(/\{(name|destination|company|link|amount|owner|date)\}/gi, (_m, k: string) => vars[k.toLowerCase()] ?? "").trim();
}

/* ───────────────────────── steps ───────────────────────── */

interface StepOut {
  kind: StepKind;
  ok: boolean;
  detail: string;
  /** "noop" = nothing needed (still ok); "blocked" = couldn't be done for a known reason; "error" = failed. */
  outcome: "done" | "noop" | "blocked" | "error";
  message?: boolean;
}

const done = (kind: StepKind, detail: string, message = false): StepOut => ({ kind, ok: true, detail, outcome: "done", message });
const noop = (kind: StepKind, detail: string): StepOut => ({ kind, ok: true, detail: `Skipped: ${detail}`, outcome: "noop" });
const blocked = (kind: StepKind, detail: string): StepOut => ({ kind, ok: false, detail: `Skipped: ${detail}`, outcome: "blocked" });

const NOUN: Record<SubjectType, string> = { lead: "lead", quote: "quote", booking: "booking", invoice: "invoice", visaCase: "visa case" };

function outboxKind(t: AutomationTrigger): "followup" | "reminder" | "notification" {
  if (t === "lead_idle" || t === "quote_idle") return "followup";
  if (t === "invoice_overdue") return "reminder";
  return "notification";
}

const links = (s: Subject) => ({ leadId: s.lead?.id ?? null, bookingId: s.booking?.id ?? null, invoiceId: s.invoice?.id ?? null, visaCaseId: s.visa?.id ?? null });

async function defaultAssignee(r: RunState, roles: string[] = ["sales", "owner", "admin"]): Promise<string | null> {
  return r.subj.ownerId ?? firstUserWithRole(r.s, roles);
}

const STEPS: Record<StepKind, (r: RunState, st: Step) => Promise<StepOut>> = {
  async send_message(r, st) {
    const body = await render(r, st.message);
    if (!body) return blocked(st.kind, "the message is empty");
    const target = pickChannel(st.channel, r.subj.phone, r.subj.email);
    if (!target) return blocked(st.kind, "no phone number or email on file");
    await queueMessage(r.s, r.ctx, { channel: st.channel, phone: r.subj.phone, email: r.subj.email, subject: r.auto.name, body, kind: outboxKind(r.ev.trigger), ...links(r.subj) });
    const via = target.channel !== st.channel ? ` (no ${st.channel === "email" ? "email" : "phone"} on file)` : "";
    return done(st.kind, `${CH[target.channel]} queued to ${target.to}${via}: "${clip(body, 90)}"`, true);
  },

  async send_payment_link(r, st) {
    const inv = r.subj.invoice;
    if (!inv) return blocked(st.kind, `there's no invoice for this ${NOUN[r.subj.type]} yet`);
    if (inv.status === "cancelled") return noop(st.kind, `${inv.number} is cancelled`);
    if (inv.partyType === "agent") return noop(st.kind, `${inv.number} is billed to a B2B agent`);
    const due = outstandingOf(inv);
    if (due <= 0) return noop(st.kind, `nothing is due on ${inv.number}`);
    if (providersFor(r.ctx).payments.name === "none") return blocked(st.kind, "no payment gateway is connected (Settings → Integrations)");
    const nowIso = r.ctx.now.toISOString();
    const existing = (await r.w.list("paymentLinks")).find((l) => l.invoiceId === inv.id && l.status === "created" && l.amount === due && (!l.expiresAt || l.expiresAt > nowIso));
    const link = existing ?? (await createLink(r.s, r.ctx, { purpose: "invoice", amount: due, description: `Payment for ${inv.number}`, customer: { name: r.subj.name, phone: r.subj.phone, email: r.subj.email }, invoiceId: inv.id }));
    if (!existing) r.w.dirty("paymentLinks");
    r.payUrl = link.url;
    r.payAmount = due;
    const target = pickChannel(st.channel, r.subj.phone, r.subj.email);
    if (!target) return { kind: st.kind, ok: false, outcome: "error", detail: `Payment link for ${rupees(due)} is ready, but there's no phone or email to send it to` };
    const body = st.message.trim() ? await render(r, st.message) : T.paymentReminder(firstName(r.subj.name), inv.number, due, inv.dueDate, link.url);
    await queueMessage(r.s, r.ctx, { channel: st.channel, phone: r.subj.phone, email: r.subj.email, subject: `Payment for ${inv.number}`, body, kind: "reminder", ...links(r.subj) });
    return done(st.kind, `Payment link for ${rupees(due)} on ${inv.number} ${existing ? "re-sent" : "sent"} by ${CH[target.channel]} to ${target.to}`, true);
  },

  async create_task(r, st) {
    const title = clip(await render(r, st.title), 200);
    if (!title) return blocked(st.kind, "the task has no title");
    const assigneeId = st.userId ?? (await defaultAssignee(r));
    const l = links(r.subj);
    const open = (await r.w.list("tasks")).find((t) => !t.done && t.title === title && t.leadId === l.leadId && t.bookingId === l.bookingId && t.visaCaseId === l.visaCaseId);
    if (open) return noop(st.kind, "the same task is already open");
    const due = new Date(r.ctx.now.getTime() + (st.dueInDays > 0 ? st.dueInDays * DAY : 2 * 3600_000));
    await createRow(r.s, "tasks", { title, dueAt: due.toISOString(), assigneeId, leadId: l.leadId, bookingId: l.bookingId, visaCaseId: l.visaCaseId, priority: st.dueInDays === 0 ? "high" : "normal" }, r.ctx.now);
    r.w.dirty("tasks");
    const who = (await ownerName(r.w, assigneeId)) || "unassigned";
    return done(st.kind, `Task "${clip(title, 70)}" for ${who}, due ${st.dueInDays > 0 ? formatDate(isoDate(due)) : "today"}`);
  },

  async assign_owner(r, st) {
    const users = await r.w.list("users");
    let target: User | undefined;
    if (st.userId) {
      target = users.find((u) => u.id === st.userId && u.active);
      if (!target) return { kind: st.kind, ok: false, outcome: "error", detail: "The person chosen in this step is no longer an active user" };
    } else {
      const current = r.subj.ownerId ? users.find((u) => u.id === r.subj.ownerId) : undefined;
      if (current?.active) return noop(st.kind, `already assigned to ${current.name}`);
      const byAge = (a: User, b: User) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
      let pool = users.filter((u) => u.active && u.role === "sales").sort(byAge);
      if (!pool.length) pool = users.filter((u) => u.active && (u.role === "owner" || u.role === "admin")).sort(byAge);
      if (!pool.length) return { kind: st.kind, ok: false, outcome: "error", detail: "There's nobody in the sales team to assign to" };
      target = pool[r.auto.runs % pool.length]!;
    }
    if (r.subj.ownerId === target.id) return noop(st.kind, `already assigned to ${target.name}`);
    const { s, ctx, subj } = r;
    if (subj.lead) subj.lead = await patchRow(s, "leads", subj.lead.id, { ownerId: target.id }, ctx.now);
    if (subj.quote) subj.quote = await patchRow(s, "quotes", subj.quote.id, { ownerId: target.id }, ctx.now);
    if (subj.booking && (subj.type === "booking" || subj.type === "invoice")) subj.booking = await patchRow(s, "bookings", subj.booking.id, { ownerId: target.id }, ctx.now);
    if (subj.visa) subj.visa = await patchRow(s, "visaCases", subj.visa.id, { assigneeId: target.id }, ctx.now);
    subj.ownerId = target.id;
    subj.facts.ownerId = target.id;
    r.w.dirty("leads", "quotes", "bookings", "visaCases");
    return done(st.kind, `Assigned to ${target.name}`);
  },

  async set_temperature(r, st) {
    const lead = r.subj.lead;
    if (!lead) return blocked(st.kind, `there's no lead behind this ${NOUN[r.subj.type]}`);
    const v = st.value as Lead["temperature"];
    if (!["hot", "warm", "cold"].includes(v)) return { kind: st.kind, ok: false, outcome: "error", detail: `"${st.value}" isn't hot, warm or cold` };
    if (lead.temperature === v) return noop(st.kind, `already ${v}`);
    r.subj.lead = await patchRow(r.s, "leads", lead.id, { temperature: v }, r.ctx.now);
    r.subj.facts.temperature = v;
    r.w.dirty("leads");
    return done(st.kind, `Marked ${v} (was ${lead.temperature})`);
  },

  async set_stage(r, st) {
    const lead = r.subj.lead;
    if (!lead) return blocked(st.kind, `there's no lead behind this ${NOUN[r.subj.type]}`);
    const to = st.value as LeadStage;
    if (!LEAD_STAGES.includes(to)) return { kind: st.kind, ok: false, outcome: "error", detail: `"${st.value}" isn't a lead stage` };
    if (to === "won") return blocked(st.kind, "a lead is marked won only when its quote is confirmed");
    if (lead.stage === to) return noop(st.kind, `already ${to}`);
    if (!canTransition(LEAD_FLOW, lead.stage, to)) {
      return blocked(st.kind, `a ${lead.stage} lead can't move to ${to} (allowed next: ${LEAD_FLOW[lead.stage].join(", ") || "none"})`);
    }
    r.subj.lead = await patchRow(r.s, "leads", lead.id, { stage: to, lostReason: to === "lost" ? st.title.trim() || `Closed by automation "${r.auto.name}"` : "" }, r.ctx.now);
    r.subj.facts.stage = to;
    if (r.subj.type === "lead") r.subj.facts.status = to;
    r.w.dirty("leads");
    return done(st.kind, `Moved the lead from ${lead.stage} to ${to}`);
  },

  async add_tag(r, st) {
    const tag = clip((await render(r, st.title || st.value)).trim(), 40);
    if (!tag) return blocked(st.kind, "no tag given");
    const contact = (r.subj.lead?.contactId ? await r.s.get("contacts", r.subj.lead.contactId) : undefined) ?? (await findContact(r.s, r.subj.phone, r.subj.email));
    if (!contact) return blocked(st.kind, "there's no customer record to tag");
    if (contact.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return noop(st.kind, `already tagged "${tag}"`);
    await patchRow(r.s, "contacts", contact.id, { tags: [...contact.tags, tag] }, r.ctx.now);
    r.w.dirty("contacts");
    return done(st.kind, `Tagged ${contact.name} "${tag}"`);
  },

  async notify_owner(r, st) {
    const text = await render(r, st.message);
    if (!text) return blocked(st.kind, "the alert is empty");
    const ownerId = r.subj.ownerId ?? (await firstUserWithRole(r.s, ["owner", "admin"]));
    if (!ownerId) return { kind: st.kind, ok: false, outcome: "error", detail: "There's nobody to notify" };
    const l = links(r.subj);
    await createRow(r.s, "tasks", { title: clip(text, 200), dueAt: new Date(r.ctx.now.getTime() + 3600_000).toISOString(), assigneeId: ownerId, leadId: l.leadId, bookingId: l.bookingId, visaCaseId: l.visaCaseId, priority: "high" }, r.ctx.now);
    r.w.dirty("tasks");
    return done(st.kind, `Alerted ${(await ownerName(r.w, ownerId)) || "the owner"}: "${clip(text, 90)}"`);
  },
};

function runStatus(outs: StepOut[]): AutomationRun["status"] {
  const did = outs.some((o) => o.outcome === "done");
  const hard = outs.some((o) => o.outcome === "error");
  const soft = outs.some((o) => o.outcome === "blocked");
  if (did) return hard || soft ? "partial" : "done";
  return hard ? "failed" : "skipped";
}

/** Run every step for one subject and record the run. Never throws for a step failure. */
async function execute(s: Store, ctx: Ctx, w: World, auto: Automation, ev: Ev, subj: Subject): Promise<AutomationRun> {
  const r: RunState = { s, ctx, w, settings: await w.settings(), auto, ev, subj };
  const outs: StepOut[] = [];
  for (const st of auto.steps) {
    try {
      outs.push(await STEPS[st.kind](r, st));
    } catch (e) {
      outs.push({ kind: st.kind, ok: false, outcome: "error", detail: errText(e) });
    }
  }
  return record(s, ctx, w, auto, ev, subj, outs, "");
}

async function record(s: Store, ctx: Ctx, w: World, auto: Automation, ev: Ev, subj: Pick<Subject, "type" | "id" | "name" | "lead" | "booking" | "visa"> | null, outs: StepOut[], error: string): Promise<AutomationRun> {
  const at = ctx.now.toISOString();
  const status = error ? "failed" : runStatus(outs);
  const run = await createRow(s, "automationRuns", {
    automationId: auto.id, automationName: auto.name, trigger: auto.trigger, subjectType: ev.subjectType, subjectId: ev.subjectId,
    subjectName: clip(subj?.name ?? "", 160), status, steps: outs.map((o) => ({ kind: o.kind, ok: o.ok, detail: clip(o.detail, 300) })),
    error: clip(error, 300), at, key: runKey(auto, ev),
  }, ctx.now);
  const saved = await patchRow(s, "automations", auto.id, { runs: auto.runs + 1, lastRunAt: at }, ctx.now);
  auto.runs = saved.runs;
  auto.lastRunAt = saved.lastRunAt;
  w.dirty("automationRuns");
  if (status !== "skipped" && subj && (subj.lead || subj.booking || subj.visa)) {
    const did = outs.filter((o) => o.outcome === "done").map((o) => o.detail);
    const failed = outs.filter((o) => o.outcome === "error" || o.outcome === "blocked").map((o) => o.detail);
    const body = `Automation "${auto.name}": ${[...did, ...failed.map((f) => `problem — ${f}`)].join("; ") || error}`;
    await log(s, ctx, { leadId: subj.lead?.id ?? null, bookingId: subj.lead ? null : subj.booking?.id ?? null, visaCaseId: subj.visa?.id ?? null, body: clip(body, 4000) });
  }
  return run;
}

/** Check idempotency and conditions, then run. Returns whether a run was recorded. */
async function maybeRun(s: Store, ctx: Ctx, w: World, auto: Automation, ev: Ev, keys: Set<string>): Promise<boolean> {
  const key = runKey(auto, ev);
  if (keys.has(key)) return false;
  const subj = await resolve(w, ev);
  if (!subj || !(await passes(w, subj, auto.conditions))) return false;
  keys.add(key);
  try {
    await execute(s, ctx, w, auto, ev, subj);
  } catch (e) {
    try { await record(s, ctx, w, auto, ev, subj, [], errText(e)); } catch { /* the user's action must not fail because of an automation */ }
  }
  return true;
}

/* ───────────────────────── entry points ───────────────────────── */

/** After-hook: run event automations for the rows the action just wrote. */
async function fireEvents(s: Store, ctx: Ctx, events: Ev[]): Promise<void> {
  const triggers = new Set(events.map((e) => e.trigger));
  const autos = (await s.list("automations")).filter((a) => a.active && triggers.has(a.trigger));
  if (!autos.length) return;
  const w = new World(s);
  const keys = new Set((await s.list("automationRuns")).map((r) => r.key));
  for (const ev of events) for (const a of autos) if (a.trigger === ev.trigger) await maybeRun(s, ctx, w, a, ev, keys);
}

registerAfterHook(async (s, ctx, _name, _input, _output, writes) => {
  if (!writes?.length) return;
  const events = eventsFromWrites(writes);
  if (!events.length) return;
  try {
    await fireEvents(s, ctx, events);
  } catch {
    /* never roll back the user's action because of an automation */
  }
});

/** Background work (called from runJobs): due time triggers, plus a 24-hour catch-up for event triggers. Returns runs recorded. */
export async function runAutomations(s: Store, ctx: Ctx): Promise<number> {
  const autos = (await s.list("automations")).filter((a) => a.active);
  if (!autos.length) return 0;
  const w = new World(s);
  const keys = new Set((await s.list("automationRuns")).map((r) => r.key));
  const since = new Date(ctx.now.getTime() - DAY).toISOString();
  let n = 0;
  for (const a of autos) {
    let evs: Ev[] = [];
    if (isTime(a.trigger)) evs = await dueEvents(w, a, ctx);
    else if (SWEEPABLE.includes(a.trigger)) {
      const from = a.createdAt > since ? a.createdAt : since;
      evs = (await recentEvents(w, a.trigger, from)).reverse();
    }
    for (const ev of evs) if (await maybeRun(s, ctx, w, a, ev, keys)) n++;
  }
  return n;
}

/* ───────────────────────── validation ───────────────────────── */

const draftInput = z.object({
  name: z.string().trim().min(1, "Give the automation a name").max(160),
  description: z.string().trim().max(300).default(""),
  trigger: z.enum(AUTOMATION_TRIGGERS, { errorMap: () => ({ message: "Choose what starts this automation" }) }),
  days: z.number().int().min(0, "Days can't be negative").max(365, "Use 365 days or fewer").default(0),
  conditions: schemas.automations.shape.conditions,
  steps: schemas.automations.shape.steps,
  active: z.boolean().default(true),
});
type Draft = z.output<typeof draftInput>;

const NUMERIC_FIELDS: readonly AutomationField[] = ["score", "budget", "amount", "pax"];
const STAFF = new Set(["owner", "admin", "sales", "ops", "accounts", "visa", "marketing"]);

async function validateDraft(s: Store, d: Draft): Promise<Draft> {
  const fields: Record<string, string> = {};
  const bad = (k: string, m: string) => { fields[k] ??= m; };
  if (isTime(d.trigger)) {
    const min = d.trigger === "lead_idle" || d.trigger === "quote_idle" ? 1 : 0;
    if (d.days < min) {
      bad("days", d.trigger === "lead_idle" ? "Enter after how many quiet days (1 or more) this should run."
        : "Enter after how many days without an answer (1 or more) this should run.");
    }
  }
  d.conditions.forEach((c, i) => {
    if ((NUMERIC_FIELDS.includes(c.field) || c.op === "gte" || c.op === "lte") && Number.isNaN(Number(c.value))) {
      bad(`conditions.${i}.value`, `Condition ${i + 1}: "${c.field}" needs a number${c.field === "budget" || c.field === "amount" ? " (in paise)" : ""}.`);
    }
    if ((c.op === "gte" || c.op === "lte") && !NUMERIC_FIELDS.includes(c.field)) bad(`conditions.${i}.op`, `Condition ${i + 1}: "at least / at most" only works for score, budget, amount and travellers.`);
  });
  const users = (await s.list("users")).filter((u) => u.active && STAFF.has(u.role));
  d.steps.forEach((st, i) => {
    const n = `Action ${i + 1}`;
    if (st.kind === "send_payment_link" && !PAYMENT_LINK_TRIGGERS.includes(d.trigger)) {
      bad(`steps.${i}.kind`, `${n}: payment links need a booking or invoice to collect for — use them with "Quote accepted", "Booking confirmed", "Trip coming up" or "Payment overdue".`);
    }
    if ((st.kind === "send_message" || st.kind === "notify_owner") && !st.message.trim()) bad(`steps.${i}.message`, `${n}: write the message.`);
    if (st.kind === "create_task" && !st.title.trim()) bad(`steps.${i}.title`, `${n}: give the task a title.`);
    if (st.kind === "add_tag" && !st.title.trim() && !st.value.trim()) bad(`steps.${i}.title`, `${n}: type the tag to add.`);
    if (st.kind === "set_stage") {
      if (!LEAD_STAGES.includes(st.value as LeadStage)) bad(`steps.${i}.value`, `${n}: pick a stage (new, contacted, quoted, negotiation or lost).`);
      else if (st.value === "won") bad(`steps.${i}.value`, `${n}: a lead is marked won automatically when its quote is confirmed, so an automation can't set it.`);
    }
    if (st.kind === "set_temperature" && !["hot", "warm", "cold"].includes(st.value)) bad(`steps.${i}.value`, `${n}: pick hot, warm or cold.`);
    if ((st.kind === "assign_owner" || st.kind === "create_task") && st.userId && !users.some((u) => u.id === st.userId)) {
      bad(`steps.${i}.userId`, `${n}: that person isn't an active team member. Pick someone else${st.kind === "assign_owner" ? " or share leads round-robin" : ""}.`);
    }
  });
  const first = Object.values(fields)[0];
  if (first) throw new DomainError(first, 422, fields);
  return { ...d, days: isTime(d.trigger) ? d.days : 0 };
}

function parseDraft(raw: unknown): Draft {
  const p = draftInput.safeParse(raw);
  if (!p.success) {
    const f: Record<string, string> = {};
    for (const iss of p.error.issues) f[iss.path.join(".") || "_"] ??= iss.message;
    const [k, m] = Object.entries(f)[0]!;
    throw new DomainError(k === "_" || k === "name" || k === "trigger" ? m : `${k.replace(/^steps\.(\d+)/, (_x, i) => `Action ${Number(i) + 1}`).replace(/^conditions\.(\d+)/, (_x, i) => `Condition ${Number(i) + 1}`)}: ${m}`, 422, f);
  }
  return p.data;
}

/* ───────────────────────── dry run ───────────────────────── */

async function previewStep(r: RunState, st: Step): Promise<string> {
  const s = r.subj;
  switch (st.kind) {
    case "send_message": {
      const t = pickChannel(st.channel, s.phone, s.email);
      const body = await render(r, st.message);
      return t ? `${CH[t.channel]} to ${s.name} (${t.to}): "${body}"` : `${CH[st.channel]} to ${s.name}: skipped — no phone or email on file`;
    }
    case "send_payment_link": {
      const inv = s.invoice;
      if (!inv) return `Payment link: skipped — no invoice for this ${NOUN[s.type]} yet`;
      const due = outstandingOf(inv);
      if (due <= 0) return `Payment link: skipped — nothing is due on ${inv.number}`;
      if (providersFor(r.ctx).payments.name === "none") return `Payment link for ${rupees(due)}: skipped — no payment gateway connected`;
      const body = st.message.trim() ? await render({ ...r, payUrl: "[payment link]", payAmount: due }, st.message) : T.paymentReminder(firstName(s.name), inv.number, due, inv.dueDate, "[payment link]");
      return `Payment link for ${rupees(due)} on ${inv.number} by ${CH[st.channel]}: "${body}"`;
    }
    case "create_task": {
      const who = (await ownerName(r.w, st.userId ?? s.ownerId)) || "the record owner";
      return `Task for ${who}: "${await render(r, st.title)}" (due ${st.dueInDays > 0 ? `in ${st.dueInDays} day${st.dueInDays === 1 ? "" : "s"}` : "today"})`;
    }
    case "assign_owner": {
      if (st.userId) return `Assign to ${(await ownerName(r.w, st.userId)) || "the chosen person"}`;
      const cur = s.ownerId ? (await r.w.list("users")).find((u) => u.id === s.ownerId) : undefined;
      return cur?.active ? `Keep with ${cur.name} (already assigned)` : "Assign round-robin to the next person in the sales team";
    }
    case "set_temperature": return s.lead ? `Mark the lead ${st.value} (now ${s.lead.temperature})` : "Mark the lead: skipped — no lead behind this record";
    case "set_stage": {
      if (!s.lead) return "Move the lead: skipped — no lead behind this record";
      const to = st.value as LeadStage;
      if (s.lead.stage === to) return `Move the lead: already ${to}`;
      return canTransition(LEAD_FLOW, s.lead.stage, to) && to !== "won" ? `Move the lead from ${s.lead.stage} to ${to}` : `Move the lead to ${to}: skipped — a ${s.lead.stage} lead can't move there`;
    }
    case "add_tag": return `Tag ${s.name || "the customer"} "${await render(r, st.title || st.value)}"`;
    case "notify_owner": return `Alert ${(await ownerName(r.w, s.ownerId)) || "the owner"}: "${await render(r, st.message)}"`;
  }
}

function genericPreview(st: Step): string {
  switch (st.kind) {
    case "send_message": return `${CH[st.channel]}: "${st.message}"`;
    case "send_payment_link": return `Payment link for the balance by ${CH[st.channel]}${st.message ? `: "${st.message}"` : ""}`;
    case "create_task": return `Task: "${st.title}" (due ${st.dueInDays > 0 ? `in ${st.dueInDays} days` : "today"})`;
    case "assign_owner": return st.userId ? "Assign to the chosen person" : "Assign round-robin to the sales team (only if unassigned)";
    case "set_temperature": return `Mark the lead ${st.value}`;
    case "set_stage": return `Move the lead to ${st.value}`;
    case "add_tag": return `Tag the customer "${st.title || st.value}"`;
    case "notify_owner": return `Alert the owner: "${st.message}"`;
  }
}

async function dryRun(s: Store, ctx: Ctx, auto: Automation): Promise<AutomationTestResult> {
  const w = new World(s);
  const time = isTime(auto.trigger);
  const evs = time ? await dueEvents(w, auto, ctx) : await recentEvents(w, auto.trigger, new Date(ctx.now.getTime() - 30 * DAY).toISOString());
  const runs = (await w.list("automationRuns")).filter((r) => r.automationId === auto.id);
  const keys = new Set(runs.map((r) => r.key));
  const matched: { ev: Ev; subj: Subject; alreadyRan: boolean }[] = [];
  for (const ev of evs) {
    const subj = await resolve(w, ev);
    if (!subj || !(await passes(w, subj, auto.conditions))) continue;
    const alreadyRan = time ? keys.has(runKey(auto, ev)) : runs.some((r) => r.subjectId === ev.subjectId && r.trigger === ev.trigger && (ev.trigger !== "payment_received" || r.key === runKey(auto, ev)));
    matched.push({ ev, subj, alreadyRan });
  }
  const settings = await w.settings();
  const first = matched.find((m) => !m.alreadyRan) ?? matched[0];
  const preview = first
    ? await Promise.all(auto.steps.map(async (st) => ({ kind: st.kind, summary: await previewStep({ s, ctx, w, settings, auto, ev: first.ev, subj: first.subj }, st) })))
    : auto.steps.map((st) => ({ kind: st.kind, summary: genericPreview(st) }));
  const warnings: string[] = [];
  if (!auto.active) warnings.push("This automation is paused — it won't run until you switch it on.");
  if (!matched.length) warnings.push(time ? "Nobody matches right now." : "Nothing in the last 30 days would have matched.");
  if (!time && matched.length) warnings.push("This runs on new events only. These matches are from the last 30 days, to show who it would have caught.");
  const pending = matched.filter((m) => !m.alreadyRan);
  const sendSteps = auto.steps.filter((st) => st.kind === "send_message" || st.kind === "send_payment_link");
  if (sendSteps.length && pending.length) {
    const unreachable = pending.filter((m) => !pickChannel(sendSteps[0]!.channel, m.subj.phone, m.subj.email)).length;
    const noPhone = pending.filter((m) => !m.subj.phone).length;
    if (unreachable) warnings.push(`${unreachable} of ${pending.length} match${pending.length === 1 ? "" : "es"} have no phone or email — messages will be skipped for them.`);
    else if (noPhone && sendSteps.some((st) => st.channel !== "email")) warnings.push(`${noPhone} match${noPhone === 1 ? " has" : "es have"} no phone number — ${noPhone === 1 ? "it" : "they"} will get an email instead of ${CH[sendSteps[0]!.channel]}.`);
  }
  if (auto.steps.some((st) => st.kind === "send_payment_link") && providersFor(ctx).payments.name === "none") {
    warnings.push("No payment gateway is connected, so payment links will be skipped. Connect Razorpay, Stripe or PayPal in Settings → Integrations.");
  }
  if (auto.trigger === "visa_status_changed" && auto.steps.some((st) => st.kind === "set_stage" || st.kind === "set_temperature")) {
    warnings.push("Visa cases have no lead, so \"Move the lead\" and \"Mark the lead\" will be skipped.");
  }
  const ran = matched.length - pending.length;
  if (ran) warnings.push(`${ran} of these ${ran === 1 ? "has" : "have"} already been handled by this automation and won't run again.`);
  if (matched.length > 50) warnings.push(`Showing the first 50 of ${matched.length} matches.`);
  return {
    trigger: auto.trigger,
    matches: matched.slice(0, 50).map((m) => ({ subjectType: m.ev.subjectType, subjectId: m.ev.subjectId, name: m.subj.name, reason: m.ev.reason, alreadyRan: m.alreadyRan })),
    preview,
    warnings,
  };
}

/* ───────────────────────── actions ───────────────────────── */

const MANAGERS = ["owner", "admin", "marketing"] as const;
registerActionRoles({
  saveAutomation: [...MANAGERS], toggleAutomation: [...MANAGERS], deleteAutomation: [...MANAGERS], installAutomation: [...MANAGERS],
  runAutomationNow: [...MANAGERS], testAutomation: [...MANAGERS, "sales"],
});

function templateAutomation(t: AutomationTemplate): Draft {
  return { ...t.automation, description: t.automation.description ?? "", days: t.automation.days ?? 0, conditions: t.automation.conditions ?? [], steps: t.automation.steps, active: true };
}

registerActions({
  saveAutomation: action(draftInput.extend({ id: z.string().min(1).optional() }), async (s, ctx, i) => {
    const { id, ...raw } = i;
    const d = await validateDraft(s, raw);
    if (id) {
      await mustGet(s, "automations", id);
      return patchRow(s, "automations", id, d, ctx.now);
    }
    return createRow(s, "automations", { ...d, runs: 0, lastRunAt: null, template: "" }, ctx.now);
  }),

  toggleAutomation: action(z.object({ automationId: z.string().min(1), active: z.boolean() }), async (s, ctx, i) => {
    await mustGet(s, "automations", i.automationId);
    return patchRow(s, "automations", i.automationId, { active: i.active }, ctx.now);
  }),

  deleteAutomation: action(z.object({ automationId: z.string().min(1) }), async (s, _ctx, i) => {
    await mustGet(s, "automations", i.automationId);
    await s.remove("automations", i.automationId);
    return { ok: true, deleted: i.automationId };
  }),

  installAutomation: action(z.object({ templateKey: z.string().min(1).max(60), active: z.boolean().default(true) }), async (s, ctx, i) => {
    const t = AUTOMATION_TEMPLATES.find((x) => x.key === i.templateKey);
    if (!t) throw new DomainError(`There's no recipe called "${i.templateKey}".`, 404);
    const existing = (await s.list("automations")).find((a) => a.template === t.key);
    if (existing) throw new DomainError(`This recipe is already installed as "${existing.name}". Edit that one instead.`, 409, { automationId: existing.id });
    const d = templateAutomation(t);
    const roles = TEMPLATE_ASSIGNEE_ROLES[t.key];
    if (roles) {
      for (const [idx, rs] of Object.entries(roles)) {
        const st = d.steps[Number(idx)];
        if (st && !st.userId) st.userId = await firstUserWithRole(s, rs);
      }
    }
    const valid = await validateDraft(s, d);
    return createRow(s, "automations", { ...valid, active: i.active, template: t.key, runs: 0, lastRunAt: null }, ctx.now);
  }),

  testAutomation: action(z.object({ automationId: z.string().min(1).optional(), draft: z.unknown().optional() }), async (s, ctx, i) => {
    let auto: Automation;
    if (i.automationId) auto = await mustGet(s, "automations", i.automationId);
    else if (i.draft !== undefined) {
      const d = parseDraft(i.draft);
      const id = (i.draft as { id?: unknown }).id;
      const saved = typeof id === "string" ? await s.get("automations", id) : undefined;
      const valid = await validateDraft(s, d);
      auto = { ...valid, id: saved?.id ?? "draft", template: saved?.template ?? "", runs: saved?.runs ?? 0, lastRunAt: saved?.lastRunAt ?? null, createdAt: saved?.createdAt ?? ctx.now.toISOString(), updatedAt: ctx.now.toISOString() };
    } else throw new DomainError("Pick an automation to test, or send the draft.", 422);
    return dryRun(s, ctx, auto);
  }),

  runAutomationNow: action(z.object({ automationId: z.string().min(1) }), async (s, ctx, i) => {
    const auto = await mustGet(s, "automations", i.automationId);
    if (!isTime(auto.trigger)) throw new DomainError(`This runs by itself whenever ${WHENEVER[auto.trigger]}.`, 422);
    const w = new World(s);
    const keys = new Set((await s.list("automationRuns")).map((r) => r.key));
    const evs = await dueEvents(w, auto, ctx);
    let ran = 0;
    for (const ev of evs) if (await maybeRun(s, ctx, w, auto, ev, keys)) ran++;
    return { ran, skipped: evs.length - ran };
  }),
});

/* ───────────────────────── marketing funnel ───────────────────────── */

const RANGE_DAYS = [7, 30, 90, 365] as const;

function monthDays(month: string): number {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Spend in a month pro-rated by the days it overlaps [from, to]. */
export function proratedSpend(month: string, amount: number, from: ISODate, to: ISODate): number {
  const len = monthDays(month);
  const start = `${month}-01`, end = `${month}-${String(len).padStart(2, "0")}`;
  const a = start > from ? start : from, b = end < to ? end : to;
  if (a > b) return 0;
  return Math.round((amount * (daysBetween(a, b) + 1)) / len);
}

function mondayOf(d: ISODate): ISODate {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  return addDays(d, -((dow + 6) % 7));
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const v = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return Math.round(v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2);
};

const LOST_BUCKETS: [RegExp, string][] = [
  [/elsewhere|competitor|another (agent|agency|company)|other (agent|agency)|went with|booked with|cheaper (agent|online)|makemytrip|online/i, "Booked elsewhere"],
  [/price|expensive|budget|costly|cost|rate|cheap/i, "Price too high"],
  [/postpone|later|next year|next month|not now|cancel|dates? (changed|moved)|not travel/i, "Plans postponed"],
  [/no (response|reply|answer)|not (responding|reachable|picking)|unreachable|ghost|switched off/i, "No response"],
  [/visa/i, "Visa issue"],
  [/availability|sold out|no rooms|full|flight/i, "No availability"],
];

export function normaliseLostReason(r: string): string {
  const t = r.trim();
  if (!t) return "Not specified";
  const hit = LOST_BUCKETS.find(([re]) => re.test(t));
  if (hit) return hit[1];
  return t.charAt(0).toUpperCase() + t.slice(1, 60);
}

async function marketingFunnel(s: Store, ctx: Ctx, p: { days: number }): Promise<MarketingFunnel> {
  const settings = await readSettings(s);
  const tz = settings.timezone;
  const days = p.days;
  const to = todayOf(ctx, settings);
  const from = addDays(to, -(days - 1));
  const prevTo = addDays(from, -1), prevFrom = addDays(from, -days);
  const [leads, quotes, bookings, activities, outbox, spendRows, landing, autos, runs, messages] = await Promise.all([
    s.list("leads"), s.list("quotes"), s.list("bookings"), s.list("activities"), s.list("outbox"), s.list("channelSpend"), s.list("landingPages"),
    s.list("automations"), s.list("automationRuns"), s.list("messages"),
  ]);
  const dayOf = (iso: string) => isoDate(new Date(iso), tz);
  const quoted = new Set(quotes.map((q) => q.leadId).filter(Boolean) as string[]);
  const outbound = new Set<string>();
  const firstTouch = new Map<string, number>();
  const touch = (leadId: string | null, at: string) => {
    if (!leadId) return;
    const t = Date.parse(at);
    const cur = firstTouch.get(leadId);
    if (cur === undefined || t < cur) firstTouch.set(leadId, t);
  };
  for (const a of activities) if (a.leadId && a.direction === "out" && a.kind !== "system") { outbound.add(a.leadId); touch(a.leadId, a.at); }
  for (const o of outbox) if (o.leadId && o.kind !== "otp") touch(o.leadId, o.createdAt);
  const liveBookings = bookings.filter((b) => b.status !== "cancelled");
  const revenueOf = (l: Lead) => {
    const bs = liveBookings.filter((b) => b.id === l.bookingId || b.leadId === l.id);
    return bs.reduce((a, b) => a + b.sellTotal, 0);
  };
  type Flags = { lead: Lead; day: ISODate; contacted: boolean; quoted: boolean; won: boolean; lost: boolean; revenue: number; responseMins: number | null };
  const flag = (l: Lead): Flags => {
    const won = l.stage === "won" || Boolean(l.bookingId);
    const q = won || ["quoted", "negotiation", "won"].includes(l.stage) || quoted.has(l.id);
    const c = q || l.stage !== "new" || outbound.has(l.id);
    const created = Date.parse(l.createdAt);
    const ft = firstTouch.get(l.id);
    return { lead: l, day: dayOf(l.createdAt), contacted: c, quoted: q, won, lost: l.stage === "lost", revenue: won ? revenueOf(l) : 0, responseMins: ft !== undefined && ft >= created ? Math.max(0, Math.round((ft - created) / 60_000)) : null };
  };
  const all = leads.map(flag);
  const cur = all.filter((f) => f.day >= from && f.day <= to);
  const prev = all.filter((f) => f.day >= prevFrom && f.day <= prevTo);
  const sum = (xs: Flags[], fn: (f: Flags) => number) => xs.reduce((a, f) => a + fn(f), 0);
  const budget = (f: Flags) => f.lead.budget ?? 0;

  // Spend per channel, pro-rated to the range
  const spendBy = new Map<LeadSource, number>();
  for (const r of spendRows) spendBy.set(r.source, (spendBy.get(r.source) ?? 0) + proratedSpend(r.month, r.amount, from, to));
  const ratio = (a: number, b: number) => (b > 0 ? Math.round(a / b) : null);
  const roi = (rev: number, spend: number) => (spend > 0 ? Math.round(((rev - spend) / spend) * 100) : null);

  const sources = LEAD_SOURCES.filter((src) => cur.some((f) => f.lead.source === src) || prev.some((f) => f.lead.source === src) || (spendBy.get(src) ?? 0) > 0);
  const channels: ChannelRow[] = sources.map((src) => {
    const xs = cur.filter((f) => f.lead.source === src);
    const won = xs.filter((f) => f.won).length;
    const revenue = sum(xs, (f) => f.revenue);
    const spend = spendBy.get(src) ?? 0;
    return {
      source: src, label: SOURCE_LABEL[src], leads: xs.length, contacted: xs.filter((f) => f.contacted).length, quoted: xs.filter((f) => f.quoted).length,
      won, lost: xs.filter((f) => f.lost).length, revenue, spend,
      cpl: spend > 0 && xs.length ? ratio(spend, xs.length) : null, cac: spend > 0 && won ? ratio(spend, won) : null, roiPct: roi(revenue, spend),
      conversionBps: xs.length ? Math.round((won / xs.length) * 10_000) : 0,
      responseMins: median(xs.map((f) => f.responseMins).filter((m): m is number => m !== null)),
      prevLeads: prev.filter((f) => f.lead.source === src).length,
    };
  }).sort((a, b) => b.leads - a.leads || b.spend - a.spend);

  const won = cur.filter((f) => f.won);
  const revenue = sum(won, (f) => f.revenue);
  const spend = channels.reduce((a, c) => a + c.spend, 0);
  const withRevenue = won.filter((f) => f.revenue > 0);
  const winDays = won.map((f) => {
    const b = liveBookings.find((x) => x.id === f.lead.bookingId || x.leadId === f.lead.id);
    return b ? Math.max(0, daysBetween(f.day, dayOf(b.createdAt))) : null;
  }).filter((d): d is number => d !== null);

  const stages: FunnelStage[] = [
    { key: "leads", label: "Enquiries", count: cur.length, value: sum(cur, budget) },
    { key: "contacted", label: "Contacted", count: cur.filter((f) => f.contacted).length, value: sum(cur.filter((f) => f.contacted), budget) },
    { key: "quoted", label: "Quoted", count: cur.filter((f) => f.quoted).length, value: sum(cur.filter((f) => f.quoted), budget) },
    { key: "won", label: "Booked", count: won.length, value: revenue },
  ];

  const weekly: MarketingFunnel["weekly"] = [];
  for (let wk = mondayOf(from); wk <= to; wk = addDays(wk, 7)) {
    const xs = cur.filter((f) => f.day >= wk && f.day <= addDays(wk, 6));
    weekly.push({ week: wk, leads: xs.length, won: xs.filter((f) => f.won).length, revenue: sum(xs.filter((f) => f.won), (f) => f.revenue) });
  }

  const roiRows = await campaignRoi(s);
  const camps = await s.list("campaigns");
  const campaigns: MarketingFunnel["campaigns"] = roiRows.map((c) => ({
    id: c.id, name: c.name, channel: c.channel, status: c.status, sent: c.sent, delivered: c.delivered, read: c.read, leads: c.leads, bookings: c.bookings,
    revenue: c.revenue, cost: c.cost, roiPct: c.roi, scheduledAt: camps.find((x) => x.id === c.id)?.scheduledAt ?? null,
  })).sort((a, b) => (b.scheduledAt ?? "").localeCompare(a.scheduledAt ?? ""));

  const landingPages: MarketingFunnel["landingPages"] = landing.map((lp) => {
    const tag = new RegExp(`landing page:\\s*${lp.slug}\\b`, "i");
    const tiedAll = all.filter((f) => tag.test(f.lead.notes));
    const tied = tiedAll.filter((f) => f.day >= from && f.day <= to);
    return tiedAll.length
      ? { id: lp.id, title: lp.title, slug: lp.slug, published: lp.published, leads: tied.length, won: tied.filter((f) => f.won).length, revenue: sum(tied.filter((f) => f.won), (f) => f.revenue) }
      : { id: lp.id, title: lp.title, slug: lp.slug, published: lp.published, leads: lp.leads, won: 0, revenue: 0 };
  });

  const reasons = new Map<string, number>();
  for (const f of cur.filter((x) => x.lost)) {
    const r = normaliseLostReason(f.lead.lostReason);
    reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  const lostReasons = [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));

  const since30 = new Date(ctx.now.getTime() - 30 * DAY).toISOString();
  const runs30 = runs.filter((r) => r.at >= since30);
  const automation = {
    active: autos.filter((a) => a.active).length, total: autos.length, runs30d: runs30.length,
    messages30d: runs30.reduce((a, r) => a + r.steps.filter((st) => st.ok && (st.kind === "send_message" || st.kind === "send_payment_link") && !st.detail.startsWith("Skipped")).length, 0),
    failed30d: runs30.filter((r) => r.status === "failed" || r.status === "partial").length,
  };
  const best = bestSendHour(messages.filter((m) => m.direction === "in"));

  const totals: MarketingFunnel["totals"] = {
    leads: cur.length, prevLeads: prev.length, won: won.length, prevWon: prev.filter((f) => f.won).length, revenue, prevRevenue: sum(prev.filter((f) => f.won), (f) => f.revenue),
    spend, cpl: spend > 0 && cur.length ? ratio(spend, cur.length) : null, cac: spend > 0 && won.length ? ratio(spend, won.length) : null, roiPct: roi(revenue, spend),
    conversionBps: cur.length ? Math.round((won.length / cur.length) * 10_000) : 0,
    avgDealSize: withRevenue.length ? Math.round(sum(withRevenue, (f) => f.revenue) / withRevenue.length) : null,
    avgDaysToWin: winDays.length ? Math.round(winDays.reduce((a, b) => a + b, 0) / winDays.length) : null,
    pipelineValue: sum(cur.filter((f) => OPEN_LEAD(f.lead)), budget),
  };

  const instantReply = autos.some((a) => a.active && a.trigger === "lead_created" && a.steps.some((st) => st.kind === "send_message"));
  const insights = funnelInsights({ days, cur, channels, totals, lostReasons, automation, quotes, now: ctx.now.getTime(), instantReply });
  return { range: { from, to, days }, totals, stages, channels, weekly, campaigns, landingPages, lostReasons, automation, bestSendHour: { hour: best.hour, sample: best.sample }, insights };
}

function funnelInsights(d: {
  days: number; cur: { lead: Lead; won: boolean; responseMins: number | null }[]; channels: ChannelRow[]; totals: MarketingFunnel["totals"];
  lostReasons: MarketingFunnel["lostReasons"]; automation: MarketingFunnel["automation"]; quotes: Quote[]; now: number; instantReply: boolean;
}): MarketingFunnel["insights"] {
  type Insight = MarketingFunnel["insights"][number] & { weight: number };
  const out: Insight[] = [];
  const money = (p: number) => rupees(Math.round(p / 100) * 100);
  const period = d.days === 7 ? "this week" : d.days === 365 ? "this year" : `in the last ${d.days} days`;
  const paid = d.channels.filter((c) => c.spend > 0 && c.leads >= 3 && c.cpl !== null);

  // 1. Cost per lead gap between paid channels
  if (paid.length >= 2) {
    const sorted = [...paid].sort((a, b) => a.cpl! - b.cpl!);
    const cheap = sorted[0]!, dear = sorted[sorted.length - 1]!;
    if (dear.cpl! >= cheap.cpl! * 1.5) {
      out.push({ weight: 90, tone: "warn", text: `${dear.label} cost ${money(dear.cpl!)} per lead vs ${money(cheap.cpl!)} on ${cheap.label} ${period} — shift some budget to ${cheap.label}.`, to: "/app/marketing?tab=spend" });
    }
  }
  // 2. Slow first replies
  const twoHours = 120;
  const slow = d.cur.filter((f) => (f.responseMins !== null && f.responseMins > twoHours) || (f.responseMins === null && f.lead.stage === "new" && d.now - Date.parse(f.lead.createdAt) > twoHours * 60_000));
  if (slow.length >= 2) {
    out.push({ weight: 85 + Math.min(10, slow.length), tone: "warn", text: `${slow.length} lead${slow.length === 1 ? "" : "s"} waited over 2 hours for a first reply ${period}.${d.instantReply ? " Automatic replies are on, but a person still needs to call them sooner." : " An instant WhatsApp reply automation fixes this."}`, to: "/app/automations" });
  }
  // 3. Under-funded high converter
  const totalSpend = d.channels.reduce((a, c) => a + c.spend, 0);
  const avgConv = d.totals.conversionBps;
  if (avgConv > 0 && totalSpend > 0) {
    const star = d.channels.filter((c) => c.spend > 0 && c.leads >= 3 && c.conversionBps >= avgConv * 1.8 && c.spend / totalSpend < 0.15 && ["meta_ads", "google_ads", "instagram", "landing_page", "email", "website"].includes(c.source))
      .sort((a, b) => b.conversionBps - a.conversionBps)[0];
    if (star) {
      const x = Math.round((star.conversionBps / avgConv) * 10) / 10;
      out.push({ weight: 80, tone: "good", text: `${star.label} converts ${x}× better than average but gets only ${Math.round((star.spend / totalSpend) * 100)}% of spend — give it more budget.`, to: "/app/marketing?tab=spend" });
    }
  }
  // 4. Channels losing money
  const losing = d.channels.filter((c) => c.spend >= 500_000 && c.roiPct !== null && c.roiPct < 0).sort((a, b) => a.roiPct! - b.roiPct!)[0];
  if (losing) {
    out.push({ weight: 78, tone: "warn", text: `${losing.label}: ${money(losing.spend)} spent but only ${money(losing.revenue)} booked ${period}. Check the ad targeting or the follow-up on these leads.`, to: `/app/leads?source=${losing.source}` });
  }
  // 5. Quotes waiting
  const stale = d.quotes.filter((q) => (q.status === "sent" || q.status === "viewed") && d.now - Date.parse(q.updatedAt) > 3 * DAY);
  if (stale.length >= 2) {
    out.push({ weight: 75, tone: "warn", text: `${stale.length} quotes worth ${money(stale.reduce((a, q) => a + q.total, 0))} have had no answer for 3+ days. A follow-up automation would chase them.`, to: "/app/leads?stage=quoted" });
  }
  // 6. Main reason for losing
  const lostTotal = d.lostReasons.reduce((a, r) => a + r.count, 0);
  const top = d.lostReasons[0];
  if (top && lostTotal >= 3 && top.count / lostTotal >= 0.3 && top.reason !== "Not specified") {
    const tip = top.reason === "Price too high" ? " — offer a budget option alongside each quote" : top.reason === "No response" ? " — follow up faster and on WhatsApp" : top.reason === "Booked elsewhere" ? " — call back sooner after sending quotes" : "";
    out.push({ weight: 70, tone: "info", text: `"${top.reason}" is why ${Math.round((top.count / lostTotal) * 100)}% of lost leads walked away ${period}${tip}.`, to: "/app/leads?stage=lost" });
  }
  // 7. Lead volume trend
  if (d.totals.prevLeads >= 10) {
    const change = Math.round(((d.totals.leads - d.totals.prevLeads) / d.totals.prevLeads) * 100);
    if (Math.abs(change) >= 20) {
      out.push({ weight: 60, tone: change > 0 ? "good" : "warn", text: `Enquiries are ${change > 0 ? "up" : "down"} ${Math.abs(change)}% on the previous ${d.days} days (${d.totals.leads} vs ${d.totals.prevLeads}).`, to: "/app/leads" });
    }
  }
  // 8. Best revenue channel
  const bestRev = [...d.channels].filter((c) => c.revenue > 0).sort((a, b) => b.revenue - a.revenue)[0];
  if (bestRev && d.totals.revenue > 0 && bestRev.revenue / d.totals.revenue >= 0.25) {
    const ask = bestRev.source === "referral" || bestRev.source === "repeat" ? " Ask happy customers for more referrals." : "";
    out.push({ weight: 55, tone: "good", text: `${bestRev.label} brought ${money(bestRev.revenue)} from ${bestRev.won} booking${bestRev.won === 1 ? "" : "s"} — ${Math.round((bestRev.revenue / d.totals.revenue) * 100)}% of booked revenue ${period}.${ask}`, to: `/app/leads?source=${bestRev.source}` });
  }
  // 9. Automations
  if (d.automation.failed30d > 0) out.push({ weight: 65, tone: "warn", text: `${d.automation.failed30d} automation run${d.automation.failed30d === 1 ? "" : "s"} had a problem in the last 30 days — check the run history.`, to: "/app/automations" });
  else if (d.automation.active === 0) out.push({ weight: 50, tone: "info", text: "No automations are switched on. Start with \"Instant reply to every new enquiry\" and \"Follow up quotes that get no answer\".", to: "/app/automations" });
  return out.sort((a, b) => b.weight - a.weight).slice(0, 5).map(({ weight: _w, ...i }) => i);
}

/* ───────────────────────── audience preview ───────────────────────── */

/** Indicative SMS cost per message (DLT route), in paise. */
export const SMS_COST = 20;

async function audiencePreview(s: Store, p: { segmentId?: string | null; rules?: Entity<"segments">["rules"]; channel: Channel }): Promise<AudiencePreview> {
  const contacts = p.rules
    ? filterAudience(await s.list("contacts"), await s.list("leads"), p.rules)
    : (await segmentAudience(s, p.segmentId ?? null)) as Entity<"contacts">[];
  const reach = contacts.filter((c) => (p.channel === "email" ? c.email : c.phone));
  const sample = [...contacts].sort((a, b) => b.trips - a.trips || b.totalSpend - a.totalSpend || a.name.localeCompare(b.name)).slice(0, 8)
    .map((c) => ({ id: c.id, name: c.name, city: c.city, phone: c.phone, email: c.email, trips: c.trips, totalSpend: c.totalSpend }));
  const rate = p.channel === "whatsapp" ? WHATSAPP_MARKETING_COST : p.channel === "sms" ? SMS_COST : 0;
  return { count: contacts.length, reachable: reach.length, sample, estCost: reach.length * rate };
}

/* ───────────────────────── reports ───────────────────────── */

registerReports({
  automationTemplates: {
    params: z.object({}).passthrough(), roles: ["owner", "admin", "marketing", "sales", "accounts"],
    run: (async () => AUTOMATION_TEMPLATES) as never,
  },
  marketingFunnel: {
    params: z.object({ days: z.coerce.number().int().refine((n) => (RANGE_DAYS as readonly number[]).includes(n), "Use 7, 30, 90 or 365 days").default(30) }).passthrough(),
    roles: ["owner", "admin", "marketing"],
    run: ((s: Store, ctx: Ctx, p: { days: number }) => marketingFunnel(s, ctx, p)) as never,
  },
  audiencePreview: {
    params: z.object({ segmentId: z.string().nullable().optional(), rules: schemas.segments.shape.rules.removeDefault().optional(), channel: z.enum(["whatsapp", "email", "sms"]).default("whatsapp") }),
    roles: ["owner", "admin", "marketing"],
    run: ((s: Store, _ctx: Ctx, p: { segmentId?: string | null; rules?: Entity<"segments">["rules"]; channel: Channel }) => audiencePreview(s, p)) as never,
  },
});

export { AUTOMATION_TEMPLATES, marketingFunnel, audiencePreview };
