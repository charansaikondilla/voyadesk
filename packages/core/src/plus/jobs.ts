/**
 * Background work, run every minute by the server (and on a timer in the browser demo):
 * scheduled campaigns, drip sequences, payment reminders, AI follow-ups, hold and link expiry, message delivery.
 * Every job is idempotent: it checks the outbox before sending, so running twice never double-sends.
 */
import { z } from "zod";
import { internals, registerActions } from "../actions.js";
import { addDays, daysBetween, isoDate } from "../dates.js";
import { type Entity, type Outbox } from "../entities.js";
import { bestSendHour, campaignRoi, destinationTrends, forecastRevenue, launchSuggestions, predictLead, trainLeadModel, weightedPipeline } from "../insights.js";
import { deliverQueued, queueMessage, T } from "../messaging.js";
import { registerActionRoles } from "../permissions.js";
import { providersFor } from "../providers.js";
import { registerReports } from "../reports.js";
import { DomainError, scoreLead } from "../rules.js";
import { getSettings, patchRow, todayOf, type Ctx, type Store } from "../store.js";
import { createLink } from "./commerce.js";
import { queueCampaign } from "./engage.js";
import { runAutomations } from "./growth.js";
import { action, linkFor, log, rupees } from "./shared.js";

const { outstandingOf } = internals;

const recent = (rows: Outbox[], since: string, match: (o: Outbox) => boolean) => rows.some((o) => o.createdAt >= since && match(o));

/* ───────────────────────── follow-ups ───────────────────────── */

export interface FollowUp {
  kind: "lead" | "quote" | "payment" | "visa";
  refId: string;
  name: string;
  phone: string;
  email: string;
  body: string;
  reason: string;
  leadId: string | null;
  bookingId: string | null;
  invoiceId: string | null;
  visaCaseId: string | null;
}

async function personalise(ctx: Ctx, base: string, context: string): Promise<{ body: string; ai: boolean }> {
  const out = await providersFor(ctx).ai.complete({
    system: "You write short, warm WhatsApp follow-ups for an Indian travel agency. One message, under 60 words, no emojis overload, keep any link exactly as given. Reply with the message only.",
    prompt: `Context: ${context}\nDraft: ${base}`, maxTokens: 300,
  });
  return out && out.trim().length > 10 ? { body: out.trim().slice(0, 1000), ai: true } : { body: base, ai: false };
}

