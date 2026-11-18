import { describe, expect, it } from "vitest";
import {
  addDays, base64ToBytes, bytesToBase64, createRow, emiPlan, forecastRevenue, isoDate, makeDocx, makeXlsx, makeZip, MemoryStore, parseCsv,
  parseItineraryText, planTransport, readZip, runAction, runJobs, runPublicAction, runReport, seedDemo, trialBalance, sandboxFlightOffers,
  crc32, utf8, type Ctx, type LedgerEntry, type Role,
} from "../src/index.js";

const NOW = new Date("2026-11-15T05:30:00Z");
const demo = (role: Role = "owner", userId = "u1", agentId: string | null = null): Ctx => ({ tenantId: "demo", userId, role, agentId, now: NOW });
const pub = (): Ctx => ({ tenantId: "demo", userId: "public", role: "admin", agentId: null, now: NOW });
const real = (role: Role = "owner"): Ctx => ({ tenantId: "agency-1", userId: "u1", role, agentId: null, now: NOW });
const books = async (s: MemoryStore) => trialBalance((await s.list("ledger")) as unknown as LedgerEntry[]).balanced;
const day = (n: number) => addDays(isoDate(NOW), n);

async function masters(s: MemoryStore) {
  const sup = await createRow(s, "suppliers", { name: "Sea Breeze Resorts", category: "hotel", city: "Goa", paymentTermsDays: 7 }, NOW);
  const hotel = await createRow(s, "hotels", { name: "Sea Breeze", city: "Goa", country: "India", stars: 4, supplierId: sup.id, rates: [{ roomType: "Deluxe", mealPlan: "CP", season: "regular", netPerNight: 450_000, currency: "INR" }] }, NOW);
  await createRow(s, "transfers", { name: "Goa cab", city: "Goa", country: "India", vehicle: "Sedan", netPerVehicle: 180_000, supplierId: sup.id }, NOW);
  await createRow(s, "users", { name: "Owner", email: "owner@x.in", role: "owner" }, NOW);
  await createRow(s, "users", { name: "Accounts", email: "acc@x.in", role: "accounts" }, NOW);
  await createRow(s, "users", { name: "Ops", email: "ops@x.in", role: "ops" }, NOW);
  return { sup, hotel };
}
const contact = { name: "Asha Rao", phone: "+91 98765 43210", email: "asha@example.com" };

