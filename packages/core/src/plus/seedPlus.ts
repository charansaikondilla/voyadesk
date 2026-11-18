/**
 * Demo data for the feature pack, created through the real workflows (sandbox providers):
 * inventory, engine bookings, payment links, holds, options A/B, amendments, calls, AI calls, inbox threads,
 * documents, visa uploads, TCS payers, commissions, insurance claims and the first job run.
 * All people, businesses, airlines' flight numbers and fares in the demo are fictional.
 */
import { runAction, runPublicAction } from "../actions.js";
import { addDays, isoDate } from "../dates.js";
import { type Role } from "../entities.js";
import { sandboxProviders } from "../providers.js";
import { createRow, patchRow, type Ctx, type Store } from "../store.js";
import { queueCampaign } from "./engage.js";
import { runJobs } from "./jobs.js";
import { seedGrowth } from "./seedGrowth.js";

const R = (rupees: number) => Math.round(rupees * 100);
const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const PDF_MINI = `data:application/pdf;base64,${btoaSafe("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length 58>>stream\nBT /F1 14 Tf 20 70 Td (Sample document - demo only) Tj ET\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF")}`;

function btoaSafe(s: string): string {
  const bytes = new TextEncoder().encode(s);
  const B = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2];
    out += B[a >> 2]! + B[((a & 3) << 4) | ((b ?? 0) >> 4)]! + (b === undefined ? "=" : B[((b & 15) << 2) | ((c ?? 0) >> 6)]!) + (c === undefined ? "=" : B[c & 63]!);
  }
  return out;
}

/** A short two-tone WAV (sample "recording" for the sandbox call log — clearly not a real call). */
function sampleRecording(): string {
  const rate = 8000, secs = 1.2, n = Math.floor(rate * secs);
  const buf = new Uint8Array(44 + n);
  const v = new DataView(buf.buffer);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i); };
  w(0, "RIFF"); v.setUint32(4, 36 + n, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, "data"); v.setUint32(40, n, true);
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(40 * Math.sin((2 * Math.PI * (i < n / 2 ? 440 : 660) * i) / rate));
  let bin = "";
  const B = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (let i = 0; i < buf.length; i += 3) {
    const a = buf[i]!, b = buf[i + 1], c = buf[i + 2];
    bin += B[a >> 2]! + B[((a & 3) << 4) | ((b ?? 0) >> 4)]! + (b === undefined ? "=" : B[((b & 15) << 2) | ((c ?? 0) >> 6)]!) + (c === undefined ? "=" : B[c & 63]!);
  }
  return `data:audio/wav;base64,${bin}`;
}

