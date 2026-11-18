/**
 * Server routes for the feature pack:
 *  - integrations: connect / disconnect each provider (owner/admin), values encrypted and never returned
 *  - payment webhooks (Razorpay, Stripe, PayPal) → automatic reconciliation
 *  - WhatsApp Cloud webhook (incoming chats + delivery receipts), Meta lead ads, call logs (IVR / SIM app / Exotel), inbound email
 *  - Google Sheets rate import (published CSV)
 *  - background scheduler (drips, reminders, follow-ups, delivery)
 */
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { applyDeliveryStatus, DomainError, deliverQueued, recordCall, runAction, runJobs, settlePaymentLink, type Ctx, type Providers } from "@voyadesk/core";
import { type Db } from "./db.js";
import { type PgStore } from "./pgStore.js";
import { hmacHex, paypalClient, safeEqual, verifyStripe } from "./providers.js";
import { SERVICES, type Service, type TenantSecrets } from "./secrets.js";

type Handler = (req: Request, res: Response) => Promise<unknown>;
type RawReq = Request & { rawBody?: string };

export interface ExtraDeps {
  db: Db;
  secrets: TenantSecrets;
  providersOf: (tenantId: string) => Promise<Providers>;
  inTenant: <T>(tenantId: string, fn: (s: PgStore) => Promise<T>) => Promise<T>;
  authenticate: (req: Request) => Promise<{ ctx: Ctx; tenantId: string }>;
  now: () => Date;
  publicApiUrl?: string;
  webhookSecret: string;
  fetch?: typeof fetch;
}

