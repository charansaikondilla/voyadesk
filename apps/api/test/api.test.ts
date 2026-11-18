import { createHmac } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addDays, isoDate } from "@voyadesk/core";
import { createApp } from "../src/app.js";
import { openDb, type Db } from "../src/db.js";
import { PgStore } from "../src/pgStore.js";

const NOW = new Date("2026-11-15T05:30:00Z");
let db: Db;
let app: ReturnType<typeof createApp>;
const SECRET = "test-webhook-secret";

beforeAll(async () => {
  db = await openDb();
  app = createApp({ db, jwtSecret: "x".repeat(40), webhookSecret: SECRET, metaVerifyToken: "verify-me", now: () => NOW });
});
afterAll(async () => {
  await db.close();
});

async function signup(email: string, demo = false) {
  const r = await request(app).post("/api/v1/auth/signup").send({ companyName: `Agency ${email}`, name: "Owner", email, password: "correct horse", businessTypes: ["b2c", "b2b_dmc", "visa"], demo });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.data as { token: string; tenantId: string; user: { id: string } };
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe("health and database", () => {
  it("reports Postgres and row-level security", async () => {
    const r = await request(app).get("/health");
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ ok: true, db: "pglite", rls: true });
  });
});

describe("auth", () => {
  it("signs up, logs in, rejects bad passwords and duplicate emails", async () => {
    const s = await signup("a@agency.in");
    const me = await request(app).get("/api/v1/auth/me").set(auth(s.token));
    expect(me.status).toBe(200);
    expect(me.body.data.settings.modules).toMatchObject({ b2b: true, visa: true });
    expect((await request(app).post("/api/v1/auth/login").send({ email: "a@agency.in", password: "correct horse" })).status).toBe(200);
    const bad = await request(app).post("/api/v1/auth/login").send({ email: "a@agency.in", password: "nope" });
    expect(bad.status).toBe(401);
    expect(bad.body.error.message).toMatch(/incorrect/);
    expect((await request(app).post("/api/v1/auth/signup").send({ companyName: "Dup", name: "X", email: "a@agency.in", password: "12345678" })).status).toBe(409);
    expect((await request(app).get("/api/v1/auth/me")).status).toBe(401);
    expect((await request(app).get("/api/v1/auth/me").set({ Authorization: "Bearer forged.token.value" })).status).toBe(401);
  });

  it("validates signup input with readable messages", async () => {
    const r = await request(app).post("/api/v1/auth/signup").send({ companyName: "X Travels", name: "Y", email: "not-an-email", password: "short" });
    expect(r.status).toBe(422);
    expect(r.body.error.message).toMatch(/email/i);
  });
});

