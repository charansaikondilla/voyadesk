/**
 * Money features: payment links (sandbox / Razorpay / Stripe / PayPal) with automatic reconciliation, EMI,
 * hold-now-pay-later, public coupons, multi-PAN TCS payers, agent commissions and post-sale amendments with approval.
 */
import { z } from "zod";
import { internals, priceOfQuote, registerActions } from "../actions.js";
import { addDays, type ISODate } from "../dates.js";
import { type Entity, type PaymentLink, type Quote } from "../entities.js";
import { docNumber, newId, randomToken } from "../ids.js";
import { invoiceLegs, supplierBillLegs, walletTopUpLegs, type Leg } from "../ledger.js";
import { queueMessage, T } from "../messaging.js";
import { applyBps } from "../money.js";
import { registerActionRoles } from "../permissions.js";
import { providersFor } from "../providers.js";
import { DomainError } from "../rules.js";
import { createRow, getSettings, mustGet, patchRow, todayOf, type Ctx, type Store } from "../store.js";
import { splitGst } from "../tax.js";
import { emiPlan } from "../toolkit.js";
import { action, linkFor, log, money, optStr, rupees, withProvider } from "./shared.js";

const { confirmQuote, recordPaymentInternal, postLedger, issueCreditNote, outstandingOf, nextNumber, applyChosenOption, taxRules, firstUserWithRole } = internals;

/* ───────────────────────── payment links ───────────────────────── */

export interface LinkInput {
  purpose: PaymentLink["purpose"];
  amount: number;
  description: string;
  customer: { name: string; phone: string; email: string };
  invoiceId?: string | null;
  quoteId?: string | null;
  visaCaseId?: string | null;
  emiMonths?: number;
  optionKey?: string;
  selectedOptionalIds?: string[];
}

export async function createLink(s: Store, ctx: Ctx, i: LinkInput): Promise<PaymentLink> {
  const settings = await getSettings(s, ctx.now);
  const p = providersFor(ctx).payments;
  if (p.name === "none") throw new DomainError("Connect a payment gateway (Razorpay, Stripe or PayPal) in Settings → Integrations to take online payments.", 422);
  if (i.amount <= 0) throw new DomainError("Nothing is due.", 409);
  const token = randomToken(24);
  const returnUrl = await linkFor(s, ctx, `/pay/${ctx.tenantId}/${token}`);
  const res = await withProvider(() => p.createLink({
    token, amount: i.amount, currency: settings.baseCurrency, description: i.description.slice(0, 240), customer: i.customer, returnUrl, emiMonths: i.emiMonths,
  }));
  const link = await createRow(s, "paymentLinks", {
    purpose: i.purpose, invoiceId: i.invoiceId ?? null, quoteId: i.quoteId ?? null, visaCaseId: i.visaCaseId ?? null, amount: i.amount,
    currency: settings.baseCurrency, provider: p.name as PaymentLink["provider"], url: res.url, providerRef: res.providerRef, token,
    customerName: i.customer.name, phone: i.customer.phone, email: i.customer.email, emiMonths: i.emiMonths ?? 0,
    expiresAt: addDays(todayOf(ctx, settings), 7) + "T23:59:59.000Z", optionKey: i.optionKey ?? "", selectedOptionalIds: i.selectedOptionalIds ?? [],
  }, ctx.now);
  return link;
}

const GATEWAY: Record<PaymentLink["provider"], Entity<"payments">["gateway"]> = { sandbox: "sandbox", razorpay: "razorpay", stripe: "stripe", paypal: "paypal" };

/**
 * A gateway (or the sandbox) says the link was paid: record the payment against the invoice, or confirm the
 * proposal into a booking with this payment. Idempotent: a second notification for the same link does nothing.
 */
