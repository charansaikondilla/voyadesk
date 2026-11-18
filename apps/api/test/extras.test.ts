import { createHmac } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, isoDate } from "@voyadesk/core";
import { createApp } from "../src/app.js";
import { openDb, type Db } from "../src/db.js";
import { verifyStripe } from "../src/providers.js";

const NOW = new Date("2026-11-15T05:30:00Z");
let db: Db;
let app: ReturnType<typeof createApp>;
const calls: { url: string; init?: RequestInit }[] = [];

/** Fake outside world: Razorpay and WhatsApp answer like the real APIs. */
const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  calls.push({ url: u, init });
  if (u === "https://api.razorpay.com/v1/payment_links") return new Response(JSON.stringify({ id: "plink_RZP1", short_url: "https://rzp.io/i/abc" }), { status: 200 });
  if (u.includes("graph.facebook.com") && u.endsWith("/messages")) return new Response(JSON.stringify({ messages: [{ id: "wamid.TEST1" }] }), { status: 200 });
  return new Response("not found", { status: 404 });
}) as typeof fetch;

beforeAll(async () => {
  db = await openDb();
  app = createApp({ db, jwtSecret: "y".repeat(40), webhookSecret: "hook-secret", metaVerifyToken: "verify-me", now: () => NOW, fetch: fakeFetch, publicApiUrl: "https://api.example.in" });
});
afterAll(async () => {
  await db.close();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
async function signup(email: string, demo = false) {
  const r = await request(app).post("/api/v1/auth/signup").send({ companyName: `Agency ${email}`, name: "Owner", email, password: "correct horse", businessTypes: ["b2c", "visa"], demo });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data as { token: string; tenantId: string };
}

async function quoteFor(token: string) {
  await request(app).post("/api/v1/data/hotels").set(auth(token)).send({ name: "Sea Breeze", city: "Goa", country: "India", stars: 4, rates: [{ roomType: "Deluxe", mealPlan: "CP", season: "regular", netPerNight: 450000, currency: "INR" }] });
  const lead = await request(app).post("/api/v1/actions/captureLead").set(auth(token)).send({ name: "Asha", phone: "+91 98765 43210", email: "asha@example.com", source: "website", destination: "Goa", travelDate: addDays(isoDate(NOW), 20), nights: 3, adults: 2 });
  const q = await request(app).post("/api/v1/actions/createQuoteFromLead").set(auth(token)).send({ leadId: lead.body.data.lead.id });
  const sent = await request(app).post("/api/v1/actions/sendQuote").set(auth(token)).send({ quoteId: q.body.data.id, channel: "link" });
  expect(sent.status, JSON.stringify(sent.body)).toBe(200);
  return q.body.data as { id: string; shareToken: string };
}

describe("integrations", () => {
  it("stores keys encrypted and never returns them; only owners/admins can manage", async () => {
    const s = await signup("int@agency.in");
    const put = await request(app).put("/api/v1/integrations/razorpay").set(auth(s.token)).send({ keyId: "rzp_live_x", keySecret: "super-secret", webhookSecret: "rzp-hook", junk: "ignored" });
    expect(put.status).toBe(200);
    const got = await request(app).get("/api/v1/integrations").set(auth(s.token));
    expect(got.body.data.services.razorpay.connected).toBe(true);
    expect(JSON.stringify(got.body)).not.toContain("super-secret");
    const raw = await db.query<{ value: string }>("SELECT value FROM tenant_secrets WHERE tenant_id = $1", [s.tenantId]);
    expect(raw.rows[0]!.value).not.toContain("super-secret");
    expect(got.body.data.webhooks.razorpay).toBe(`https://api.example.in/api/v1/webhooks/${s.tenantId}/payments/razorpay`);
  });

  it("demo signups start in sandbox mode; real ones are not configured until keys are added", async () => {
    const d = await signup("demo-sbx@agency.in", true);
    expect((await request(app).get("/api/v1/integrations").set(auth(d.token))).body.data.sandbox).toBe(true);
    const r = await signup("real@agency.in");
    const q = await quoteFor(r.token);
    const pay = await request(app).post(`/api/v1/public/${r.tenantId}/actions/proposalPay`).send({ token: q.shareToken, selectedOptionalIds: [] });
    expect(pay.status).toBe(422);
    expect(pay.body.error.message).toMatch(/payment gateway/);
  });
});

describe("Razorpay end to end", () => {
  it("creates a real payment link and settles it from a signed webhook (once)", async () => {
    const s = await signup("rzp@agency.in");
    await request(app).put("/api/v1/integrations/razorpay").set(auth(s.token)).send({ keyId: "rzp_test_k", keySecret: "rzp_test_s", webhookSecret: "rzp-hook" });
    const q = await quoteFor(s.token);
    const pay = await request(app).post(`/api/v1/public/${s.tenantId}/actions/proposalPay`).send({ token: q.shareToken, selectedOptionalIds: [], mode: "full" });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    expect(pay.body.data.url).toBe("https://rzp.io/i/abc");
    const sent = JSON.parse(String(calls.find((c) => c.url.includes("razorpay"))!.init!.body)) as { reference_id: string; amount: number };
    expect(sent.reference_id).toBe(pay.body.data.token);

    const event = JSON.stringify({ event: "payment_link.paid", payload: { payment_link: { entity: { id: "plink_RZP1", reference_id: pay.body.data.token, amount_paid: pay.body.data.amount } }, payment: { entity: { id: "pay_123", method: "upi", amount: pay.body.data.amount } } } });
    const bad = await request(app).post(`/api/v1/webhooks/${s.tenantId}/payments/razorpay`).set("Content-Type", "application/json").set("X-Razorpay-Signature", "nope").send(event);
    expect(bad.status).toBe(401);
    const sig = createHmac("sha256", "rzp-hook").update(event).digest("hex");
    const ok = await request(app).post(`/api/v1/webhooks/${s.tenantId}/payments/razorpay`).set("Content-Type", "application/json").set("X-Razorpay-Signature", sig).send(event);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const again = await request(app).post(`/api/v1/webhooks/${s.tenantId}/payments/razorpay`).set("Content-Type", "application/json").set("X-Razorpay-Signature", sig).send(event);
    expect(again.status).toBe(200);
    const bookings = await request(app).get("/api/v1/data/bookings").set(auth(s.token));
    expect(bookings.body.data.length).toBe(1);
    const payments = await request(app).get("/api/v1/data/payments").set(auth(s.token));
    expect(payments.body.data.length).toBe(1);
    expect(payments.body.data[0]).toMatchObject({ gateway: "razorpay", reference: "pay_123", amount: pay.body.data.amount });
  });
});

describe("Stripe signature", () => {
  it("accepts a fresh v1 signature and rejects old or wrong ones", () => {
    const body = '{"type":"checkout.session.completed"}';
    const t = 1_700_000_000;
    const v1 = createHmac("sha256", "whsec").update(`${t}.${body}`).digest("hex");
    expect(verifyStripe(body, `t=${t},v1=${v1}`, "whsec", t + 10)).toBe(true);
    expect(verifyStripe(body, `t=${t},v1=${v1}`, "whsec", t + 1000)).toBe(false);
    expect(verifyStripe(body, `t=${t},v1=${"0".repeat(64)}`, "whsec", t)).toBe(false);
  });
});

describe("WhatsApp Cloud and call logs", () => {
  it("incoming WhatsApp message creates a lead, bot reply goes out through the Cloud API, receipts update", async () => {
    const s = await signup("wa@agency.in");
    await request(app).put("/api/v1/integrations/whatsapp").set(auth(s.token)).send({ phoneNumberId: "PN1", accessToken: "EAAG", appSecret: "app-secret", verifyToken: "vt" });
    const verify = await request(app).get(`/api/v1/webhooks/${s.tenantId}/whatsapp-cloud`).query({ "hub.mode": "subscribe", "hub.verify_token": "vt", "hub.challenge": "42" });
    expect(verify.text).toBe("42");
    const body = JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: "919812345678", profile: { name: "Ravi" } }], messages: [{ from: "919812345678", type: "text", text: { body: "Goa 3N for 2 adults on 20 Dec" } }] } }] }] });
    const sig = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`;
    const r = await request(app).post(`/api/v1/webhooks/${s.tenantId}/whatsapp-cloud`).set("Content-Type", "application/json").set("X-Hub-Signature-256", sig).send(body);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const leads = await request(app).get("/api/v1/data/leads").set(auth(s.token));
    expect(leads.body.data[0]).toMatchObject({ name: "Ravi", source: "whatsapp" });
    const out = await request(app).get("/api/v1/data/outbox").set(auth(s.token));
    const reply = out.body.data.find((o: { kind: string }) => o.kind === "chat");
    expect(reply).toMatchObject({ status: "sent", providerRef: "wamid.TEST1" });
    const receipt = JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: "wamid.TEST1", status: "read" }] } }] }] });
    await request(app).post(`/api/v1/webhooks/${s.tenantId}/whatsapp-cloud`).set("Content-Type", "application/json").set("X-Hub-Signature-256", `sha256=${createHmac("sha256", "app-secret").update(receipt).digest("hex")}`).send(receipt);
    const after = await request(app).get("/api/v1/data/outbox").set(auth(s.token));
    expect(after.body.data.find((o: { providerRef: string }) => o.providerRef === "wamid.TEST1").status).toBe("read");
  });

  it("IVR call log with key: missed call → lead + call-back task; wrong key rejected", async () => {
    const s = await signup("ivr@agency.in");
    await request(app).put("/api/v1/integrations/calls").set(auth(s.token)).send({ key: "call-key-123" });
    const bad = await request(app).post(`/api/v1/webhooks/${s.tenantId}/calls?key=wrong`).type("form").send({ CallSid: "c1", CallFrom: "09876500011", Direction: "incoming", DialCallStatus: "no-answer" });
    expect(bad.status).toBe(401);
    const ok = await request(app).post(`/api/v1/webhooks/${s.tenantId}/calls?key=call-key-123`).type("form").send({ CallSid: "c1", CallFrom: "09876500011", Direction: "incoming", DialCallStatus: "no-answer" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.data.status).toBe("missed");
    const tasks = await request(app).get("/api/v1/data/tasks").set(auth(s.token));
    expect(tasks.body.data.some((t: { title: string }) => /missed call/.test(t.title))).toBe(true);
    const dup = await request(app).post(`/api/v1/webhooks/${s.tenantId}/calls?key=call-key-123`).type("form").send({ CallSid: "c1", CallFrom: "09876500011", Direction: "incoming", DialCallStatus: "no-answer" });
    expect(dup.status).toBe(200);
    expect((await request(app).get("/api/v1/data/calls").set(auth(s.token))).body.data.length).toBe(1);
  });

  it("uploads up to 8 MB go through and protected collections can't be written directly", async () => {
    const s = await signup("files@agency.in");
    const c = await request(app).post("/api/v1/data/contacts").set(auth(s.token)).send({ name: "Asha" });
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const up = await request(app).post("/api/v1/actions/uploadFile").set(auth(s.token)).send({ ownerType: "contact", ownerId: c.body.data.id, name: "p.png", mime: "image/png", dataUrl: png, label: "Passport" });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body.data.dataUrl).toBeUndefined();
    const direct = await request(app).post("/api/v1/data/files").set(auth(s.token)).send({ name: "x", mime: "image/png", size: 1, dataUrl: png, ownerType: "contact" });
    expect(direct.status).toBe(409);
  });
});
