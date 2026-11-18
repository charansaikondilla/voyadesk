import { z } from "zod";
import {
  formatZodError, paxSchema, priceLine, schemas, type Agent, type Collection, type Entity, type Invoice, type Lead,
  type Package, type Quote, type Settings,
} from "./entities.js";
import { addDays, financialYear, isValidISODate, type ISODate } from "./dates.js";
import { docNumber, newId, randomToken } from "./ids.js";
import {
  accountBalance, buildTxn, creditNoteLegs, invoiceLegs, paymentLegs, refundLegs, supplierBillLegs,
  supplierPaymentLegs, walletTopUpLegs, type Leg, type LedgerEntry, type PartyRef,
} from "./ledger.js";
import { allocate, applyBps, type Minor } from "./money.js";
import { parseMrz } from "./mrz.js";
import { parseEnquiry } from "./parser.js";
import { canRunAction } from "./permissions.js";
import { providersFor } from "./providers.js";
import { emptyLine, payingPaxOf, priceQuote, type PriceLine, type PricingInput, type PricingResult } from "./pricing.js";
import {
  assertTransition, BOOKING_FLOW, DomainError, findConflicts, LEAD_FLOW, LEAD_SOURCES, QUOTE_FLOW, scoreLead,
  SERVICE_FLOW, VISA_FLOW, type LeadStage,
} from "./rules.js";
import { createRow, getSettings, mustGet, patchRow, todayOf, type Ctx, type Store } from "./store.js";
import {
  DEFAULT_GST_RULES, DEFAULT_TCS_RULES, resolveGst, splitGst, type GstRule, type TcsRule,
} from "./tax.js";

/* ───────────────────────── helpers ───────────────────────── */

const money = z.number().int().min(0);
const optStr = (max = 200) => z.string().trim().max(max).optional();
const optDate = z.string().refine(isValidISODate, "Use a valid date (YYYY-MM-DD)").nullable().optional();

/** WhatsApp marketing message cost used for campaign estimates (India, Meta rate card Jan 2026), in paise. */
export const WHATSAPP_MARKETING_COST = 86;

async function taxRules(store: Store): Promise<{ gst: GstRule[]; tcs: TcsRule[] }> {
  const [g, t] = await Promise.all([store.list("taxRules"), store.list("tcsRules")]);
  return {
    gst: g.length ? g.map((r) => ({ ...r, id: r.id })) : DEFAULT_GST_RULES,
    tcs: t.length ? t.map((r) => ({ ...r, id: r.id })) : DEFAULT_TCS_RULES,
  };
}

export function quotePricingInput(q: Quote, today: ISODate, tcsRules: TcsRule[] = DEFAULT_TCS_RULES): PricingInput {
  return {
    lines: q.lines as PriceLine[],
    pax: q.pax,
    currency: q.currency,
    fx: q.fx,
    markupMode: q.markupMode,
    packageMarkup: q.packageMarkup,
    taxBasis: q.taxBasis,
    gstRateBps: q.gstRateBps,
    discount: q.discount,
    tcs: q.scope === "overseas" ? { on: today, hasPan: q.hasPan, priorFyAmount: q.priorFyAmount, rules: tcsRules } : null,
  };
}

export function priceOfQuote(q: Quote, today: ISODate, tcsRules?: TcsRule[]): PricingResult {
  // Quotes with Option A/B are priced on the chosen option (or the first one until the customer chooses)
  const lines = q.options?.length ? linesForOption(q.lines, q.chosenOption || q.options[0]!.key) : q.lines;
  return priceQuote(quotePricingInput({ ...q, lines }, today, tcsRules));
}

/** Price every itinerary option of a quote separately. */
export function priceOptions(q: Quote, today: ISODate, tcsRules?: TcsRule[]): { key: string; name: string; pricing: PricingResult }[] {
  return q.options.map((o) => ({ key: o.key, name: o.name, pricing: priceQuote(quotePricingInput({ ...q, lines: linesForOption(q.lines, o.key) }, today, tcsRules)) }));
}

async function postLedger(
  store: Store, ctx: Ctx, today: ISODate, legs: Leg[], ref: { type: string; id: string; memo: string },
): Promise<LedgerEntry[]> {
  const entries = buildTxn(legs, {
    txnId: newId("txn"), date: today, memo: ref.memo, refType: ref.type, refId: ref.id, newId: () => newId("led"),
  });
  const saved: LedgerEntry[] = [];
  for (const e of entries) {
    const { id: _id, ...body } = e;
    saved.push((await createRow(store, "ledger", body, ctx.now)) as unknown as LedgerEntry);
  }
  return saved;
}

async function ledgerEntries(store: Store): Promise<LedgerEntry[]> {
  return (await store.list("ledger")) as unknown as LedgerEntry[];
}

async function log(
  store: Store, ctx: Ctx,
  a: { leadId?: string | null; bookingId?: string | null; visaCaseId?: string | null; kind?: Entity<"activities">["kind"]; body: string; direction?: "in" | "out" | null },
): Promise<void> {
  await createRow(store, "activities", {
    leadId: a.leadId ?? null, bookingId: a.bookingId ?? null, visaCaseId: a.visaCaseId ?? null,
    kind: a.kind ?? "system", body: a.body, at: ctx.now.toISOString(), byId: ctx.userId, direction: a.direction ?? null,
  }, ctx.now);
}

const last10 = (p: string) => p.replace(/\D/g, "").slice(-10);

async function firstUserWithRole(store: Store, roles: string[]): Promise<string | null> {
  const users = await store.list("users");
  for (const r of roles) {
    const u = users.find((x) => x.role === r && x.active);
    if (u) return u.id;
  }
  return null;
}

async function nextNumber(store: Store, key: string, prefix: string, today: ISODate): Promise<string> {
  const fy = financialYear(today);
  const seq = await store.nextSeq(`${key}:${fy}`);
  return docNumber(prefix, seq, fy);
}

function outstandingOf(inv: Invoice): Minor {
  return Math.max(0, inv.total - inv.paid - inv.credited);
}

function invoiceStatus(inv: Pick<Invoice, "total" | "paid" | "credited">): Invoice["status"] {
  if (inv.credited >= inv.total) return "cancelled";
  if (inv.paid + inv.credited >= inv.total) return "paid";
  if (inv.paid > 0) return "partially_paid";
  return "issued";
}

function partyOfInvoice(inv: Invoice): PartyRef {
  return { type: inv.partyType, id: inv.partyId, name: inv.partyName };
}

/** Move a visa case between "docs pending" and "docs received" as the checklist fills up. */
function visaDocStatus(applicants: Entity<"visaCases">["applicants"], status: Entity<"visaCases">["status"]): Entity<"visaCases">["status"] {
  const complete = applicants.length > 0 && applicants.every((a) => a.docs.every((d) => d.received));
  if (complete && status === "docs_pending") return "docs_received";
  if (!complete && status === "docs_received") return "docs_pending";
  return status;
}

/** Visa auto-allocation: the active visa executive with the fewest open cases (owner/admin if there is none). */
async function leastLoadedVisaStaff(store: Store): Promise<string | null> {
  const staff = (await store.list("users")).filter((u) => u.active && u.role === "visa");
  if (!staff.length) return firstUserWithRole(store, ["owner", "admin"]);
  const open = (await store.list("visaCases")).filter((v) => !["approved", "rejected", "delivered"].includes(v.status));
  const load = (id: string) => open.filter((v) => v.assigneeId === id).length;
  return [...staff].sort((a, b) => load(a.id) - load(b.id) || a.createdAt.localeCompare(b.createdAt))[0]!.id;
}

/* ───────────────────────── agent credit ───────────────────────── */

export interface AgentPosition {
  receivable: Minor;
  wallet: Minor;
  overdue: Minor;
  available: Minor;
}

export async function agentPosition(store: Store, agent: Agent, today: ISODate): Promise<AgentPosition> {
  const entries = await ledgerEntries(store);
  const party = { type: "agent" as const, id: agent.id };
  const receivable = accountBalance(entries, "receivable", party);
  const wallet = accountBalance(entries, "wallet", party);
  const invoices = (await store.list("invoices")).filter((i) => i.partyType === "agent" && i.partyId === agent.id);
  const overdue = invoices.filter((i) => i.dueDate < today).reduce((s, i) => s + outstandingOf(i), 0);
  return { receivable, wallet, overdue, available: Math.max(0, agent.creditLimit - Math.max(0, receivable)) };
}

async function assertAgentCanBook(store: Store, agent: Agent, amount: Minor, payBy: "wallet" | "credit", today: ISODate) {
  if (agent.blocked) throw new DomainError(`${agent.name} is blocked. Clear overdue dues to book again.`, 403);
  const pos = await agentPosition(store, agent, today);
  if (pos.overdue > 0) {
    throw new DomainError(`${agent.name} has overdue invoices of ₹${(pos.overdue / 100).toLocaleString("en-IN")}. Pay them before booking.`, 403);
  }
  if (payBy === "wallet" && pos.wallet < amount) {
    throw new DomainError(`Wallet balance ₹${(pos.wallet / 100).toLocaleString("en-IN")} is less than the booking total ₹${(amount / 100).toLocaleString("en-IN")}. Top up the wallet first.`, 402);
  }
  if (payBy === "credit" && pos.available < amount) {
    throw new DomainError(`Credit limit exceeded: available ₹${(pos.available / 100).toLocaleString("en-IN")}, booking needs ₹${(amount / 100).toLocaleString("en-IN")}.`, 402);
  }
}

/* ───────────────────────── quote building ───────────────────────── */

function matchesPlace(city: string, country: string, dest: string): boolean {
  const d = dest.trim().toLowerCase();
  return d !== "" && (city.toLowerCase() === d || country.toLowerCase() === d);
}