export function mountExtras(app: Express, d: ExtraDeps): void {
  const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).then((out) => { if (!res.headersSent) res.json({ data: out ?? null }); }).catch(next);
  };
  const f = d.fetch ?? fetch;
  const tenantOf = async (req: Request) => {
    const tenantId = String(req.params["tenantId"]);
    const t = await d.db.query("SELECT 1 FROM tenants WHERE id = $1", [tenantId]);
    if (!t.rows.length) throw new DomainError("Not found", 404);
    return tenantId;
  };
  const sysCtx = async (tenantId: string, userId = "webhook"): Promise<Ctx> => ({ tenantId, userId, role: "admin", agentId: null, now: d.now(), providers: await d.providersOf(tenantId) });
  const ownerOnly = async (req: Request) => {
    const a = await d.authenticate(req);
    if (!["owner", "admin"].includes(a.ctx.role)) throw new DomainError("Only the owner or an admin can manage integrations.", 403);
    return a;
  };
  const apiBase = (d.publicApiUrl ?? "").replace(/\/$/, "");

  /* ───────────── integrations ───────────── */
  app.get("/api/v1/integrations", wrap(async (req) => {
    const a = await ownerOnly(req);
    const secrets = await d.secrets.get(a.tenantId);
    const hook = (p: string) => `${apiBase || "<your API address>"}/api/v1/webhooks/${a.tenantId}/${p}`;
    return {
      services: await d.secrets.status(a.tenantId), sandbox: secrets.sandbox?.["enabled"] === "true",
      webhooks: {
        razorpay: hook("payments/razorpay"), stripe: hook("payments/stripe"), paypal: hook("payments/paypal"), whatsapp: hook("whatsapp-cloud"),
        metaLeads: hook("meta-leads"), calls: `${hook("calls")}?key=${secrets.calls?.["key"] ? "<your call key>" : "<set a call key first>"}`, email: `${hook("email")}?key=<your call key>`,
      },
    };
  }));
  app.put("/api/v1/integrations/:service", wrap(async (req) => {
    const a = await ownerOnly(req);
    const service = String(req.params["service"]);
    if (!(service in SERVICES)) throw new DomainError(`Unknown integration "${service}"`, 404);
    const values = z.record(z.string().max(4000)).parse(req.body ?? {});
    await d.secrets.set(a.tenantId, service as Service, values);
    return { ok: true, services: await d.secrets.status(a.tenantId) };
  }));
  app.delete("/api/v1/integrations/:service", wrap(async (req) => {
    const a = await ownerOnly(req);
    const service = String(req.params["service"]);
    if (!(service in SERVICES)) throw new DomainError(`Unknown integration "${service}"`, 404);
    await d.secrets.remove(a.tenantId, service as Service);
    return { ok: true, services: await d.secrets.status(a.tenantId) };
  }));
  app.post("/api/v1/integrations/test-message", wrap(async (req) => {
    const a = await ownerOnly(req);
    const i = z.object({ to: z.string().min(5).max(200) }).parse(req.body);
    const p = await d.providersOf(a.tenantId);
    const r = await p.messaging.send({ channel: i.to.includes("@") ? "email" : "whatsapp", to: i.to, subject: "Test message", body: "This is a test message from your travel CRM.", kind: "chat" });
    if (!r.ok) throw new DomainError(r.error ?? "The test message failed.", r.notConfigured ? 422 : 502);
    return { ok: true, ref: r.ref };
  }));

  /* ───────────── Google Sheets / CSV rate sheet fetch ───────────── */
  app.get("/api/v1/import/sheet", wrap(async (req) => {
    const a = await d.authenticate(req);
    if (!["owner", "admin", "ops"].includes(a.ctx.role)) throw new DomainError("You don't have permission to import rates.", 403);
    let url: URL;
    try { url = new URL(String(req.query["url"] ?? "")); } catch { throw new DomainError("Paste the sheet's link.", 422); }
    if (url.protocol !== "https:" || !["docs.google.com", "sheets.googleusercontent.com"].includes(url.hostname)) throw new DomainError("Use a Google Sheets link (File → Share → Publish to web → CSV).", 422);
    // Accept a normal sheet link and turn it into its CSV export
    const m = /\/spreadsheets\/d\/([\w-]+)/.exec(url.pathname);
    const gid = url.searchParams.get("gid") ?? /gid=(\d+)/.exec(url.hash)?.[1] ?? "0";
    const target = m && !url.pathname.includes("/pub") ? `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}` : url.toString();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10_000);
    try {
      const r = await f(target, { signal: ctl.signal, redirect: "follow" });
      if (!r.ok) throw new DomainError("The sheet could not be opened. Make sure it is shared as 'Anyone with the link' or published to the web.", 422);
      const text = await r.text();
      if (text.length > 2_000_000) throw new DomainError("The sheet is too large (over 2 MB). Split it into smaller sheets.", 413);
      if (/^\s*<!doctype html|<html/i.test(text)) throw new DomainError("Google returned a sign-in page. Share the sheet as 'Anyone with the link can view'.", 422);
      return { csv: text };
    } finally {
      clearTimeout(timer);
    }
  }));

  /* ───────────── payment webhooks ───────────── */
  const settleByToken = async (tenantId: string, token: string, paid: { amount: number; method: string; reference: string }) =>
    d.inTenant(tenantId, async (s) => {
      const ctx = await sysCtx(tenantId);
      const link = (await s.list("paymentLinks")).find((l) => l.token === token);
      if (!link) throw new DomainError("Unknown payment link", 404);
      return settlePaymentLink(s, ctx, link, paid);
    });

  app.post("/api/v1/webhooks/:tenantId/payments/razorpay", wrap(async (req) => {
    const tenantId = await tenantOf(req);
    const sec = (await d.secrets.get(tenantId)).razorpay?.["webhookSecret"];
    const raw = (req as RawReq).rawBody ?? "";
    if (!sec || !safeEqual(String(req.header("x-razorpay-signature") ?? ""), hmacHex(sec, raw))) throw new DomainError("Invalid signature", 401);
    const b = req.body as { event?: string; payload?: { payment_link?: { entity?: { reference_id?: string; amount_paid?: number } }; payment?: { entity?: { id?: string; method?: string; amount?: number } } } };
    if (b.event !== "payment_link.paid") return { ignored: b.event ?? "unknown" };
    const token = b.payload?.payment_link?.entity?.reference_id ?? "";
    const pay = b.payload?.payment?.entity;
    const out = await settleByToken(tenantId, token, { amount: b.payload?.payment_link?.entity?.amount_paid ?? pay?.amount ?? 0, method: pay?.method === "emi" ? "emi" : pay?.method ?? "upi", reference: pay?.id ?? "razorpay" });
    return { ok: true, status: out.link.status };
  }));

  app.post("/api/v1/webhooks/:tenantId/payments/stripe", wrap(async (req) => {
    const tenantId = await tenantOf(req);
    const sec = (await d.secrets.get(tenantId)).stripe?.["webhookSecret"];
    const raw = (req as RawReq).rawBody ?? "";
    if (!sec || !verifyStripe(raw, req.header("stripe-signature"), sec, Math.floor(d.now().getTime() / 1000))) throw new DomainError("Invalid signature", 401);
    const e = req.body as { type?: string; data?: { object?: { client_reference_id?: string; amount_total?: number; payment_status?: string; payment_intent?: string } } };
    if (e.type !== "checkout.session.completed" || e.data?.object?.payment_status !== "paid") return { ignored: e.type ?? "unknown" };
    const o = e.data.object;
    const out = await settleByToken(tenantId, o.client_reference_id ?? "", { amount: o.amount_total ?? 0, method: "card", reference: o.payment_intent ?? "stripe" });
    return { ok: true, status: out.link.status };
  }));

  app.post("/api/v1/webhooks/:tenantId/payments/paypal", wrap(async (req) => {
    const tenantId = await tenantOf(req);
    const secrets = await d.secrets.get(tenantId);
    if (!secrets.paypal?.["webhookId"]) throw new DomainError("PayPal webhook not configured", 401);
    const pp = paypalClient(secrets, f);
    const token = await pp.token();
    const verify = await f(`${pp.base}/v1/notifications/verify-webhook-signature`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ auth_algo: req.header("paypal-auth-algo"), cert_url: req.header("paypal-cert-url"), transmission_id: req.header("paypal-transmission-id"), transmission_sig: req.header("paypal-transmission-sig"), transmission_time: req.header("paypal-transmission-time"), webhook_id: secrets.paypal["webhookId"], webhook_event: req.body }),
    });
    const v = (await verify.json()) as { verification_status?: string };
    if (v.verification_status !== "SUCCESS") throw new DomainError("Invalid signature", 401);
    const e = req.body as { event_type?: string; resource?: { id?: string; custom_id?: string; amount?: { value?: string }; purchase_units?: { custom_id?: string; amount?: { value?: string } }[] } };
    if (e.event_type === "CHECKOUT.ORDER.APPROVED" && e.resource?.id) {
      const cap = await f(`${pp.base}/v2/checkout/orders/${e.resource.id}/capture`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
      const c = (await cap.json()) as { status?: string; purchase_units?: { custom_id?: string; payments?: { captures?: { id?: string; amount?: { value?: string } }[] } }[] };
      if (c.status !== "COMPLETED") return { ignored: `capture ${c.status ?? "failed"}` };
      const pu = c.purchase_units?.[0];
      const capt = pu?.payments?.captures?.[0];
      const out = await settleByToken(tenantId, pu?.custom_id ?? e.resource.purchase_units?.[0]?.custom_id ?? "", { amount: Math.round(Number(capt?.amount?.value ?? "0") * 100), method: "card", reference: capt?.id ?? e.resource.id });
      return { ok: true, status: out.link.status };
    }
    if (e.event_type === "PAYMENT.CAPTURE.COMPLETED" && e.resource?.custom_id) {
      const out = await settleByToken(tenantId, e.resource.custom_id, { amount: Math.round(Number(e.resource.amount?.value ?? "0") * 100), method: "card", reference: e.resource.id ?? "paypal" });
      return { ok: true, status: out.link.status };
    }
    return { ignored: e.event_type ?? "unknown" };
  }));

  /* ───────────── WhatsApp Cloud + Meta lead ads ───────────── */
  for (const kind of ["whatsapp-cloud", "meta-leads"] as const) {
    app.get(`/api/v1/webhooks/:tenantId/${kind}`, async (req, res, next) => {
      try {
        const tenantId = await tenantOf(req);
        const s = await d.secrets.get(tenantId);
        const expected = kind === "whatsapp-cloud" ? s.whatsapp?.["verifyToken"] : s.meta?.["verifyToken"];
        if (req.query["hub.mode"] === "subscribe" && expected && req.query["hub.verify_token"] === expected) res.status(200).send(String(req.query["hub.challenge"] ?? ""));
        else res.status(403).json({ error: { message: "Verification failed" } });
      } catch (e) { next(e); }
    });
  }

  const metaSigOk = (req: Request, appSecret: string | undefined) => {
    const sig = String(req.header("x-hub-signature-256") ?? "").replace(/^sha256=/, "");
    return Boolean(appSecret) && safeEqual(sig, hmacHex(appSecret!, (req as RawReq).rawBody ?? ""));
  };

  app.post("/api/v1/webhooks/:tenantId/whatsapp-cloud", wrap(async (req) => {
    const tenantId = await tenantOf(req);
    const s = await d.secrets.get(tenantId);
    if (!metaSigOk(req, s.whatsapp?.["appSecret"])) throw new DomainError("Invalid signature", 401);
    type Change = { value?: { contacts?: { profile?: { name?: string }; wa_id?: string }[]; messages?: { from: string; type: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string } } }[]; statuses?: { id: string; status: string; errors?: { title?: string }[] }[] } };
    const changes = ((req.body as { entry?: { changes?: Change[] }[] }).entry ?? []).flatMap((e) => e.changes ?? []);
    let messages = 0, statuses = 0;
    for (const ch of changes) {
      for (const m of ch.value?.messages ?? []) {
        const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? `[${m.type} message]`;
        const name = ch.value?.contacts?.find((c) => c.wa_id === m.from)?.profile?.name;
        await d.inTenant(tenantId, async (st) => runAction(st, await sysCtx(tenantId), "inboundMessage", { channel: "whatsapp", from: name, phone: `+${m.from}`, body: text }));
        messages++;
      }
      for (const stt of ch.value?.statuses ?? []) {
        const map: Record<string, "sent" | "delivered" | "read" | "failed"> = { sent: "sent", delivered: "delivered", read: "read", failed: "failed" };
        if (map[stt.status]) await d.inTenant(tenantId, async (st) => applyDeliveryStatus(st, await sysCtx(tenantId), stt.id, map[stt.status]!, stt.errors?.[0]?.title));
        statuses++;
      }
    }
    // Reply right away instead of waiting for the next scheduler tick
    if (messages) await d.inTenant(tenantId, async (st) => deliverQueued(st, await sysCtx(tenantId), 50));
    return { messages, statuses };
  }));

  app.post("/api/v1/webhooks/:tenantId/meta-leads", wrap(async (req) => {
    const tenantId = await tenantOf(req);
    const s = await d.secrets.get(tenantId);
    if (!metaSigOk(req, s.meta?.["appSecret"])) throw new DomainError("Invalid signature", 401);
    const ids = ((req.body as { entry?: { changes?: { field?: string; value?: { leadgen_id?: string } }[] }[] }).entry ?? []).flatMap((e) => e.changes ?? []).filter((c) => c.field === "leadgen" && c.value?.leadgen_id).map((c) => c.value!.leadgen_id!);
    let created = 0;
    for (const id of ids) {
      const r = await f(`https://graph.facebook.com/v21.0/${encodeURIComponent(id)}?access_token=${encodeURIComponent(s.meta?.["pageAccessToken"] ?? "")}`);
      const lead = (await r.json()) as { field_data?: { name: string; values: string[] }[]; ad_name?: string };
      if (!r.ok || !lead.field_data) continue;
      const get = (...names: string[]) => lead.field_data!.find((x) => names.includes(x.name.toLowerCase()))?.values?.[0];
      const other = lead.field_data.filter((x) => !["full_name", "phone_number", "email"].includes(x.name)).map((x) => `${x.name.replace(/_/g, " ")}: ${x.values.join(", ")}`).join("\n");
      await d.inTenant(tenantId, async (st) => runAction(st, await sysCtx(tenantId), "captureLead", { name: get("full_name", "name"), phone: get("phone_number", "phone"), email: get("email"), text: other || undefined, notes: lead.ad_name ? `Meta ad: ${lead.ad_name}` : undefined, source: "meta_ads" }));
      created++;
    }
    return { created };
  }));

  /* ───────────── call logs (IVR / SIM app / Exotel) and inbound email ───────────── */
  const keyOk = async (req: Request, tenantId: string) => {
    const key = (await d.secrets.get(tenantId)).calls?.["key"];
    const given = String(req.query["key"] ?? "");
    if (key && given && safeEqual(given, key)) return true;
    const sig = String(req.header("x-signature") ?? "").replace(/^sha256=/, "");
    return Boolean(sig) && safeEqual(sig, hmacHex(d.webhookSecret, (req as RawReq).rawBody ?? ""));
  };

  app.post("/api/v1/webhooks/:tenantId/calls", express.urlencoded({ extended: false, limit: "200kb" }), wrap(async (req) => {
    const tenantId = await tenantOf(req);
    if (!(await keyOk(req, tenantId))) throw new DomainError("Invalid key", 401);
    const b = req.body as Record<string, string | number | undefined>;
    const str = (...k: string[]) => { for (const x of k) if (b[x] !== undefined && b[x] !== "") return String(b[x]); return ""; };
    const sid = str("CallSid", "callId", "id");
    const rawStatus = str("status", "Status", "DialCallStatus", "CallStatus").toLowerCase();
    const status = /^(answered|completed|in-progress)$/.test(rawStatus) ? "answered" : /busy/.test(rawStatus) ? "busy" : /voicemail/.test(rawStatus) ? "voicemail" : /no-answer|no_answer|failed|missed|canceled|cancelled/.test(rawStatus) ? (str("direction", "Direction").startsWith("in") ? "missed" : "no_answer") : "answered";
    const duration = Number(str("durationSec", "DialCallDuration", "ConversationDuration", "Duration") || 0);
    return d.inTenant(tenantId, async (s) => {
      const ctx = await sysCtx(tenantId);
      // Status callback for an AI voice call we placed
      const existing = sid ? (await s.list("calls")).find((c) => c.providerRef === sid) : undefined;
      if (existing) {
        const { patchRow } = await import("@voyadesk/core");
        return patchRow(s, "calls", existing.id, { status: status === "missed" ? "no_answer" : status, durationSec: duration || existing.durationSec, recordingUrl: str("RecordingUrl", "recordingUrl") || existing.recordingUrl, outcome: str("outcome", "Outcome") || existing.outcome, transcript: str("transcript", "Transcript") || existing.transcript }, ctx.now);
      }
      const dir = str("direction", "Direction").toLowerCase();
      const direction = dir.startsWith("in") ? "in" : "out";
      const phone = direction === "in" ? str("phone", "From", "CallFrom", "from") : str("phone", "To", "CallTo", "to");
      if (!/^[+\d][\d\s-]{6,17}$/.test(phone)) throw new DomainError("Missing or invalid phone number", 422);
      return recordCall(s, ctx, { phone, name: str("name"), direction, status: status as "answered", durationSec: duration, startedAt: str("startedAt", "StartTime") ? new Date(str("startedAt", "StartTime")).toISOString() : undefined, recordingUrl: str("recordingUrl", "RecordingUrl"), source: (str("source") as "sim" | "ivr") || (b["CallSid"] ? "ivr" : "sim"), provider: str("provider") || (b["CallSid"] ? "exotel" : "sim-app"), providerRef: sid, userEmail: str("agentEmail", "userEmail") });
    });
  }));

  app.post("/api/v1/webhooks/:tenantId/email", express.urlencoded({ extended: false, limit: "2mb" }), wrap(async (req) => {
    const tenantId = await tenantOf(req);
    if (!(await keyOk(req, tenantId))) throw new DomainError("Invalid key", 401);
    const b = req.body as Record<string, string>;
    const from = b["from"] ?? b["From"] ?? b["sender"] ?? "";
    const email = /[\w.+-]+@[\w-]+\.[\w.-]+/.exec(from)?.[0] ?? "";
    const name = (b["fromName"] ?? from.replace(/<.*>/, "").replace(/"/g, "").trim()) || undefined;
    const text = [b["subject"] ?? b["Subject"] ?? "", b["text"] ?? b["body-plain"] ?? b["TextBody"] ?? ""].filter(Boolean).join("\n\n");
    if (text.trim().length < 5) throw new DomainError("Empty email", 422);
    return d.inTenant(tenantId, async (s) => runAction(s, await sysCtx(tenantId), "importEnquiry", { text: text.slice(0, 20_000), source: "email", fromName: name, fromEmail: email || undefined, createQuote: true }));
  }));
}

/* ───────────── background scheduler ───────────── */

export function startScheduler(d: Pick<ExtraDeps, "db" | "inTenant" | "providersOf" | "now">, intervalMs = 60_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const tenants = await d.db.query<{ id: string }>("SELECT id FROM tenants");
      for (const t of tenants.rows) {
        try {
          const providers = await d.providersOf(t.id);
          await d.inTenant(t.id, (s) => runJobs(s, { tenantId: t.id, userId: "system", role: "owner", agentId: null, now: d.now(), providers }));
        } catch (e) {
          console.error(`[jobs] tenant ${t.id}:`, e instanceof Error ? e.message : e);
        }
      }
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  return () => clearInterval(timer);
}
