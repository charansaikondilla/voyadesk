import { beforeEach, describe, expect, it } from "vitest";
import {
  accountBalance, actions, addDays, canRead, createRow, isoDate, MemoryStore, publicActions, redactForRole, runAction,
  runPublicAction, runReport, scopeRows, seedDemo, trialBalance, type Ctx, type LedgerEntry, type Role,
} from "../src/index.js";

const NOW = new Date("2026-11-15T05:30:00Z"); // 11:00 IST
const ctx = (role: Role = "owner", agentId: string | null = null): Ctx => ({ tenantId: "t1", userId: "u1", role, agentId, now: NOW });
const ledger = async (s: MemoryStore) => (await s.list("ledger")) as unknown as LedgerEntry[];

async function masters(s: MemoryStore) {
  const sup = await createRow(s, "suppliers", { name: "Sea Breeze Resorts", category: "hotel", city: "Goa", paymentTermsDays: 7 }, NOW);
  await createRow(s, "hotels", { name: "Sea Breeze", city: "Goa", country: "India", stars: 4, supplierId: sup.id, rates: [{ roomType: "Deluxe", mealPlan: "CP", season: "regular", netPerNight: 450_000, currency: "INR" }] }, NOW);
  await createRow(s, "transfers", { name: "Goa cab", city: "Goa", country: "India", vehicle: "Sedan", netPerVehicle: 180_000, supplierId: sup.id }, NOW);
  await createRow(s, "users", { name: "Ops", email: "ops@x.in", role: "ops" }, NOW);
  return sup;
}

describe("lead → quote → booking → invoice → payment", () => {
  let s: MemoryStore;
  beforeEach(async () => {
    s = new MemoryStore();
    await masters(s);
  });

  it("runs the whole chain with balanced books and correct balances", async () => {
    const travel = addDays(isoDate(NOW), 20);
    const { lead } = (await runAction(s, ctx(), "captureLead", { name: "Asha Rao", phone: "+91 98765 43210", source: "website", destination: "Goa", travelDate: travel, nights: 3, adults: 2 })) as { lead: { id: string; stage: string } };
    expect(lead.stage).toBe("new");
    expect((await s.list("tasks"))[0]!.title).toMatch(/within 15 minutes/);

    const quote = (await runAction(s, ctx(), "createQuoteFromLead", { leadId: lead.id })) as { id: string; lines: unknown[]; total: number; shareToken: string };
    expect(quote.lines.length).toBeGreaterThanOrEqual(3);
    expect(quote.total).toBeGreaterThan(0);

    const sent = (await runAction(s, ctx(), "sendQuote", { quoteId: quote.id, channel: "whatsapp" })) as { link: string };
    expect(sent.link).toContain(quote.shareToken);
    expect((await s.get("leads", lead.id))!.stage).toBe("quoted");

    // Customer opens the proposal link (public, no login): net costs are never exposed
    const view = (await runPublicAction(s, ctx(), "viewProposal", { token: quote.shareToken })) as { quote: { lines: Record<string, unknown>[] } };
    expect(view.quote.lines.every((l) => !("netCost" in l))).toBe(true);
    expect((await s.get("quotes", quote.id))!.status).toBe("viewed");

    const fresh = (await s.get("quotes", quote.id))!;
    const r = (await runPublicAction(s, { ...ctx(), tenantId: "demo" }, "acceptProposal", { token: quote.shareToken, selectedOptionalIds: [], payment: { amount: 1_000_000, method: "upi" } })) as { bookingNumber: string };
    expect(r.bookingNumber).toMatch(/^FILE\/2026-27\/0001$/);

    const booking = (await s.list("bookings"))[0]!;
    const invoice = (await s.list("invoices"))[0]!;
    expect(invoice.number).toBe("INV/2026-27/0001");
    expect(invoice.total).toBe(fresh.total);
    expect(invoice.cgst + invoice.sgst + invoice.igst).toBe(invoice.gst);
    expect(invoice.paid).toBe(1_000_000);
    expect(invoice.status).toBe("partially_paid");
    expect((await s.list("services")).filter((x) => x.bookingId === booking.id).length).toBeGreaterThan(0);
    expect((await s.get("leads", lead.id))!.stage).toBe("won");
    expect((await s.list("supplierBills")).length).toBe(1);

    const entries = await ledger(s);
    expect(trialBalance(entries).balanced).toBe(true);
    expect(accountBalance(entries, "receivable")).toBe(invoice.total - invoice.paid);
    expect(accountBalance(entries, "revenue")).toBe(invoice.sell);
    expect(accountBalance(entries, "gst_output")).toBe(invoice.gst);
    expect(accountBalance(entries, "payable")).toBe(booking.costTotal);

    // Over-payment is refused; paying the balance closes the invoice
    await expect(runAction(s, ctx("accounts"), "recordPayment", { invoiceId: invoice.id, amount: invoice.total, method: "upi" })).rejects.toThrow(/more than the outstanding/);
    await runAction(s, ctx("accounts"), "recordPayment", { invoiceId: invoice.id, amount: invoice.total - invoice.paid, method: "bank_transfer" });
    expect((await s.get("invoices", invoice.id))!.status).toBe("paid");

    // Cancellation with a charge: credit note + refund keep every balance consistent
    const charge = 500_000;
    await runAction(s, ctx(), "cancelBooking", { bookingId: booking.id, reason: "Family emergency", cancellationCharge: charge, refundTo: "bank" });
    const inv2 = (await s.get("invoices", invoice.id))!;
    expect(inv2.credited).toBe(invoice.total - charge);
    expect(inv2.paid).toBe(charge);
    const after = await ledger(s);
    expect(trialBalance(after).balanced).toBe(true);
    expect(accountBalance(after, "receivable")).toBe(0);
    expect((await s.get("bookings", booking.id))!.status).toBe("cancelled");
  });

  it("blocks sending an incomplete quote and explains why", async () => {
    const { lead } = (await runAction(s, ctx(), "captureLead", { name: "No Date", phone: "9876500000", destination: "Goa" })) as { lead: { id: string } };
    const q = (await runAction(s, ctx(), "createQuoteFromLead", { leadId: lead.id })) as { id: string };
    await expect(runAction(s, ctx(), "sendQuote", { quoteId: q.id })).rejects.toThrow(/start date/);
  });

  it("de-duplicates a repeat enquiry from the same phone", async () => {
    const a = (await runAction(s, ctx(), "captureLead", { name: "Ravi", phone: "+91 90000 11111", destination: "Goa" })) as { lead: { id: string }; duplicate: boolean };
    const b = (await runAction(s, ctx(), "captureLead", { name: "Ravi K", phone: "9000011111", destination: "goa" })) as { lead: { id: string }; duplicate: boolean };
    expect(b.duplicate).toBe(true);
    expect(b.lead.id).toBe(a.lead.id);
    expect((await s.list("contacts")).length).toBe(1);
  });

  it("refuses a double-booked driver", async () => {
    const travel = addDays(isoDate(NOW), 10);
    const drv = await createRow(s, "resources", { kind: "driver", name: "Ramesh" }, NOW);
    const ids: string[] = [];
    for (const name of ["A One", "B Two"]) {
      const { lead } = (await runAction(s, ctx(), "captureLead", { name, phone: `98${name.length}7654321`.slice(0, 10), destination: "Goa", travelDate: travel, nights: 2 })) as { lead: { id: string } };
      const q = (await runAction(s, ctx(), "createQuoteFromLead", { leadId: lead.id })) as { id: string };
      const r = (await runAction(s, ctx(), "acceptQuote", { quoteId: q.id })) as { services: { id: string; type: string }[] };
      ids.push(r.services.find((x) => x.type === "transfer")!.id);
    }
    await runAction(s, ctx("ops"), "assignResource", { serviceId: ids[0], resourceId: drv.id });
    await expect(runAction(s, ctx("ops"), "assignResource", { serviceId: ids[1], resourceId: drv.id })).rejects.toThrow(/already assigned/);
  });
});