async function suggestLines(
  store: Store, destination: string, nights: number, pax: z.output<typeof paxSchema>, scopeHint: "domestic" | "overseas",
): Promise<{ lines: PriceLine[]; scope: "domestic" | "overseas" }> {
  const [hotels, transfers, sights, visas] = await Promise.all([
    store.list("hotels"), store.list("transfers"), store.list("sightseeing"), store.list("visaMasters"),
  ]);
  const lines: PriceLine[] = [];
  let scope = scopeHint;
  const hotel = hotels.find((h) => matchesPlace(h.city, h.country, destination) && h.rates.length > 0);
  if (hotel) {
    if (hotel.country.toLowerCase() !== "india") scope = "overseas";
    const rate = [...hotel.rates].sort((a, b) => a.netPerNight - b.netPerNight)[0]!;
    const rooms = Math.max(1, Math.ceil(pax.adults / 2));
    lines.push(emptyLine({
      id: newId("ln"), type: "hotel", title: `${hotel.name} — ${rate.roomType} (${rate.mealPlan}), ${rooms} room${rooms > 1 ? "s" : ""}`,
      day: 1, netCost: rate.netPerNight, currency: rate.currency, quantity: Math.max(1, nights) * rooms, supplierId: hotel.supplierId,
    }));
  }
  const transfer = transfers.find((t) => matchesPlace(t.city, t.country, destination));
  if (transfer) {
    if (transfer.country.toLowerCase() !== "india") scope = "overseas";
    lines.push(emptyLine({ id: newId("ln"), type: "transfer", title: `Arrival transfer — ${transfer.vehicle}`, day: 1, netCost: transfer.netPerVehicle, currency: transfer.currency, supplierId: transfer.supplierId }));
    lines.push(emptyLine({ id: newId("ln"), type: "transfer", title: `Departure transfer — ${transfer.vehicle}`, day: Math.max(1, nights + 1), netCost: transfer.netPerVehicle, currency: transfer.currency, supplierId: transfer.supplierId }));
  }
  sights.filter((s) => matchesPlace(s.city, s.country, destination)).slice(0, 2).forEach((s, i) => {
    if (s.country.toLowerCase() !== "india") scope = "overseas";
    lines.push(emptyLine({ id: newId("ln"), type: "sightseeing", title: s.name, day: Math.min(nights + 1, i + 2), netCost: s.netPerPerson, currency: s.currency, perPerson: true, supplierId: s.supplierId }));
  });
  const visa = visas.find((v) => v.country.toLowerCase() === destination.toLowerCase() || (hotel && v.country.toLowerCase() === hotel.country.toLowerCase()));
  if (visa && scope === "overseas") {
    lines.push(emptyLine({ id: newId("ln"), type: "visa", title: `${visa.country} ${visa.visaType} visa`, day: 1, netCost: visa.fee + visa.serviceFee, perPerson: true }));
  }
  lines.push(emptyLine({ id: newId("ln"), type: "insurance", title: "Travel insurance (optional upgrade)", day: 1, netCost: 90_000, perPerson: true, optional: true }));
  return { lines, scope };
}

function defaultDays(destination: string, nights: number): { title: string; description: string }[] {
  const n = Math.max(1, nights);
  return Array.from({ length: n + 1 }, (_, i) => {
    if (i === 0) return { title: `Arrive in ${destination || "destination"}`, description: "Meet and greet on arrival, transfer to your hotel and check in. Evening at leisure." };
    if (i === n) return { title: "Departure", description: "Breakfast, check out and transfer for your onward journey." };
    return { title: `Explore ${destination || "the city"} — day ${i + 1}`, description: "Breakfast at the hotel followed by sightseeing as per the plan." };
  });
}

async function buildQuoteDraft(
  store: Store, ctx: Ctx, settings: Settings,
  p: {
    contactName: string; phone: string; email: string; destination: string; nights: number; startDate: ISODate | null;
    pax: z.output<typeof paxSchema>; leadId: string | null; agentId: string | null; ownerId: string | null;
    pkg: Package | null; markupBps: number; title?: string;
  },
): Promise<Quote> {
  const today = todayOf(ctx, settings);
  const { gst } = await taxRules(store);
  const { lines, scope: scopeFromLines } = await suggestLines(store, p.destination, p.nights, p.pax, p.pkg?.scope ?? "domestic");
  const scope = p.pkg?.scope === "overseas" ? "overseas" : scopeFromLines;
  const rule = resolveGst("package", scope, today, gst);
  const number = await nextNumber(store, "quote", settings.quotePrefix, today);
  const draft = {
    number, leadId: p.leadId, agentId: p.agentId, ownerId: p.ownerId, contactName: p.contactName, phone: p.phone, email: p.email,
    title: p.title ?? (p.pkg ? p.pkg.name : `${p.nights}N ${p.destination || "Holiday"} for ${payingPaxOf(p.pax)}`),
    destination: p.destination, scope, startDate: p.startDate, nights: p.nights, pax: p.pax,
    currency: settings.baseCurrency, fx: settings.fx, markupMode: "overall" as const,
    packageMarkup: { kind: "percent" as const, value: p.markupBps, per: "unit" as const },
    taxBasis: rule.basis, gstRateBps: rule.rateBps, lines,
    days: p.pkg?.days.length ? p.pkg.days : defaultDays(p.destination, p.nights),
    inclusions: p.pkg?.inclusions.length ? p.pkg.inclusions : ["Accommodation as listed", "Daily breakfast", "Private transfers as listed", "All applicable hotel taxes"],
    exclusions: p.pkg?.exclusions.length ? p.pkg.exclusions : ["Airfare unless listed", "Personal expenses", "Anything not mentioned in inclusions"],
    shareToken: randomToken(24),
  };
  const q = await createRow(store, "quotes", draft, ctx.now);
  const total = priceOfQuote(q, today).total;
  return patchRow(store, "quotes", q.id, { total }, ctx.now);
}

/* ───────────────────────── quote validation (pre-send check) ───────────────────────── */

export interface QuoteCheck {
  errors: string[];
  warnings: string[];
}

export function checkQuote(q: Quote, today: ISODate, pricing?: PricingResult): QuoteCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const included = q.lines.filter((l) => !l.optional || l.selected);
  if (included.length === 0) errors.push("Add at least one service to the quote.");
  if (!q.startDate) errors.push("Set the travel start date.");
  else if (q.startDate < today) errors.push("The travel start date is in the past.");
  // B2B quotes are sent to and booked by the agent, so the end client's contact is optional
  if (!q.agentId && !q.phone && !q.email) errors.push("Add the customer's phone or email so the quote can be sent.");
  const p = pricing ?? priceOfQuote(q, today);
  if (p.total <= 0) errors.push("The quote total is zero.");
  if (p.margin < 0) errors.push("The discount is larger than the markup: this quote sells below cost.");
  if (q.nights > 0 && !included.some((l) => l.type === "hotel")) warnings.push(`No accommodation added for ${q.nights} night${q.nights > 1 ? "s" : ""}.`);
  included.filter((l) => l.netCost === 0).forEach((l) => warnings.push(`"${l.title}" has no cost entered.`));
  if (q.days.length > 0 && q.nights > 0 && q.days.length !== q.nights + 1) warnings.push(`Day plan has ${q.days.length} days but the trip is ${q.nights}N/${q.nights + 1}D.`);
  if (q.scope === "overseas" && !q.hasPan) warnings.push("No PAN on file: TCS will be collected at the higher rate.");
  if (p.sell > 0 && p.marginBps < 300) warnings.push(`Margin is only ${(p.marginBps / 100).toFixed(1)}%.`);
  return { errors, warnings };
}

/* ───────────────────────── confirm quote → booking → invoice ───────────────────────── */

const paymentInput = z.object({
  amount: money.refine((v) => v > 0, "Amount must be more than zero"),
  method: schemas.payments.shape.method,
  gateway: schemas.payments.shape.gateway.optional(),
  reference: optStr(80),
});

async function confirmQuote(
  store: Store, ctx: Ctx, quote: Quote,
  opts: { selectedOptionalIds?: string[]; payment?: z.output<typeof paymentInput> | null; payBy?: "wallet" | "credit" | null; placeOfSupply?: string | null },
) {
  const settings = await getSettings(store, ctx.now);
  const today = todayOf(ctx, settings);
  const rules = await taxRules(store);
  if (quote.status === "accepted") throw new DomainError("This quote is already confirmed.", 409);
  if (quote.status === "rejected" || quote.status === "expired") throw new DomainError(`This quote is ${quote.status}. Revise and resend it first.`, 409);
  if (quote.validUntil && quote.validUntil < today && ctx.role === "agent") throw new DomainError("This proposal has expired. Ask for a fresh quote.", 409);

  const baseLines = quote.options.length ? linesForOption(quote.lines, quote.chosenOption || quote.options[0]!.key) : quote.lines;
  const lines = baseLines.map((l) => (l.optional ? { ...l, selected: (opts.selectedOptionalIds ?? []).includes(l.id) || (opts.selectedOptionalIds === undefined && l.selected) } : l));
  const q: Quote = { ...quote, lines };
  const pricing = priceOfQuote(q, today, rules.tcs);
  const check = checkQuote(q, today, pricing);
  if (check.errors.length) throw new DomainError(check.errors[0]!, 422, check);

  // B2B: the agent pays from wallet or books on credit
  let agent: Agent | null = null;
  if (q.agentId) {
    agent = await mustGet(store, "agents", q.agentId);
    if (opts.payBy) await assertAgentCanBook(store, agent, pricing.total, opts.payBy, today);
  }

  if (q.couponCode) {
    const coupon = (await store.list("coupons")).find((c) => c.code === q.couponCode);
    if (coupon) await patchRow(store, "coupons", coupon.id, { uses: coupon.uses + 1 }, ctx.now);
  }

  const startDate = q.startDate!;
  const booking = await createRow(store, "bookings", {
    number: await nextNumber(store, "booking", settings.bookingPrefix, today),
    quoteId: q.id, leadId: q.leadId, agentId: q.agentId, contactName: q.contactName, phone: q.phone, email: q.email,
    title: q.title, destination: q.destination, startDate, endDate: addDays(startDate, Math.max(0, q.nights)),
    pax: q.pax, status: "confirmed", currency: q.currency, sellTotal: pricing.sell, costTotal: pricing.base,
    ownerId: q.ownerId, scope: q.scope,
  }, ctx.now);

  // Services for operations, one per included line
  const services = [];
  const priced = new Map(pricing.lines.map((p) => [p.id, p]));
  for (const l of lines) {
    const pl = priced.get(l.id);
    if (!pl?.included) continue;
    const date = addDays(startDate, l.day - 1);
    const endDate = l.type === "hotel" ? addDays(date, Math.max(1, Math.min(l.quantity, q.nights || l.quantity))) : null;
    services.push(await createRow(store, "services", {
      bookingId: booking.id, type: l.type, title: l.title, supplierId: l.supplierId, date, endDate, netCost: pl.base, status: "pending",
    }, ctx.now));
  }

  // Supplier payables, one bill per supplier
  const suppliers = await store.list("suppliers");
  const bySupplier = new Map<string, Minor>();
  for (const s of services) if (s.supplierId) bySupplier.set(s.supplierId, (bySupplier.get(s.supplierId) ?? 0) + s.netCost);
  for (const [supplierId, amount] of bySupplier) {
    const sup = suppliers.find((s) => s.id === supplierId);
    if (!sup || amount <= 0) continue;
    const due = addDays(startDate, -sup.paymentTermsDays);
    const bill = await createRow(store, "supplierBills", {
      supplierId, supplierName: sup.name, bookingId: booking.id, amount, dueDate: due < today ? today : due,
    }, ctx.now);
    await postLedger(store, ctx, today, supplierBillLegs({ party: { type: "supplier", id: supplierId, name: sup.name }, amount }), {
      type: "supplierBill", id: bill.id, memo: `Supplier cost ${booking.number} — ${sup.name}`,
    });
  }

  // GST/TCS invoice
  const party: PartyRef = agent ? { type: "agent", id: agent.id, name: agent.name } : { type: "customer", id: null, name: q.contactName };
  if (!agent && q.leadId) {
    const lead = await store.get("leads", q.leadId);
    party.id = lead?.contactId ?? null;
  }
  const placeOfSupply = opts.placeOfSupply || settings.state;
  const split = splitGst(pricing.gst, settings.state, placeOfSupply);
  const nonTaxable = pricing.sell - pricing.taxable;
  const invLines = q.taxBasis === "cost_plus_markup"
    ? [{ description: `Tour package: ${q.title} (${q.nights}N/${q.nights + 1}D, ${pricing.payingPax} pax)`, sac: "998555", amount: pricing.sell }]
    : [
        { description: `Travel services at cost (pure agent): ${q.title}`, sac: "", amount: nonTaxable },
        { description: "Service fee", sac: "998559", amount: pricing.taxable },
      ].filter((l) => l.amount > 0);
  const creditDays = agent ? agent.creditDays : 7;
  let due = addDays(today, creditDays);
  if (due > startDate) due = startDate < today ? today : startDate;
  const invoice = await createRow(store, "invoices", {
    number: await nextNumber(store, "invoice", settings.invoicePrefix, today), bookingId: booking.id,
    partyType: party.type === "agent" ? "agent" : "customer", partyId: party.id, partyName: party.name,
    gstin: agent?.gstin ?? "", placeOfSupply, supplierState: settings.state, scope: q.scope, issueDate: today, dueDate: due,
    currency: q.currency, lines: invLines, sell: pricing.sell, gst: pricing.gst, ...split, tcs: pricing.tcs, total: pricing.total,
  }, ctx.now);
  await postLedger(store, ctx, today, invoiceLegs({ party, sell: pricing.sell, gst: pricing.gst, tcs: pricing.tcs }), {
    type: "invoice", id: invoice.id, memo: `Invoice ${invoice.number} — ${booking.number}`,
  });

  const savedBooking = await patchRow(store, "bookings", booking.id, { invoiceId: invoice.id }, ctx.now);
  const savedQuote = await patchRow(store, "quotes", q.id, { lines, status: "accepted", bookingId: booking.id, total: pricing.total }, ctx.now);

  if (q.leadId) {
    const lead = await store.get("leads", q.leadId);
    if (lead) {
      await patchRow(store, "leads", lead.id, { stage: "won", bookingId: booking.id, lastActivityAt: ctx.now.toISOString() }, ctx.now);
      if (lead.contactId) {
        const c = await store.get("contacts", lead.contactId);
        if (c) await patchRow(store, "contacts", c.id, { trips: c.trips + 1, totalSpend: c.totalSpend + pricing.total }, ctx.now);
      }
    }
  }
  await log(store, ctx, { leadId: q.leadId, bookingId: booking.id, body: `Quote ${q.number} confirmed → booking ${booking.number} and invoice ${invoice.number} created.` });

  const opsUser = await firstUserWithRole(store, ["ops", "owner", "admin"]);
  await createRow(store, "tasks", {
    title: `Confirm ${services.length} service${services.length === 1 ? "" : "s"} with suppliers for ${booking.number}`,
    dueAt: new Date(ctx.now.getTime() + 24 * 3600_000).toISOString(), assigneeId: opsUser, bookingId: booking.id, priority: "high",
  }, ctx.now);

  let payment = null;
  let finalInvoice = invoice;
  if (opts.payBy === "wallet") {
    const r = await recordPaymentInternal(store, ctx, invoice.id, { amount: pricing.total, method: "wallet", reference: "Agent wallet" });
    payment = r.payment;
    finalInvoice = r.invoice;
  } else if (opts.payment) {
    const r = await recordPaymentInternal(store, ctx, invoice.id, opts.payment);
    payment = r.payment;
    finalInvoice = r.invoice;
  }
  return { booking: savedBooking, invoice: finalInvoice, services, quote: savedQuote, payment, pricing };
}