/** Find everyone who needs a nudge today: quiet leads, unanswered proposals, money due, missing visa documents. */
export async function findFollowUps(s: Store, ctx: Ctx): Promise<FollowUp[]> {
  const settings = await getSettings(s, ctx.now);
  const today = todayOf(ctx, settings);
  const since3 = new Date(ctx.now.getTime() - 3 * 86_400_000).toISOString();
  const twoDaysAgo = new Date(ctx.now.getTime() - 2 * 86_400_000).toISOString();
  const [leads, quotes, invoices, bookings, visas, outbox] = await Promise.all([s.list("leads"), s.list("quotes"), s.list("invoices"), s.list("bookings"), s.list("visaCases"), s.list("outbox")]);
  const out: FollowUp[] = [];
  for (const l of leads) {
    if (!["new", "contacted"].includes(l.stage) || !(l.lastActivityAt && l.lastActivityAt < twoDaysAgo) || l.createdAt < addDays(today, -30)) continue;
    if (recent(outbox, since3, (o) => o.kind === "followup" && o.leadId === l.id)) continue;
    out.push({ kind: "lead", refId: l.id, name: l.name, phone: l.phone, email: l.email, leadId: l.id, bookingId: null, invoiceId: null, visaCaseId: null, reason: "No reply for 2+ days",
      body: `Hi ${l.name.split(" ")[0]}, just checking in about your ${l.destination || "trip"} plans${l.travelDate ? ` for ${l.travelDate}` : ""}. Shall I send you a few options? Reply with your budget and I'll share them today.` });
  }
  for (const q of quotes) {
    if (!["sent", "viewed"].includes(q.status) || q.updatedAt > twoDaysAgo || (q.validUntil && q.validUntil < today)) continue;
    if (recent(outbox, since3, (o) => o.kind === "followup" && o.leadId === q.leadId && o.body.includes(q.shareToken))) continue;
    const link = await linkFor(s, ctx, `/p/${ctx.tenantId}/${q.shareToken}`);
    out.push({ kind: "quote", refId: q.id, name: q.contactName, phone: q.phone, email: q.email, leadId: q.leadId, bookingId: null, invoiceId: null, visaCaseId: null, reason: q.status === "viewed" ? "Opened the proposal but hasn't confirmed" : "Proposal not opened yet",
      body: `Hi ${q.contactName.split(" ")[0]}, your ${q.title} proposal (${rupees(q.total)}) is ready${q.validUntil ? ` and the price holds until ${q.validUntil}` : ""}. You can confirm, pay or hold it here: ${link}` });
  }
  for (const inv of invoices) {
    const due = outstandingOf(inv);
    if (due <= 0 || inv.status === "cancelled" || inv.partyType !== "customer" || inv.dueDate > addDays(today, 3)) continue;
    if (recent(outbox, since3, (o) => ["reminder", "followup"].includes(o.kind) && o.invoiceId === inv.id)) continue;
    const b = inv.bookingId ? bookings.find((x) => x.id === inv.bookingId) : undefined;
    if (!b || b.status === "cancelled") continue;
    out.push({ kind: "payment", refId: inv.id, name: b.contactName, phone: b.phone, email: b.email, leadId: b.leadId, bookingId: b.id, invoiceId: inv.id, visaCaseId: null, reason: inv.dueDate < today ? `Overdue since ${inv.dueDate}` : `Due ${inv.dueDate}`,
      body: "" });
  }
  for (const v of visas) {
    if (v.status !== "docs_pending" || v.updatedAt > twoDaysAgo) continue;
    if (recent(outbox, since3, (o) => o.kind === "followup" && o.visaCaseId === v.id)) continue;
    const missing = v.applicants.flatMap((a) => a.docs.filter((d) => !d.received).map((d) => d.name));
    if (!missing.length) continue;
    out.push({ kind: "visa", refId: v.id, name: v.contactName, phone: v.phone, email: v.email, leadId: null, bookingId: null, invoiceId: null, visaCaseId: v.id, reason: `${missing.length} document${missing.length > 1 ? "s" : ""} missing`,
      body: `Hi ${v.contactName.split(" ")[0]}, we still need ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? " and more" : ""} for your ${v.country} visa. Upload them from your phone here: ${await linkFor(s, ctx, `/visa-upload/${ctx.tenantId}/${v.uploadToken}`)}` });
  }
  return out;
}

/** Turn follow-ups into messages: payment ones get a fresh pay link. Returns what was queued (or drafted). */
export async function runFollowUps(s: Store, ctx: Ctx, mode: "send" | "draft", only?: string[]): Promise<{ queued: number; items: (FollowUp & { ai: boolean })[] }> {
  const items = (await findFollowUps(s, ctx)).filter((f) => !only || only.includes(f.refId));
  const done: (FollowUp & { ai: boolean })[] = [];
  const canPay = providersFor(ctx).payments.name !== "none";
  for (const f of items) {
    let body = f.body;
    if (f.kind === "payment" && f.invoiceId) {
      const inv = (await s.get("invoices", f.invoiceId))!;
      const due = outstandingOf(inv);
      let link = await linkFor(s, ctx, `/my/${ctx.tenantId}`);
      if (canPay) {
        const existing = (await s.list("paymentLinks")).find((l) => l.invoiceId === inv.id && l.status === "created" && l.amount === due);
        link = existing?.url ?? (await createLink(s, ctx, { purpose: "invoice", amount: due, description: `Payment for ${inv.number}`, customer: { name: f.name, phone: f.phone, email: f.email }, invoiceId: inv.id })).url;
      }
      body = T.paymentReminder(f.name.split(" ")[0] ?? f.name, inv.number, due, inv.dueDate, link);
    }
    const p = await personalise(ctx, body, `${f.kind} follow-up: ${f.reason}`);
    const row = await queueMessage(s, ctx, { phone: f.phone, email: f.email, subject: "A quick follow-up", body: p.body, kind: f.kind === "payment" ? "reminder" : "followup", status: mode === "draft" ? "draft" : "queued", leadId: f.leadId, bookingId: f.bookingId, invoiceId: f.invoiceId, visaCaseId: f.visaCaseId });
    if (!row) continue;
    if (f.leadId) await log(s, ctx, { leadId: f.leadId, kind: "whatsapp", direction: "out", body: `${p.ai ? "AI" : "Automatic"} follow-up ${mode === "draft" ? "drafted" : "sent"}: ${f.reason}.` });
    done.push({ ...f, body: p.body, ai: p.ai });
  }
  return { queued: done.length, items: done };
}