describe("data API rules", () => {
  it("validates, protects workflow fields and blocks direct money writes", async () => {
    const s = await signup("b@agency.in");
    const h = auth(s.token);
    const bad = await request(app).post("/api/v1/data/hotels").set(h).send({ name: "", city: "Goa" });
    expect(bad.status).toBe(422);
    const hotel = await request(app).post("/api/v1/data/hotels").set(h).send({ name: "Sea Breeze", city: "Goa", rates: [{ roomType: "Deluxe", netPerNight: 450000 }] });
    expect(hotel.status).toBe(201);
    expect(hotel.body.data.rates[0]).toMatchObject({ mealPlan: "CP", currency: "INR" });
    // Money and ledger records can only come from workflows
    const inv = await request(app).post("/api/v1/data/invoices").set(h).send({ partyName: "X", issueDate: "2026-11-15", dueDate: "2026-11-20", sell: 1, gst: 0, total: 1 });
    expect(inv.status).toBe(409);
    expect((await request(app).post("/api/v1/data/ledger").set(h).send({})).status).toBe(409);
    // Status fields are ignored on generic PATCH
    const lead = await request(app).post("/api/v1/actions/captureLead").set(h).send({ name: "Asha", phone: "9876543210", destination: "Goa" });
    const id = lead.body.data.lead.id;
    const patched = await request(app).patch(`/api/v1/data/leads/${id}`).set(h).send({ stage: "won", notes: "VIP" });
    expect(patched.body.data).toMatchObject({ stage: "new", notes: "VIP" });
    expect((await request(app).get("/api/v1/data/nonsense").set(h)).status).toBe(404);
  });

  it("isolates tenants in the API and inside Postgres itself", async () => {
    const a = await signup("c@agency.in");
    const b = await signup("d@agency.in");
    const lead = await request(app).post("/api/v1/actions/captureLead").set(auth(a.token)).send({ name: "Secret customer", phone: "9876500001" });
    const id = lead.body.data.lead.id;
    expect((await request(app).get(`/api/v1/data/leads/${id}`).set(auth(b.token))).status).toBe(404);
    const bLeads = await request(app).get("/api/v1/data/leads").set(auth(b.token));
    expect(bLeads.body.data).toHaveLength(0);
    // Database-level: the restricted role sees nothing without a tenant, and only its own rows with one
    const none = await db.transaction(async (tx) => {
      await tx.query("SET LOCAL ROLE voyadesk_app");
      return tx.query<{ n: number }>("SELECT count(*)::int AS n FROM records");
    });
    expect(none.rows[0]!.n).toBe(0);
    const onlyB = await db.transaction(async (tx) => (await PgStore.open(tx, b.tenantId, db.appRole)).list("leads"));
    expect(onlyB).toHaveLength(0);
  });
});

describe("full sales-to-cash flow over HTTP", () => {
  it("captures a lead, quotes, shares a proposal, confirms with payment and keeps books balanced", async () => {
    const s = await signup("e@agency.in");
    const h = auth(s.token);
    const sup = await request(app).post("/api/v1/data/suppliers").set(h).send({ name: "Sea Breeze Resorts", category: "hotel", city: "Goa" });
    await request(app).post("/api/v1/data/hotels").set(h).send({ name: "Sea Breeze", city: "Goa", supplierId: sup.body.data.id, rates: [{ roomType: "Deluxe", netPerNight: 450000 }] });
    const travel = addDays(isoDate(NOW), 25);
    const cap = await request(app).post("/api/v1/actions/captureLead").set(h).send({ text: "3N Goa, 2 pax, budget 40k", name: "Rahul", phone: "9876512345", travelDate: travel, source: "whatsapp" });
    expect(cap.status).toBe(200);
    expect(cap.body.data.lead).toMatchObject({ destination: "Goa", nights: 3 });
    const q = await request(app).post("/api/v1/actions/createQuoteFromLead").set(h).send({ leadId: cap.body.data.lead.id });
    const quote = q.body.data;
    const sent = await request(app).post("/api/v1/actions/sendQuote").set(h).send({ quoteId: quote.id });
    expect(sent.status).toBe(200);

    // Public proposal page — no login, net costs hidden
    const view = await request(app).post(`/api/v1/public/${s.tenantId}/actions/viewProposal`).send({ token: quote.shareToken });
    expect(view.status).toBe(200);
    expect(JSON.stringify(view.body.data)).not.toContain("netCost");
    const total = view.body.data.pricing.total;
    // A live account never trusts a browser-reported payment
    const blocked = await request(app).post(`/api/v1/public/${s.tenantId}/actions/acceptProposal`).send({ token: quote.shareToken, payment: { amount: total, method: "upi" } });
    expect(blocked.status).toBe(409);
    // Test mode (sandbox) allows simulated payments end to end
    await request(app).put("/api/v1/integrations/sandbox").set(auth(s.token)).send({ enabled: "true" });
    const accept = await request(app).post(`/api/v1/public/${s.tenantId}/actions/acceptProposal`).send({ token: quote.shareToken, payment: { amount: total, method: "upi" } });
    expect(accept.status, JSON.stringify(accept.body)).toBe(200);
    expect(accept.body.data.bookingNumber).toBe("FILE/2026-27/0001");
    // Accepting twice is refused
    expect((await request(app).post(`/api/v1/public/${s.tenantId}/actions/acceptProposal`).send({ token: quote.shareToken })).status).toBe(409);

    const books = await request(app).get("/api/v1/reports/books").set(h);
    expect(books.body.data.trial.balanced).toBe(true);
    const inv = await request(app).get("/api/v1/data/invoices").set(h);
    expect(inv.body.data[0]).toMatchObject({ status: "paid", total });
    const dash = await request(app).get("/api/v1/reports/dashboard").set(h);
    expect(dash.body.data.kpis.bookingsMonth).toBe(1);
    const pnl = await request(app).get(`/api/v1/reports/pnl?params=${encodeURIComponent(JSON.stringify({ groupBy: "destination" }))}`).set(h);
    expect(pnl.body.data.rows[0].label).toBe("Goa");
  });
});