async function recordPaymentInternal(
  store: Store, ctx: Ctx, invoiceId: string,
  p: { amount: Minor; method: Entity<"payments">["method"]; gateway?: Entity<"payments">["gateway"] | undefined; reference?: string | undefined; date?: ISODate | null | undefined },
) {
  const settings = await getSettings(store, ctx.now);
  const today = todayOf(ctx, settings);
  const inv = await mustGet(store, "invoices", invoiceId);
  if (inv.status === "cancelled") throw new DomainError("This invoice is cancelled.", 409);
  const outstanding = outstandingOf(inv);
  if (outstanding <= 0) throw new DomainError("This invoice is already fully paid.", 409);
  if (p.amount > outstanding) throw new DomainError(`Amount is more than the outstanding ₹${(outstanding / 100).toLocaleString("en-IN")}.`, 422);
  const party = partyOfInvoice(inv);
  const fromWallet = p.method === "wallet";
  if (fromWallet) {
    const wallet = accountBalance(await ledgerEntries(store), "wallet", { type: party.type, id: party.id });
    if (wallet < p.amount) throw new DomainError(`Wallet balance ₹${(wallet / 100).toLocaleString("en-IN")} is not enough.`, 402);
  }
  const payment = await createRow(store, "payments", {
    invoiceId: inv.id, partyType: inv.partyType, partyId: inv.partyId, partyName: inv.partyName, amount: p.amount, method: p.method,
    gateway: p.gateway ?? "manual", reference: p.reference ?? "", date: p.date ?? today, direction: "in", purpose: "invoice",
  }, ctx.now);
  await postLedger(store, ctx, p.date ?? today, paymentLegs({ party, amount: p.amount, fromWallet }), {
    type: "payment", id: payment.id, memo: `Payment for ${inv.number}`,
  });
  const paid = inv.paid + p.amount;
  const invoice = await patchRow(store, "invoices", inv.id, { paid, status: invoiceStatus({ ...inv, paid }) }, ctx.now);
  const booking = inv.bookingId ? await store.get("bookings", inv.bookingId) : undefined;
  await log(store, ctx, { leadId: booking?.leadId ?? null, bookingId: inv.bookingId, kind: "payment", body: `Payment of ₹${(p.amount / 100).toLocaleString("en-IN")} received by ${p.method} for ${inv.number}.` });
  return { payment, invoice };
}

/* ───────────────────────── action registry ───────────────────────── */

export interface ActionDef<S extends z.ZodTypeAny = z.ZodTypeAny, O = unknown> {
  input: S;
  run: (store: Store, ctx: Ctx, input: z.output<S>) => Promise<O>;
}

/** Loose shape for registries (parameters are contravariant, so `never` accepts every action). */
interface AnyAction {
  input: z.ZodTypeAny;
  run: (store: Store, ctx: Ctx, input: never) => Promise<unknown>;
}

interface RunnableAction {
  input: z.ZodTypeAny;
  run: (store: Store, ctx: Ctx, input: unknown) => Promise<unknown>;
}

function action<S extends z.ZodTypeAny, O>(input: S, run: (store: Store, ctx: Ctx, input: z.output<S>) => Promise<O>): ActionDef<S, O> {
  return { input, run };
}

const captureLeadInput = z.object({
  name: optStr(160), phone: optStr(20), email: optStr(160), source: z.enum(LEAD_SOURCES).default("other"),
  service: z.enum(["holiday", "visa", "flight", "hotel", "transfer"]).optional(), destination: optStr(80), travelDate: optDate,
  nights: z.number().int().min(0).max(90).nullable().optional(), adults: z.number().int().min(1).max(500).optional(),
  children: z.number().int().min(0).max(500).optional(), budget: money.nullable().optional(), notes: optStr(4000),
  text: optStr(4000), agentId: z.string().nullable().optional(),
});

async function captureLead(store: Store, ctx: Ctx, i: z.output<typeof captureLeadInput>) {
  const settings = await getSettings(store, ctx.now);
  const today = todayOf(ctx, settings);
  const [hotels, packages, visas] = await Promise.all([store.list("hotels"), store.list("packages"), store.list("visaMasters")]);
  const known = [...new Set([...hotels.map((h) => h.city), ...hotels.map((h) => h.country), ...packages.map((p) => p.destination), ...visas.map((v) => v.country)].filter((x) => x && x !== "India"))];
  const parsed = i.text ? parseEnquiry(i.text, known, today) : null;

  const phone = (i.phone || parsed?.phone || "").trim();
  const email = (i.email || parsed?.email || "").trim().toLowerCase();
  const name = (i.name || "").trim() || (phone ? `Enquiry ${phone}` : email ? email.split("@")[0]! : parsed?.destination ? `${parsed.destination} enquiry` : "");
  if (!name) throw new DomainError("Add a name, phone or email for the lead.", 422);
  const destination = (i.destination || parsed?.destination || "").trim();
  const adults = i.adults ?? parsed?.adults ?? 2;
  const children = i.children ?? parsed?.children ?? 0;
  const travelDate = i.travelDate ?? parsed?.travelDate ?? null;
  const nights = i.nights ?? parsed?.nights ?? null;
  const budget = i.budget ?? parsed?.budget ?? null;
  const service = i.service ?? parsed?.service ?? "holiday";
  const agentId = ctx.role === "agent" ? ctx.agentId : i.agentId ?? null;
  const source = ctx.role === "agent" ? "b2b_agent" : i.source;

  // Contact de-duplication by phone (last 10 digits) or email
  const contacts = await store.list("contacts");
  let contact = contacts.find((c) => (phone && c.phone && last10(c.phone) === last10(phone)) || (email && c.email === email));
  if (!contact) contact = await createRow(store, "contacts", { name, phone, email, tags: [] }, ctx.now);

  // Open lead for the same person and destination → update it instead of creating a duplicate
  const leads = await store.list("leads");
  const open = leads.find((l) => l.contactId === contact!.id && !["won", "lost"].includes(l.stage) && l.destination.toLowerCase() === destination.toLowerCase());
  if (open) {
    await log(store, ctx, { leadId: open.id, kind: source === "whatsapp" ? "whatsapp" : "note", direction: "in", body: `Repeat enquiry via ${source}${i.text ? `: "${i.text}"` : ""}` });
    const lead = await patchRow(store, "leads", open.id, {
      travelDate: open.travelDate ?? travelDate, nights: open.nights ?? nights, budget: open.budget ?? budget, lastActivityAt: ctx.now.toISOString(),
    }, ctx.now);
    return { lead, duplicate: true, parsed };
  }

  const repeat = contact.trips > 0;
  const scored = scoreLead({
    source: repeat ? "repeat" : source, budget, payingPax: adults + children, travelDate, destination: destination || null,
    phone: phone || null, email: email || null, activityCount: 0, today,
  });

  // Auto-assign with routing rules (destination-specific first, then service, then anyone)
  let ownerId: string | null = null;
  const rules = (await store.list("routingRules")).filter((r) => r.active && r.assigneeIds.length > 0)
    .filter((r) => (r.service === "any" || r.service === service) && (!r.destination || r.destination.toLowerCase() === destination.toLowerCase()))
    .sort((a, b) => Number(Boolean(b.destination)) - Number(Boolean(a.destination)) || Number(b.service !== "any") - Number(a.service !== "any"));
  const rule = rules[0];
  if (rule) {
    ownerId = rule.assigneeIds[rule.cursor % rule.assigneeIds.length] ?? null;
    await patchRow(store, "routingRules", rule.id, { cursor: rule.cursor + 1 }, ctx.now);
  } else if (ctx.role === "sales") ownerId = ctx.userId;
  else ownerId = (await firstUserWithRole(store, ["sales", "owner", "admin"])) ?? ctx.userId;

  const lead = await createRow(store, "leads", {
    contactId: contact.id, name, phone, email, source, service, destination, travelDate, nights,
    pax: { adults, children, infants: 0 }, budget, notes: [i.notes, i.text ? `Original message: ${i.text}` : ""].filter(Boolean).join("\n"),
    stage: "new", temperature: scored.temperature, score: scored.score, scoreReasons: scored.reasons, ownerId, agentId,
    lastActivityAt: ctx.now.toISOString(),
  }, ctx.now);
  await log(store, ctx, { leadId: lead.id, body: `Lead captured from ${source.replace("_", " ")}${parsed ? ` (smart parser matched: ${parsed.matched.join(", ") || "nothing"})` : ""}.` });
  await createRow(store, "tasks", {
    title: `Call ${name} within 15 minutes`, dueAt: new Date(ctx.now.getTime() + 15 * 60_000).toISOString(), assigneeId: ownerId,
    leadId: lead.id, priority: scored.temperature === "hot" ? "high" : "normal",
  }, ctx.now);
  return { lead, duplicate: false, parsed };
}