export async function settlePaymentLink(
  s: Store, ctx: Ctx, link: PaymentLink, paid: { amount: number; method: string; reference: string; emiMonths?: number },
): Promise<{ link: PaymentLink; bookingId: string | null; invoiceId: string | null }> {
  if (link.status === "paid") return { link, bookingId: null, invoiceId: link.invoiceId };
  if (link.status === "cancelled") throw new DomainError("This payment link was cancelled.", 409);
  const method = (["upi", "card", "netbanking", "wallet", "emi"].includes(paid.method) ? paid.method : "card") as Entity<"payments">["method"];
  const gateway = GATEWAY[link.provider];
  let bookingId: string | null = null;
  let invoiceId = link.invoiceId;
  if (link.purpose === "proposal" && link.quoteId) {
    const q = await mustGet(s, "quotes", link.quoteId);
    if (q.status === "accepted" && q.bookingId) {
      const b = await mustGet(s, "bookings", q.bookingId);
      invoiceId = b.invoiceId;
      bookingId = b.id;
      if (invoiceId) {
        const inv = await mustGet(s, "invoices", invoiceId);
        const amt = Math.min(paid.amount, outstandingOf(inv));
        if (amt > 0) await recordPaymentInternal(s, ctx, inv.id, { amount: amt, method, gateway, reference: paid.reference });
      }
    } else {
      const chosen = await applyChosenOption(s, ctx, q, link.optionKey || undefined);
      const r = await confirmQuote(s, ctx, chosen, { selectedOptionalIds: link.selectedOptionalIds, payment: { amount: paid.amount, method, gateway, reference: paid.reference } });
      bookingId = r.booking.id;
      invoiceId = r.invoice.id;
      await afterConfirmHook?.(s, ctx, r.booking.id);
      for (const h of (await s.list("holds")).filter((x) => x.quoteId === q.id && x.status === "held")) await patchRow(s, "holds", h.id, { status: "converted" }, ctx.now);
    }
  } else if (invoiceId) {
    const inv = await mustGet(s, "invoices", invoiceId);
    const amt = Math.min(paid.amount, outstandingOf(inv));
    if (amt <= 0) throw new DomainError("This invoice is already paid.", 409);
    const r = await recordPaymentInternal(s, ctx, inv.id, { amount: amt, method, gateway, reference: paid.reference });
    bookingId = inv.bookingId;
    if (link.visaCaseId) {
      const vc = await s.get("visaCases", link.visaCaseId);
      if (vc) await patchRow(s, "visaCases", vc.id, { paid: vc.paid + amt }, ctx.now);
    }
    await queueMessage(s, ctx, { phone: link.phone, email: link.email, body: T.paymentReceipt(link.customerName, amt, inv.number, outstandingOf(r.invoice)), kind: "notification", invoiceId: inv.id, bookingId: inv.bookingId, visaCaseId: link.visaCaseId });
  } else {
    throw new DomainError("This payment link is not attached to anything payable.", 409);
  }
  const out = await patchRow(s, "paymentLinks", link.id, { status: "paid", paidAt: ctx.now.toISOString(), method, emiMonths: paid.emiMonths ?? link.emiMonths, invoiceId: invoiceId ?? null }, ctx.now);
  await log(s, ctx, { bookingId, visaCaseId: link.visaCaseId, kind: "payment", body: `Online payment ${rupees(paid.amount)} received via ${link.provider === "sandbox" ? "sandbox gateway (test)" : link.provider}${paid.emiMonths ? ` on ${paid.emiMonths}-month EMI` : ""}. Reference ${paid.reference}.` });
  return { link: out, bookingId, invoiceId };
}

/** Set by the engines module so payments that confirm a quote also run inventory and notification steps. */
let afterConfirmHook: ((s: Store, ctx: Ctx, bookingId: string) => Promise<void>) | null = null;
export function setAfterConfirm(fn: (s: Store, ctx: Ctx, bookingId: string) => Promise<void>): void {
  afterConfirmHook = fn;
}

/** Visa fees are billed on a proper invoice (embassy fee at cost, service fee with 18% GST) before collecting online. */
async function ensureVisaInvoice(s: Store, ctx: Ctx, vc: Entity<"visaCases">): Promise<Entity<"invoices">> {
  if (vc.invoiceId) return mustGet(s, "invoices", vc.invoiceId);
  const settings = await getSettings(s, ctx.now);
  const today = todayOf(ctx, settings);
  const master = vc.visaMasterId ? await s.get("visaMasters", vc.visaMasterId) : undefined;
  const n = Math.max(1, vc.applicants.length);
  const serviceFee = (master?.serviceFee ?? 0) * n;
  const fee = vc.fee > 0 ? vc.fee - serviceFee : 0;
  if (vc.fee <= 0) throw new DomainError("Set the visa fee on this case before asking for payment.", 422);
  const gst = applyBps(serviceFee, 1800);
  const split = splitGst(gst, settings.state, settings.state);
  const party = { type: vc.agentId ? ("agent" as const) : ("customer" as const), id: vc.agentId ?? vc.contactId, name: vc.contactName };
  const inv = await createRow(s, "invoices", {
    number: await nextNumber(s, "invoice", settings.invoicePrefix, today), bookingId: null, partyType: party.type, partyId: party.id, partyName: party.name,
    placeOfSupply: settings.state, supplierState: settings.state, scope: "overseas", issueDate: today, dueDate: today, currency: settings.baseCurrency,
    lines: [
      { description: `${vc.country} ${vc.visaType} visa fee at cost (pure agent) — ${vc.number}, ${n} applicant${n > 1 ? "s" : ""}`, sac: "", amount: fee },
      { description: "Visa service fee", sac: "998559", amount: serviceFee },
    ].filter((l) => l.amount > 0),
    sell: fee + serviceFee, gst, ...split, tcs: 0, total: fee + serviceFee + gst, paid: vc.paid > 0 ? Math.min(vc.paid, fee + serviceFee + gst) : 0,
  }, ctx.now);
  await postLedger(s, ctx, today, invoiceLegs({ party, sell: fee + serviceFee, gst, tcs: 0 }), { type: "invoice", id: inv.id, memo: `Invoice ${inv.number} — visa ${vc.number}` });
  await patchRow(s, "visaCases", vc.id, { invoiceId: inv.id }, ctx.now);
  return inv;
}