export async function seedPlus(store: Store, base: Date, tenantId = "demo"): Promise<void> {
  const users = await store.list("users");
  const by = (role: Role) => users.find((u) => u.role === role)!;
  const owner = by("owner"), ops = by("ops"), accounts = by("accounts"), visa = by("visa"), marketing = by("marketing");
  const sales = users.filter((u) => u.role === "sales");
  // Demo data always runs on the sandbox, even inside a real tenant that asked for sample data
  const providers = sandboxProviders(tenantId);
  const ctx = (role: Role, userId: string, hoursAgo = 0, agentId: string | null = null): Ctx => ({ tenantId, userId, role, agentId, now: new Date(base.getTime() - hoursAgo * 3600_000), providers });
  const pub = (hoursAgo = 0): Ctx => ({ tenantId, userId: "public", role: "admin", agentId: null, now: new Date(base.getTime() - hoursAgo * 3600_000), providers });
  const today = isoDate(base);
  const at = (days: number) => addDays(today, days);
  const t0 = new Date(base.getTime() - 30 * 86_400_000);

  /* Inventory and masters */
  const hotels = await store.list("hotels");
  const goa = hotels.find((h) => h.city === "Goa" && h.rates.length)!;
  const dubai = hotels.find((h) => h.city === "Dubai" && h.rates.length)!;
  if (goa) await createRow(store, "allotments", { hotelId: goa.id, roomType: goa.rates[0]!.roomType, from: at(0), to: at(150), rooms: 6, booked: {}, releaseDays: 7 }, t0);
  if (dubai) await createRow(store, "allotments", { hotelId: dubai.id, roomType: dubai.rates[0]!.roomType, from: at(0), to: at(150), rooms: 4, booked: {}, releaseDays: 10 }, t0);
  const suppliers = await store.list("suppliers");
  const sf1 = await createRow(store, "seriesFares", { airline: "Demo Air", flightNo: "DA 711", from: "BOM", to: "DXB", departDate: at(32), departTime: "04:35", arriveTime: "06:20", returnFlightNo: "DA 712", returnDate: at(37), seats: 30, netFare: R(21_500), sellFare: R(24_900), pnr: "SRDX71", supplierId: suppliers.find((s) => s.city === "Dubai")?.id ?? null }, t0);
  await createRow(store, "seriesFares", { airline: "Demo Air", flightNo: "DA 245", from: "DEL", to: "GOI", departDate: at(21), departTime: "06:10", arriveTime: "08:45", returnFlightNo: "DA 246", returnDate: at(25), seats: 40, netFare: R(7_800), sellFare: R(9_499), pnr: "SRGO24" }, t0);
  const plans = [
    await createRow(store, "insurancePlans", { name: "Asia Smart", insurer: "Suraksha General (Demo)", region: "asia", sumInsured: R(25_00_000), premiumPerDay: R(95), minPremium: R(499), maxAge: 70, benefits: ["Medical cover $30,000", "Trip delay ₹5,000", "Baggage loss ₹15,000", "24×7 assistance"] }, t0),
    await createRow(store, "insurancePlans", { name: "Worldwide Plus", insurer: "Yatra Shield (Demo)", region: "worldwide", sumInsured: R(85_00_000), premiumPerDay: R(210), minPremium: R(999), maxAge: 75, benefits: ["Medical cover $100,000", "Trip cancellation ₹50,000", "Passport loss", "Adventure sports add-on"] }, t0),
    await createRow(store, "insurancePlans", { name: "Schengen Secure", insurer: "Suraksha General (Demo)", region: "schengen", sumInsured: R(30_00_000), premiumPerDay: R(160), minPremium: R(899), maxAge: 70, benefits: ["Meets Schengen visa rules (€30,000)", "Repatriation", "Personal liability"] }, t0),
  ];
  for (const [name, capacity, perDay, perKm] of [["Sedan (Dzire/Etios)", 4, 2800, 14], ["SUV (Innova Crysta)", 6, 4200, 19], ["Tempo Traveller", 12, 6500, 26], ["Mini coach", 20, 9800, 38]] as const) {
    await createRow(store, "vehicleRates", { name, capacity, perDay: R(perDay), perKm: R(perKm), kmIncludedPerDay: 250, allowancePerDay: R(400), city: "" }, t0);
  }

  /* Agents: one partner earns commission on direct-price bookings; partner branding */
  const agents = await store.list("agents");
  const wander = agents.find((a) => a.name === "Wanderlust Partners");
  if (wander) await patchRow(store, "agents", wander.id, { commissionBps: 500, brandName: "Wanderlust Partners Holidays", brandPhone: wander.phone, brandEmail: wander.email }, t0);
  for (const b of (await store.list("bookings")).filter((x) => x.agentId && x.agentId === wander?.id)) {
    await createRow(store, "commissions", { agentId: b.agentId!, bookingId: b.id, bookingNumber: b.number, basis: b.sellTotal, rateBps: 500, amount: Math.round(b.sellTotal * 0.05) }, t0);
  }

  /* Website engine bookings: series fare, hotel on allotment, live flight, insurance — paid online (sandbox) */
  const contact = (name: string, phone: string, email = "") => ({ name, phone, email });
  const pay = async (token: string, hoursAgo: number, method: "upi" | "card" = "upi") => {
    const p = await runPublicAction(store, pub(hoursAgo), "viewProposal", { token }) as { pricing: { total: number } };
    return runPublicAction(store, pub(hoursAgo), "acceptProposal", { token, selectedOptionalIds: [], payment: { amount: p.pricing.total, method, gateway: "sandbox", reference: `TEST-${token.slice(0, 6).toUpperCase()}` } });
  };
  const s1 = await runPublicAction(store, pub(72), "publicSeriesQuote", { seriesId: sf1.id, seats: 2, contact: contact("Neha Kapoor", "+91 99000 70001", "neha.k@example.com"), passengers: ["Neha Kapoor", "Arjun Kapoor"] }) as { token: string };
  await pay(s1.token, 71);
  if (goa) {
    const h = await runPublicAction(store, pub(50), "publicHotelQuote", { hotelId: goa.id, roomType: goa.rates[0]!.roomType, mealPlan: goa.rates[0]!.mealPlan, checkIn: at(18), nights: 3, rooms: 2, adults: 4, contact: contact("Karan Malhotra", "+91 99000 70002", "karan.m@example.com") }) as { token: string };
    await pay(h.token, 49, "card");
  }
  const offers = await runPublicAction(store, pub(30), "publicFlightSearch", { from: "BOM", to: "DXB", date: at(40), adults: 2, children: 0, cabin: "economy" }) as { offers: { id: string }[] };
  if (offers.offers[0]) {
    const f = await runPublicAction(store, pub(30), "publicFlightQuote", { offerId: offers.offers[0].id, query: { from: "BOM", to: "DXB", date: at(40), adults: 2, children: 0, cabin: "economy" }, contact: contact("Rhea Fernandes", "+91 99000 70003", "rhea.f@example.com"), passengers: ["Rhea Fernandes", "Leon Fernandes"] }) as { token: string };
    await pay(f.token, 29);
  }
  const ins = await runPublicAction(store, pub(20), "publicInsuranceQuote", { planId: plans[0]!.id, from: at(40), to: at(46), destination: "Dubai", travellers: [{ name: "Rhea Fernandes", dob: "1991-04-12" }, { name: "Leon Fernandes", dob: "1989-09-30" }], contact: contact("Rhea Fernandes", "+91 99000 70003", "rhea.f@example.com") }) as { token: string };
  await pay(ins.token, 19);
  const policy = (await store.list("policies"))[0];
  if (policy) await createRow(store, "claims", { number: "CLM-0001", policyId: policy.id, policyNumber: policy.number, contactName: policy.contactName, type: "baggage", amount: R(8_500), description: "Checked-in bag arrived damaged at Dubai airport; airline damage report attached.", status: "in_review" }, base);
  await store.nextSeq("claim");

  /* Website checkout that's waiting: a package booked online, paid by advance link; another on hold */
  const pkgs = (await store.list("packages")).filter((p) => p.published);
  const goaPkg = pkgs.find((p) => p.destination === "Goa") ?? pkgs[0]!;
  const sb = await runPublicAction(store, pub(10), "storefrontBook", { packageId: goaPkg.id, startDate: at(26), adults: 2, children: 1, contact: contact("Pooja Iyer", "+91 99000 70004", "pooja.i@example.com") }) as { token: string };
  await runPublicAction(store, pub(9), "viewProposal", { token: sb.token });
  await runPublicAction(store, pub(9), "proposalPay", { token: sb.token, selectedOptionalIds: [], mode: "advance" });
  const sb2 = await runPublicAction(store, pub(6), "storefrontBook", { packageId: (pkgs.find((p) => p.destination === "Kerala") ?? pkgs[1]!).id, startDate: at(34), adults: 2, children: 0, contact: contact("Siddharth Rao", "+91 99000 70005", "sid.rao@example.com") }) as { token: string };
  await runPublicAction(store, pub(5), "viewProposal", { token: sb2.token });
  await runPublicAction(store, pub(5), "proposalHold", { token: sb2.token, selectedOptionalIds: [] });

  /* A quote with two itinerary options (standard vs premium hotel) */
  const openLead = (await store.list("leads")).find((l) => ["new", "contacted"].includes(l.stage) && l.destination && l.phone);
  if (openLead) {
    const q = await runAction(store, ctx("sales", openLead.ownerId ?? sales[0]!.id, 4), "createQuoteFromLead", { leadId: openLead.id }) as { id: string; lines: { id: string; type: string; title: string; netCost: number; quantity: number }[] };
    const hotelLine = q.lines.find((l) => l.type === "hotel");
    if (hotelLine) {
      const premium = { ...hotelLine, id: `${hotelLine.id}_b`, title: hotelLine.title.replace(/—.*/, "— Premium sea-view room"), netCost: Math.round(hotelLine.netCost * 1.45), option: "B" };
      const full = (await store.get("quotes", q.id))!;
      await patchRow(store, "quotes", q.id, { lines: [...full.lines.map((l) => (l.id === hotelLine.id ? { ...l, option: "A" } : l)), { ...full.lines.find((l) => l.id === hotelLine.id)!, ...premium }] }, base);
      await runAction(store, ctx("sales", openLead.ownerId ?? sales[0]!.id, 4), "setQuoteOptions", { quoteId: q.id, options: [{ key: "A", name: "Option A — Standard" }, { key: "B", name: "Option B — Premium" }] });
      if (!(await store.get("quotes", q.id))!.startDate) await patchRow(store, "quotes", q.id, { startDate: at(30) }, base);
      await runAction(store, ctx("sales", openLead.ownerId ?? sales[0]!.id, 3), "sendQuote", { quoteId: q.id, channel: "whatsapp" });
    }
  }

  /* Money: payment link on an unpaid invoice, TCS split across two PANs, a pending amendment */
  const invoices = await store.list("invoices");
  const unpaid = invoices.find((i) => i.partyType === "customer" && i.total > i.paid + i.credited && i.bookingId);
  if (unpaid) await runAction(store, ctx("accounts", accounts.id, 8), "createPaymentLink", { invoiceId: unpaid.id, send: true });
  const overseas = invoices.find((i) => i.scope === "overseas" && i.partyType === "customer" && i.total > 0);
  if (overseas) {
    const half = Math.floor(overseas.total / 2);
    await runAction(store, ctx("accounts", accounts.id, 7), "setTcsPayers", { invoiceId: overseas.id, payers: [{ name: overseas.partyName, pan: "ABCPK1234L", relation: "Self", amount: half }, { name: `${overseas.partyName.split(" ")[0]} (spouse)`, pan: "ABCPK5678M", relation: "Spouse", amount: overseas.total - half }] });
  }
  const confirmed = (await store.list("bookings")).find((b) => b.status === "confirmed" && b.startDate > at(10) && !b.agentId);
  if (confirmed) {
    await runAction(store, ctx("ops", ops.id, 6), "requestAmendment", { bookingId: confirmed.id, reason: "Customer wants a sunset cruise added on day 2", changes: [{ kind: "add", type: "sightseeing", title: "Sunset cruise with dinner (2 pax)", date: addDays(confirmed.startDate, 1), netCost: R(4_200) }], sellImpact: R(5_200) });
  }

  /* Calls: IVR log with recording, a missed call (call-back task), an outgoing call, and AI voice calls */
  const rec = sampleRecording();
  const someLeads = (await store.list("leads")).filter((l) => l.phone && !["won", "lost"].includes(l.stage)).slice(0, 4);
  await runAction(store, ctx("sales", sales[0]!.id, 5), "recordCall", { phone: someLeads[0]?.phone ?? "+91 99000 80001", direction: "in", status: "answered", durationSec: 312, recordingUrl: rec, source: "ivr" });
  await runAction(store, ctx("sales", sales[0]!.id, 2), "recordCall", { phone: "+91 99000 80002", name: "Unknown caller", direction: "in", status: "missed", source: "ivr" });
  await runAction(store, ctx("sales", sales[1]?.id ?? sales[0]!.id, 1), "recordCall", { phone: someLeads[1]?.phone ?? "+91 99000 80003", direction: "out", status: "answered", durationSec: 186, recordingUrl: rec, source: "sim" });
  if (someLeads.length >= 3) await runAction(store, ctx("marketing", marketing.id, 1), "startAiCalls", { leadIds: someLeads.slice(1, 4).map((l) => l.id), script: "Hi {name}, this is the travel desk calling about your holiday enquiry. Are your dates still the same, and would you like us to send options on WhatsApp?" });

  /* Inbox: threads with owners and an internal note */
  const msgs = await store.list("messages");
  for (const phone of [...new Set(msgs.map((m) => m.phone).filter(Boolean))]) {
    const lead = (await store.list("leads")).find((l) => l.phone && l.phone.replace(/\D/g, "").slice(-10) === phone.replace(/\D/g, "").slice(-10));
    const first = msgs.find((m) => m.phone === phone && m.direction === "in");
    await createRow(store, "chatThreads", { phone, name: first?.from ?? "", channel: "whatsapp", ownerId: lead?.ownerId ?? sales[0]!.id, leadId: lead?.id ?? null, notes: [{ byId: owner.id, byName: owner.name, at: base.toISOString(), body: "Priority customer — reply within the hour." }] }, base);
  }

  /* Documents: a customer's passport copy and a visa upload through the secure link */
  const someContact = (await store.list("contacts")).find((c) => c.trips > 0);
  if (someContact) await runAction(store, ctx("sales", sales[0]!.id, 3), "uploadFile", { ownerType: "contact", ownerId: someContact.id, name: "passport-copy.png", mime: "image/png", dataUrl: PNG_1PX, label: "Passport copy (demo file)" });
  const schengen = (await store.list("visaCases")).find((v) => v.status === "docs_pending");
  if (schengen) {
    const doc = schengen.applicants[0]!.docs[1]?.name ?? schengen.applicants[0]!.docs[0]!.name;
    await runPublicAction(store, pub(3), "visaUpload", { token: schengen.uploadToken, applicantIndex: 0, docName: doc, name: "photo.png", mime: "image/png", dataUrl: PNG_1PX });
    await runAction(store, ctx("visa", visa.id, 2), "uploadFile", { ownerType: "visaCase", ownerId: schengen.id, applicantIndex: 0, label: schengen.applicants[0]!.docs[0]!.name, name: "covering-letter.pdf", mime: "application/pdf", dataUrl: PDF_MINI });
  }

  /* Field app: a driver started a job and shared location */
  const asg = (await store.list("assignments"))[0];
  if (asg) await patchRow(store, "assignments", asg.id, { status: "started", lastLat: 15.4989, lastLng: 73.8278, lastSeenAt: new Date(base.getTime() - 20 * 60_000).toISOString() }, base);

  /* Marketing: the Diwali campaign's messages, then one scheduled at the best time */
  const camps = await store.list("campaigns");
  const diwali = camps.find((c) => c.status === "sent");
  if (diwali && !(await store.list("outbox")).some((o) => o.campaignId === diwali.id)) await queueCampaign(store, ctx("marketing", marketing.id, 24 * 15), diwali.id);
  const kerala = camps.find((c) => c.status === "draft");
  if (kerala) await runAction(store, ctx("marketing", marketing.id, 1), "scheduleCampaign", { campaignId: kerala.id, at: null });

  /* First background run: drips, reminders, follow-ups and delivery through the sandbox */
  await runJobs(store, ctx("owner", "system"));

  /* Growth: marketing spend, enquiries from every channel, installed automations and their history */
  await seedGrowth(store, base, tenantId);
}