const quotePatch = z.object({
  title: optStr(160), destination: optStr(80), scope: z.enum(["domestic", "overseas"]).optional(), startDate: optDate,
  nights: z.number().int().min(0).max(90).optional(), pax: paxSchema.optional(), currency: z.string().length(3).optional(),
  fx: z.record(z.number().positive()).optional(), markupMode: z.enum(["overall", "per_component"]).optional(),
  packageMarkup: schemas.quotes.shape.packageMarkup.optional(), taxBasis: z.enum(["cost_plus_markup", "markup_only"]).optional(),
  gstRateBps: z.number().int().min(0).max(10_000).optional(), hasPan: z.boolean().optional(), priorFyAmount: money.optional(),
  discount: schemas.quotes.shape.discount.optional(), lines: z.array(priceLine).optional(),
  days: schemas.quotes.shape.days.optional(), inclusions: z.array(z.string().max(200)).optional(),
  exclusions: z.array(z.string().max(200)).optional(), terms: optStr(4000), contactName: optStr(160), phone: optStr(20), email: optStr(160),
  options: schemas.quotes.shape.options.optional(),
});

async function publicProposal(store: Store, ctx: Ctx, quote: Quote) {
  const settings = await getSettings(store, ctx.now);
  const today = todayOf(ctx, settings);
  const { tcs } = await taxRules(store);
  const pricing = priceOfQuote(quote, today, tcs);
  const priced = new Map(pricing.lines.map((p) => [p.id, p]));
  const optionPrices = quote.status === "accepted" ? [] : priceOptions(quote, today, tcs);
  const optionPriced = new Map(optionPrices.flatMap((o) => o.pricing.lines.map((p) => [p.id, p] as const)));
  const booking = quote.bookingId ? await store.get("bookings", quote.bookingId) : undefined;
  const invoice = booking?.invoiceId ? await store.get("invoices", booking.invoiceId) : undefined;
  return {
    company: { name: settings.companyName, phone: settings.phone, email: settings.email, brandColor: settings.brandColor, gateways: settings.gateways, advancePercent: settings.advancePercent, emiPlans: settings.emiPlans },
    quote: {
      id: quote.id, number: quote.number, title: quote.title, contactName: quote.contactName, destination: quote.destination,
      startDate: quote.startDate, nights: quote.nights, pax: quote.pax, currency: quote.currency, status: quote.status,
      validUntil: quote.validUntil, days: quote.days, inclusions: quote.inclusions, exclusions: quote.exclusions, terms: quote.terms,
      scope: quote.scope, version: quote.version, chosenOption: quote.chosenOption,
      lines: quote.lines.map((l) => ({ id: l.id, type: l.type, title: l.title, day: l.day, optional: l.optional, selected: l.selected, option: l.option, sell: optionPriced.get(l.id)?.sell ?? priced.get(l.id)?.sell ?? 0, total: optionPriced.get(l.id)?.total ?? priced.get(l.id)?.total ?? 0 })),
      options: optionPrices.map((o) => ({ key: o.key, name: o.name, total: o.pricing.total, perPerson: o.pricing.perPerson, sell: o.pricing.sell, gst: o.pricing.gst, tcs: o.pricing.tcs })),
    },
    pricing: { sell: pricing.sell, gst: pricing.gst, tcs: pricing.tcs, tcsNote: pricing.tcsNote, discount: pricing.discount, total: pricing.total, perPerson: pricing.perPerson, payingPax: pricing.payingPax },
    booking: booking ? { number: booking.number, status: booking.status } : null,
    invoice: invoice ? { number: invoice.number, total: invoice.total, paid: invoice.paid, outstanding: outstandingOf(invoice) } : null,
    expired: Boolean(quote.validUntil && quote.validUntil < today && quote.status !== "accepted"),
  };
}

const createQuoteFromLeadInput = z.object({ leadId: z.string(), packageId: z.string().nullable().optional() });

async function createQuoteFromLead(s: Store, ctx: Ctx, i: z.output<typeof createQuoteFromLeadInput>): Promise<Quote> {
    const settings = await getSettings(s, ctx.now);
    const lead = await mustGet(s, "leads", i.leadId);
    const packages = await s.list("packages");
    const pkg = i.packageId ? await mustGet(s, "packages", i.packageId)
      : packages.find((p) => lead.destination && p.destination.toLowerCase() === lead.destination.toLowerCase()) ?? null;
    let markupBps = settings.defaultMarkupBps;
    if (lead.agentId) markupBps = (await mustGet(s, "agents", lead.agentId)).markupBps;
    const quote = await buildQuoteDraft(s, ctx, settings, {
      contactName: lead.name, phone: lead.phone, email: lead.email, destination: lead.destination || pkg?.destination || "",
      nights: lead.nights ?? pkg?.nights ?? 3, startDate: lead.travelDate, pax: lead.pax, leadId: lead.id, agentId: lead.agentId,
      ownerId: lead.ownerId ?? ctx.userId, pkg, markupBps,
    });
    await log(s, ctx, { leadId: lead.id, body: `Draft quote ${quote.number} created${pkg ? ` from template "${pkg.name}"` : ""}.` });
    return quote;
  }