/** Amount to pay on a proposal: chosen option + ticked add-ons, advance or full. */
export function proposalAmount(q: Quote, today: ISODate, opts: { option?: string; selectedOptionalIds: string[]; mode: "advance" | "full"; advancePercent: number }) {
  const lines = q.lines.map((l) => (l.optional ? { ...l, selected: opts.selectedOptionalIds.includes(l.id) } : l));
  const priced = priceOfQuote({ ...q, lines, chosenOption: opts.option ?? q.chosenOption }, today);
  const advance = Math.max(100, Math.round((priced.total * opts.advancePercent) / 100 / 100) * 100);
  return { total: priced.total, amount: opts.mode === "full" || opts.advancePercent >= 100 ? priced.total : Math.min(priced.total, advance) };
}

async function quoteByToken(s: Store, token: string): Promise<Quote> {
  const q = (await s.list("quotes")).find((x) => x.shareToken === token && x.status !== "draft");
  if (!q) throw new DomainError("This proposal link is not valid or has been withdrawn.", 404);
  return q;
}

/* ───────────────────────── amendments ───────────────────────── */

const reverse = (legs: Leg[]): Leg[] => legs.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));

const changeInput = z.object({
  kind: z.enum(["add", "change", "remove"]), serviceId: z.string().nullable().optional(),
  type: z.enum(["hotel", "flight", "transfer", "sightseeing", "activity", "visa", "insurance", "meal", "other"]).default("other"),
  title: optStr(160), date: z.string().nullable().optional(), netCost: money.default(0), supplierId: z.string().nullable().optional(),
});

async function amendmentImpact(s: Store, bookingId: string, changes: z.output<typeof changeInput>[]) {
  const services = (await s.list("services")).filter((x) => x.bookingId === bookingId);
  let cost = 0;
  for (const c of changes) {
    const sv = c.serviceId ? services.find((x) => x.id === c.serviceId) : undefined;
    if (c.kind !== "add" && !sv) throw new DomainError("Pick the service to change or remove.", 422);
    if (c.kind === "add") cost += c.netCost;
    if (c.kind === "change") cost += c.netCost - sv!.netCost;
    if (c.kind === "remove") cost -= sv!.status === "cancelled" ? 0 : sv!.netCost;
  }
  return cost;
}

/* ───────────────────────── actions ───────────────────────── */

registerActionRoles({
  createPaymentLink: ["owner", "admin", "accounts", "sales", "visa"],
  cancelPaymentLink: ["owner", "admin", "accounts"],
  setTcsPayers: ["owner", "admin", "accounts", "sales"],
  verifyPan: ["owner", "admin", "accounts", "sales"],
  payCommissions: ["owner", "admin", "accounts"],
  requestAmendment: ["owner", "admin", "ops", "sales"],
  decideAmendment: ["owner", "admin", "accounts"],
  emiOptions: "*",
});