describe("B2B agents: wallet, credit limit, privacy", () => {
  it("enforces wallet balance and credit limits and hides net costs", async () => {
    const s = new MemoryStore();
    await masters(s);
    const pkg = await createRow(s, "packages", { name: "Goa 3N", destination: "Goa", nights: 3, published: true }, NOW);
    const agent = await createRow(s, "agents", { name: "Wanderlust", creditLimit: 1_000_000, markupBps: 700 }, NOW);
    const a = ctx("agent", agent.id);
    const start = addDays(isoDate(NOW), 30);
    const q = (await runAction(s, a, "agentCreateQuote", { packageId: pkg.id, startDate: start, adults: 2, contactName: "Client" })) as { id: string; total: number };

    await expect(runAction(s, a, "agentBook", { quoteId: q.id, payBy: "wallet" })).rejects.toThrow(/Wallet balance/);
    await runAction(s, a, "topUpWallet", { agentId: agent.id, amount: q.total, method: "upi" });
    await runAction(s, a, "agentBook", { quoteId: q.id, payBy: "wallet" });
    const entries = await ledger(s);
    expect(accountBalance(entries, "wallet", { type: "agent", id: agent.id })).toBe(0);
    expect(accountBalance(entries, "receivable", { type: "agent", id: agent.id })).toBe(0);

    const q2 = (await runAction(s, a, "agentCreateQuote", { packageId: pkg.id, startDate: start, adults: 6, contactName: "Big group" })) as { id: string; total: number };
    expect(q2.total).toBeGreaterThan(1_000_000);
    await expect(runAction(s, a, "agentBook", { quoteId: q2.id, payBy: "credit" })).rejects.toThrow(/Credit limit exceeded/);

    // Agents may not run staff-only actions or see other agencies' rows
    await expect(runAction(s, a, "recordPayment", { invoiceId: "x", amount: 1, method: "upi" })).rejects.toThrow(/permission/);
    expect(canRead("agent", "suppliers")).toBe(false);
    const quotes = await s.list("quotes");
    expect(scopeRows("agent", "quotes", quotes, { userId: "u", agentId: "someone-else" })).toHaveLength(0);
    const red = redactForRole("agent", "quotes", quotes[0]!);
    expect(red.lines.every((l) => l.netCost === 0)).toBe(true);
  });
});