/* ───────────────────────── drips ───────────────────────── */

async function runDrips(s: Store, ctx: Ctx): Promise<number> {
  const settings = await getSettings(s, ctx.now);
  const today = todayOf(ctx, settings);
  const [drips, leads, quotes, bookings, outbox] = await Promise.all([s.list("dripSequences"), s.list("leads"), s.list("quotes"), s.list("bookings"), s.list("outbox")]);
  const sentKey = new Set(outbox.filter((o) => o.dripId).map((o) => `${o.dripId}|${o.dripStep}|${o.leadId ?? o.bookingId}`));
  let n = 0;
  for (const d of drips.filter((x) => x.active && x.steps.length)) {
    const since = d.createdAt.slice(0, 10) > addDays(today, -60) ? d.createdAt.slice(0, 10) : addDays(today, -60);
    type Target = { key: string; name: string; phone: string; email: string; destination: string; anchor: string; leadId: string | null; bookingId: string | null; link: string };
    const targets: Target[] = [];
    if (d.trigger === "new_lead") for (const l of leads.filter((x) => x.createdAt.slice(0, 10) >= since && !["won", "lost"].includes(x.stage))) targets.push({ key: l.id, name: l.name, phone: l.phone, email: l.email, destination: l.destination, anchor: l.createdAt.slice(0, 10), leadId: l.id, bookingId: null, link: await linkFor(s, ctx, `/store/${ctx.tenantId}`) });
    if (d.trigger === "no_reply_3d") for (const l of leads.filter((x) => ["new", "contacted"].includes(x.stage) && x.lastActivityAt && x.lastActivityAt.slice(0, 10) >= since)) targets.push({ key: l.id, name: l.name, phone: l.phone, email: l.email, destination: l.destination, anchor: addDays(l.lastActivityAt!.slice(0, 10), 3), leadId: l.id, bookingId: null, link: await linkFor(s, ctx, `/store/${ctx.tenantId}`) });
    if (d.trigger === "quote_sent") for (const q of quotes.filter((x) => ["sent", "viewed"].includes(x.status) && x.updatedAt.slice(0, 10) >= since)) targets.push({ key: q.leadId ?? q.id, name: q.contactName, phone: q.phone, email: q.email, destination: q.destination, anchor: q.updatedAt.slice(0, 10), leadId: q.leadId, bookingId: null, link: await linkFor(s, ctx, `/p/${ctx.tenantId}/${q.shareToken}`) });
    if (d.trigger === "trip_completed") for (const b of bookings.filter((x) => x.status !== "cancelled" && x.endDate < today && x.endDate >= since)) targets.push({ key: b.id, name: b.contactName, phone: b.phone, email: b.email, destination: b.destination, anchor: b.endDate, leadId: null, bookingId: b.id, link: await linkFor(s, ctx, `/store/${ctx.tenantId}`) });
    for (const t of targets) {
      for (const [k, step] of d.steps.entries()) {
        if (addDays(t.anchor, step.afterDays) > today) continue;
        if (sentKey.has(`${d.id}|${k}|${t.key}`)) continue;
        const body = step.message.replace(/\{name\}/gi, t.name.split(" ")[0] ?? "").replace(/\{destination\}/gi, t.destination || "your trip").replace(/\{company\}/gi, settings.companyName).replace(/\{link\}/gi, t.link);
        const row = await queueMessage(s, ctx, { channel: step.channel, phone: t.phone, email: t.email, subject: d.name, body, kind: "drip", dripId: d.id, dripStep: k, leadId: t.leadId ?? (d.trigger === "trip_completed" ? null : t.key), bookingId: t.bookingId });
        sentKey.add(`${d.id}|${k}|${t.key}`);
        if (row) n++;
      }
    }
  }
  return n;
}

/* ───────────────────────── the job runner ───────────────────────── */