export const actions = {
  captureLead: action(captureLeadInput, captureLead),

  updateLeadStage: action(z.object({ leadId: z.string(), stage: z.enum(["new", "contacted", "quoted", "negotiation", "won", "lost"]), lostReason: optStr(200) }), async (s, ctx, i) => {
    const lead = await mustGet(s, "leads", i.leadId);
    if (i.stage === "won" && lead.stage !== "won") throw new DomainError("A lead is marked won automatically when its quote is confirmed.", 409);
    if (i.stage === "lost" && !i.lostReason) throw new DomainError("Pick a reason for losing the lead.", 422);
    assertTransition(LEAD_FLOW, lead.stage, i.stage as LeadStage, "Lead");
    const out = await patchRow(s, "leads", lead.id, { stage: i.stage, lostReason: i.stage === "lost" ? i.lostReason ?? "" : "", lastActivityAt: ctx.now.toISOString() }, ctx.now);
    await log(s, ctx, { leadId: lead.id, body: `Stage changed: ${lead.stage} → ${i.stage}${i.lostReason ? ` (${i.lostReason})` : ""}.` });
    return out;
  }),

  logActivity: action(z.object({
    leadId: z.string().nullable().optional(), bookingId: z.string().nullable().optional(), visaCaseId: z.string().nullable().optional(),
    kind: z.enum(["call", "whatsapp", "email", "note"]), body: z.string().trim().min(1, "Write something").max(4000),
    direction: z.enum(["in", "out"]).nullable().optional(), durationSec: z.number().int().min(0).nullable().optional(),
  }), async (s, ctx, i) => {
    if (!i.leadId && !i.bookingId && !i.visaCaseId) throw new DomainError("Attach the activity to a lead, booking or visa case.", 422);
    const act = await createRow(s, "activities", {
      leadId: i.leadId ?? null, bookingId: i.bookingId ?? null, visaCaseId: i.visaCaseId ?? null, kind: i.kind, body: i.body,
      direction: i.direction ?? (i.kind === "note" ? null : "out"), durationSec: i.durationSec ?? null, at: ctx.now.toISOString(), byId: ctx.userId,
    }, ctx.now);
    if (i.leadId) {
      const lead = await mustGet(s, "leads", i.leadId);
      const settings = await getSettings(s, ctx.now);
      const count = (await s.list("activities")).filter((a) => a.leadId === lead.id && a.kind !== "system").length;
      const sc = scoreLead({ source: lead.source, budget: lead.budget, payingPax: lead.pax.adults + lead.pax.children, travelDate: lead.travelDate, destination: lead.destination || null, phone: lead.phone || null, email: lead.email || null, activityCount: count, today: todayOf(ctx, settings) });
      const stage = lead.stage === "new" && i.kind !== "note" ? "contacted" : lead.stage;
      await patchRow(s, "leads", lead.id, { lastActivityAt: ctx.now.toISOString(), stage, score: sc.score, temperature: sc.temperature, scoreReasons: sc.reasons }, ctx.now);
    }
    return act;
  }),

  createTask: action(z.object({
    title: z.string().trim().min(1, "Required").max(200), dueAt: z.string().min(1), assigneeId: z.string().nullable().optional(),
    leadId: z.string().nullable().optional(), bookingId: z.string().nullable().optional(), priority: z.enum(["low", "normal", "high"]).optional(),
  }), async (s, ctx, i) => createRow(s, "tasks", { ...i, assigneeId: i.assigneeId ?? ctx.userId, leadId: i.leadId ?? null, bookingId: i.bookingId ?? null }, ctx.now)),

  completeTask: action(z.object({ taskId: z.string(), done: z.boolean().default(true) }), async (s, ctx, i) => {
    await mustGet(s, "tasks", i.taskId);
    return patchRow(s, "tasks", i.taskId, { done: i.done }, ctx.now);
  }),

  createQuoteFromLead: action(createQuoteFromLeadInput, createQuoteFromLead),

  generateAiQuote: action(z.object({ text: z.string().trim().min(5, "Paste the customer's message").max(4000), name: optStr(160), phone: optStr(20), source: z.enum(LEAD_SOURCES).default("whatsapp") }), async (s, ctx, i) => {
    const captured = await captureLead(s, ctx, { text: i.text, name: i.name, phone: i.phone, source: i.source });
    const quote = await createQuoteFromLead(s, ctx, { leadId: captured.lead.id, packageId: null });
    return { lead: captured.lead, quote, parsed: captured.parsed, duplicate: captured.duplicate };
  }),

  saveQuote: action(z.object({ quoteId: z.string(), patch: quotePatch }), async (s, ctx, i) => {
    const q = await mustGet(s, "quotes", i.quoteId);
    if (ctx.role === "agent" && q.agentId !== ctx.agentId) throw new DomainError("Quote not found", 404);
    if (q.status === "accepted") throw new DomainError("A confirmed quote is locked. Make changes on the booking instead.", 409);
    const settings = await getSettings(s, ctx.now);
    const today = todayOf(ctx, settings);
    const patch: Record<string, unknown> = Object.fromEntries(Object.entries(i.patch).filter(([, v]) => v !== undefined));
    if (ctx.role === "agent" && patch["lines"]) {
      // Agents cannot see or change net costs: keep the stored costs for existing lines
      const byId = new Map(q.lines.map((l) => [l.id, l]));
      patch["lines"] = (patch["lines"] as PriceLine[]).filter((l) => byId.has(l.id)).map((l) => ({ ...byId.get(l.id)!, selected: l.selected, quantity: l.quantity, day: l.day }));
    }
    if (q.status !== "draft") {
      patch["status"] = "draft";
      patch["version"] = q.version + 1;
    }
    const draft = await patchRow(s, "quotes", q.id, patch, ctx.now);
    const { tcs } = await taxRules(s);
    return patchRow(s, "quotes", q.id, { total: priceOfQuote(draft, today, tcs).total }, ctx.now);
  }),

  applyCoupon: action(z.object({ quoteId: z.string(), code: z.string().trim().toUpperCase().max(20) }), async (s, ctx, i) => {
    const q = await mustGet(s, "quotes", i.quoteId);
    if (q.status === "accepted") throw new DomainError("A confirmed quote is locked.", 409);
    const settings = await getSettings(s, ctx.now);
    const today = todayOf(ctx, settings);
    if (!i.code) {
      return patchRow(s, "quotes", q.id, { discount: null, couponCode: "", total: priceOfQuote({ ...q, discount: null }, today).total }, ctx.now);
    }
    const c = (await s.list("coupons")).find((x) => x.code === i.code);
    if (!c || !c.active) throw new DomainError(`Coupon ${i.code} is not valid.`, 422);
    if (c.validFrom && today < c.validFrom) throw new DomainError(`Coupon ${i.code} starts on ${c.validFrom}.`, 422);
    if (c.validTo && today > c.validTo) throw new DomainError(`Coupon ${i.code} expired on ${c.validTo}.`, 422);
    if (c.maxUses > 0 && c.uses >= c.maxUses) throw new DomainError(`Coupon ${i.code} has been fully used.`, 422);
    const discount = { kind: c.kind, value: c.value };
    return patchRow(s, "quotes", q.id, { discount, couponCode: c.code, total: priceOfQuote({ ...q, discount }, today).total }, ctx.now);
  }),

  sendQuote: action(z.object({ quoteId: z.string(), channel: z.enum(["whatsapp", "email", "link"]).default("whatsapp") }), async (s, ctx, i) => {
    const q = await mustGet(s, "quotes", i.quoteId);
    if (ctx.role === "agent" && q.agentId !== ctx.agentId) throw new DomainError("Quote not found", 404);
    const settings = await getSettings(s, ctx.now);
    const today = todayOf(ctx, settings);
    const { tcs } = await taxRules(s);
    const check = checkQuote(q, today, priceOfQuote(q, today, tcs));
    if (check.errors.length) throw new DomainError(check.errors[0]!, 422, check);
    assertTransition(QUOTE_FLOW, q.status, "sent", "Quote");
    const out = await patchRow(s, "quotes", q.id, { status: "sent", shareToken: q.shareToken || randomToken(24), validUntil: addDays(today, 7) }, ctx.now);
    if (q.leadId) {
      const lead = await s.get("leads", q.leadId);
      if (lead && ["new", "contacted", "negotiation"].includes(lead.stage)) {
        await patchRow(s, "leads", lead.id, { stage: "quoted", lastActivityAt: ctx.now.toISOString() }, ctx.now);
      }
    }
    await log(s, ctx, { leadId: q.leadId, kind: i.channel === "email" ? "email" : "whatsapp", direction: "out", body: `Quote ${q.number} (v${out.version}) sent by ${i.channel}.` });
    return { quote: out, link: `#/p/${out.shareToken}`, warnings: check.warnings };
  }),

  acceptQuote: action(z.object({
    quoteId: z.string(), selectedOptionalIds: z.array(z.string()).optional(), payment: paymentInput.nullable().optional(),
    placeOfSupply: optStr(80), option: z.string().max(2).optional(),
  }), async (s, ctx, i) => {
    const q = await applyChosenOption(s, ctx, await mustGet(s, "quotes", i.quoteId), i.option);
    const settings = await getSettings(s, ctx.now);
    if (q.status === "draft") {
      const check = checkQuote(q, todayOf(ctx, settings));
      if (check.errors.length) throw new DomainError(check.errors[0]!, 422, check);
    }
    return confirmQuote(s, ctx, q, { selectedOptionalIds: i.selectedOptionalIds, payment: i.payment ?? null, placeOfSupply: i.placeOfSupply ?? null });
  }),

  updateServiceStatus: action(z.object({ serviceId: z.string(), status: z.enum(["pending", "requested", "confirmed", "cancelled"]), confirmationNo: optStr(60) }), async (s, ctx, i) => {
    const sv = await mustGet(s, "services", i.serviceId);
    assertTransition(SERVICE_FLOW, sv.status, i.status, "Service");
    const conf = i.confirmationNo ?? sv.confirmationNo;
    if (i.status === "confirmed" && ["hotel", "flight"].includes(sv.type) && !conf) {
      throw new DomainError("Enter the supplier confirmation number to confirm this service.", 422);
    }
    const out = await patchRow(s, "services", sv.id, { status: i.status, confirmationNo: conf }, ctx.now);
    await log(s, ctx, { bookingId: sv.bookingId, body: `${sv.title}: ${sv.status} → ${i.status}${conf ? ` (conf. ${conf})` : ""}.` });
    const all = (await s.list("services")).filter((x) => x.bookingId === sv.bookingId && x.status !== "cancelled");
    if (all.length && all.every((x) => x.status === "confirmed")) await log(s, ctx, { bookingId: sv.bookingId, body: "All services confirmed — ready for vouchers." });
    return out;
  }),

  generateVoucher: action(z.object({ serviceId: z.string() }), async (s, ctx, i) => {
    const sv = await mustGet(s, "services", i.serviceId);
    if (sv.status !== "confirmed") throw new DomainError("Confirm the service with the supplier before issuing a voucher.", 409);
    if (sv.voucherNo) return sv;
    const seq = await s.nextSeq("voucher");
    const out = await patchRow(s, "services", sv.id, { voucherNo: docNumber("VCH", seq) }, ctx.now);
    await log(s, ctx, { bookingId: sv.bookingId, body: `Voucher ${out.voucherNo} issued for ${sv.title}.` });
    return out;
  }),

  assignResource: action(z.object({ serviceId: z.string(), resourceId: z.string(), from: optDate, to: optDate, notifiedVia: z.enum(["whatsapp", "email", "app"]).default("whatsapp") }), async (s, ctx, i) => {
    const sv = await mustGet(s, "services", i.serviceId);
    const res = await mustGet(s, "resources", i.resourceId);
    if (!res.active) throw new DomainError(`${res.name} is marked inactive.`, 409);
    if (sv.status === "cancelled") throw new DomainError("This service is cancelled.", 409);
    const from = i.from ?? sv.date;
    const to = i.to ?? sv.endDate ?? sv.date;
    const existing = await s.list("assignments");
    const conflicts = findConflicts(existing.map((a) => ({ id: a.id, resourceId: a.resourceId, from: a.from, to: a.to, serviceId: a.serviceId })), { resourceId: res.id, from, to, serviceId: sv.id });
    if (conflicts.length) {
      const bookings = await s.list("bookings");
      const which = conflicts.map((c) => {
        const a = existing.find((x) => x.id === c.id);
        return `${bookings.find((b) => b.id === a?.bookingId)?.number ?? "another booking"} (${c.from} to ${c.to})`;
      });
      throw new DomainError(`${res.name} is already assigned on those dates: ${which.join(", ")}.`, 409, { conflicts });
    }
    const dup = existing.find((a) => a.serviceId === sv.id && a.resourceId === res.id);
    if (dup) return dup;
    const out = await createRow(s, "assignments", { serviceId: sv.id, bookingId: sv.bookingId, resourceId: res.id, from, to, notifiedVia: i.notifiedVia }, ctx.now);
    await log(s, ctx, { bookingId: sv.bookingId, body: `${res.kind[0]!.toUpperCase()}${res.kind.slice(1)} ${res.name} assigned to ${sv.title} (${from}${to !== from ? ` to ${to}` : ""}); details queued to send by ${i.notifiedVia}.` });
    return out;
  }),

  driverUpdate: action(z.object({ assignmentId: z.string(), status: z.enum(["started", "completed", "issue", "location"]), note: optStr(500), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() }), async (s, ctx, i) => {
    const a = await mustGet(s, "assignments", i.assignmentId);
    const res = await mustGet(s, "resources", a.resourceId);
    if (ctx.role === "driver") {
      const me = await s.get("users", ctx.userId);
      if (!me || me.resourceId !== a.resourceId) throw new DomainError("This job is not assigned to you.", 403);
    }
    const located = i.lat !== undefined && i.lng !== undefined ? { lastLat: i.lat, lastLng: i.lng, lastSeenAt: ctx.now.toISOString() } : {};
    if (i.status === "location") {
      if (!located.lastSeenAt) throw new DomainError("Location is missing.", 422);
      await patchRow(s, "assignments", a.id, located, ctx.now);
      return { ok: true };
    }
    await patchRow(s, "assignments", a.id, { status: i.status, ...located }, ctx.now);
    if (i.status === "completed") {
      const sv = await s.get("services", a.serviceId);
      if (sv && sv.status === "confirmed") await log(s, ctx, { bookingId: a.bookingId, body: `${sv.title} delivered.` });
    }
    await log(s, ctx, { bookingId: a.bookingId, body: `${res.name} marked the service ${i.status}${i.note ? `: ${i.note}` : ""}${located.lastSeenAt ? " (location shared)" : ""}.` });
    return { ok: true };
  }),

  updateBookingStatus: action(z.object({ bookingId: z.string(), status: z.enum(["confirmed", "in_progress", "completed"]) }), async (s, ctx, i) => {
    const b = await mustGet(s, "bookings", i.bookingId);
    assertTransition(BOOKING_FLOW, b.status, i.status, "Booking");
    const out = await patchRow(s, "bookings", b.id, { status: i.status }, ctx.now);
    await log(s, ctx, { bookingId: b.id, leadId: b.leadId, body: `Booking status: ${b.status} → ${i.status}.` });
    return out;
  }),

  cancelBooking: action(z.object({ bookingId: z.string(), reason: z.string().trim().min(1, "Give a reason").max(300), cancellationCharge: money.default(0), refundTo: z.enum(["none", "bank", "wallet"]).default("bank") }), async (s, ctx, i) => {
    const b = await mustGet(s, "bookings", i.bookingId);
    assertTransition(BOOKING_FLOW, b.status, "cancelled", "Booking");
    for (const sv of (await s.list("services")).filter((x) => x.bookingId === b.id && x.status !== "cancelled")) {
      await patchRow(s, "services", sv.id, { status: "cancelled" }, ctx.now);
    }
    let creditNote = null;
    if (b.invoiceId) {
      const inv = await mustGet(s, "invoices", b.invoiceId);
      const creditable = inv.total - inv.credited - i.cancellationCharge;
      if (creditable < 0) throw new DomainError("The cancellation charge is more than the invoice value.", 422);
      if (creditable > 0) creditNote = await issueCreditNote(s, ctx, { invoiceId: inv.id, amount: creditable, reason: `Cancellation: ${i.reason}`, refundTo: i.refundTo });
    }
    const out = await patchRow(s, "bookings", b.id, { status: "cancelled", notes: [b.notes, `Cancelled: ${i.reason}`].filter(Boolean).join("\n") }, ctx.now);
    await log(s, ctx, { bookingId: b.id, leadId: b.leadId, body: `Booking cancelled (${i.reason}). Charge ₹${(i.cancellationCharge / 100).toLocaleString("en-IN")}. Supplier cancellations must be raised separately.` });
    return { booking: out, creditNote };
  }),

  recordPayment: action(z.object({
    invoiceId: z.string(), amount: money.refine((v) => v > 0, "Amount must be more than zero"),
    method: schemas.payments.shape.method, gateway: schemas.payments.shape.gateway.optional(), reference: optStr(80), date: optDate,
  }), async (s, ctx, i) => recordPaymentInternal(s, ctx, i.invoiceId, i)),

  issueCreditNote: action(z.object({ invoiceId: z.string(), amount: money.refine((v) => v > 0, "Amount must be more than zero"), reason: z.string().trim().min(1, "Give a reason").max(300), refundTo: z.enum(["none", "bank", "wallet"]).default("none") }),
    (s, ctx, i) => issueCreditNote(s, ctx, i)),

  topUpWallet: action(z.object({ agentId: z.string(), amount: money.refine((v) => v > 0, "Amount must be more than zero"), method: schemas.payments.shape.method.default("upi"), reference: optStr(80) }), async (s, ctx, i) => {
    if (ctx.role === "agent" && ctx.agentId !== i.agentId) throw new DomainError("You can only top up your own wallet.", 403);
    if (i.method === "wallet") throw new DomainError("Choose how the money was paid (UPI, bank transfer…).", 422);
    const agent = await mustGet(s, "agents", i.agentId);
    const settings = await getSettings(s, ctx.now);
    const today = todayOf(ctx, settings);
    const payment = await createRow(s, "payments", {
      partyType: "agent", partyId: agent.id, partyName: agent.name, amount: i.amount, method: i.method, reference: i.reference ?? "",
      date: today, direction: "in", purpose: "wallet_topup", gateway: "manual",
    }, ctx.now);
    await postLedger(s, ctx, today, walletTopUpLegs({ party: { type: "agent", id: agent.id, name: agent.name }, amount: i.amount }), { type: "walletTopUp", id: payment.id, memo: `Wallet top-up — ${agent.name}` });
    return { payment, position: await agentPosition(s, agent, today) };
  }),

  setAgentBlocked: action(z.object({ agentId: z.string(), blocked: z.boolean() }), async (s, ctx, i) => {
    await mustGet(s, "agents", i.agentId);
    return patchRow(s, "agents", i.agentId, { blocked: i.blocked }, ctx.now);
  }),

  paySupplierBill: action(z.object({ billId: z.string(), amount: money.refine((v) => v > 0, "Amount must be more than zero"), method: schemas.payments.shape.method.default("bank_transfer"), reference: optStr(80) }), async (s, ctx, i) => {
    const bill = await mustGet(s, "supplierBills", i.billId);
    const outstanding = bill.amount - bill.paid;
    if (outstanding <= 0) throw new DomainError("This bill is already paid.", 409);
    if (i.amount > outstanding) throw new DomainError(`Amount is more than the outstanding ₹${(outstanding / 100).toLocaleString("en-IN")}.`, 422);
    const settings = await getSettings(s, ctx.now);
    const today = todayOf(ctx, settings);
    const payment = await createRow(s, "payments", {
      partyType: "supplier", partyId: bill.supplierId, partyName: bill.supplierName || "Supplier", amount: i.amount, method: i.method,
      reference: i.reference ?? "", date: today, direction: "out", purpose: "supplier", gateway: "manual",
    }, ctx.now);
    await postLedger(s, ctx, today, supplierPaymentLegs({ party: { type: "supplier", id: bill.supplierId, name: bill.supplierName }, amount: i.amount }), { type: "supplierPayment", id: payment.id, memo: `Paid ${bill.supplierName}` });
    const paid = bill.paid + i.amount;
    return patchRow(s, "supplierBills", bill.id, { paid, status: paid >= bill.amount ? "paid" : "partially_paid" }, ctx.now);
  }),

  createVisaCase: action(z.object({
    contactName: z.string().trim().min(1, "Required").max(160), phone: optStr(20), email: optStr(160), country: z.string().trim().min(1, "Pick a country"),
    visaType: optStr(80), travelDate: optDate, applicants: z.array(z.string().trim().min(1)).min(1, "Add at least one applicant").max(50), agentId: z.string().nullable().optional(),
  }), async (s, ctx, i) => {
    const settings = await getSettings(s, ctx.now);
    const today = todayOf(ctx, settings);
    const masters = await s.list("visaMasters");
    const master = masters.find((m) => m.country.toLowerCase() === i.country.toLowerCase() && (!i.visaType || m.visaType.toLowerCase() === i.visaType.toLowerCase()))
      ?? masters.find((m) => m.country.toLowerCase() === i.country.toLowerCase());
    const checklist = master?.checklist.length ? master.checklist : ["Passport (6+ months validity)", "Photograph", "Bank statement", "Flight booking", "Hotel booking"];
    const assigneeId = await leastLoadedVisaStaff(s);
    const agentId = ctx.role === "agent" ? ctx.agentId : i.agentId ?? null;
    const vc = await createRow(s, "visaCases", {
      number: await nextNumber(s, "visa", "VISA", today), contactName: i.contactName, phone: i.phone ?? "", email: i.email ?? "",
      country: master?.country ?? i.country, visaType: master?.visaType ?? i.visaType ?? "Tourist", visaMasterId: master?.id ?? null,
      travelDate: i.travelDate ?? null, agentId, assigneeId, status: "docs_pending",
      fee: master ? (master.fee + master.serviceFee) * i.applicants.length : 0,
      applicants: i.applicants.map((n) => ({ name: n, docs: checklist.map((d) => ({ name: d, received: false })) })),
      uploadToken: randomToken(24),
    }, ctx.now);
    await log(s, ctx, { visaCaseId: vc.id, body: `Visa case ${vc.number} opened with the ${vc.country} checklist; status link ready to share with the customer.` });
    await createRow(s, "tasks", { title: `Collect documents for ${vc.number} (${vc.country})`, dueAt: new Date(ctx.now.getTime() + 48 * 3600_000).toISOString(), assigneeId, visaCaseId: vc.id }, ctx.now);
    return vc;
  }),

  markVisaDoc: action(z.object({ caseId: z.string(), applicantIndex: z.number().int().min(0), docName: z.string(), received: z.boolean() }), async (s, ctx, i) => {
    const vc = await mustGet(s, "visaCases", i.caseId);
    if (ctx.role === "agent" && vc.agentId !== ctx.agentId) throw new DomainError("Visa case not found", 404);
    const ap = vc.applicants[i.applicantIndex];
    if (!ap) throw new DomainError("Applicant not found", 404);
    const doc = ap.docs.find((d) => d.name === i.docName);
    if (!doc) throw new DomainError("Document not on the checklist", 404);
    const applicants = vc.applicants.map((a, idx) => idx !== i.applicantIndex ? a : { ...a, docs: a.docs.map((d) => (d.name === i.docName ? { ...d, received: i.received } : d)) });
    const status = visaDocStatus(applicants, vc.status);
    const out = await patchRow(s, "visaCases", vc.id, { applicants, status }, ctx.now);
    if (status !== vc.status) await log(s, ctx, { visaCaseId: vc.id, body: `All documents received — ${vc.number} is ready to submit.` });
    return out;
  }),

  scanPassport: action(z.object({ caseId: z.string(), applicantIndex: z.number().int().min(0), mrz: z.string().min(10, "Paste both MRZ lines") }), async (s, ctx, i) => {
    const vc = await mustGet(s, "visaCases", i.caseId);
    const ap = vc.applicants[i.applicantIndex];
    if (!ap) throw new DomainError("Applicant not found", 404);
    const r = parseMrz(i.mrz, ctx.now);
    if (!r.valid) throw new DomainError(r.errors[0] ?? "Could not read the passport", 422, { errors: r.errors });
    const warnings: string[] = [];
    if (vc.travelDate && r.expiry && r.expiry < addDays(vc.travelDate, 180)) warnings.push("Passport expires within 6 months of travel — most countries will refuse it.");
    const applicants = vc.applicants.map((a, idx) => idx !== i.applicantIndex ? a : {
      ...a, name: a.name || `${r.givenNames} ${r.surname}`.trim(), passportNo: r.passportNo, nationality: r.nationality, dob: r.dob || null, expiry: r.expiry || null,
      docs: a.docs.map((d) => (/passport/i.test(d.name) ? { ...d, received: true } : d)),
    });
    const status = visaDocStatus(applicants, vc.status);
    const out = await patchRow(s, "visaCases", vc.id, { applicants, status }, ctx.now);
    if (status !== vc.status) await log(s, ctx, { visaCaseId: vc.id, body: `All documents received — ${vc.number} is ready to submit.` });
    await log(s, ctx, { visaCaseId: vc.id, body: `Passport ${r.passportNo} scanned for applicant ${i.applicantIndex + 1}; all check digits valid.` });
    return { visaCase: out, passport: r, warnings };
  }),

  advanceVisaCase: action(z.object({ caseId: z.string(), status: z.enum(["enquiry", "docs_pending", "docs_received", "submitted", "in_process", "approved", "rejected", "delivered"]), note: optStr(1000) }), async (s, ctx, i) => {
    const vc = await mustGet(s, "visaCases", i.caseId);
    assertTransition(VISA_FLOW, vc.status, i.status, "Visa case");
    if (i.status === "submitted") {
      const missing = vc.applicants.flatMap((a) => a.docs.filter((d) => !d.received).map((d) => `${a.name}: ${d.name}`));
      if (missing.length) throw new DomainError(`Documents still missing: ${missing.slice(0, 3).join("; ")}${missing.length > 3 ? "…" : ""}`, 422);
      if (vc.applicants.some((a) => !a.passportNo)) throw new DomainError("Scan or enter every applicant's passport before submitting.", 422);
    }
    if (i.status === "rejected" && !i.note) throw new DomainError("Add the rejection reason to share with the customer.", 422);
    const out = await patchRow(s, "visaCases", vc.id, { status: i.status, decisionNote: i.note ?? vc.decisionNote }, ctx.now);
    await log(s, ctx, { visaCaseId: vc.id, body: `Status: ${vc.status} → ${i.status}. WhatsApp update queued for the customer.${i.note ? ` Note: ${i.note}` : ""}` });
    return out;
  }),

  sendCampaign: action(z.object({ campaignId: z.string() }), async (s, ctx, i) => {
    const c = await mustGet(s, "campaigns", i.campaignId);
    if (c.status === "sent") throw new DomainError("This campaign was already sent.", 409);
    const audience = await segmentAudience(s, c.segmentId);
    const reachable = audience.filter((a) => (c.channel === "email" ? a.email : a.phone));
    if (reachable.length === 0) throw new DomainError("No contacts in this segment have a " + (c.channel === "email" ? "email address." : "phone number."), 422);
    const cost = c.channel === "whatsapp" ? reachable.length * WHATSAPP_MARKETING_COST : 0;
    return patchRow(s, "campaigns", c.id, { status: "sent", sentCount: reachable.length, cost, scheduledAt: ctx.now.toISOString() }, ctx.now);
  }),

  inboundMessage: action(z.object({ channel: z.enum(["whatsapp", "email", "web_chat"]).default("whatsapp"), from: optStr(120), phone: optStr(20), body: z.string().trim().min(1).max(4000) }), async (s, ctx, i) => {
    const settings = await getSettings(s, ctx.now);
    const today = todayOf(ctx, settings);
    const now = ctx.now.toISOString();
    const inbound = await createRow(s, "messages", { channel: i.channel, from: i.from ?? "", phone: i.phone ?? "", body: i.body, at: now, direction: "in" }, ctx.now);
    let reply: string;
    let lead: Lead | null = null;
    const fileNo = /\b(?:FILE|BK)[/-][\w/-]+/i.exec(i.body)?.[0];
    if (/\b(status|voucher|my booking|booking)\b/i.test(i.body)) {
      const bookings = await s.list("bookings");
      const b = bookings.find((x) => (fileNo && x.number.toUpperCase() === fileNo.toUpperCase()) || (i.phone && x.phone && last10(x.phone) === last10(i.phone)));
      reply = b
        ? `Hi ${b.contactName}! Booking ${b.number} (${b.title}) is ${b.status.replace("_", " ")}. Travel ${b.startDate}. Vouchers are shared 3 days before travel.`
        : "We couldn't find a booking for this number. Please share your file number (e.g. FILE/2026-27/0001).";
    } else {
      const r = await captureLead(s, ctx, { text: i.body, name: i.from, phone: i.phone, source: "whatsapp" });
      lead = r.lead;
      const p = r.parsed;
      reply = p && p.matched.length >= 2
        ? `Thanks ${lead.name}! Noted: ${[p.nights ? `${p.nights}N` : "", p.destination ?? "", p.adults ? `${p.adults} travellers` : "", p.travelDate ?? ""].filter(Boolean).join(", ")}. A travel expert will call you within 15 minutes with options.`
        : `Hi! Thanks for contacting ${settings.companyName}. Please share destination, travel dates, number of travellers and budget, and we'll send you a quote.`;
      await patchRow(s, "messages", inbound.id, { leadId: lead.id }, ctx.now);
    }
    const out = await createRow(s, "messages", { channel: i.channel, from: settings.companyName, phone: i.phone ?? "", body: reply, at: now, direction: "out", handledBy: "bot", leadId: lead?.id ?? null }, ctx.now);
    void today;
    return { inbound, reply: out, lead };
  }),

  replyMessage: action(z.object({ phone: z.string().min(1), body: z.string().trim().min(1, "Write a reply").max(4000), channel: z.enum(["whatsapp", "email", "web_chat"]).default("whatsapp"), leadId: z.string().nullable().optional() }), async (s, ctx, i) => {
    const settings = await getSettings(s, ctx.now);
    const msgs = await s.list("messages");
    for (const m of msgs.filter((x) => x.phone === i.phone && x.direction === "in" && !x.read)) await patchRow(s, "messages", m.id, { read: true }, ctx.now);
    return createRow(s, "messages", { channel: i.channel, from: settings.companyName, phone: i.phone, body: i.body, at: ctx.now.toISOString(), direction: "out", handledBy: "human", leadId: i.leadId ?? null }, ctx.now);
  }),

  inviteUsers: action(z.object({ users: z.array(z.object({ name: z.string().trim().min(1, "Name required"), email: z.string().trim().toLowerCase().email("Enter a valid email"), role: z.enum(["owner", "admin", "sales", "ops", "accounts", "visa", "marketing", "agent", "driver"]), agentId: z.string().nullable().optional() })).min(1).max(200) }), async (s, ctx, i) => {
    const existing = new Set((await s.list("users")).map((u) => u.email));
    const created = [];
    const skipped: string[] = [];
    for (const u of i.users) {
      if (existing.has(u.email)) {
        skipped.push(u.email);
        continue;
      }
      if (u.role === "owner" && ctx.role !== "owner") throw new DomainError("Only the owner can add another owner.", 403);
      created.push(await createRow(s, "users", { name: u.name, email: u.email, role: u.role, agentId: u.agentId ?? null }, ctx.now));
      existing.add(u.email);
    }
    return { created, skipped };
  }),

  completeOnboardingStep: action(z.object({ step: z.string().min(1).max(40), done: z.boolean().default(true) }), async (s, ctx, i) => {
    const st = await getSettings(s, ctx.now);
    return patchRow(s, "settings", st.id, { onboarding: { ...st.onboarding, [i.step]: i.done } }, ctx.now);
  }),

  bookGroupSeat: action(z.object({ groupId: z.string(), name: z.string().trim().min(1, "Name required"), phone: optStr(20) }), async (s, ctx, i) => {
    const g = await mustGet(s, "groupDepartures", i.groupId);
    if (g.status !== "open") throw new DomainError("This departure is closed for bookings.", 409);
    if (g.passengers.length >= g.seats) throw new DomainError("No seats left on this departure.", 409);
    const passengers = [...g.passengers, { name: i.name, phone: i.phone ?? "", room: "", paid: false }];
    return patchRow(s, "groupDepartures", g.id, { passengers, status: passengers.length >= g.seats ? "closed" : "open" }, ctx.now);
  }),

  agentCreateQuote: action(z.object({ packageId: z.string(), startDate: z.string().refine(isValidISODate, "Pick the travel date"), adults: z.number().int().min(1).max(100), children: z.number().int().min(0).max(100).default(0), contactName: z.string().trim().min(1, "Client name required").max(160), phone: optStr(20), email: optStr(160), agentId: z.string().nullable().optional() }), async (s, ctx, i) => {
    const agentId = ctx.role === "agent" ? ctx.agentId : i.agentId ?? null;
    if (!agentId) throw new DomainError("Pick the agent this quote is for.", 422);
    const agent = await mustGet(s, "agents", agentId);
    const pkg = await mustGet(s, "packages", i.packageId);
    const settings = await getSettings(s, ctx.now);
    return buildQuoteDraft(s, ctx, settings, {
      contactName: i.contactName, phone: i.phone || agent.phone, email: i.email || agent.email, destination: pkg.destination, nights: pkg.nights,
      startDate: i.startDate, pax: { adults: i.adults, children: i.children, infants: 0 }, leadId: null, agentId, ownerId: null, pkg,
      markupBps: agent.markupBps, title: `${pkg.name} — ${i.contactName}`,
    });
  }),

  agentBook: action(z.object({ quoteId: z.string(), payBy: z.enum(["wallet", "credit"]), selectedOptionalIds: z.array(z.string()).optional(), option: z.string().max(2).optional() }), async (s, ctx, i) => {
    const found = await mustGet(s, "quotes", i.quoteId);
    if (!found.agentId) throw new DomainError("This quote is not an agent quote.", 422);
    if (ctx.role === "agent" && found.agentId !== ctx.agentId) throw new DomainError("Quote not found", 404);
    const q = await applyChosenOption(s, ctx, found, i.option);
    return confirmQuote(s, ctx, q, { payBy: i.payBy, selectedOptionalIds: i.selectedOptionalIds });
  }),
} satisfies Record<string, AnyAction>;