describe("file writers and parsers", () => {
  it("zip round-trips, with correct CRC", () => {
    const zip = makeZip([{ name: "a.txt", data: "hello" }, { name: "b/c.txt", data: utf8("world") }, { name: "a.txt", data: "dup" }]);
    const files = readZip(zip);
    expect(files.map((f) => f.name)).toEqual(["a.txt", "b/c.txt", "a (2).txt"]);
    expect(new TextDecoder().decode(files[1]!.data)).toBe("world");
    expect(crc32(utf8("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
  });
  it("xlsx and docx contain the required parts", () => {
    const x = readZip(makeXlsx([{ name: "Rooming", rows: [["Name", "Room"], ["Amit", 101]] }])).map((f) => f.name);
    expect(x).toEqual(expect.arrayContaining(["[Content_Types].xml", "xl/workbook.xml", "xl/worksheets/sheet1.xml", "xl/styles.xml"]));
    const sheet = new TextDecoder().decode(readZip(makeXlsx([{ name: "S", rows: [["A & B"], [5]] }])).find((f) => f.name.endsWith("sheet1.xml"))!.data);
    expect(sheet).toContain("A &amp; B");
    expect(sheet).toContain("<v>5</v>");
    expect(readZip(makeDocx([{ kind: "title", text: "Goa" }, { kind: "table", rows: [["Day", "Plan"]] }])).map((f) => f.name)).toContain("word/document.xml");
  });
  it("base64 round-trips binary", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });
  it("CSV handles quotes, commas and newlines", () => {
    expect(parseCsv('Hotel,City,Rate\n"Sea, Breeze","Goa","4,500"\n"Say ""hi""",Goa,1\n')).toEqual([["Hotel", "City", "Rate"], ["Sea, Breeze", "Goa", "4,500"], ['Say "hi"', "Goa", "1"]]);
  });
  it("EMI: no-cost and reducing balance", () => {
    expect(emiPlan(90_000_00, 3, 0)).toMatchObject({ monthly: 30_000_00, interest: 0, noCost: true });
    const p = emiPlan(1_00_000_00, 12, 1500);
    expect(p.monthly).toBe(902_584); // ₹9,025.84 at 15% p.a.
    expect(p.total).toBe(p.monthly * 12);
  });
  it("transport: cheapest mix that seats everyone", () => {
    const v = [
      { id: "sedan", name: "Sedan", capacity: 4, perDay: 280_000, perKm: 1_400, kmIncludedPerDay: 250, allowancePerDay: 40_000 },
      { id: "tt", name: "Tempo Traveller", capacity: 12, perDay: 650_000, perKm: 2_600, kmIncludedPerDay: 250, allowancePerDay: 40_000 },
    ];
    const plan = planTransport(v, 10, 3, [120, 200, 300])!;
    expect(plan.seats).toBeGreaterThanOrEqual(10);
    expect(plan.vehicles).toEqual([expect.objectContaining({ id: "tt", count: 1 })]);
    expect(plan.cost).toBe(3 * (650_000 + 40_000));
  });
  it("reads supplier itineraries into days and priced services", () => {
    const r = parseItineraryText("Day 1: Arrive Goa\nAirport pickup and check-in.\nHotel Sea Breeze 3N - ₹ 24,000\nDay 2: North Goa tour\nFort Aguada tour ₹1,500 per person\nInclusions\n- Breakfast\nExclusions\n- Airfare");
    expect(r.days.map((d) => d.title)).toEqual(["Arrive Goa", "North Goa tour"]);
    expect(r.services).toEqual([expect.objectContaining({ type: "hotel", netCost: 2_400_000, day: 1 }), expect.objectContaining({ type: "sightseeing", netCost: 150_000, perPerson: true, day: 2 })]);
    expect(r.inclusions).toEqual(["Breakfast"]);
    expect(r.exclusions).toEqual(["Airfare"]);
  });
  it("forecast returns three future months", () => {
    const f = forecastRevenue([{ createdAt: "2026-10-03T00:00:00Z", sellTotal: 500_000, status: "confirmed" }], "2026-11-15", 3);
    expect(f.next.map((n) => n.month)).toEqual(["2026-12", "2027-01", "2027-02"]);
  });
});

describe("payments, EMI, holds and options", () => {
  it("customer pays a proposal through a sandbox link → booking, invoice and balanced books; second webhook is ignored", async () => {
    const s = new MemoryStore();
    await masters(s);
    const { lead } = (await runAction(s, demo(), "captureLead", { ...contact, source: "website", destination: "Goa", travelDate: day(20), nights: 3, adults: 2 })) as { lead: { id: string } };
    const q = (await runAction(s, demo(), "createQuoteFromLead", { leadId: lead.id })) as { id: string; shareToken: string };
    await runAction(s, demo(), "sendQuote", { quoteId: q.id, channel: "whatsapp" });
    const link = (await runPublicAction(s, pub(), "proposalPay", { token: q.shareToken, selectedOptionalIds: [], mode: "advance" })) as { token: string; amount: number; total: number; url: string };
    expect(link.amount).toBeLessThan(link.total);
    expect(link.url).toBe(`#/pay/demo/${link.token}`);
    const paid = (await runPublicAction(s, pub(), "sandboxPay", { token: link.token, method: "upi" })) as { bookingNumber: string };
    expect(paid.bookingNumber).toMatch(/FILE/);
    const inv = (await s.list("invoices"))[0]!;
    expect(inv.paid).toBe(link.amount);
    await expect(runPublicAction(s, pub(), "sandboxPay", { token: link.token })).resolves.toMatchObject({ status: "paid" });
    expect((await s.list("payments")).length).toBe(1);
    expect(await books(s)).toBe(true);
    expect((await s.list("outbox")).some((o) => o.kind === "notification" && /confirmed/.test(o.body))).toBe(true);
  });

  it("a real agency without a gateway gets a clear message, and messages wait instead of pretending to send", async () => {
    const s = new MemoryStore();
    await masters(s);
    const { lead } = (await runAction(s, real(), "captureLead", { ...contact, source: "website", destination: "Goa", travelDate: day(20), nights: 3, adults: 2 })) as { lead: { id: string } };
    const q = (await runAction(s, real(), "createQuoteFromLead", { leadId: lead.id })) as { id: string; shareToken: string };
    await runAction(s, real(), "sendQuote", { quoteId: q.id, channel: "whatsapp" });
    await expect(runPublicAction(s, { ...pub(), tenantId: "agency-1" }, "proposalPay", { token: q.shareToken, selectedOptionalIds: [] })).rejects.toThrow(/payment gateway/);
    const r = await runJobs(s, real());
    expect(r["waiting"]).toBeGreaterThan(0);
    const out = (await s.list("outbox")).find((o) => o.kind === "notification")!;
    expect(out.status).toBe("queued");
    expect(out.error).toMatch(/isn't connected/);
  });

  it("hold-now-pay-later locks the price and expires", async () => {
    const s = new MemoryStore();
    await masters(s);
    const { lead } = (await runAction(s, demo(), "captureLead", { ...contact, source: "website", destination: "Goa", travelDate: day(20), nights: 3, adults: 2 })) as { lead: { id: string } };
    const q = (await runAction(s, demo(), "createQuoteFromLead", { leadId: lead.id })) as { id: string; shareToken: string };
    await runAction(s, demo(), "sendQuote", { quoteId: q.id, channel: "link" });
    const h = (await runPublicAction(s, pub(), "proposalHold", { token: q.shareToken, selectedOptionalIds: [] })) as { id: string; status: string };
    expect(h.status).toBe("held");
    const later: Ctx = { ...demo(), now: new Date(NOW.getTime() + 49 * 3600_000) };
    await runJobs(s, later);
    expect((await s.get("holds", h.id))!.status).toBe("expired");
  });

  it("Option A/B: priced separately, customer's choice decides the booking", async () => {
    const s = new MemoryStore();
    await masters(s);
    const { lead } = (await runAction(s, demo(), "captureLead", { ...contact, source: "website", destination: "Goa", travelDate: day(20), nights: 3, adults: 2 })) as { lead: { id: string } };
    const q = (await runAction(s, demo(), "createQuoteFromLead", { leadId: lead.id })) as { id: string; shareToken: string; lines: { id: string; type: string }[] };
    const full = (await s.get("quotes", q.id))!;
    const hotel = full.lines.find((l) => l.type === "hotel")!;
    const premium = { ...hotel, id: "premium", netCost: hotel.netCost * 2 };
    await runAction(s, demo(), "saveQuote", { quoteId: q.id, patch: { lines: [...full.lines, premium] } });
    await runAction(s, demo(), "setQuoteOptions", { quoteId: q.id, options: [{ key: "A", name: "Standard" }, { key: "B", name: "Premium" }], lineOptions: { [hotel.id]: "A", premium: "B" } });
    await runAction(s, demo(), "sendQuote", { quoteId: q.id, channel: "link" });
    const view = (await runPublicAction(s, pub(), "viewProposal", { token: q.shareToken })) as { quote: { options: { key: string; total: number }[] } };
    expect(view.quote.options.length).toBe(2);
    expect(view.quote.options[1]!.total).toBeGreaterThan(view.quote.options[0]!.total);
    await expect(runPublicAction(s, pub(), "acceptProposal", { token: q.shareToken, selectedOptionalIds: [] })).rejects.toThrow(/Choose one of the options/);
    await runPublicAction(s, pub(), "acceptProposal", { token: q.shareToken, selectedOptionalIds: [], option: "B" });
    const svc = await s.list("services");
    expect(svc.some((x) => x.netCost === premium.netCost * premium.quantity)).toBe(true);
    expect(svc.filter((x) => x.type === "hotel").length).toBe(1);
    expect((await s.list("invoices"))[0]!.total).toBe(view.quote.options[1]!.total);
    expect(await books(s)).toBe(true);
  });
});

describe("engines and inventory", () => {
  it("hotel allotment: availability shrinks after booking, sold-out blocks, cancellation gives rooms back", async () => {
    const s = new MemoryStore();
    const { hotel } = await masters(s);
    await createRow(s, "allotments", { hotelId: hotel.id, roomType: "Deluxe", from: day(0), to: day(60), rooms: 2, booked: {} }, NOW);
    const search = async () => (await runPublicAction(s, pub(), "publicHotelSearch", { city: "Goa", checkIn: day(10), nights: 2, rooms: 1, adults: 2 })) as { roomsLeft: number | null }[];
    expect((await search())[0]!.roomsLeft).toBe(2);
    const q = (await runPublicAction(s, pub(), "publicHotelQuote", { hotelId: hotel.id, roomType: "Deluxe", mealPlan: "CP", checkIn: day(10), nights: 2, rooms: 2, adults: 4, contact })) as { token: string; total: number };
    await runPublicAction(s, pub(), "acceptProposal", { token: q.token, selectedOptionalIds: [], payment: { amount: q.total, method: "upi", gateway: "sandbox" } });
    expect(await search()).toEqual([]);
    expect((await s.list("services"))[0]!.status).toBe("confirmed");
    const b = (await s.list("bookings"))[0]!;
    await runAction(s, demo("ops"), "cancelBooking", { bookingId: b.id, reason: "Plans changed", refundTo: "none" });
    expect((await search())[0]!.roomsLeft).toBe(2);
    expect(await books(s)).toBe(true);
  });

  it("series fare seats, live flight ticketing (sandbox) and an insurance policy", async () => {
    const s = new MemoryStore();
    await masters(s);
    const sf = await createRow(s, "seriesFares", { airline: "Demo Air", flightNo: "DA 1", from: "BOM", to: "DXB", departDate: day(30), seats: 3, netFare: 2_000_000, sellFare: 2_400_000 }, NOW);
    const q = (await runPublicAction(s, pub(), "publicSeriesQuote", { seriesId: sf.id, seats: 2, contact, passengers: ["Asha Rao", "Dev Rao"] })) as { token: string; total: number };
    await runPublicAction(s, pub(), "acceptProposal", { token: q.token, selectedOptionalIds: [], payment: { amount: q.total, method: "card", gateway: "sandbox" } });
    expect((await s.get("seriesFares", sf.id))!.sold).toBe(2);
    await expect(runPublicAction(s, pub(), "publicSeriesQuote", { seriesId: sf.id, seats: 2, contact })).rejects.toThrow(/Only 1 seat/);

    const query = { from: "BOM", to: "GOI", date: day(12), adults: 1, children: 0, cabin: "economy" as const };
    const offers = sandboxFlightOffers(query);
    expect(offers.length).toBeGreaterThan(2);
    const fq = (await runPublicAction(s, pub(), "publicFlightQuote", { offerId: offers[0]!.id, query, contact, passengers: ["Asha Rao"] })) as { token: string; total: number };
    await runPublicAction(s, pub(), "acceptProposal", { token: fq.token, selectedOptionalIds: [], payment: { amount: fq.total, method: "upi", gateway: "sandbox" } });
    const fo = (await s.list("flightOrders"))[0]!;
    expect(fo.status).toBe("ticketed");
    expect(fo.pnr).toMatch(/^[A-Z0-9]{6}$/);

    const plan = await createRow(s, "insurancePlans", { name: "Asia", insurer: "Demo", region: "asia", sumInsured: 1, premiumPerDay: 9_500, minPremium: 49_900, maxAge: 70 }, NOW);
    await expect(runPublicAction(s, pub(), "publicInsuranceQuote", { planId: plan.id, from: day(30), to: day(35), destination: "Dubai", travellers: [{ name: "Old", dob: "1940-01-01" }], contact })).rejects.toThrow(/covers travellers up to 70/);
    const iq = (await runPublicAction(s, pub(), "publicInsuranceQuote", { planId: plan.id, from: day(30), to: day(35), destination: "Dubai", travellers: [{ name: "Asha", dob: "1990-01-01" }], contact })) as { token: string; total: number };
    await runPublicAction(s, pub(), "acceptProposal", { token: iq.token, selectedOptionalIds: [], payment: { amount: iq.total, method: "upi", gateway: "sandbox" } });
    const pol = (await s.list("policies"))[0]!;
    expect(pol.premium).toBe(57_000); // 6 days × ₹95
    // Stand-alone seats, tickets and policies are not overseas tour packages: no TCS
    expect((await s.list("invoices")).every((i) => i.tcs === 0)).toBe(true);
    expect(await books(s)).toBe(true);
  });
});

describe("amendments, commission, TCS payers", () => {
  it("approved change adds the service, bills the supplier, issues a supplementary invoice — books balance", async () => {
    const s = new MemoryStore();
    const { sup } = await masters(s);
    const { lead } = (await runAction(s, demo(), "captureLead", { ...contact, source: "website", destination: "Goa", travelDate: day(20), nights: 3, adults: 2 })) as { lead: { id: string } };
    const q = (await runAction(s, demo(), "createQuoteFromLead", { leadId: lead.id })) as { id: string };
    const r = (await runAction(s, demo(), "acceptQuote", { quoteId: q.id })) as { booking: { id: string; sellTotal: number } };
    const a = (await runAction(s, demo("ops", "ops-user"), "requestAmendment", { bookingId: r.booking.id, reason: "Add a cruise", changes: [{ kind: "add", type: "sightseeing", title: "Cruise", netCost: 300_000, supplierId: sup.id }], sellImpact: 400_000 })) as { id: string; costImpact: number };
    expect(a.costImpact).toBe(300_000);
    await expect(runAction(s, demo("accounts", "ops-user"), "decideAmendment", { amendmentId: a.id, approve: true })).rejects.toThrow(/Someone else/);
    await runAction(s, demo("accounts", "acc-user"), "decideAmendment", { amendmentId: a.id, approve: true });
    expect((await s.list("invoices")).length).toBe(2);
    expect((await s.get("bookings", r.booking.id))!.sellTotal).toBe(r.booking.sellTotal + 400_000);
    expect((await s.list("services")).some((x) => x.title === "Cruise")).toBe(true);
    expect(await books(s)).toBe(true);
  });

  it("multi-PAN split must add up and validates PAN format", async () => {
    const s = new MemoryStore();
    await masters(s);
    const { lead } = (await runAction(s, demo(), "captureLead", { ...contact, source: "website", destination: "Goa", travelDate: day(20), nights: 3, adults: 2 })) as { lead: { id: string } };
    const q = (await runAction(s, demo(), "createQuoteFromLead", { leadId: lead.id })) as { id: string };
    const r = (await runAction(s, demo(), "acceptQuote", { quoteId: q.id })) as { invoice: { id: string; total: number } };
    await expect(runAction(s, demo(), "setTcsPayers", { invoiceId: r.invoice.id, payers: [{ name: "A", pan: "ABCDE1234F", amount: 1 }] })).rejects.toThrow(/add up/);
    await expect(runAction(s, demo(), "setTcsPayers", { invoiceId: r.invoice.id, payers: [{ name: "A", pan: "BAD", amount: r.invoice.total }] })).rejects.toThrow(/PAN/);
    const out = (await runAction(s, demo(), "setTcsPayers", { invoiceId: r.invoice.id, payers: [{ name: "A", pan: "ABCDE1234F", amount: r.invoice.total - 100 }, { name: "B", pan: "ABCDE5678G", amount: 100 }] })) as unknown[];
    expect(out.length).toBe(2);
  });
});

describe("calls, portal, visa uploads, inbox", () => {
  it("missed call creates a lead and a call-back task; returning the call closes it", async () => {
    const s = new MemoryStore();
    await masters(s);
    const c = (await runAction(s, demo("owner"), "recordCall", { phone: "+91 90000 11111", direction: "in", status: "missed", source: "ivr" })) as { leadId: string; callbackTaskId: string };
    expect(c.leadId).toBeTruthy();
    expect((await s.get("tasks", c.callbackTaskId))!.done).toBe(false);
    await runAction(s, demo("owner"), "recordCall", { phone: "+91 90000 11111", direction: "out", status: "answered", durationSec: 90, source: "sim" });
    expect((await s.get("tasks", c.callbackTaskId))!.done).toBe(true);
    const rep = (await runReport(s, demo(), "calls", {})) as { followUpRate: number };
    expect(rep.followUpRate).toBe(100);
  });

  it("customer signs in with a one-time code and sees their trip; wrong codes are limited", async () => {
    const s = new MemoryStore();
    await masters(s);
    const { lead } = (await runAction(s, demo(), "captureLead", { ...contact, source: "website", destination: "Goa", travelDate: day(20), nights: 3, adults: 2 })) as { lead: { id: string } };
    const q = (await runAction(s, demo(), "createQuoteFromLead", { leadId: lead.id })) as { id: string };
    await runAction(s, demo(), "acceptQuote", { quoteId: q.id });
    const r = (await runPublicAction(s, pub(), "customerRequestCode", { login: contact.email })) as { demoCode: string };
    expect(r.demoCode).toMatch(/^\d{6}$/);
    await expect(runPublicAction(s, pub(), "customerVerify", { login: contact.email, code: r.demoCode === "000000" ? "111111" : "000000" })).rejects.toThrow(/not right/);
    const v = (await runPublicAction(s, pub(), "customerVerify", { login: contact.email, code: r.demoCode })) as { token: string };
    const portal = (await runPublicAction(s, pub(), "customerPortal", { token: v.token })) as { bookings: unknown[] };
    expect(portal.bookings.length).toBe(1);
    await expect(runPublicAction(s, pub(), "customerPortal", { token: "x".repeat(32) })).rejects.toThrow(/sign in/);
    // Unknown people get the same answer (no account fishing)
    expect(await runPublicAction(s, pub(), "customerRequestCode", { login: "nobody@example.com" })).toEqual({ sent: true, channel: "email" });
  });

  it("visa applicant uploads through the secure link; the checklist fills in", async () => {
    const s = new MemoryStore();
    await masters(s);
    await createRow(s, "visaMasters", { country: "UAE", visaType: "Tourist", fee: 650_000, serviceFee: 100_000, checklist: ["Passport", "Photo"] }, NOW);
    const vc = (await runAction(s, demo(), "createVisaCase", { contactName: "Asha", phone: contact.phone, country: "UAE", applicants: ["Asha"] })) as { uploadToken: string; id: string };
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    await runPublicAction(s, pub(), "visaUpload", { token: vc.uploadToken, applicantIndex: 0, docName: "Photo", name: "p.png", mime: "image/png", dataUrl: png });
    await runPublicAction(s, pub(), "visaUpload", { token: vc.uploadToken, applicantIndex: 0, docName: "Passport", name: "pp.png", mime: "image/png", dataUrl: png });
    expect((await s.get("visaCases", vc.id))!.status).toBe("docs_received");
    await expect(runPublicAction(s, pub(), "visaUpload", { token: vc.uploadToken, applicantIndex: 0, docName: "Photo", name: "x.exe", mime: "application/x-msdownload", dataUrl: png })).rejects.toThrow(/Upload a photo/);
    expect((await s.list("outbox")).some((o) => o.body.includes(`/visa-upload/demo/${vc.uploadToken}`))).toBe(true);
    const link = (await runAction(s, demo("visa"), "createPaymentLink", { visaCaseId: vc.id })) as { amount: number };
    expect(link.amount).toBe(650_000 + 100_000 + 18_000);
    expect(await books(s)).toBe(true);
  });

  it("WhatsApp bot suggests packages, threads get an owner, campaign replies are attributed", async () => {
    const s = new MemoryStore();
    await masters(s);
    await createRow(s, "packages", { name: "Goa Beach Break", destination: "Goa", nights: 3, published: true, startingPrice: 1_500_000 }, NOW);
    const seg = await createRow(s, "segments", { name: "All", rules: [] }, NOW);
    await createRow(s, "contacts", { name: "Ravi", phone: "+91 90000 22222" }, NOW);
    const camp = await createRow(s, "campaigns", { name: "Goa sale", channel: "whatsapp", segmentId: seg.id, message: "Hi {name}, Goa from ₹15k: {link}" }, NOW);
    await runAction(s, demo(), "sendCampaign", { campaignId: camp.id });
    expect((await s.list("outbox")).filter((o) => o.campaignId === camp.id).length).toBe(1);
    await runAction(s, demo(), "inboundMessage", { channel: "whatsapp", from: "Ravi", phone: "+91 90000 22222", body: "Goa 3N for 2 adults on 20 Dec" });
    const lead = (await s.list("leads"))[0]!;
    expect(lead.campaignId).toBe(camp.id);
    expect((await s.list("messages")).some((m) => m.direction === "out" && /Goa Beach Break/.test(m.body))).toBe(true);
    expect((await s.list("chatThreads"))[0]!.ownerId).toBe(lead.ownerId);
  });
});

describe("full demo seed", () => {
  it("seeds every feature through real workflows with balanced books", async () => {
    const s = new MemoryStore();
    await seedDemo(s, NOW);
    expect(await books(s)).toBe(true);
    expect((await s.list("flightOrders")).filter((f) => f.status === "ticketed").length).toBe(1);
    expect((await s.list("policies")).length).toBe(1);
    expect((await s.list("seriesFares")).some((x) => x.sold === 2)).toBe(true);
    expect((await s.list("allotments")).some((a) => Object.keys(a.booked).length > 0)).toBe(true);
    expect((await s.list("holds")).filter((h) => h.status === "held").length).toBe(1);
    expect((await s.list("amendments")).filter((a) => a.status === "pending").length).toBe(1);
    expect((await s.list("calls")).length).toBeGreaterThanOrEqual(5);
    expect((await s.list("quotes")).some((q) => q.options.length === 2)).toBe(true);
    expect((await s.list("outbox")).filter((o) => o.status === "delivered").length).toBeGreaterThan(10);
    const ins = (await runReport(s, { ...demo(), userId: (await s.list("users"))[0]!.id }, "insights", {})) as { forecast: { next: unknown[] }; predicted: unknown[] };
    expect(ins.forecast.next.length).toBe(3);
  });
});