export async function runJobs(s: Store, ctx: Ctx): Promise<Record<string, number>> {
  const settings = await getSettings(s, ctx.now);
  const now = ctx.now.toISOString();
  const r: Record<string, number> = { campaigns: 0, drips: 0, automations: 0, followUps: 0, holdsExpired: 0, linksExpired: 0, sent: 0, failed: 0, waiting: 0 };
  for (const c of (await s.list("campaigns")).filter((x) => x.status === "scheduled" && x.scheduledAt && x.scheduledAt <= now)) {
    const n = await queueCampaign(s, ctx, c.id);
    await patchRow(s, "campaigns", c.id, { status: "sent", sentCount: n, cost: c.channel === "whatsapp" ? n * 86 : 0 }, ctx.now);
    r["campaigns"]! += 1;
  }
  r["drips"] = await runDrips(s, ctx);
  // Automations run before the generic follow-ups: their messages count as the nudge, so nobody is messaged twice
  r["automations"] = await runAutomations(s, ctx);
  // Follow-ups and reminders: the outbox check (one nudge per person every 3 days) prevents repeats
  if (settings.autoFollowUps || settings.paymentReminders) {
    const items = (await findFollowUps(s, ctx)).filter((f) => (f.kind === "payment" ? settings.paymentReminders : settings.autoFollowUps));
    if (items.length) r["followUps"] = (await runFollowUps(s, ctx, "send", items.map((x) => x.refId))).queued;
  }
  for (const h of (await s.list("holds")).filter((x) => x.status === "held" && x.holdUntil < now)) {
    await patchRow(s, "holds", h.id, { status: "expired" }, ctx.now);
    const q = await s.get("quotes", h.quoteId);
    await log(s, ctx, { leadId: q?.leadId ?? null, body: `Hold on ${q?.number ?? "quote"} expired without payment.` });
    r["holdsExpired"]! += 1;
  }
  for (const l of (await s.list("paymentLinks")).filter((x) => x.status === "created" && x.expiresAt && x.expiresAt < now)) {
    await patchRow(s, "paymentLinks", l.id, { status: "expired" }, ctx.now);
    r["linksExpired"]! += 1;
  }
  const d = await deliverQueued(s, ctx);
  r["sent"] = d.sent;
  r["failed"] = d.failed;
  r["waiting"] = d.waiting;
  return r;
}

/* ───────────────────────── actions + reports ───────────────────────── */

registerActionRoles({ runJobs: ["owner", "admin"], aiFollowUps: ["owner", "admin", "sales", "accounts", "visa", "marketing"], rescoreLeads: ["owner", "admin", "sales"] });

registerActions({
  runJobs: action(z.object({}), (s, ctx) => runJobs(s, ctx)),

  aiFollowUps: action(z.object({ mode: z.enum(["preview", "draft", "send"]).default("preview"), refIds: z.array(z.string()).optional() }), async (s, ctx, i) => {
    if (i.mode === "preview") return { queued: 0, items: await findFollowUps(s, ctx) };
    const r = await runFollowUps(s, ctx, i.mode, i.refIds);
    if (i.mode === "send") await deliverQueued(s, ctx);
    return r;
  }),

  rescoreLeads: action(z.object({}), async (s, ctx) => {
    const leads = await s.list("leads");
    const model = trainLeadModel(leads);
    if (!model.ready) throw new DomainError(`Need at least 12 won or lost leads to learn from (you have ${model.trainedOn}).`, 422);
    const today = todayOf(ctx, await getSettings(s, ctx.now));
    const activities = await s.list("activities");
    let n = 0;
    for (const l of leads.filter((x) => !["won", "lost"].includes(x.stage))) {
      const rules = scoreLead({ source: l.source, budget: l.budget, payingPax: l.pax.adults + l.pax.children, travelDate: l.travelDate, destination: l.destination || null, phone: l.phone || null, email: l.email || null, activityCount: activities.filter((a) => a.leadId === l.id).length, today });
      const p = predictLead(model, { ...l, score: rules.score });
      const score = Math.round(rules.score * 0.5 + p.chance * 0.5);
      await patchRow(s, "leads", l.id, { score, temperature: score >= 70 ? "hot" : score >= 45 ? "warm" : "cold", scoreReasons: [...p.reasons, `Win chance ${p.chance}% — learned from ${model.trainedOn} closed leads`, ...rules.reasons.slice(0, 3)] }, ctx.now);
      n++;
    }
    return { rescored: n, trainedOn: model.trainedOn };
  }),
});