export type ActionName = keyof typeof actions;

async function issueCreditNote(store: Store, ctx: Ctx, i: { invoiceId: string; amount: Minor; reason: string; refundTo: "none" | "bank" | "wallet" }) {
  const settings = await getSettings(store, ctx.now);
  const today = todayOf(ctx, settings);
  const inv = await mustGet(store, "invoices", i.invoiceId);
  const creditable = inv.total - inv.credited;
  if (i.amount > creditable) throw new DomainError(`Credit note is more than the creditable ₹${(creditable / 100).toLocaleString("en-IN")}.`, 422);
  const party = partyOfInvoice(inv);
  const cn = await createRow(store, "creditNotes", {
    number: await nextNumber(store, "creditNote", "CN", today), invoiceId: inv.id, amount: i.amount, reason: i.reason, refundTo: i.refundTo, date: today,
  }, ctx.now);
  await postLedger(store, ctx, today, creditNoteLegs({ party, amount: i.amount, invoice: inv }), { type: "creditNote", id: cn.id, memo: `Credit note ${cn.number} on ${inv.number}` });
  const credited = inv.credited + i.amount;
  // Money already received beyond what is still owed becomes refundable
  const overpaid = Math.max(0, inv.paid - (inv.total - credited));
  let paid = inv.paid;
  if (i.refundTo !== "none" && overpaid > 0) {
    await postLedger(store, ctx, today, refundLegs({ party, amount: overpaid, to: i.refundTo }), { type: "refund", id: cn.id, memo: `Refund for ${cn.number} to ${i.refundTo}` });
    await createRow(store, "payments", {
      invoiceId: inv.id, partyType: inv.partyType, partyId: inv.partyId, partyName: inv.partyName, amount: overpaid,
      method: i.refundTo === "wallet" ? "wallet" : "bank_transfer", date: today, direction: "out", purpose: "refund", reference: cn.number,
    }, ctx.now);
    paid -= overpaid;
  }
  const invoice = await patchRow(store, "invoices", inv.id, { credited, paid, status: invoiceStatus({ total: inv.total, paid, credited }) }, ctx.now);
  return { creditNote: cn, invoice, refunded: i.refundTo !== "none" ? overpaid : 0 };
}

