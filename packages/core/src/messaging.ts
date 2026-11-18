/**
 * Outgoing messages (WhatsApp, email, SMS). Workflows queue a row in `outbox`; deliverQueued() sends it through
 * the tenant's provider. In the demo the sandbox "delivers" instantly; a real tenant without a provider keeps the
 * message queued with a clear note, so nothing is lost and nothing is pretended.
 */
import { type Entity, type Outbox } from "./entities.js";
import { providersFor } from "./providers.js";
import { createRow, getSettings, patchRow, type Ctx, type Store } from "./store.js";
import { formatMoney } from "./money.js";

export type Channel = "whatsapp" | "email" | "sms";

export interface QueueInput {
  channel?: Channel;
  phone?: string | null;
  email?: string | null;
  subject?: string;
  body: string;
  kind?: Outbox["kind"];
  status?: "queued" | "draft";
  scheduledAt?: string | null;
  leadId?: string | null;
  bookingId?: string | null;
  visaCaseId?: string | null;
  campaignId?: string | null;
  contactId?: string | null;
  invoiceId?: string | null;
  dripId?: string | null;
  dripStep?: number | null;
}

/** Pick the channel: the one asked for if we have the address for it, else WhatsApp by phone, else email. */
export function pickChannel(want: Channel | undefined, phone?: string | null, email?: string | null): { channel: Channel; to: string } | null {
  const p = (phone ?? "").trim();
  const e = (email ?? "").trim();
  if (want === "email" && e) return { channel: "email", to: e };
  if ((want === "whatsapp" || want === "sms") && p) return { channel: want, to: p };
  if (p) return { channel: "whatsapp", to: p };
  if (e) return { channel: "email", to: e };
  return null;
}

/** Queue one message. Returns null when the person has no phone or email (nothing to send to). */
export async function queueMessage(store: Store, ctx: Ctx, m: QueueInput): Promise<Outbox | null> {
  const target = pickChannel(m.channel, m.phone, m.email);
  if (!target) return null;
  return createRow(store, "outbox", {
    channel: target.channel, to: target.to, subject: m.subject ?? "", body: m.body.slice(0, 4000), kind: m.kind ?? "notification",
    status: m.status ?? "queued", scheduledAt: m.scheduledAt ?? null, leadId: m.leadId ?? null, bookingId: m.bookingId ?? null,
    visaCaseId: m.visaCaseId ?? null, campaignId: m.campaignId ?? null, contactId: m.contactId ?? null, invoiceId: m.invoiceId ?? null,
    dripId: m.dripId ?? null, dripStep: m.dripStep ?? null,
  }, ctx.now);
}

/** Send everything that is due. Safe to call often; each row is attempted at most 3 times with back-off. */
export async function deliverQueued(store: Store, ctx: Ctx, limit = 200): Promise<{ sent: number; failed: number; waiting: number }> {
  const p = providersFor(ctx).messaging;
  const now = ctx.now.toISOString();
  const due = (await store.list("outbox"))
    .filter((o) => o.status === "queued" && (!o.scheduledAt || o.scheduledAt <= now))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(0, limit);
  let sent = 0, failed = 0, waiting = 0;
  for (const o of due) {
    const r = await p.send({ channel: o.channel, to: o.to, subject: o.subject, body: o.body, kind: o.kind });
    if (r.ok) {
      sent++;
      await patchRow(store, "outbox", o.id, { status: r.delivered ? "delivered" : "sent", provider: p.name, providerRef: r.ref ?? "", sentAt: now, error: "", attempts: o.attempts + 1 }, ctx.now);
    } else if (r.notConfigured) {
      waiting++;
      if (o.error !== r.error) await patchRow(store, "outbox", o.id, { error: `${o.channel === "email" ? "Email" : "WhatsApp"} isn't connected yet — this will send once it is.` }, ctx.now);
    } else {
      const attempts = o.attempts + 1;
      if (attempts >= 3) failed++;
      await patchRow(store, "outbox", o.id, {
        status: attempts >= 3 ? "failed" : "queued", attempts, error: (r.error ?? "Send failed").slice(0, 300), provider: p.name,
        scheduledAt: attempts >= 3 ? o.scheduledAt : new Date(ctx.now.getTime() + attempts * 5 * 60_000).toISOString(),
      }, ctx.now);
    }
  }
  return { sent, failed, waiting };
}

/** Apply a delivery receipt from a provider webhook (WhatsApp statuses, email events). */
export async function applyDeliveryStatus(store: Store, ctx: Ctx, providerRef: string, status: "sent" | "delivered" | "read" | "failed", error?: string): Promise<boolean> {
  const row = (await store.list("outbox")).find((o) => o.providerRef === providerRef);
  if (!row) return false;
  const rank = { draft: 0, queued: 1, skipped: 1, failed: 1, sent: 2, delivered: 3, read: 4 } as const;
  if (status !== "failed" && rank[status] <= rank[row.status]) return true;
  await patchRow(store, "outbox", row.id, { status, error: error ?? row.error }, ctx.now);
  return true;
}

/* ───────────────────────── templates ───────────────────────── */

export async function companyLine(store: Store, ctx: Ctx): Promise<{ name: string; phone: string }> {
  const s = await getSettings(store, ctx.now);
  return { name: s.companyName, phone: s.phone };
}

export const T = {
  bookingConfirmed: (b: Entity<"bookings">, company: string, portal: string) =>
    `Hi ${b.contactName}, your booking ${b.number} (${b.title}) is confirmed for ${b.startDate}. ${company} will share vouchers before travel. Manage your trip: ${portal}`,
  voucher: (name: string, service: string, voucherNo: string, portal: string) =>
    `Hi ${name}, voucher ${voucherNo} for ${service} is ready. View or download it here: ${portal}`,
  driverJob: (driver: string, service: string, date: string, booking: Entity<"bookings">) =>
    `Hi ${driver}, new job: ${service} on ${date} for ${booking.contactName} (${booking.pax.adults + booking.pax.children} pax), booking ${booking.number}. Guest phone ${booking.phone || "on file"}. Open the field app for details.`,
  driverForGuest: (guest: string, kind: string, name: string, phone: string, service: string) =>
    `Hi ${guest}, your ${kind} for ${service} is ${name} (${phone}). They will contact you before pickup.`,
  visaStatus: (name: string, number: string, country: string, status: string, note: string, link: string) =>
    `Hi ${name}, update on your ${country} visa (${number}): ${status.replace(/_/g, " ")}.${note ? ` ${note}` : ""} Track it here: ${link}`,
  visaUpload: (name: string, number: string, country: string, link: string) =>
    `Hi ${name}, please upload the documents for your ${country} visa (${number}) here — no login needed: ${link}`,
  paymentReceipt: (name: string, amount: number, invoice: string, balance: number) =>
    `Hi ${name}, we received ${formatMoney(amount)} against invoice ${invoice}.${balance > 0 ? ` Balance due: ${formatMoney(balance)}.` : " Fully paid — thank you!"}`,
  paymentReminder: (name: string, invoice: string, balance: number, due: string, link: string) =>
    `Hi ${name}, a gentle reminder: ${formatMoney(balance)} is due on invoice ${invoice} (due ${due}). Pay securely here: ${link}`,
  quoteLink: (name: string, title: string, link: string) => `Hi ${name}, here is your proposal for ${title}: ${link} — you can choose add-ons and confirm online.`,
  otp: (code: string, company: string) => `${code} is your ${company} sign-in code. It expires in 10 minutes. Don't share it with anyone.`,
};