registerReports({
  insights: {
    params: z.object({}).passthrough(), roles: ["owner", "admin", "sales", "marketing"],
    run: (async (s: Store, ctx: Ctx) => {
      const today = isoDate(ctx.now);
      const [leads, bookings, packages, messages] = await Promise.all([s.list("leads"), s.list("bookings"), s.list("packages"), s.list("messages")]);
      const model = trainLeadModel(leads);
      const open = leads.filter((l) => !["won", "lost"].includes(l.stage));
      const predicted = open.map((l) => ({ id: l.id, name: l.name, destination: l.destination, stage: l.stage, ...predictLead(model, l) })).sort((a, b) => b.chance - a.chance).slice(0, 10);
      const live = bookings.filter((b) => b.status !== "cancelled");
      const avg = live.length ? Math.round(live.reduce((a, b) => a + b.sellTotal, 0) / live.length) : 0;
      const trends = destinationTrends(leads, packages, today);
      return {
        model: { trainedOn: model.trainedOn, ready: model.ready, baseRate: Math.round(model.baseRate * 100), factors: model.factors.filter((f) => f.n >= 2).slice(0, 10) },
        predicted, forecast: forecastRevenue(bookings, today, 3), pipeline: weightedPipeline(open, avg), trends: trends.slice(0, 8),
        suggestions: launchSuggestions(trends), bestHour: bestSendHour(messages.filter((m) => m.direction === "in")), roi: await campaignRoi(s),
      };
    }) as never,
  },
  calls: {
    params: z.object({}).passthrough(), roles: ["owner", "admin", "sales", "marketing"],
    run: (async (s: Store, ctx: Ctx) => {
      const today = isoDate(ctx.now);
      const [calls, tasks, users] = await Promise.all([s.list("calls"), s.list("tasks"), s.list("users")]);
      const todays = calls.filter((c) => isoDate(new Date(c.startedAt)) === today);
      const missed = calls.filter((c) => c.direction === "in" && c.status !== "answered");
      const missedWithTask = missed.filter((c) => c.callbackTaskId);
      const calledBack = missedWithTask.filter((c) => tasks.find((t) => t.id === c.callbackTaskId)?.done).length;
      const byUser = users.filter((u) => ["sales", "owner", "admin", "marketing", "visa"].includes(u.role)).map((u) => {
        const mine = calls.filter((c) => c.userId === u.id);
        return { id: u.id, name: u.name, calls: mine.length, talkMinutes: Math.round(mine.reduce((a, c) => a + c.durationSec, 0) / 60) };
      }).filter((x) => x.calls > 0);
      return {
        today: todays.length, todayMissed: todays.filter((c) => c.direction === "in" && c.status !== "answered").length, recordings: calls.filter((c) => c.recordingUrl).length,
        followUpRate: missedWithTask.length ? Math.round((calledBack / missedWithTask.length) * 100) : 100, avgTalkSec: calls.length ? Math.round(calls.filter((c) => c.status === "answered").reduce((a, c) => a + c.durationSec, 0) / Math.max(1, calls.filter((c) => c.status === "answered").length)) : 0,
        byUser, aiCalls: calls.filter((c) => c.source === "ai_voice").length,
      };
    }) as never,
  },
  visaPlus: {
    params: z.object({}).passthrough(), roles: ["owner", "admin", "visa"],
    run: (async (s: Store) => {
      const [cases, users, agents] = await Promise.all([s.list("visaCases"), s.list("users"), s.list("agents")]);
      const done = (v: Entity<"visaCases">) => ["approved", "rejected", "delivered"].includes(v.status);
      const months = new Map<string, { approved: number; rejected: number }>();
      for (const v of cases.filter((x) => ["approved", "rejected", "delivered"].includes(x.status))) {
        const m = v.updatedAt.slice(0, 7);
        const row = months.get(m) ?? { approved: 0, rejected: 0 };
        if (v.status === "rejected") row.rejected++; else row.approved++;
        months.set(m, row);
      }
      const byStatus = ["docs_pending", "docs_received", "submitted", "in_process", "approved", "rejected", "delivered"].map((st) => ({ status: st, count: cases.filter((v) => v.status === st).length }));
      const staff = users.filter((u) => u.role === "visa" || cases.some((v) => v.assigneeId === u.id)).map((u) => {
        const mine = cases.filter((v) => v.assigneeId === u.id);
        const closed = mine.filter(done);
        const days = closed.map((v) => Math.max(0, daysBetween(v.createdAt.slice(0, 10), v.updatedAt.slice(0, 10))));
        return { id: u.id, name: u.name, open: mine.length - closed.length, closed: closed.length, avgDays: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null };
      });
      const byAgent = agents.map((a) => {
        const mine = cases.filter((v) => v.agentId === a.id);
        return { id: a.id, name: a.name, cases: mine.length, approved: mine.filter((v) => v.status === "approved" || v.status === "delivered").length, revenue: mine.reduce((x, v) => x + v.fee, 0) };
      }).filter((x) => x.cases > 0);
      const revenueByCountry = [...new Set(cases.map((v) => v.country))].map((c) => ({ country: c, cases: cases.filter((v) => v.country === c).length, revenue: cases.filter((v) => v.country === c).reduce((x, v) => x + v.fee, 0) })).sort((a, b) => b.revenue - a.revenue);
      return { byStatus, trend: [...months.entries()].sort().map(([month, v]) => ({ month, ...v })), staff, byAgent, revenueByCountry };
    }) as never,
  },
  commissions: {
    params: z.object({}).passthrough(), roles: ["owner", "admin", "accounts", "agent"],
    run: (async (s: Store, ctx: Ctx) => {
      const rows = (await s.list("commissions")).filter((c) => ctx.role !== "agent" || c.agentId === ctx.agentId);
      const agents = await s.list("agents");
      return { rows: rows.map((c) => ({ ...c, agentName: agents.find((a) => a.id === c.agentId)?.name ?? "" })), accrued: rows.filter((c) => c.status === "accrued").reduce((a, c) => a + c.amount, 0), paid: rows.filter((c) => c.status === "paid").reduce((a, c) => a + c.amount, 0) };
    }) as never,
  },
  messaging: {
    params: z.object({}).passthrough(), roles: ["owner", "admin", "marketing", "sales"],
    run: (async (s: Store, ctx: Ctx) => {
      const rows = await s.list("outbox");
      const count = (f: (o: Outbox) => boolean) => rows.filter(f).length;
      const p = providersFor(ctx);
      return {
        provider: { messaging: p.messaging.name, payments: p.payments.name, flights: p.flights.name, ai: p.ai.name, voice: p.voice.name, sandbox: p.messaging.sandbox },
        byStatus: ["draft", "queued", "sent", "delivered", "read", "failed"].map((st) => ({ status: st, count: count((o) => o.status === st) })),
        byKind: ["notification", "campaign", "drip", "reminder", "followup", "chat", "otp"].map((k) => ({ kind: k, count: count((o) => o.kind === k) })),
        waiting: count((o) => o.status === "queued" && Boolean(o.error)), drafts: count((o) => o.status === "draft"),
      };
    }) as never,
  },
  availability: {
    params: z.object({ from: z.string().optional(), days: z.number().int().min(1).max(31).default(14) }), roles: ["owner", "admin", "ops", "sales"],
    run: (async (s: Store, ctx: Ctx, p: { from?: string; days: number }) => {
      const from = p.from ?? isoDate(ctx.now);
      const dates = Array.from({ length: p.days }, (_, k) => addDays(from, k));
      const [allotments, hotels] = await Promise.all([s.list("allotments"), s.list("hotels")]);
      const keys = [...new Set(allotments.map((a) => `${a.hotelId}|${a.roomType}`))];
      return {
        dates,
        rows: keys.map((k) => {
          const [hotelId, roomType] = k.split("|") as [string, string];
          const h = hotels.find((x) => x.id === hotelId);
          return { hotelId, hotel: h?.name ?? "Hotel", city: h?.city ?? "", roomType, cells: dates.map((d) => { const blocks = allotments.filter((a) => a.hotelId === hotelId && a.roomType === roomType && a.from <= d && a.to >= d); return blocks.length ? { total: blocks.reduce((x, a) => x + a.rooms, 0), booked: blocks.reduce((x, a) => x + (a.booked[d] ?? 0), 0) } : null; }) };
        }),
      };
    }) as never,
  },
});