async function segmentAudience(store: Store, segmentId: string | null) {
  const contacts = await store.list("contacts");
  if (!segmentId) return contacts;
  const seg = await mustGet(store, "segments", segmentId);
  return filterAudience(contacts, await store.list("leads"), seg.rules);
}

export type SegmentRule = Entity<"segments">["rules"][number];

/** Contacts matching every segment rule (tag, city, trips, spend in rupees, enquired destination, lead temperature). */
export function filterAudience(contacts: Entity<"contacts">[], leads: Lead[], rules: SegmentRule[]): Entity<"contacts">[] {
  return contacts.filter((c) => rules.every((r) => {
    const cl = leads.filter((l) => l.contactId === c.id);
    const v = r.value.toLowerCase();
    switch (r.field) {
      case "tag": return c.tags.some((t) => t.toLowerCase() === v);
      case "city": return r.op === "contains" ? c.city.toLowerCase().includes(v) : c.city.toLowerCase() === v;
      case "trips": return r.op === "gte" ? c.trips >= Number(v) : r.op === "lte" ? c.trips <= Number(v) : c.trips === Number(v);
      case "totalSpend": {
        const t = Number(v) * 100;
        return r.op === "gte" ? c.totalSpend >= t : r.op === "lte" ? c.totalSpend <= t : c.totalSpend === t;
      }
      case "destination": return cl.some((l) => l.destination.toLowerCase().includes(v));
      case "temperature": return cl.some((l) => l.temperature === v);
      default: return false;
    }
  }));
}

export async function segmentSize(store: Store, segmentId: string | null): Promise<number> {
  return (await segmentAudience(store, segmentId)).length;
}

/** Keep only the shared lines and the chosen option's lines; quotes without options pass through. */
export function linesForOption<T extends { option?: string }>(lines: T[], option: string): T[] {
  return lines.filter((l) => !l.option || l.option === option);
}