registerActions({
  createPaymentLink: action(z.object({ invoiceId: z.string().optional(), visaCaseId: z.string().optional(), amount: money.optional(), emiMonths: z.number().int().min(0).max(36).optional(), send: z.boolean().default(true) }), async (s, ctx, i) => {
    let inv: Entity<"invoices">;
    let person = { name: "", phone: "", email: "" };
    let visaCaseId: string | null = null;
    if (i.visaCaseId) {
      const vc = await mustGet(s, "visaCases", i.visaCaseId);
      inv = await ensureVisaInvoice(s, ctx, vc);
      person = { name: vc.contactName, phone: vc.phone, email: vc.email };
      visaCaseId = vc.id;
    } else if (i.invoiceId) {
      inv = await mustGet(s, "invoices", i.invoiceId);
      const b = inv.bookingId ? await s.get("bookings", inv.bookingId) : undefined;
      const agent = inv.partyType === "agent" && inv.partyId ? await s.get("agents", inv.partyId) : undefined;
      person = { name: inv.partyName, phone: agent?.phone ?? b?.phone ?? "", email: agent?.email ?? b?.email ?? "" };
    } else throw new DomainError("Pick the invoice or visa case to collect for.", 422);
    const due = outstandingOf(inv);
    if (due <= 0) throw new DomainError(`Invoice ${inv.number} is already fully paid.`, 409);
    const amount = Math.min(i.amount ?? due, due);
    const link = await createLink(s, ctx, { purpose: visaCaseId ? "visa" : "invoice", amount, description: `Payment for ${inv.number}`, customer: person, invoiceId: inv.id, visaCaseId, emiMonths: i.emiMonths });
    if (i.send) {
      await queueMessage(s, ctx, { phone: person.phone, email: person.email, subject: `Payment link for ${inv.number}`, body: T.paymentReminder(person.name, inv.number, amount, inv.dueDate, link.url), kind: "reminder", invoiceId: inv.id, bookingId: inv.bookingId, visaCaseId });
    }
    await log(s, ctx, { bookingId: inv.bookingId, visaCaseId, body: `Payment link for ${rupees(amount)} created on ${inv.number}${i.send ? " and sent" : ""}.` });
    return link;
  }),

  cancelPaymentLink: action(z.object({ linkId: z.string() }), async (s, ctx, i) => {
    const l = await mustGet(s, "paymentLinks", i.linkId);
    if (l.status !== "created") throw new DomainError(`This link is already ${l.status}.`, 409);
    return patchRow(s, "paymentLinks", l.id, { status: "cancelled" }, ctx.now);
  }),

  emiOptions: action(z.object({ amount: money }), async (s, ctx, i) => {
    const settings = await getSettings(s, ctx.now);
    return settings.emiPlans.map((p) => emiPlan(i.amount, p.months, p.rateBps));
  }),

  setTcsPayers: action(z.object({ invoiceId: z.string(), payers: z.array(z.object({ name: z.string().trim().min(1, "Payer name"), pan: z.string().trim(), relation: optStr(40), amount: money })).min(1).max(10) }), async (s, ctx, i) => {
    const inv = await mustGet(s, "invoices", i.invoiceId);
    const sum = i.payers.reduce((a, p) => a + p.amount, 0);
    if (sum !== inv.total) throw new DomainError(`The payers' amounts add up to ${rupees(sum)}, but the invoice total is ${rupees(inv.total)}.`, 422);
    const pan = providersFor(ctx).pan;
    for (const old of (await s.list("tcsPayers")).filter((x) => x.invoiceId === inv.id)) await s.remove("tcsPayers", old.id);
    const out = [];
    for (const p of i.payers) {
      const v = await pan.verify(p.pan.toUpperCase(), p.name);
      if (!v.valid) throw new DomainError(`${p.name}: ${v.note}`, 422);
      out.push(await createRow(s, "tcsPayers", { invoiceId: inv.id, name: p.name, pan: p.pan, relation: p.relation ?? "", amount: p.amount, verified: !v.notConfigured, verifiedName: v.name ?? "", verifyNote: v.note }, ctx.now));
    }
    await log(s, ctx, { bookingId: inv.bookingId, body: `TCS split across ${out.length} PAN${out.length > 1 ? "s" : ""} on ${inv.number}: ${out.map((p) => `${p.name} (${p.pan}) ${rupees(p.amount)}`).join(", ")}.` });
    return out;
  }),

  verifyPan: action(z.object({ pan: z.string().trim().toUpperCase(), name: z.string().trim().min(1) }), async (_s, ctx, i) => providersFor(ctx).pan.verify(i.pan, i.name)),

  payCommissions: action(z.object({ commissionIds: z.array(z.string()).min(1) }), async (s, ctx, i) => {
    const settings = await getSettings(s, ctx.now);
    const today = todayOf(ctx, settings);
    const rows = await Promise.all(i.commissionIds.map((id) => mustGet(s, "commissions", id)));
    const open = rows.filter((r) => r.status === "accrued");
    if (!open.length) throw new DomainError("These commissions are already paid.", 409);
    const byAgent = new Map<string, number>();
    for (const r of open) byAgent.set(r.agentId, (byAgent.get(r.agentId) ?? 0) + r.amount);
    for (const [agentId, amount] of byAgent) {
      const agent = await mustGet(s, "agents", agentId);
      // Commission expense (booked to cost of sales) credited to the agent's wallet
      await postLedger(s, ctx, today, [{ account: "cost_of_sales", debit: amount }, { account: "wallet", credit: amount, party: { type: "agent", id: agent.id, name: agent.name } }], { type: "commission", id: newId("cpay"), memo: `Commission paid to ${agent.name}` });
    }
    for (const r of open) await patchRow(s, "commissions", r.id, { status: "paid", paidAt: ctx.now.toISOString() }, ctx.now);
    return { paid: open.length, total: open.reduce((a, r) => a + r.amount, 0) };
  }),

  requestAmendment: action(z.object({ bookingId: z.string(), reason: z.string().trim().min(3, "Say why the booking is changing").max(500), changes: z.array(changeInput).min(1, "Add at least one change"), sellImpact: z.number().int() }), async (s, ctx, i) => {
    const b = await mustGet(s, "bookings", i.bookingId);
    if (b.status === "cancelled" || b.status === "completed") throw new DomainError(`This booking is ${b.status}.`, 409);
    if (i.sellImpact < 0 && -i.sellImpact > b.sellTotal) throw new DomainError("The price reduction is more than the booking value.", 422);
    const cost = await amendmentImpact(s, b.id, i.changes);
    const inv = b.invoiceId ? await s.get("invoices", b.invoiceId) : undefined;
    const gstImpact = inv && inv.sell > 0 ? Math.round((i.sellImpact * inv.gst) / inv.sell) : 0;
    const seq = await s.nextSeq("amendment");
    const a = await createRow(s, "amendments", {
      number: docNumber("AMD", seq), bookingId: b.id, reason: i.reason,
      changes: i.changes.map((c) => ({ kind: c.kind, serviceId: c.serviceId ?? null, type: c.type, title: c.title ?? "", date: c.date ?? null, netCost: c.netCost, sell: 0, supplierId: c.supplierId ?? null })),
      costImpact: cost, sellImpact: i.sellImpact, gstImpact, requestedById: ctx.userId,
    }, ctx.now);
    const approver = await firstUserWithRole(s, ["accounts", "owner", "admin"]);
    await createRow(s, "tasks", { title: `Approve change ${a.number} on ${b.number}: margin ${rupees(Math.abs(i.sellImpact - cost))} ${i.sellImpact - cost >= 0 ? "gain" : "loss"}`, dueAt: new Date(ctx.now.getTime() + 4 * 3600_000).toISOString(), assigneeId: approver, bookingId: b.id, priority: "high" }, ctx.now);
    await log(s, ctx, { bookingId: b.id, body: `Change ${a.number} requested: ${i.reason}. Cost ${cost >= 0 ? "+" : "−"}${rupees(Math.abs(cost))}, price ${i.sellImpact >= 0 ? "+" : "−"}${rupees(Math.abs(i.sellImpact))}. Waiting for approval.` });
    return a;
  }),

  decideAmendment: action(z.object({ amendmentId: z.string(), approve: z.boolean(), note: optStr(500) }), async (s, ctx, i) => {
    const a = await mustGet(s, "amendments", i.amendmentId);
    if (a.status !== "pending") throw new DomainError(`This change is already ${a.status}.`, 409);
    if (a.requestedById === ctx.userId && ctx.role !== "owner") throw new DomainError("Someone else must approve a change you requested.", 403);
    if (!i.approve) {
      const out = await patchRow(s, "amendments", a.id, { status: "rejected", decidedById: ctx.userId, decisionNote: i.note ?? "" }, ctx.now);
      await log(s, ctx, { bookingId: a.bookingId, body: `Change ${a.number} rejected${i.note ? `: ${i.note}` : ""}.` });
      return out;
    }
    const settings = await getSettings(s, ctx.now);
    const today = todayOf(ctx, settings);
    const b = await mustGet(s, "bookings", a.bookingId);
    const suppliers = await s.list("suppliers");
    const costBySupplier = new Map<string, number>();
    for (const c of a.changes) {
      if (c.kind === "add") {
        await createRow(s, "services", { bookingId: b.id, type: c.type, title: c.title || "Added service", supplierId: c.supplierId, date: c.date ?? b.startDate, netCost: c.netCost, status: "pending" }, ctx.now);
        if (c.supplierId) costBySupplier.set(c.supplierId, (costBySupplier.get(c.supplierId) ?? 0) + c.netCost);
      } else {
        const sv = await mustGet(s, "services", c.serviceId);
        if (c.kind === "change") {
          await patchRow(s, "services", sv.id, { title: c.title || sv.title, date: c.date ?? sv.date, netCost: c.netCost, notes: [sv.notes, `Changed by ${a.number} — reconfirm with the supplier.`].filter(Boolean).join("\n") }, ctx.now);
          if (sv.supplierId) costBySupplier.set(sv.supplierId, (costBySupplier.get(sv.supplierId) ?? 0) + c.netCost - sv.netCost);
        } else if (sv.status !== "cancelled") {
          await patchRow(s, "services", sv.id, { status: "cancelled", notes: [sv.notes, `Removed by ${a.number}.`].filter(Boolean).join("\n") }, ctx.now);
          if (sv.supplierId) costBySupplier.set(sv.supplierId, (costBySupplier.get(sv.supplierId) ?? 0) - sv.netCost);
        }
      }
    }
    // Supplier side: extra cost → new bill; lower cost → reduce the unpaid part of an open bill
    for (const [supplierId, delta] of costBySupplier) {
      if (delta === 0) continue;
      const sup = suppliers.find((x) => x.id === supplierId);
      const party = { type: "supplier" as const, id: supplierId, name: sup?.name ?? "Supplier" };
      if (delta > 0) {
        const bill = await createRow(s, "supplierBills", { supplierId, supplierName: party.name, bookingId: b.id, amount: delta, dueDate: today, reference: a.number }, ctx.now);
        await postLedger(s, ctx, today, supplierBillLegs({ party, amount: delta }), { type: "supplierBill", id: bill.id, memo: `${a.number} extra cost — ${party.name}` });
      } else {
        let left = -delta;
        for (const bill of (await s.list("supplierBills")).filter((x) => x.bookingId === b.id && x.supplierId === supplierId && x.amount > x.paid)) {
          const cut = Math.min(left, bill.amount - bill.paid);
          if (cut <= 0) continue;
          await patchRow(s, "supplierBills", bill.id, { amount: bill.amount - cut, status: bill.paid >= bill.amount - cut ? "paid" : bill.paid > 0 ? "partially_paid" : "open" }, ctx.now);
          await postLedger(s, ctx, today, reverse(supplierBillLegs({ party, amount: cut })), { type: "supplierBill", id: bill.id, memo: `${a.number} cost reduced — ${party.name}` });
          left -= cut;
        }
        if (left > 0) await log(s, ctx, { bookingId: b.id, body: `${party.name} has already been paid; ask them for a refund or credit of ${rupees(left)}.` });
      }
    }
    // Customer side: higher price → supplementary invoice; lower price → credit note
    let invoiceId: string | null = null;
    let creditNoteId: string | null = null;
    const orig = b.invoiceId ? await s.get("invoices", b.invoiceId) : undefined;
    if (a.sellImpact > 0 && orig) {
      const split = splitGst(a.gstImpact, orig.supplierState, orig.placeOfSupply);
      const sup = await createRow(s, "invoices", {
        number: await nextNumber(s, "invoice", settings.invoicePrefix, today), bookingId: b.id, partyType: orig.partyType, partyId: orig.partyId, partyName: orig.partyName,
        gstin: orig.gstin, pan: orig.pan, placeOfSupply: orig.placeOfSupply, supplierState: orig.supplierState, scope: orig.scope, issueDate: today, dueDate: today,
        currency: orig.currency, lines: [{ description: `Change ${a.number} to ${b.number}: ${a.reason}`, sac: orig.lines[0]?.sac ?? "", amount: a.sellImpact }],
        sell: a.sellImpact, gst: a.gstImpact, ...split, tcs: 0, total: a.sellImpact + a.gstImpact,
      }, ctx.now);
      await postLedger(s, ctx, today, invoiceLegs({ party: { type: orig.partyType, id: orig.partyId, name: orig.partyName }, sell: a.sellImpact, gst: a.gstImpact, tcs: 0 }), { type: "invoice", id: sup.id, memo: `Supplementary invoice ${sup.number} — ${a.number}` });
      invoiceId = sup.id;
    } else if (a.sellImpact < 0 && orig) {
      const cn = await issueCreditNote(s, ctx, { invoiceId: orig.id, amount: Math.min(orig.total - orig.credited, -a.sellImpact - a.gstImpact), reason: `Change ${a.number}: ${a.reason}`, refundTo: "none" });
      creditNoteId = (cn as { creditNote?: { id: string }; id?: string }).creditNote?.id ?? (cn as { id?: string }).id ?? null;
    }
    await patchRow(s, "bookings", b.id, { sellTotal: Math.max(0, b.sellTotal + a.sellImpact), costTotal: Math.max(0, b.costTotal + a.costImpact) }, ctx.now);
    const out = await patchRow(s, "amendments", a.id, { status: "approved", decidedById: ctx.userId, decisionNote: i.note ?? "", invoiceId, creditNoteId }, ctx.now);
    await log(s, ctx, { bookingId: b.id, leadId: b.leadId, body: `Change ${a.number} approved and applied${invoiceId ? " — supplementary invoice issued" : creditNoteId ? " — credit note issued" : ""}.` });
    return out;
  }),
});