describe("visa desk", () => {
  it("cannot submit until every document and passport is in", async () => {
    const s = new MemoryStore();
    await createRow(s, "visaMasters", { country: "UAE", visaType: "Tourist", fee: 650_000, serviceFee: 100_000, checklist: ["Passport copy", "Photo"] }, NOW);
    const vc = (await runAction(s, ctx("visa"), "createVisaCase", { contactName: "Asha", phone: "9876543210", country: "UAE", applicants: ["Asha"] })) as { id: string; fee: number };
    expect(vc.fee).toBe(750_000);
    await expect(runAction(s, ctx("visa"), "advanceVisaCase", { caseId: vc.id, status: "submitted" })).rejects.toThrow(/cannot move|missing/);
    await runAction(s, ctx("visa"), "markVisaDoc", { caseId: vc.id, applicantIndex: 0, docName: "Photo", received: true });
    const scan = (await runAction(s, ctx("visa"), "scanPassport", { caseId: vc.id, applicantIndex: 0, mrz: "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10" })) as { visaCase: { status: string } };
    expect(scan.visaCase.status).toBe("docs_received");
    await runAction(s, ctx("visa"), "advanceVisaCase", { caseId: vc.id, status: "submitted" });
    await expect(runAction(s, ctx("visa"), "advanceVisaCase", { caseId: vc.id, status: "rejected" })).rejects.toThrow(/rejection reason/);
  });
});

describe("WhatsApp bot", () => {
  it("turns a free-text WhatsApp message into a scored, assigned lead", async () => {
    const s = new MemoryStore();
    await masters(s);
    const r = (await runAction(s, ctx(), "inboundMessage", { phone: "+91 90000 99999", from: "Ritika", body: "Hi, 4N Goa, 2 adults, 20 Dec, budget 60k" })) as { lead: { destination: string; nights: number; budget: number }; reply: { body: string } };
    expect(r.lead).toMatchObject({ destination: "Goa", nights: 4, budget: 60_000_00 });
    expect(r.reply.body).toMatch(/within 15 minutes/);
  });
});

describe("AI quote from a bare message", () => {
  it("works without contact details and names the lead after the trip", async () => {
    const s = new MemoryStore();
    await masters(s);
    const r = (await runAction(s, ctx(), "generateAiQuote", { text: "4N Goa, 2 adults, 20 Dec, budget 60k" })) as { lead: { name: string }; quote: { id: string } };
    expect(r.lead.name).toBe("Goa enquiry");
    await expect(runAction(s, ctx(), "sendQuote", { quoteId: r.quote.id })).rejects.toThrow(/phone or email/);
    await expect(runAction(s, ctx(), "captureLead", { text: "hello there" })).rejects.toThrow(/name, phone or email/);
  });
});

describe("demo agency seed", () => {
  it("builds through real workflows with balanced books, and every report runs", async () => {
    const s = new MemoryStore();
    const res = await seedDemo(s, NOW);
    const entries = await ledger(s);
    expect(entries.length).toBeGreaterThan(50);
    expect(trialBalance(entries).balanced).toBe(true);
    // Every invoice's outstanding equals the receivable posted for it
    const invoices = await s.list("invoices");
    const outstanding = invoices.reduce((a, i) => a + i.total - i.paid - i.credited, 0);
    expect(accountBalance(entries, "receivable")).toBe(outstanding);
    const dash = (await runReport(s, ctx(), "dashboard", {})) as { kpis: { openLeads: number; revenueMonth: number }; revenueTrend: unknown[] };
    expect(dash.kpis.openLeads).toBeGreaterThan(0);
    expect(dash.revenueTrend).toHaveLength(6);
    for (const name of ["pnl", "aging", "gst", "operations", "visa", "campaigns", "books"]) {
      await expect(runReport(s, ctx(), name, {})).resolves.toBeTruthy();
    }
    const st = (await runReport(s, ctx("agent", res.agentId), "statement", { partyType: "agent", partyId: res.agentId })) as { position: { wallet: number } };
    expect(st.position.wallet).toBeGreaterThanOrEqual(0);
    await expect(runReport(s, ctx("agent", res.agentId), "statement", { partyType: "agent", partyId: "other" })).rejects.toThrow(/own statement/);
    expect(Object.keys(actions).length).toBeGreaterThan(30);
    expect(Object.keys(publicActions)).toContain("acceptProposal");
  }, 30_000);
});