async function applyChosenOption(s: Store, ctx: Ctx, q: Quote, option: string | undefined): Promise<Quote> {
  if (!q.options.length) return q;
  const key = option ?? q.chosenOption;
  if (!key || !q.options.some((o) => o.key === key)) throw new DomainError(`Choose one of the options: ${q.options.map((o) => o.name).join(", ")}.`, 422);
  const chosen = q.options.find((o) => o.key === key)!;
  await log(s, ctx, { leadId: q.leadId, body: `Customer chose ${chosen.name} on quote ${q.number}.` });
  return patchRow(s, "quotes", q.id, { lines: linesForOption(q.lines, key), chosenOption: key }, ctx.now);
}

/* ───────────────────────── public (no login) actions ───────────────────────── */

export const publicActions = {
  viewProposal: action(z.object({ token: z.string().min(8) }), async (s, ctx, i) => {
    const q = (await s.list("quotes")).find((x) => x.shareToken === i.token && x.status !== "draft");
    if (!q) throw new DomainError("This proposal link is not valid or has been withdrawn.", 404);
    let quote = q;
    if (q.status === "sent" || q.status === "viewed") {
      quote = await patchRow(s, "quotes", q.id, { views: q.views + 1, status: "viewed" }, ctx.now);
      if (q.views === 0) await log(s, ctx, { leadId: q.leadId, kind: "quote_view", body: `Customer opened proposal ${q.number}.` });
    }
    return publicProposal(s, ctx, quote);
  }),

  acceptProposal: action(z.object({ token: z.string().min(8), selectedOptionalIds: z.array(z.string()).default([]), payment: paymentInput.nullable().optional(), option: z.string().max(2).optional() }), async (s, ctx, i) => {
    const found = (await s.list("quotes")).find((x) => x.shareToken === i.token && x.status !== "draft");
    if (!found) throw new DomainError("This proposal link is not valid.", 404);
    // Security: on a live account money is only recorded from the gateway's signed confirmation (see proposalPay),
    // never from what a browser says it paid. Only the sandbox (test mode) accepts a simulated payment here.
    if (!providersFor(ctx).payments.sandbox) {
      throw new DomainError("To confirm, pay online or put the proposal on hold.", 409);
    }
    const settings = await getSettings(s, ctx.now);
    if (found.validUntil && found.validUntil < todayOf(ctx, settings)) throw new DomainError("This proposal has expired. Please ask us for a fresh quote.", 409);
    const q = await applyChosenOption(s, ctx, found, i.option);
    const r = await confirmQuote(s, ctx, q, { selectedOptionalIds: i.selectedOptionalIds, payment: i.payment ? { ...i.payment, gateway: i.payment.gateway ?? "razorpay" } : null });
    return { proposal: await publicProposal(s, ctx, r.quote), bookingNumber: r.booking.number };
  }),

  storefrontEnquiry: action(z.object({
    packageId: z.string().nullable().optional(), name: z.string().trim().min(1, "Your name").max(160), phone: z.string().trim().regex(/^[+\d][\d\s-]{6,17}$/, "Enter a valid phone number"),
    email: optStr(160), travelDate: optDate, adults: z.number().int().min(1).max(50).default(2), message: optStr(2000), landingSlug: optStr(60),
    campaignId: optStr(60),
  }), async (s, ctx, i) => {
    const pkg = i.packageId ? await s.get("packages", i.packageId) : undefined;
    const r = await captureLead(s, ctx, {
      name: i.name, phone: i.phone, email: i.email, source: i.landingSlug ? "landing_page" : "website", destination: pkg?.destination,
      travelDate: i.travelDate ?? null, nights: pkg?.nights ?? null, adults: i.adults, notes: [pkg ? `Interested in package: ${pkg.name}` : "", i.message ?? "", i.landingSlug ? `Landing page: ${i.landingSlug}` : ""].filter(Boolean).join("\n"),
    });
    if (i.campaignId && (await s.get("campaigns", i.campaignId)) && !r.lead.campaignId) await patchRow(s, "leads", r.lead.id, { campaignId: i.campaignId }, ctx.now);
    if (i.landingSlug) {
      const lp = (await s.list("landingPages")).find((l) => l.slug === i.landingSlug);
      if (lp) await patchRow(s, "landingPages", lp.id, { leads: lp.leads + 1 }, ctx.now);
    }
    return { ok: true, reference: r.lead.id.slice(-6).toUpperCase() };
  }),

  visaStatus: action(z.object({ number: z.string().trim().min(3), phone: z.string().trim().min(6) }), async (s, _ctx, i) => {
    const vc = (await s.list("visaCases")).find((v) => v.number.toUpperCase() === i.number.toUpperCase() && last10(v.phone) === last10(i.phone));
    if (!vc) throw new DomainError("No visa application matches that number and phone.", 404);
    return {
      number: vc.number, country: vc.country, visaType: vc.visaType, status: vc.status, applicants: vc.applicants.length,
      missingDocs: vc.applicants.flatMap((a) => a.docs.filter((d) => !d.received).map((d) => `${a.name}: ${d.name}`)),
    };
  }),
} satisfies Record<string, AnyAction>;

export type PublicActionName = keyof typeof publicActions;

/* ───────────────────────── extension registry ───────────────────────── */

const extraActions: Record<string, RunnableAction> = {};
const extraPublic: Record<string, RunnableAction> = {};
/** One row written while an action ran: the row as it was before the action first touched it (null = created) and as it is now. */
export interface WriteRecord {
  collection: Collection;
  id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}
type AfterHook = (store: Store, ctx: Ctx, name: string, input: unknown, output: unknown, writes: readonly WriteRecord[]) => Promise<void>;

/** Collections whose changes after-hooks can see (automations derive their events from these). */
const JOURNALED: ReadonlySet<Collection> = new Set(["leads", "quotes", "bookings", "payments", "visaCases"]);

/**
 * Wrap a store so every insert/update of a journaled collection is recorded with its previous state.
 * No extra queries: patchRow always reads the row right before writing it, and that read is remembered.
 */
function journaled(inner: Store, writes: WriteRecord[]): Store {
  const seen = new Map<string, Record<string, unknown> | null>();
  const lastRead = new Map<string, Record<string, unknown>>();
  const record = (c: Collection, id: string, before: Record<string, unknown> | null, after: Record<string, unknown>) => {
    const key = `${c}:${id}`;
    if (!seen.has(key)) seen.set(key, before);
    const existing = writes.find((w) => w.collection === c && w.id === id);
    if (existing) existing.after = after;
    else writes.push({ collection: c, id, before: seen.get(key) ?? null, after });
  };
  return {
    list: (c) => inner.list(c),
    get: async (c, id) => {
      const row = await inner.get(c, id);
      if (row && JOURNALED.has(c)) lastRead.set(`${c}:${id}`, row as unknown as Record<string, unknown>);
      return row;
    },
    insert: async (c, row) => {
      const out = await inner.insert(c, row);
      if (JOURNALED.has(c)) record(c, out.id, null, out as unknown as Record<string, unknown>);
      return out;
    },
    update: async (c, id, row) => {
      const key = `${c}:${id}`;
      const before = JOURNALED.has(c) && !seen.has(key) ? lastRead.get(key) ?? ((await inner.get(c, id)) as unknown as Record<string, unknown> | undefined) ?? null : null;
      const out = await inner.update(c, id, row);
      if (JOURNALED.has(c)) record(c, id, before, out as unknown as Record<string, unknown>);
      return out;
    },
    remove: (c, id) => inner.remove(c, id),
    nextSeq: (k) => inner.nextSeq(k),
  };
}
const afterHooks: AfterHook[] = [];

/** Add more workflow actions (feature packs register themselves at import time). */
export function registerActions(map: Record<string, AnyAction>, isPublic = false): void {
  Object.assign(isPublic ? extraPublic : extraActions, map as unknown as Record<string, RunnableAction>);
}

/** Run code after any action succeeds, inside the same transaction (a throw rolls everything back). */
export function registerAfterHook(hook: AfterHook): void {
  afterHooks.push(hook);
}

export function actionNames(): string[] {
  return [...Object.keys(actions), ...Object.keys(extraActions)];
}

/** Building blocks shared with feature packs. */
export const internals = {
  applyChosenOption, action, log, nextNumber, captureLead, confirmQuote, recordPaymentInternal, postLedger, issueCreditNote, segmentAudience,
  publicProposal, last10, firstUserWithRole, outstandingOf, invoiceStatus, partyOfInvoice, taxRules, buildQuoteDraft,
  createQuoteFromLead, ledgerEntries, visaDocStatus, paymentInput, quotePatch, suggestLines,
};

/** Validate input, check permission, and run a staff/agent action. */
export async function runAction(store: Store, ctx: Ctx, name: string, raw: unknown): Promise<unknown> {
  const def = (actions as unknown as Record<string, RunnableAction>)[name] ?? extraActions[name];
  if (!def) throw new DomainError(`Unknown action "${name}"`, 404);
  if (!canRunAction(ctx.role, name)) throw new DomainError("You don't have permission to do that.", 403);
  const parsed = def.input.safeParse(raw ?? {});
  if (!parsed.success) {
    const f = formatZodError(parsed.error);
    throw new DomainError(f.message, 422, f.fields);
  }
  const writes: WriteRecord[] = [];
  const tracked = journaled(store, writes);
  const out = await def.run(tracked, ctx, parsed.data);
  for (const h of afterHooks) await h(tracked, ctx, name, parsed.data, out, writes);
  return out;
}

/** Run a public action (proposal page, storefront, visa tracker). */
export async function runPublicAction(store: Store, ctx: Ctx, name: string, raw: unknown): Promise<unknown> {
  const def = (publicActions as unknown as Record<string, RunnableAction>)[name] ?? extraPublic[name];
  if (!def) throw new DomainError(`Unknown action "${name}"`, 404);
  const parsed = def.input.safeParse(raw ?? {});
  if (!parsed.success) {
    const f = formatZodError(parsed.error);
    throw new DomainError(f.message, 422, f.fields);
  }
  const writes: WriteRecord[] = [];
  const tracked = journaled(store, writes);
  const out = await def.run(tracked, ctx, parsed.data);
  for (const h of afterHooks) await h(tracked, ctx, `public:${name}`, parsed.data, out, writes);
  return out;
}

/** Collections that must only change through actions (to keep money and status rules intact). */
export const ACTION_ONLY: ReadonlySet<Collection> = new Set(["ledger", "invoices", "payments", "creditNotes", "assignments", "messages"]);

/** Fields on generic CRUD updates that only workflows may change. */
export const PROTECTED_FIELDS: Partial<Record<Collection, string[]>> = {
  quotes: ["status", "bookingId", "total", "number", "shareToken", "views", "version"],
  bookings: ["status", "invoiceId", "number", "sellTotal", "costTotal", "quoteId"],
  leads: ["stage", "score", "temperature", "scoreReasons", "bookingId"],
  services: ["status", "voucherNo"],
  visaCases: ["status", "number", "uploadToken"],
  supplierBills: ["paid", "status"],
  campaigns: ["status", "sentCount", "cost"],
  coupons: ["uses"],
  agents: ["blocked"],
  automations: ["runs", "lastRunAt"],
};

export { allocate, applyBps };