/* ───────────────────────── public (customer) actions ───────────────────────── */

registerActions({
  proposalPay: action(z.object({ token: z.string().min(8), option: z.string().max(2).optional(), selectedOptionalIds: z.array(z.string()).default([]), mode: z.enum(["advance", "full"]).default("full"), emiMonths: z.number().int().min(0).max(36).default(0) }), async (s, ctx, i) => {
    const q = await quoteByToken(s, i.token);
    const settings = await getSettings(s, ctx.now);
    const today = todayOf(ctx, settings);
    if (q.status === "accepted") {
      const b = q.bookingId ? await mustGet(s, "bookings", q.bookingId) : null;
      const inv = b?.invoiceId ? await mustGet(s, "invoices", b.invoiceId) : null;
      if (!inv || outstandingOf(inv) <= 0) throw new DomainError("This booking is fully paid. Thank you!", 409);
      return createLink(s, ctx, { purpose: "invoice", amount: outstandingOf(inv), description: `Balance for ${b!.number}`, customer: { name: q.contactName, phone: q.phone, email: q.email }, invoiceId: inv.id, emiMonths: i.emiMonths });
    }
    if (q.validUntil && q.validUntil < today) throw new DomainError("This proposal has expired. Please ask us for a fresh quote.", 409);
    if (q.options.length && !(i.option && q.options.some((o) => o.key === i.option))) throw new DomainError(`Choose one of the options: ${q.options.map((o) => o.name).join(", ")}.`, 422);
    const { amount, total } = proposalAmount(q, today, { option: i.option, selectedOptionalIds: i.selectedOptionalIds, mode: i.emiMonths ? "full" : i.mode, advancePercent: settings.advancePercent });
    const link = await createLink(s, ctx, {
      purpose: "proposal", amount, description: `${amount < total ? "Advance" : "Payment"} for ${q.title} (${q.number})`, customer: { name: q.contactName, phone: q.phone, email: q.email },
      quoteId: q.id, emiMonths: i.emiMonths, optionKey: i.option ?? "", selectedOptionalIds: i.selectedOptionalIds,
    });
    return { ...link, total };
  }),

  proposalHold: action(z.object({ token: z.string().min(8), option: z.string().max(2).optional(), selectedOptionalIds: z.array(z.string()).default([]) }), async (s, ctx, i) => {
    const q = await quoteByToken(s, i.token);
    if (q.status === "accepted") throw new DomainError("This proposal is already confirmed.", 409);
    const settings = await getSettings(s, ctx.now);
    const today = todayOf(ctx, settings);
    if (q.validUntil && q.validUntil < today) throw new DomainError("This proposal has expired. Please ask us for a fresh quote.", 409);
    const existing = (await s.list("holds")).find((h) => h.quoteId === q.id && h.status === "held");
    if (existing) return existing;
    const { total } = proposalAmount(q, today, { option: i.option, selectedOptionalIds: i.selectedOptionalIds, mode: "full", advancePercent: 100 });
    const holdUntil = new Date(ctx.now.getTime() + settings.holdHours * 3600_000).toISOString();
    const h = await createRow(s, "holds", { quoteId: q.id, contactName: q.contactName, phone: q.phone, amount: total, holdUntil, optionKey: i.option ?? "" }, ctx.now);
    // A hold extends the proposal so the customer can pay until the hold ends
    const holdDay = holdUntil.slice(0, 10);
    if (!q.validUntil || q.validUntil < holdDay) await patchRow(s, "quotes", q.id, { validUntil: holdDay }, ctx.now);
    await log(s, ctx, { leadId: q.leadId, body: `Customer put ${q.number} on hold for ${settings.holdHours} hours (pay later). Price locked at ${rupees(total)}.` });
    const owner = q.ownerId ?? (await firstUserWithRole(s, ["sales", "owner"]));
    await createRow(s, "tasks", { title: `Follow up: ${q.contactName} is holding ${q.number} until ${new Date(holdUntil).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}`, dueAt: new Date(ctx.now.getTime() + 6 * 3600_000).toISOString(), assigneeId: owner, leadId: q.leadId, priority: "high" }, ctx.now);
    return h;
  }),

  proposalCoupon: action(z.object({ token: z.string().min(8), code: z.string().trim().toUpperCase().max(20) }), async (s, ctx, i) => {
    const q = await quoteByToken(s, i.token);
    if (q.status === "accepted") throw new DomainError("This proposal is already confirmed.", 409);
    const settings = await getSettings(s, ctx.now);
    const today = todayOf(ctx, settings);
    const c = (await s.list("coupons")).find((x) => x.code === i.code);
    if (!c || !c.active) throw new DomainError(`Coupon ${i.code} is not valid.`, 422);
    if (c.validFrom && today < c.validFrom) throw new DomainError(`Coupon ${i.code} starts on ${c.validFrom}.`, 422);
    if (c.validTo && today > c.validTo) throw new DomainError(`Coupon ${i.code} expired on ${c.validTo}.`, 422);
    if (c.maxUses > 0 && c.uses >= c.maxUses) throw new DomainError(`Coupon ${i.code} has been fully used.`, 422);
    const discount = { kind: c.kind, value: c.value };
    const priced = priceOfQuote({ ...q, discount }, today);
    if (priced.margin < 0) throw new DomainError(`Coupon ${i.code} can't be used on this proposal.`, 422);
    await patchRow(s, "quotes", q.id, { discount, couponCode: c.code, total: priced.total }, ctx.now);
    await log(s, ctx, { leadId: q.leadId, body: `Customer applied coupon ${c.code} on ${q.number}.` });
    return { code: c.code, total: priced.total };
  }),

  payLinkInfo: action(z.object({ token: z.string().min(8) }), async (s, ctx, i) => {
    const l = (await s.list("paymentLinks")).find((x) => x.token === i.token);
    if (!l) throw new DomainError("This payment link is not valid.", 404);
    const settings = await getSettings(s, ctx.now);
    const expired = l.status === "created" && l.expiresAt !== null && l.expiresAt < ctx.now.toISOString();
    return {
      company: { name: settings.companyName, brandColor: settings.brandColor, phone: settings.phone, email: settings.email },
      link: { amount: l.amount, currency: l.currency, status: expired ? "expired" : l.status, provider: l.provider, url: l.url, customerName: l.customerName, emiMonths: l.emiMonths, purpose: l.purpose, paidAt: l.paidAt },
      emi: settings.emiPlans.map((p) => emiPlan(l.amount, p.months, p.rateBps)),
    };
  }),

  sandboxPay: action(z.object({ token: z.string().min(8), method: z.enum(["upi", "card", "netbanking", "emi"]).default("upi"), emiMonths: z.number().int().min(0).max(36).default(0) }), async (s, ctx, i) => {
    const l = (await s.list("paymentLinks")).find((x) => x.token === i.token);
    if (!l) throw new DomainError("This payment link is not valid.", 404);
    if (l.provider !== "sandbox") throw new DomainError("This link is paid on the gateway's own page.", 409);
    if (l.status === "created" && l.expiresAt && l.expiresAt < ctx.now.toISOString()) throw new DomainError("This payment link has expired. Ask for a new one.", 409);
    const r = await settlePaymentLink(s, ctx, l, { amount: l.amount, method: i.method === "emi" ? "emi" : i.method, reference: `TEST-${randomToken(8).toUpperCase()}`, emiMonths: i.method === "emi" ? i.emiMonths : 0 });
    const b = r.bookingId ? await s.get("bookings", r.bookingId) : undefined;
    return { status: "paid", bookingNumber: b?.number ?? null };
  }),
}, true);

export { ensureVisaInvoice, quoteByToken, walletTopUpLegs };
