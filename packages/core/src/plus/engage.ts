/**
 * Customer engagement: outbound messages and notifications, shared inbox (owners + internal notes), website chat,
 * call tracking (IVR / SIM app webhooks, recordings, missed-call alerts), AI voice calls, customer portal with
 * one-time-code sign-in, document uploads (customers, visa applicants, staff), and supplier rate import.
 */
import { z } from "zod";
import { actions, internals, registerActions, registerAfterHook } from "../actions.js";
import { addDays } from "../dates.js";
import { type Entity, type Lead } from "../entities.js";
import { docNumber, randomToken } from "../ids.js";
import { accountBalance, type LedgerEntry } from "../ledger.js";
import { deliverQueued, queueMessage, T } from "../messaging.js";
import { registerActionRoles } from "../permissions.js";
import { providersFor } from "../providers.js";
import { DomainError, LEAD_SOURCES } from "../rules.js";
import { createRow, getSettings, mustGet, patchRow, todayOf, type Ctx, type Store } from "../store.js";
import { parseCsv, sha256Hex } from "../toolkit.js";
import { createLink } from "./commerce.js";
import { action, checkUpload, findContact, last10, linkFor, log, optStr, rupees } from "./shared.js";

const { captureLead, segmentAudience, firstUserWithRole, outstandingOf, visaDocStatus, ledgerEntries } = internals;

const fileInput = z.object({ name: z.string().trim().min(1).max(200), mime: z.string().trim().min(3).max(100), dataUrl: z.string().min(20).max(11_000_000), label: optStr(200) });

/* ───────────────────────── campaigns ───────────────────────── */

export async function queueCampaign(s: Store, ctx: Ctx, campaignId: string): Promise<number> {
  const c = await mustGet(s, "campaigns", campaignId);
  const audience = await segmentAudience(s, c.segmentId);
  const settings = await getSettings(s, ctx.now);
  let n = 0;
  for (const a of audience) {
    const contact = a as unknown as Entity<"contacts">;
    const body = c.message.replace(/\{name\}/gi, contact.name.split(" ")[0] ?? "").replace(/\{company\}/gi, settings.companyName)
      .replace(/\{link\}/gi, await linkFor(s, ctx, `/store/${ctx.tenantId}?c=${c.id}`));
    const row = await queueMessage(s, ctx, { channel: c.channel, phone: contact.phone, email: contact.email, subject: c.name, body, kind: "campaign", campaignId: c.id, contactId: contact.id });
    if (row) n++;
  }
  return n;
}

/* ───────────────────────── calls ───────────────────────── */

export interface CallInput {
  phone: string;
  name?: string;
  direction: "in" | "out";
  status: "answered" | "missed" | "no_answer" | "busy" | "voicemail";
  durationSec?: number;
  startedAt?: string;
  recordingUrl?: string;
  source?: "sim" | "ivr" | "ai_voice" | "manual";
  provider?: string;
  providerRef?: string;
  userEmail?: string;
  userId?: string | null;
}

/** Log a call (from an IVR/SIM-app webhook or by hand): match the lead, add to the timeline, alert on missed calls. */
export async function recordCall(s: Store, ctx: Ctx, i: CallInput): Promise<Entity<"calls">> {
  if (i.providerRef) {
    const dup = (await s.list("calls")).find((c) => c.providerRef === i.providerRef);
    if (dup) return dup;
  }
  const leads = await s.list("leads");
  const p = last10(i.phone);
  let lead = leads.filter((l) => last10(l.phone) === p && p.length >= 7).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] as Lead | undefined;
  const contact = await findContact(s, i.phone, null);
  const users = await s.list("users");
  const user = i.userId ? users.find((u) => u.id === i.userId) : i.userEmail ? users.find((u) => u.email === (i.userEmail ?? "").toLowerCase()) : undefined;
  if (!lead && i.direction === "in") {
    const r = await captureLead(s, { ...ctx, role: "admin" }, { name: i.name || `Caller ${i.phone}`, phone: i.phone, source: "ivr", notes: "Created from an incoming call." });
    lead = r.lead;
  }
  const missed = i.direction === "in" && i.status !== "answered";
  let callbackTaskId: string | null = null;
  if (missed) {
    const owner = lead?.ownerId ?? (await firstUserWithRole(s, ["sales", "owner", "admin"]));
    const t = await createRow(s, "tasks", { title: `Call back ${i.name || lead?.name || i.phone} — missed call`, dueAt: new Date(ctx.now.getTime() + 10 * 60_000).toISOString(), assigneeId: owner, leadId: lead?.id ?? null, priority: "high" }, ctx.now);
    callbackTaskId = t.id;
  }
  const call = await createRow(s, "calls", {
    phone: i.phone, name: i.name ?? lead?.name ?? contact?.name ?? "", direction: i.direction, status: i.status, durationSec: i.durationSec ?? 0,
    startedAt: i.startedAt ?? ctx.now.toISOString(), recordingUrl: i.recordingUrl ?? "", leadId: lead?.id ?? null, contactId: contact?.id ?? lead?.contactId ?? null,
    userId: user?.id ?? null, source: i.source ?? "ivr", provider: i.provider ?? "", providerRef: i.providerRef ?? "", callbackTaskId,
  }, ctx.now);
  if (lead) {
    const mins = Math.round((i.durationSec ?? 0) / 60);
    await createRow(s, "activities", { leadId: lead.id, kind: "call", direction: i.direction, body: `${i.direction === "in" ? "Incoming" : "Outgoing"} call ${i.status === "answered" ? `(${mins ? `${mins} min` : `${i.durationSec ?? 0}s`})` : `— ${i.status.replace("_", " ")}`}${i.recordingUrl ? " · recording saved" : ""}${user ? ` · ${user.name}` : ""}`, at: call.startedAt, byId: user?.id ?? ctx.userId, durationSec: i.durationSec ?? 0 }, ctx.now);
    await patchRow(s, "leads", lead.id, { lastActivityAt: ctx.now.toISOString(), ...(i.status === "answered" && lead.stage === "new" ? { stage: "contacted" } : {}) }, ctx.now);
  }
  // A returned call closes the pending call-back task
  if (i.direction === "out" && i.status === "answered" && lead) {
    for (const t of (await s.list("tasks")).filter((x) => !x.done && x.leadId === lead!.id && /missed call/i.test(x.title))) await patchRow(s, "tasks", t.id, { done: true }, ctx.now);
  }
  return call;
}

/* ───────────────────────── AI helpers (Claude when connected, rules otherwise) ───────────────────────── */

async function aiJson<T>(ctx: Ctx, system: string, prompt: string): Promise<T | null> {
  const out = await providersFor(ctx).ai.complete({ system, prompt, maxTokens: 1500 });
  if (!out) return null;
  const m = /\{[\s\S]*\}/.exec(out);
  if (!m) return null;
  try { return JSON.parse(m[0]) as T; } catch { return null; }
}

const SERVICE_WORDS: [RegExp, Entity<"services">["type"]][] = [
  [/\b(hotel|resort|villa|stay|accommodation|room|camp|houseboat)\b/i, "hotel"], [/\b(flight|airfare|air ticket|airline)\b/i, "flight"],
  [/\b(transfer|pick[- ]?up|drop|cab|car|coach|vehicle|sedan|innova)\b/i, "transfer"], [/\b(tour|sightseeing|cruise|safari|excursion|ticket|park|entry)\b/i, "sightseeing"],
  [/\bvisa\b/i, "visa"], [/\binsurance\b/i, "insurance"], [/\b(meal|dinner|lunch|breakfast)\b/i, "meal"],
];