describe("demo tenant, agents and webhooks", () => {
  it("seeds a full demo agency through real workflows", async () => {
    const s = await signup("demo@agency.in", true);
    const h = auth(s.token);
    const books = await request(app).get("/api/v1/reports/books").set(h);
    expect(books.body.data.trial.balanced).toBe(true);
    expect(books.body.data.entries).toBeGreaterThan(50);
    const bookings = await request(app).get("/api/v1/data/bookings").set(h);
    expect(bookings.body.data.length).toBeGreaterThan(10);

    // Give the demo agent user a password, sign in as the agent, and check privacy
    const users = (await request(app).get("/api/v1/data/users").set(h)).body.data as { id: string; role: string; email: string; agentId: string }[];
    const agentUser = users.find((u) => u.role === "agent")!;
    expect((await request(app).post("/api/v1/auth/password").set(h).send({ userId: agentUser.id, password: "agent-pass-123" })).status).toBe(200);
    const login = await request(app).post("/api/v1/auth/login").send({ email: agentUser.email, password: "agent-pass-123" });
    const ah = auth(login.body.data.token);
    const quotes = (await request(app).get("/api/v1/data/quotes").set(ah)).body.data as { agentId: string; lines: { netCost: number }[] }[];
    expect(quotes.length).toBeGreaterThan(0);
    expect(quotes.every((q) => q.agentId === agentUser.agentId)).toBe(true);
    expect(quotes.flatMap((q) => q.lines).every((l) => l.netCost === 0)).toBe(true);
    expect((await request(app).get("/api/v1/data/suppliers").set(ah)).status).toBe(403);
    expect((await request(app).get("/api/v1/reports/pnl").set(ah)).status).toBe(403);
    const pkgs = (await request(app).get("/api/v1/data/packages").set(ah)).body.data as { id: string }[];
    const created = await request(app).post("/api/v1/actions/agentCreateQuote").set(ah).send({ packageId: pkgs[0]!.id, startDate: addDays(isoDate(NOW), 40), adults: 2, contactName: "Client" });
    expect(created.status).toBe(200);
    expect(JSON.stringify(created.body.data)).not.toMatch(/"netCost":[1-9]/);
  }, 60_000);

  it("accepts signed WhatsApp webhooks and rejects unsigned ones", async () => {
    const s = await signup("f@agency.in");
    const body = JSON.stringify({ name: "Ritika", phone: "+91 90000 77777", text: "5N Dubai, 4 pax, 27 Jan, 2L" });
    const sig = createHmac("sha256", SECRET).update(body).digest("hex");
    const unsigned = await request(app).post(`/api/v1/webhooks/${s.tenantId}/whatsapp`).set("Content-Type", "application/json").send(body);
    expect(unsigned.status).toBe(401);
    const ok = await request(app).post(`/api/v1/webhooks/${s.tenantId}/whatsapp`).set({ "Content-Type": "application/json", "X-Signature": `sha256=${sig}` }).send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.data.lead).toMatchObject({ nights: 5, budget: 200_000_00 });
    const verify = await request(app).get(`/api/v1/webhooks/${s.tenantId}/meta?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42`);
    expect(verify.text).toBe("42");
  });
});