export interface ParsedItinerary {
  days: { title: string; description: string }[];
  services: { type: Entity<"services">["type"]; title: string; day: number; netCost: number; currency: string; perPerson: boolean }[];
  inclusions: string[];
  exclusions: string[];
  engine: "claude" | "rules";
}

/** Read a supplier itinerary (PDF text or email) into day plans and priced services. */
export function parseItineraryText(text: string): Omit<ParsedItinerary, "engine"> {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim());
  const days: ParsedItinerary["days"] = [];
  const services: ParsedItinerary["services"] = [];
  const inclusions: string[] = [];
  const exclusions: string[] = [];
  let section: "days" | "inc" | "exc" = "days";
  let cur: { title: string; description: string[] } | null = null;
  const flush = () => { if (cur) days.push({ title: cur.title.slice(0, 120), description: cur.description.join(" ").replace(/\s+/g, " ").slice(0, 2000) }); cur = null; };
  for (const raw of lines) {
    if (!raw) continue;
    const dayM = /^(?:day\s*0?(\d{1,2})|d(\d{1,2}))\s*[:\-–.)]?\s*(.*)$/i.exec(raw);
    if (/^(inclusions?|includes|what'?s included)\b/i.test(raw)) { flush(); section = "inc"; continue; }
    if (/^(exclusions?|excludes|not included|what'?s not included)\b/i.test(raw)) { flush(); section = "exc"; continue; }
    if (dayM) { flush(); section = "days"; cur = { title: dayM[3] || `Day ${dayM[1] ?? dayM[2]}`, description: [] }; continue; }
    const bullet = raw.replace(/^[-•*●▪◦]\s*/, "");
    if (section === "inc") { inclusions.push(bullet.slice(0, 200)); continue; }
    if (section === "exc") { exclusions.push(bullet.slice(0, 200)); continue; }
    const price = /(?:₹|INR|Rs\.?|AED|USD|\$|THB|EUR|€|SGD)\s?([\d,]+(?:\.\d+)?)|([\d,]{3,}(?:\.\d+)?)\s?(?:₹|INR|\/-|AED|USD|THB|EUR|SGD)/i.exec(raw);
    if (price) {
      const amt = Number((price[1] ?? price[2] ?? "0").replace(/,/g, ""));
      const cur3 = /AED/i.test(raw) ? "AED" : /USD|\$/i.test(raw) ? "USD" : /THB/i.test(raw) ? "THB" : /EUR|€/i.test(raw) ? "EUR" : /SGD/i.test(raw) ? "SGD" : "INR";
      const type = SERVICE_WORDS.find(([re]) => re.test(raw))?.[1] ?? "other";
      if (amt > 0) services.push({ type, title: bullet.replace(price[0], "").replace(/[-–:|]+\s*$/, "").trim().slice(0, 160) || "Service", day: Math.max(1, days.length + (cur ? 1 : 0)), netCost: Math.round(amt * 100), currency: cur3, perPerson: /per (person|pax|adult)|pp\b|\/pax/i.test(raw) });
      continue;
    }
    if (cur) cur.description.push(bullet);
  }
  flush();
  return { days, services, inclusions, exclusions };
}

/* ───────────────────────── customer portal ───────────────────────── */

async function customerFromToken(s: Store, ctx: Ctx, token: string): Promise<Entity<"contacts">> {
  const hash = await sha256Hex(`portal:${token}`);
  const sess = (await s.list("customerSessions")).find((x) => x.tokenHash === hash);
  if (!sess || !sess.tokenExpires || sess.tokenExpires < ctx.now.toISOString()) throw new DomainError("Please sign in again.", 401);
  return mustGet(s, "contacts", sess.contactId);
}

const mine = (c: Entity<"contacts">) => (row: { phone?: string; email?: string }) =>
  (c.phone && last10(row.phone) === last10(c.phone)) || (c.email && (row.email ?? "").toLowerCase() === c.email);

async function portalData(s: Store, ctx: Ctx, c: Entity<"contacts">) {
  const settings = await getSettings(s, ctx.now);
  const isMine = mine(c);
  const [bookings, services, invoices, visaCases, policies, claims, files, quotes, flights, links] = await Promise.all([
    s.list("bookings"), s.list("services"), s.list("invoices"), s.list("visaCases"), s.list("policies"), s.list("claims"), s.list("files"), s.list("quotes"), s.list("flightOrders"), s.list("paymentLinks"),
  ]);
  const myBookings = bookings.filter((b) => isMine(b)).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const myVisa = visaCases.filter((v) => isMine(v));
  const myPolicies = policies.filter((p) => isMine(p));
  const wallet = accountBalance((await ledgerEntries(s)) as LedgerEntry[], "wallet", { type: "customer", id: c.id });
  return {
    company: { name: settings.companyName, phone: settings.phone, email: settings.email, brandColor: settings.brandColor },
    me: { name: c.name, phone: c.phone, email: c.email, trips: c.trips },
    wallet,
    bookings: myBookings.map((b) => {
      const inv = b.invoiceId ? invoices.find((x) => x.id === b.invoiceId) : undefined;
      return {
        id: b.id, number: b.number, title: b.title, destination: b.destination, startDate: b.startDate, endDate: b.endDate, status: b.status, pax: b.pax,
        services: services.filter((x) => x.bookingId === b.id && x.status !== "cancelled").map((x) => ({ id: x.id, type: x.type, title: x.title, date: x.date, status: x.status, voucherNo: x.voucherNo, confirmationNo: x.confirmationNo })),
        flights: flights.filter((f) => f.bookingId === b.id).map((f) => ({ flightNo: f.flightNo, from: f.from, to: f.to, departAt: f.departAt, pnr: f.pnr, status: f.status })),
        invoice: inv ? { id: inv.id, number: inv.number, total: inv.total, paid: inv.paid, outstanding: outstandingOf(inv), dueDate: inv.dueDate } : null,
      };
    }),
    visas: myVisa.map((v) => ({ id: v.id, number: v.number, country: v.country, visaType: v.visaType, status: v.status, uploadToken: v.uploadToken, decisionNote: v.decisionNote, missing: v.applicants.flatMap((a) => a.docs.filter((d) => !d.received).map((d) => `${a.name}: ${d.name}`)) })),
    policies: myPolicies.map((p) => ({ id: p.id, number: p.number, planName: p.planName, from: p.from, to: p.to, status: p.status, travellers: p.travellers.length })),
    claims: claims.filter((cl) => myPolicies.some((p) => p.id === cl.policyId)).map((cl) => ({ id: cl.id, number: cl.number, type: cl.type, amount: cl.amount, status: cl.status, decisionNote: cl.decisionNote })),
    documents: files.filter((f) => (f.ownerType === "contact" && f.ownerId === c.id) || (f.ownerType === "visaCase" && myVisa.some((v) => v.id === f.ownerId))).map((f) => ({ id: f.id, name: f.name, label: f.label, size: f.size, mime: f.mime, createdAt: f.createdAt })),
    proposals: quotes.filter((q) => isMine(q) && ["sent", "viewed"].includes(q.status)).map((q) => ({ number: q.number, title: q.title, total: q.total, token: q.shareToken, validUntil: q.validUntil })),
    openLinks: links.filter((l) => l.status === "created" && isMine(l)).map((l) => ({ token: l.token, amount: l.amount, url: l.url })),
  };
}

/* ───────────────────────── roles ───────────────────────── */

registerActionRoles({
  sendMessage: ["owner", "admin", "sales", "marketing", "visa", "ops", "accounts"],
  retryMessage: ["owner", "admin", "sales", "marketing", "visa", "ops", "accounts"],
  approveDrafts: ["owner", "admin", "sales", "marketing", "accounts", "visa"],
  deliverNow: ["owner", "admin"],
  assignThread: ["owner", "admin", "sales", "marketing", "visa"],
  addThreadNote: ["owner", "admin", "sales", "marketing", "visa"],
  setThreadStatus: ["owner", "admin", "sales", "marketing", "visa"],
  recordCall: ["owner", "admin", "sales", "marketing", "visa"],
  startAiCalls: ["owner", "admin", "sales", "marketing"],
  uploadFile: ["owner", "admin", "sales", "ops", "visa"],
  deleteFile: ["owner", "admin", "sales", "ops", "visa"],
  getFile: ["owner", "admin", "sales", "ops", "visa", "accounts", "marketing"],
  agentUploadVisaDoc: ["agent", "owner", "admin", "visa"],
  importRates: ["owner", "admin", "ops"],
  importEnquiry: ["owner", "admin", "sales", "marketing"],
  importItinerary: ["owner", "admin", "sales", "ops"],
  scheduleCampaign: ["owner", "admin", "marketing"],
});

/* ───────────────────────── staff actions ───────────────────────── */

registerActions({
  sendMessage: action(z.object({ channel: z.enum(["whatsapp", "email", "sms"]).optional(), to: optStr(200), leadId: z.string().optional(), bookingId: z.string().optional(), visaCaseId: z.string().optional(), subject: optStr(200), body: z.string().trim().min(1, "Write the message").max(4000) }), async (s, ctx, i) => {
    let phone = "", email = "";
    if (i.leadId) { const l = await mustGet(s, "leads", i.leadId); phone = l.phone; email = l.email; }
    if (i.bookingId) { const b = await mustGet(s, "bookings", i.bookingId); phone = b.phone; email = b.email; }
    if (i.visaCaseId) { const v = await mustGet(s, "visaCases", i.visaCaseId); phone = v.phone; email = v.email; }
    if (i.to) { if (i.to.includes("@")) email = i.to; else phone = i.to; }
    const row = await queueMessage(s, ctx, { channel: i.channel, phone, email, subject: i.subject, body: i.body, kind: "chat", leadId: i.leadId ?? null, bookingId: i.bookingId ?? null, visaCaseId: i.visaCaseId ?? null });
    if (!row) throw new DomainError("There's no phone or email to send this to.", 422);
    await log(s, ctx, { leadId: i.leadId ?? null, bookingId: i.bookingId ?? null, visaCaseId: i.visaCaseId ?? null, kind: row.channel === "email" ? "email" : "whatsapp", direction: "out", body: i.body.slice(0, 400) });
    return row;
  }),

  retryMessage: action(z.object({ outboxId: z.string() }), async (s, ctx, i) => {
    const o = await mustGet(s, "outbox", i.outboxId);
    if (!["failed", "queued"].includes(o.status)) throw new DomainError(`This message is already ${o.status}.`, 409);
    return patchRow(s, "outbox", o.id, { status: "queued", attempts: 0, scheduledAt: null, error: "" }, ctx.now);
  }),

  approveDrafts: action(z.object({ ids: z.array(z.string()).min(1), discard: z.boolean().default(false) }), async (s, ctx, i) => {
    let n = 0;
    for (const id of i.ids) {
      const o = await mustGet(s, "outbox", id);
      if (o.status !== "draft") continue;
      await patchRow(s, "outbox", id, { status: i.discard ? "skipped" : "queued" }, ctx.now);
      n++;
    }
    return { updated: n };
  }),

  deliverNow: action(z.object({}), async (s, ctx) => deliverQueued(s, ctx)),

  assignThread: action(z.object({ phone: z.string().min(1), ownerId: z.string().nullable() }), async (s, ctx, i) => {
    const t = await upsertThread(s, ctx, i.phone, "whatsapp", "");
    if (i.ownerId) await mustGet(s, "users", i.ownerId);
    const out = await patchRow(s, "chatThreads", t.id, { ownerId: i.ownerId }, ctx.now);
    const who = i.ownerId ? (await s.get("users", i.ownerId))?.name : "nobody";
    await addNote(s, ctx, out, `Assigned to ${who}.`);
    return out;
  }),

  addThreadNote: action(z.object({ phone: z.string().min(1), body: z.string().trim().min(1, "Write a note").max(2000) }), async (s, ctx, i) => {
    const t = await upsertThread(s, ctx, i.phone, "whatsapp", "");
    return addNote(s, ctx, t, i.body);
  }),

  setThreadStatus: action(z.object({ phone: z.string().min(1), status: z.enum(["open", "closed"]) }), async (s, ctx, i) => {
    const t = await upsertThread(s, ctx, i.phone, "whatsapp", "");
    return patchRow(s, "chatThreads", t.id, { status: i.status }, ctx.now);
  }),

  recordCall: action(z.object({ phone: z.string().trim().regex(/^[+\d][\d\s-]{6,17}$/, "Enter a valid phone number"), name: optStr(160), direction: z.enum(["in", "out"]), status: z.enum(["answered", "missed", "no_answer", "busy", "voicemail"]), durationSec: z.number().int().min(0).max(36_000).default(0), recordingUrl: z.string().max(3_000_000).optional(), source: z.enum(["sim", "ivr", "manual"]).default("manual") }), async (s, ctx, i) =>
    recordCall(s, ctx, { ...i, userId: ctx.userId })),

  startAiCalls: action(z.object({ leadIds: z.array(z.string()).max(50).default([]), segmentId: z.string().optional(), script: z.string().trim().min(20, "Write what the voice assistant should say and ask").max(2000) }), async (s, ctx, i) => {
    const targets: { phone: string; name: string; leadId: string | null }[] = [];
    for (const id of i.leadIds) { const l = await mustGet(s, "leads", id); if (l.phone) targets.push({ phone: l.phone, name: l.name, leadId: l.id }); }
    if (i.segmentId) for (const c of await segmentAudience(s, i.segmentId)) { const k = c as unknown as Entity<"contacts">; if (k.phone && !targets.some((t) => last10(t.phone) === last10(k.phone))) targets.push({ phone: k.phone, name: k.name, leadId: null }); }
    if (!targets.length) throw new DomainError("Pick leads or a segment with phone numbers.", 422);
    const voice = providersFor(ctx).voice;
    const results = [];
    for (const t of targets.slice(0, 50)) {
      const r = await voice.call({ phone: t.phone, name: t.name, script: i.script.replace(/\{name\}/gi, t.name.split(" ")[0] ?? "") });
      const call = await createRow(s, "calls", {
        phone: t.phone, name: t.name, direction: "out", status: r.notConfigured ? "queued" : r.status, durationSec: r.durationSec ?? 0, startedAt: ctx.now.toISOString(),
        leadId: t.leadId, source: "ai_voice", provider: voice.name, providerRef: r.ref ?? "", outcome: r.notConfigured ? "Waiting: connect a voice AI provider in Settings → Integrations" : r.outcome ?? "", transcript: r.transcript ?? "", script: i.script,
      }, ctx.now);
      if (t.leadId && !r.notConfigured) {
        await createRow(s, "activities", { leadId: t.leadId, kind: "call", direction: "out", body: `AI voice call${voice.sandbox ? " (sandbox)" : ""}: ${r.outcome ?? r.status}`, at: ctx.now.toISOString(), byId: ctx.userId, durationSec: r.durationSec ?? 0 }, ctx.now);
        if (/interested|call-back|call back/i.test(r.outcome ?? "")) {
          const lead = await mustGet(s, "leads", t.leadId);
          await createRow(s, "tasks", { title: `${lead.name}: ${r.outcome}`, dueAt: new Date(ctx.now.getTime() + 2 * 3600_000).toISOString(), assigneeId: lead.ownerId, leadId: lead.id, priority: "high" }, ctx.now);
          if (lead.stage === "new") await patchRow(s, "leads", lead.id, { stage: "contacted" }, ctx.now);
        }
      }
      results.push(call);
    }
    return { calls: results, provider: voice.name, sandbox: voice.sandbox };
  }),

  uploadFile: action(fileInput.extend({ ownerType: z.enum(["contact", "visaCase", "booking", "package", "quote", "claim", "other"]), ownerId: z.string().nullable(), applicantIndex: z.number().int().min(0).nullable().optional() }), async (s, ctx, i) => {
    const size = checkUpload(i.dataUrl, i.mime);
    const f = await createRow(s, "files", { name: i.name, mime: i.mime, size, dataUrl: i.dataUrl, ownerType: i.ownerType, ownerId: i.ownerId, label: i.label ?? "", uploadedVia: "staff", applicantIndex: i.applicantIndex ?? null }, ctx.now);
    if (i.ownerType === "visaCase" && i.ownerId && i.label) await markDocReceived(s, ctx, i.ownerId, i.applicantIndex ?? 0, i.label);
    const { dataUrl: _d, ...meta } = f;
    return meta;
  }),

  deleteFile: action(z.object({ fileId: z.string() }), async (s, ctx, i) => {
    const f = await mustGet(s, "files", i.fileId);
    await s.remove("files", f.id);
    await log(s, ctx, { visaCaseId: f.ownerType === "visaCase" ? f.ownerId : null, bookingId: f.ownerType === "booking" ? f.ownerId : null, body: `File "${f.name}" removed.` });
    return { ok: true };
  }),

  getFile: action(z.object({ fileId: z.string() }), async (s, _ctx, i) => mustGet(s, "files", i.fileId)),

  agentUploadVisaDoc: action(fileInput.extend({ caseId: z.string(), applicantIndex: z.number().int().min(0), docName: z.string().min(1) }), async (s, ctx, i) => {
    const vc = await mustGet(s, "visaCases", i.caseId);
    if (ctx.role === "agent" && vc.agentId !== ctx.agentId) throw new DomainError("Visa case not found", 404);
    const size = checkUpload(i.dataUrl, i.mime);
    await createRow(s, "files", { name: i.name, mime: i.mime, size, dataUrl: i.dataUrl, ownerType: "visaCase", ownerId: vc.id, label: i.docName, uploadedVia: ctx.role === "agent" ? "agent" : "staff", applicantIndex: i.applicantIndex }, ctx.now);
    return markDocReceived(s, ctx, vc.id, i.applicantIndex, i.docName);
  }),

  importRates: action(z.object({ kind: z.enum(["hotels", "sightseeing", "transfers"]), csv: z.string().min(5, "Paste the rate sheet").max(2_000_000), supplierId: z.string().nullable().optional() }), async (s, ctx, i) => importRates(s, ctx, i.kind, i.csv, i.supplierId ?? null)),

  importEnquiry: action(z.object({ text: z.string().trim().min(5, "Paste the email or document text").max(20_000), source: z.enum(["email", "pdf", "other"]).default("email"), fromName: optStr(160), fromEmail: optStr(160), createQuote: z.boolean().default(true) }), async (s, ctx, i) => {
    const ai = await aiJson<{ name?: string; phone?: string; email?: string; destination?: string; travelDate?: string; nights?: number; adults?: number; children?: number; budgetRupees?: number }>(ctx,
      "You extract travel enquiries for an Indian travel agency. Reply with JSON only.",
      `Extract: name, phone, email, destination (city or country), travelDate (YYYY-MM-DD), nights, adults, children, budgetRupees (total). Use null when unknown.\n\n${i.text.slice(0, 8000)}`);
    const src = (i.source === "email" ? "email" : "other") as (typeof LEAD_SOURCES)[number];
    const r = await captureLead(s, ctx, {
      text: i.text.slice(0, 4000), source: src, name: i.fromName || ai?.name || undefined, email: i.fromEmail || ai?.email || undefined, phone: ai?.phone || undefined,
      destination: ai?.destination || undefined, travelDate: ai?.travelDate && /^\d{4}-\d{2}-\d{2}$/.test(ai.travelDate) ? ai.travelDate : undefined,
      nights: ai?.nights ?? undefined, adults: ai?.adults || undefined, children: ai?.children ?? undefined, budget: ai?.budgetRupees ? Math.round(ai.budgetRupees * 100) : undefined,
    });
    const quote = i.createQuote && !r.duplicate ? await actions.createQuoteFromLead.run(s, ctx, { leadId: r.lead.id, packageId: null }) : null;
    return { lead: r.lead, quote, engine: ai ? "claude" : "rules", duplicate: r.duplicate };
  }),

  importItinerary: action(z.object({ text: z.string().trim().min(20, "Paste the supplier itinerary").max(40_000), quoteId: z.string().optional(), packageName: optStr(160), destination: optStr(80) }), async (s, ctx, i) => {
    const ai = await aiJson<Omit<ParsedItinerary, "engine">>(ctx,
      "You convert supplier itineraries for an Indian travel agency into structured JSON. Reply with JSON only.",
      `Return {"days":[{"title","description"}],"services":[{"type":"hotel|flight|transfer|sightseeing|activity|visa|insurance|meal|other","title","day","netCost" (in paise, i.e. rupees×100),"currency","perPerson"}],"inclusions":[],"exclusions":[]}\n\n${i.text.slice(0, 20000)}`);
    const parsed: ParsedItinerary = ai && Array.isArray(ai.days) ? { ...ai, services: (ai.services ?? []).filter((x) => x && x.title), inclusions: ai.inclusions ?? [], exclusions: ai.exclusions ?? [], engine: "claude" } : { ...parseItineraryText(i.text), engine: "rules" };
    if (!parsed.days.length && !parsed.services.length) throw new DomainError("Couldn't find day-by-day plans or prices. Make sure the text has lines like \"Day 1: …\" and prices like \"₹ 12,000\".", 422);
    if (i.quoteId) {
      const q = await mustGet(s, "quotes", i.quoteId);
      if (q.status === "accepted") throw new DomainError("A confirmed quote is locked.", 409);
      const { emptyLine } = await import("../pricing.js");
      const { newId } = await import("../ids.js");
      const lines = [...q.lines, ...parsed.services.map((x) => emptyLine({ id: newId("ln"), type: x.type, title: x.title, day: Math.max(1, Math.min(90, x.day || 1)), netCost: Math.max(0, Math.round(x.netCost)), currency: x.currency || "INR", perPerson: Boolean(x.perPerson) }))];
      const out = await patchRow(s, "quotes", q.id, { lines, days: parsed.days.length ? parsed.days.map((d) => ({ title: d.title, description: d.description, photoId: null })) : q.days, inclusions: parsed.inclusions.length ? parsed.inclusions : q.inclusions, exclusions: parsed.exclusions.length ? parsed.exclusions : q.exclusions, ...(q.status !== "draft" ? { status: "draft", version: q.version + 1 } : {}) }, ctx.now);
      await log(s, ctx, { leadId: q.leadId, body: `Supplier itinerary imported into ${q.number}: ${parsed.days.length} days, ${parsed.services.length} priced services (${parsed.engine === "claude" ? "AI" : "rule-based"} reader).` });
      return { quote: out, parsed };
    }
    const nights = Math.max(1, parsed.days.length - 1);
    const pkg = await createRow(s, "packages", { name: i.packageName || `${i.destination || "Imported"} ${nights}N itinerary`, destination: i.destination || "Imported", nights, days: parsed.days.map((d) => ({ title: d.title, description: d.description, photoId: null })), inclusions: parsed.inclusions, exclusions: parsed.exclusions, published: false }, ctx.now);
    return { package: pkg, parsed };
  }),

  scheduleCampaign: action(z.object({ campaignId: z.string(), at: z.string().nullable() }), async (s, ctx, i) => {
    const c = await mustGet(s, "campaigns", i.campaignId);
    if (c.status === "sent") throw new DomainError("This campaign was already sent.", 409);
    let at = i.at;
    if (!at) {
      const { bestSendHour, nextAtHour } = await import("../insights.js");
      const inbound = (await s.list("messages")).filter((m) => m.direction === "in");
      at = nextAtHour(ctx.now, bestSendHour(inbound).hour);
    }
    if (Number.isNaN(Date.parse(at))) throw new DomainError("Pick a valid date and time.", 422);
    return patchRow(s, "campaigns", c.id, { status: "scheduled", scheduledAt: new Date(at).toISOString() }, ctx.now);
  }),
});

async function markDocReceived(s: Store, ctx: Ctx, caseId: string, applicantIndex: number, docName: string) {
  const vc = await mustGet(s, "visaCases", caseId);
  const ap = vc.applicants[applicantIndex];
  if (!ap) return vc;
  const applicants = vc.applicants.map((a, idx) => (idx !== applicantIndex ? a : { ...a, docs: a.docs.map((d) => (d.name === docName ? { ...d, received: true } : d)) }));
  const status = visaDocStatus(applicants, vc.status);
  const out = await patchRow(s, "visaCases", vc.id, { applicants, status }, ctx.now);
  if (status !== vc.status) await log(s, ctx, { visaCaseId: vc.id, body: `All documents received — ${vc.number} is ready to submit.` });
  return out;
}

async function upsertThread(s: Store, ctx: Ctx, phone: string, channel: "whatsapp" | "email" | "web_chat", name: string): Promise<Entity<"chatThreads">> {
  const t = (await s.list("chatThreads")).find((x) => x.phone === phone);
  if (t) return t;
  return createRow(s, "chatThreads", { phone, name, channel }, ctx.now);
}

async function addNote(s: Store, ctx: Ctx, t: Entity<"chatThreads">, body: string) {
  const me = await s.get("users", ctx.userId);
  return patchRow(s, "chatThreads", t.id, { notes: [...t.notes, { byId: ctx.userId, byName: me?.name ?? "System", at: ctx.now.toISOString(), body }] }, ctx.now);
}

/* ───────────────────────── rate import ───────────────────────── */

async function importRates(s: Store, ctx: Ctx, kind: "hotels" | "sightseeing" | "transfers", csv: string, supplierId: string | null) {
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new DomainError("The sheet needs a header row and at least one rate.", 422);
  const head = rows[0]!.map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const num = (v: string | undefined) => Number((v ?? "").replace(/[^\d.]/g, ""));
  const errors: string[] = [];
  let created = 0, updated = 0;
  if (kind === "hotels") {
    const c = { name: col("hotel", "hotelname", "name", "property"), city: col("city", "destination", "location"), country: col("country"), stars: col("stars", "star", "category"), room: col("roomtype", "room", "roomcategory"), meal: col("mealplan", "meal", "plan", "basis"), season: col("season"), rate: col("netpernight", "rate", "net", "netrate", "price", "cost", "pernight"), cur: col("currency", "cur") };
    if (c.name < 0 || c.city < 0 || c.rate < 0) throw new DomainError("Hotel sheets need columns: Hotel, City, Room type, Meal plan, Net per night (Season, Currency, Country, Stars optional).", 422);
    const hotels = await s.list("hotels");
    for (const [k, r] of rows.slice(1).entries()) {
      const name = r[c.name] ?? "", city = r[c.city] ?? "", rate = num(r[c.rate]);
      if (!name || !city || !rate) { errors.push(`Row ${k + 2}: hotel, city and rate are required.`); continue; }
      const meal = ((c.meal >= 0 ? r[c.meal] : "CP") || "CP").toUpperCase();
      const entry = { roomType: (c.room >= 0 ? r[c.room] : "") || "Standard", mealPlan: (["EP", "CP", "MAP", "AP", "AI"].includes(meal) ? meal : "CP") as "CP", season: (/peak|high/i.test(c.season >= 0 ? r[c.season] ?? "" : "") ? "peak" : "regular") as "regular", netPerNight: Math.round(rate * 100), currency: ((c.cur >= 0 ? r[c.cur] : "INR") || "INR").toUpperCase().slice(0, 3) };
      let h = hotels.find((x) => x.name.toLowerCase() === name.toLowerCase() && x.city.toLowerCase() === city.toLowerCase());
      if (!h) {
        h = await createRow(s, "hotels", { name, city, country: (c.country >= 0 ? r[c.country] : "") || "India", stars: Math.min(7, Math.max(1, num(c.stars >= 0 ? r[c.stars] : "3") || 3)), supplierId, rates: [entry] }, ctx.now);
        hotels.push(h);
        created++;
      } else {
        const rates = [...h.rates.filter((x) => !(x.roomType === entry.roomType && x.mealPlan === entry.mealPlan && x.season === entry.season)), entry];
        h = await patchRow(s, "hotels", h.id, { rates }, ctx.now);
        hotels[hotels.findIndex((x) => x.id === h!.id)] = h;
        updated++;
      }
    }
  } else if (kind === "sightseeing") {
    const c = { name: col("name", "tour", "activity", "sightseeing"), city: col("city", "destination"), country: col("country"), rate: col("netperperson", "rate", "net", "price", "cost", "perperson"), hours: col("durationhours", "duration", "hours"), cur: col("currency") };
    if (c.name < 0 || c.city < 0 || c.rate < 0) throw new DomainError("Sightseeing sheets need columns: Name, City, Net per person (Duration hours, Currency, Country optional).", 422);
    const list = await s.list("sightseeing");
    for (const [k, r] of rows.slice(1).entries()) {
      const name = r[c.name] ?? "", city = r[c.city] ?? "", rate = num(r[c.rate]);
      if (!name || !city || !rate) { errors.push(`Row ${k + 2}: name, city and rate are required.`); continue; }
      const body = { name, city, country: (c.country >= 0 ? r[c.country] : "") || "India", netPerPerson: Math.round(rate * 100), durationHours: num(c.hours >= 0 ? r[c.hours] : "4") || 4, currency: ((c.cur >= 0 ? r[c.cur] : "INR") || "INR").toUpperCase().slice(0, 3), supplierId };
      const ex = list.find((x) => x.name.toLowerCase() === name.toLowerCase() && x.city.toLowerCase() === city.toLowerCase());
      if (ex) { await patchRow(s, "sightseeing", ex.id, body, ctx.now); updated++; } else { await createRow(s, "sightseeing", body, ctx.now); created++; }
    }
  } else {
    const c = { name: col("name", "transfer", "route"), city: col("city", "destination"), country: col("country"), vehicle: col("vehicle", "cartype", "car"), cap: col("capacity", "seats", "pax"), rate: col("netpervehicle", "rate", "net", "price", "cost"), cur: col("currency") };
    if (c.name < 0 || c.city < 0 || c.rate < 0) throw new DomainError("Transfer sheets need columns: Name, City, Vehicle, Capacity, Net per vehicle (Currency, Country optional).", 422);
    const list = await s.list("transfers");
    for (const [k, r] of rows.slice(1).entries()) {
      const name = r[c.name] ?? "", city = r[c.city] ?? "", rate = num(r[c.rate]);
      if (!name || !city || !rate) { errors.push(`Row ${k + 2}: name, city and rate are required.`); continue; }
      const body = { name, city, country: (c.country >= 0 ? r[c.country] : "") || "India", vehicle: (c.vehicle >= 0 ? r[c.vehicle] : "") || "Sedan", capacity: Math.max(1, Math.min(60, num(c.cap >= 0 ? r[c.cap] : "3") || 3)), netPerVehicle: Math.round(rate * 100), currency: ((c.cur >= 0 ? r[c.cur] : "INR") || "INR").toUpperCase().slice(0, 3), supplierId };
      const ex = list.find((x) => x.name.toLowerCase() === name.toLowerCase() && x.city.toLowerCase() === city.toLowerCase());
      if (ex) { await patchRow(s, "transfers", ex.id, body, ctx.now); updated++; } else { await createRow(s, "transfers", body, ctx.now); created++; }
    }
  }
  await log(s, ctx, { body: `Rate sheet imported (${kind}): ${created} new, ${updated} updated${errors.length ? `, ${errors.length} rows skipped` : ""}.` });
  return { created, updated, skipped: errors.length, errors: errors.slice(0, 20) };
}

/* ───────────────────────── public: portal, uploads, web chat ───────────────────────── */

registerActions({
  customerRequestCode: action(z.object({ login: z.string().trim().min(5, "Enter your phone or email").max(160) }), async (s, ctx, i) => {
    const isEmail = i.login.includes("@");
    const c = await findContact(s, isEmail ? null : i.login, isEmail ? i.login : null);
    const settings = await getSettings(s, ctx.now);
    if (!c) return { sent: true, channel: isEmail ? "email" : "whatsapp" }; // never reveal whether someone is a customer
    const code = String(100000 + (parseInt(randomToken(8).replace(/\D/g, "").slice(0, 6) || "0", 10) % 900000)).slice(0, 6);
    const codeHash = await sha256Hex(`otp:${c.id}:${code}`);
    const existing = (await s.list("customerSessions")).find((x) => x.contactId === c.id);
    const body = { contactId: c.id, login: i.login.toLowerCase(), codeHash, codeExpires: new Date(ctx.now.getTime() + 10 * 60_000).toISOString(), attempts: 0 };
    if (existing) await patchRow(s, "customerSessions", existing.id, body, ctx.now);
    else await createRow(s, "customerSessions", body, ctx.now);
    await queueMessage(s, ctx, { channel: isEmail ? "email" : "whatsapp", phone: isEmail ? null : c.phone, email: isEmail ? c.email : null, subject: `${settings.companyName} sign-in code`, body: T.otp(code, settings.companyName), kind: "otp", contactId: c.id });
    await deliverQueued(s, ctx, 20);
    return { sent: true, channel: isEmail ? "email" : "whatsapp", demoCode: ctx.tenantId === "demo" ? code : undefined };
  }),

  customerVerify: action(z.object({ login: z.string().trim().min(5).max(160), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") }), async (s, ctx, i) => {
    const sess = (await s.list("customerSessions")).find((x) => x.login === i.login.toLowerCase());
    if (!sess || !sess.codeExpires || sess.codeExpires < ctx.now.toISOString()) throw new DomainError("That code has expired. Ask for a new one.", 401);
    if (sess.attempts >= 5) throw new DomainError("Too many wrong codes. Ask for a new one.", 429);
    if ((await sha256Hex(`otp:${sess.contactId}:${i.code}`)) !== sess.codeHash) {
      await patchRow(s, "customerSessions", sess.id, { attempts: sess.attempts + 1 }, ctx.now);
      throw new DomainError("That code is not right. Check the message and try again.", 401);
    }
    const token = randomToken(32);
    await patchRow(s, "customerSessions", sess.id, { codeHash: "", codeExpires: null, attempts: 0, tokenHash: await sha256Hex(`portal:${token}`), tokenExpires: new Date(ctx.now.getTime() + 30 * 86_400_000).toISOString() }, ctx.now);
    const c = await mustGet(s, "contacts", sess.contactId);
    return { token, name: c.name };
  }),

  customerPortal: action(z.object({ token: z.string().min(16) }), async (s, ctx, i) => portalData(s, ctx, await customerFromToken(s, ctx, i.token))),

  customerLogout: action(z.object({ token: z.string().min(16) }), async (s, ctx, i) => {
    const hash = await sha256Hex(`portal:${i.token}`);
    const sess = (await s.list("customerSessions")).find((x) => x.tokenHash === hash);
    if (sess) await patchRow(s, "customerSessions", sess.id, { tokenHash: "", tokenExpires: null }, ctx.now);
    return { ok: true };
  }),

  customerFile: action(z.object({ token: z.string().min(16), fileId: z.string() }), async (s, ctx, i) => {
    const c = await customerFromToken(s, ctx, i.token);
    const f = await mustGet(s, "files", i.fileId);
    const visas = (await s.list("visaCases")).filter(mine(c));
    if (!((f.ownerType === "contact" && f.ownerId === c.id) || (f.ownerType === "visaCase" && visas.some((v) => v.id === f.ownerId)))) throw new DomainError("File not found", 404);
    return { name: f.name, mime: f.mime, dataUrl: f.dataUrl };
  }),

  customerUpload: action(fileInput.extend({ token: z.string().min(16) }), async (s, ctx, i) => {
    const c = await customerFromToken(s, ctx, i.token);
    const size = checkUpload(i.dataUrl, i.mime);
    const f = await createRow(s, "files", { name: i.name, mime: i.mime, size, dataUrl: i.dataUrl, ownerType: "contact", ownerId: c.id, label: i.label ?? "", uploadedVia: "customer" }, ctx.now);
    await log(s, ctx, { body: `${c.name} uploaded "${i.label || i.name}" in the customer portal.` });
    return { id: f.id, name: f.name };
  }),

  customerPayInvoice: action(z.object({ token: z.string().min(16), invoiceId: z.string(), emiMonths: z.number().int().min(0).max(36).default(0) }), async (s, ctx, i) => {
    const c = await customerFromToken(s, ctx, i.token);
    const inv = await mustGet(s, "invoices", i.invoiceId);
    const b = inv.bookingId ? await s.get("bookings", inv.bookingId) : undefined;
    if (!b || !mine(c)(b)) throw new DomainError("Invoice not found", 404);
    const due = outstandingOf(inv);
    if (due <= 0) throw new DomainError("This invoice is fully paid.", 409);
    return createLink(s, ctx, { purpose: "invoice", amount: due, description: `Balance for ${b.number}`, customer: { name: c.name, phone: c.phone, email: c.email }, invoiceId: inv.id, emiMonths: i.emiMonths });
  }),

  customerClaim: action(z.object({ token: z.string().min(16), policyId: z.string(), type: z.enum(["medical", "baggage", "cancellation", "delay", "other"]), amount: z.number().int().min(100), description: z.string().trim().min(10, "Tell us what happened").max(2000), file: fileInput.optional() }), async (s, ctx, i) => {
    const c = await customerFromToken(s, ctx, i.token);
    const pol = await mustGet(s, "policies", i.policyId);
    if (!mine(c)(pol)) throw new DomainError("Policy not found", 404);
    if (pol.status !== "issued") throw new DomainError("This policy is cancelled.", 409);
    const fileIds: string[] = [];
    if (i.file) {
      const size = checkUpload(i.file.dataUrl, i.file.mime);
      fileIds.push((await createRow(s, "files", { name: i.file.name, mime: i.file.mime, size, dataUrl: i.file.dataUrl, ownerType: "claim", ownerId: null, label: i.file.label ?? "Claim document", uploadedVia: "customer" }, ctx.now)).id);
    }
    const seq = await s.nextSeq("claim");
    const cl = await createRow(s, "claims", { number: docNumber("CLM", seq), policyId: pol.id, policyNumber: pol.number, contactName: c.name, type: i.type, amount: i.amount, description: i.description, fileIds }, ctx.now);
    for (const fid of fileIds) await patchRow(s, "files", fid, { ownerId: cl.id }, ctx.now);
    const ops = await firstUserWithRole(s, ["ops", "owner", "admin"]);
    await createRow(s, "tasks", { title: `New insurance claim ${cl.number} (${i.type}) for ${rupees(i.amount)} — send to the insurer`, dueAt: new Date(ctx.now.getTime() + 24 * 3600_000).toISOString(), assigneeId: ops, bookingId: pol.bookingId, priority: "high" }, ctx.now);
    return { number: cl.number };
  }),

  visaUploadInfo: action(z.object({ token: z.string().min(16) }), async (s, ctx, i) => {
    const vc = (await s.list("visaCases")).find((v) => v.uploadToken === i.token);
    if (!vc) throw new DomainError("This upload link is not valid.", 404);
    const settings = await getSettings(s, ctx.now);
    const files = (await s.list("files")).filter((f) => f.ownerType === "visaCase" && f.ownerId === vc.id);
    return {
      company: { name: settings.companyName, brandColor: settings.brandColor, phone: settings.phone },
      number: vc.number, country: vc.country, visaType: vc.visaType, status: vc.status, closed: ["submitted", "in_process", "approved", "rejected", "delivered"].includes(vc.status),
      applicants: vc.applicants.map((a, idx) => ({ index: idx, name: a.name, docs: a.docs.map((d) => ({ name: d.name, received: d.received, uploaded: files.filter((f) => f.applicantIndex === idx && f.label === d.name).map((f) => f.name) })) })),
    };
  }),

  visaUpload: action(fileInput.extend({ token: z.string().min(16), applicantIndex: z.number().int().min(0), docName: z.string().min(1).max(200) }), async (s, ctx, i) => {
    const vc = (await s.list("visaCases")).find((v) => v.uploadToken === i.token);
    if (!vc) throw new DomainError("This upload link is not valid.", 404);
    if (["submitted", "in_process", "approved", "rejected", "delivered"].includes(vc.status)) throw new DomainError("This application has already been submitted. Contact us to change documents.", 409);
    const ap = vc.applicants[i.applicantIndex];
    if (!ap || !ap.docs.some((d) => d.name === i.docName)) throw new DomainError("That document is not on the checklist.", 422);
    const size = checkUpload(i.dataUrl, i.mime);
    await createRow(s, "files", { name: i.name, mime: i.mime, size, dataUrl: i.dataUrl, ownerType: "visaCase", ownerId: vc.id, label: i.docName, uploadedVia: "customer", applicantIndex: i.applicantIndex }, ctx.now);
    const out = await markDocReceived(s, ctx, vc.id, i.applicantIndex, i.docName);
    await log(s, ctx, { visaCaseId: vc.id, body: `${ap.name} uploaded "${i.docName}" through the secure link.` });
    if (vc.assigneeId && !(await s.list("tasks")).some((t) => !t.done && t.visaCaseId === vc.id && /review uploaded/i.test(t.title))) {
      await createRow(s, "tasks", { title: `Review uploaded documents for ${vc.number}`, dueAt: new Date(ctx.now.getTime() + 4 * 3600_000).toISOString(), assigneeId: vc.assigneeId, visaCaseId: vc.id }, ctx.now);
    }
    return { received: out.applicants[i.applicantIndex]!.docs.filter((d) => d.received).length, total: out.applicants[i.applicantIndex]!.docs.length, status: out.status };
  }),

  proposalPhotos: action(z.object({ token: z.string().min(8) }), async (s, _ctx, i) => {
    const q = (await s.list("quotes")).find((x) => x.shareToken === i.token && x.status !== "draft");
    if (!q) throw new DomainError("This proposal link is not valid.", 404);
    const ids = new Set(q.days.map((d) => d.photoId).filter((x): x is string => Boolean(x)));
    return Object.fromEntries((await s.list("files")).filter((f) => ids.has(f.id) && f.mime.startsWith("image/")).map((f) => [f.id, f.dataUrl]));
  }),

  packagePhotos: action(z.object({ packageId: z.string() }), async (s, _ctx, i) => {
    const p = await mustGet(s, "packages", i.packageId);
    if (!p.published) throw new DomainError("Not found", 404);
    const ids = new Set(p.days.map((d) => d.photoId).filter((x): x is string => Boolean(x)));
    return Object.fromEntries((await s.list("files")).filter((f) => ids.has(f.id) && f.mime.startsWith("image/")).map((f) => [f.id, f.dataUrl]));
  }),

  webChat: action(z.object({ name: z.string().trim().min(1, "Your name").max(120), phone: z.string().trim().regex(/^[+\d][\d\s-]{6,17}$/, "Enter a valid phone number"), text: z.string().trim().min(1).max(2000) }), async (s, ctx, i) => {
    const r = await actions.inboundMessage.run(s, { ...ctx, role: "admin" }, { channel: "web_chat", from: i.name, phone: i.phone, body: i.text });
    await afterInbound(s, ctx, r as InboundResult, "web_chat");
    const replies = (await s.list("messages")).filter((m) => m.phone === i.phone && m.direction === "out" && m.at >= ctx.now.toISOString()).map((m) => m.body);
    return { replies };
  }),
}, true);

/* ───────────────────────── notifications after workflow actions ───────────────────────── */

interface InboundResult {
  inbound: Entity<"messages">;
  reply: Entity<"messages">;
  lead: Lead | null;
}

async function afterInbound(s: Store, ctx: Ctx, r: InboundResult, channel: "whatsapp" | "email" | "web_chat") {
  const phone = r.inbound.phone;
  if (!phone) return;
  const thread = await upsertThread(s, ctx, phone, channel, r.inbound.from);
  const lead = r.lead;
  if (lead) {
    const patch: Record<string, unknown> = { status: "open", leadId: lead.id };
    if (!thread.ownerId) patch["ownerId"] = lead.ownerId;
    await patchRow(s, "chatThreads", thread.id, patch, ctx.now);
  } else if (thread.status === "closed") await patchRow(s, "chatThreads", thread.id, { status: "open" }, ctx.now);
  if (channel !== "web_chat") await queueMessage(s, ctx, { channel: "whatsapp", phone, body: r.reply.body, kind: "chat", leadId: lead?.id ?? null });
  if (!lead) return;
  // Campaign attribution: a reply within 14 days of a campaign message to the same number
  if (!lead.campaignId) {
    const since = new Date(ctx.now.getTime() - 14 * 86_400_000).toISOString();
    const hit = (await s.list("outbox")).filter((o) => o.kind === "campaign" && o.campaignId && last10(o.to) === last10(phone) && o.createdAt >= since).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (hit) {
      await patchRow(s, "leads", lead.id, { campaignId: hit.campaignId }, ctx.now);
      const c = await s.get("campaigns", hit.campaignId!);
      if (c) await patchRow(s, "campaigns", c.id, { leadCount: c.leadCount + 1 }, ctx.now);
    }
  }
  // Package suggestions from published packages for the asked destination (or budget)
  const settings = await getSettings(s, ctx.now);
  const pkgs = (await s.list("packages")).filter((p) => p.published && (lead.destination ? p.destination.toLowerCase() === lead.destination.toLowerCase() || p.country.toLowerCase() === lead.destination.toLowerCase() : false));
  const fit = lead.budget ? pkgs.filter((p) => !p.startingPrice || p.startingPrice * Math.max(1, lead.pax.adults) <= lead.budget! * 1.2) : pkgs;
  const picks = (fit.length ? fit : pkgs).slice(0, 2);
  if (picks.length) {
    const links = await Promise.all(picks.map(async (p) => `• ${p.name}${p.startingPrice ? ` — from ${rupees(p.startingPrice)} per person` : ""}: ${await linkFor(s, ctx, `/store/${ctx.tenantId}/package/${p.id}`)}`));
    const body = `While we prepare your quote, you may like:\n${links.join("\n")}`;
    await createRow(s, "messages", { channel, from: settings.companyName, phone, body, at: ctx.now.toISOString(), direction: "out", handledBy: "bot", leadId: lead.id }, ctx.now);
    if (channel !== "web_chat") await queueMessage(s, ctx, { channel: "whatsapp", phone, body, kind: "chat", leadId: lead.id });
  }
}

registerAfterHook(async (s, ctx, name, input, output) => {
  const settings = () => getSettings(s, ctx.now);
  switch (name) {
    case "inboundMessage": {
      const i = input as { channel: "whatsapp" | "email" | "web_chat" };
      await afterInbound(s, ctx, output as InboundResult, i.channel);
      break;
    }
    case "replyMessage": {
      const m = output as Entity<"messages">;
      if (m.channel !== "web_chat") await queueMessage(s, ctx, { channel: m.channel === "email" ? "email" : "whatsapp", phone: m.channel === "email" ? null : m.phone, email: m.channel === "email" ? m.phone : null, body: m.body, kind: "chat", leadId: m.leadId });
      const t = (await s.list("chatThreads")).find((x) => x.phone === m.phone);
      if (t && !t.ownerId) await patchRow(s, "chatThreads", t.id, { ownerId: ctx.userId }, ctx.now);
      break;
    }
    case "sendCampaign": {
      await queueCampaign(s, ctx, (input as { campaignId: string }).campaignId);
      break;
    }
    case "sendQuote": {
      const i = input as { channel: "whatsapp" | "email" | "link" };
      const q = (output as { quote: Entity<"quotes"> }).quote;
      if (i.channel !== "link") await queueMessage(s, ctx, { channel: i.channel, phone: q.phone, email: q.email, subject: `Your proposal: ${q.title}`, body: T.quoteLink(q.contactName, q.title, await linkFor(s, ctx, `/p/${ctx.tenantId}/${q.shareToken}`)), kind: "notification", leadId: q.leadId });
      break;
    }
    case "generateVoucher": {
      const sv = output as Entity<"services">;
      const b = await s.get("bookings", sv.bookingId);
      if (b && sv.voucherNo) await queueMessage(s, ctx, { phone: b.phone, email: b.email, subject: `Voucher ${sv.voucherNo}`, body: T.voucher(b.contactName, sv.title, sv.voucherNo, await linkFor(s, ctx, `/my/${ctx.tenantId}`)), kind: "notification", bookingId: b.id });
      break;
    }
    case "assignResource": {
      const a = output as Entity<"assignments">;
      const [res, sv, b] = await Promise.all([s.get("resources", a.resourceId), s.get("services", a.serviceId), s.get("bookings", a.bookingId)]);
      if (res && sv && b) {
        if (a.notifiedVia !== "app") await queueMessage(s, ctx, { channel: a.notifiedVia === "email" ? "email" : "whatsapp", phone: res.phone, body: T.driverJob(res.name, sv.title, a.from, b), kind: "notification", bookingId: b.id });
        await queueMessage(s, ctx, { phone: b.phone, email: b.email, body: T.driverForGuest(b.contactName, res.kind, res.name, res.phone, sv.title), kind: "notification", bookingId: b.id });
      }
      break;
    }
    case "advanceVisaCase": {
      const vc = output as Entity<"visaCases">;
      await queueMessage(s, ctx, { phone: vc.phone, email: vc.email, subject: `Visa ${vc.number}: ${vc.status.replace(/_/g, " ")}`, body: T.visaStatus(vc.contactName, vc.number, vc.country, vc.status, vc.status === "rejected" || vc.status === "approved" ? vc.decisionNote : "", await linkFor(s, ctx, `/visa-status/${ctx.tenantId}`)), kind: "notification", visaCaseId: vc.id });
      break;
    }
    case "createVisaCase": {
      const vc = output as Entity<"visaCases">;
      await queueMessage(s, ctx, { phone: vc.phone, email: vc.email, subject: `Documents for your ${vc.country} visa`, body: T.visaUpload(vc.contactName, vc.number, vc.country, await linkFor(s, ctx, `/visa-upload/${ctx.tenantId}/${vc.uploadToken}`)), kind: "notification", visaCaseId: vc.id });
      break;
    }
    case "recordPayment": {
      const r = output as { payment: Entity<"payments">; invoice: Entity<"invoices"> };
      const b = r.invoice.bookingId ? await s.get("bookings", r.invoice.bookingId) : undefined;
      if (b) await queueMessage(s, ctx, { phone: b.phone, email: b.email, body: T.paymentReceipt(b.contactName, r.payment.amount, r.invoice.number, outstandingOf(r.invoice)), kind: "notification", bookingId: b.id, invoiceId: r.invoice.id });
      break;
    }
    default:
      break;
  }
  void settings;
  void addDays;
  void todayOf;
});
