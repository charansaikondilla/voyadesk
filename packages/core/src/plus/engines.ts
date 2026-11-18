/**
 * Booking engines: flights (supplier API / sandbox), hotels on contracted allotments with live availability,
 * series fares, travel insurance with claims, holiday-package checkout on the website, and transport costing.
 * Everything books through the same quote → booking → invoice → ledger path as the rest of the product,
 * so payments, GST/TCS, vouchers and reports work the same way.
 */
import { z } from "zod";
import { internals, priceOfQuote, registerActions, registerAfterHook } from "../actions.js";
import { addDays, daysBetween, formatDate, isValidISODate, type ISODate } from "../dates.js";
import { type Allotment, type Entity, type PriceLineInput, type Quote } from "../entities.js";
import { docNumber, newId, randomToken } from "../ids.js";
import { queueMessage, T } from "../messaging.js";
import { applyBps } from "../money.js";
import { registerActionRoles } from "../permissions.js";
import { emptyLine, priceQuote, type PriceLine } from "../pricing.js";
import { providersFor, type FlightOffer, type FlightQuery } from "../providers.js";
import { DomainError } from "../rules.js";
import { createRow, getSettings, mustGet, patchRow, todayOf, type Ctx, type Store } from "../store.js";
import { resolveGst } from "../tax.js";
import { planTransport } from "../toolkit.js";
import { setAfterConfirm } from "./commerce.js";
import { action, linkFor, log, money, optStr, rupees, withProvider } from "./shared.js";

const { nextNumber, taxRules, captureLead, createQuoteFromLead, firstUserWithRole, quotePatch } = internals;
void quotePatch;

const isoDate = z.string().refine(isValidISODate, "Use a valid date (YYYY-MM-DD)");
const contactInput = z.object({ name: z.string().trim().min(1, "Your name").max(160), phone: z.string().trim().regex(/^[+\d][\d\s-]{6,17}$/, "Enter a valid phone number"), email: z.string().trim().toLowerCase().email("Enter a valid email").or(z.literal("")).default("") });
const flightQueryInput = z.object({
  from: z.string().trim().toUpperCase().length(3, "3-letter airport code"), to: z.string().trim().toUpperCase().length(3, "3-letter airport code"),
  date: isoDate, adults: z.number().int().min(1).max(9).default(1), children: z.number().int().min(0).max(8).default(0),
  cabin: z.enum(["economy", "premium", "business"]).default("economy"),
});

/* ───────────────────────── engine quotes ───────────────────────── */

interface EngineQuoteInput {
  title: string;
  destination: string;
  startDate: ISODate;
  nights: number;
  pax: { adults: number; children: number; infants: number };
  contact: { name: string; phone: string; email: string };
  lines: PriceLine[];
  leadId: string | null;
  agentId: string | null;
  scope: "domestic" | "overseas";
  /** Component bookings (flights, hotel rooms, insurance) carry GST on the service fee; packages on the full value. */
  taxKind: "service_fee" | "package";
  send: boolean;
  validDays: number;
}

async function createEngineQuote(s: Store, ctx: Ctx, i: EngineQuoteInput): Promise<Quote> {
  const settings = await getSettings(s, ctx.now);
  const today = todayOf(ctx, settings);
  const { gst } = await taxRules(s);
  const rule = resolveGst(i.taxKind === "package" ? "package" : "service_fee", i.scope, today, gst);
  // TCS (s.206C(1G)) applies to overseas tour PACKAGES only. A stand-alone flight, hotel stay, seat or insurance
  // policy is not a package, so these quotes are priced without TCS; the destination is still recorded.
  const pricingScope = i.taxKind === "package" ? i.scope : "domestic";
  const q = await createRow(s, "quotes", {
    number: await nextNumber(s, "quote", settings.quotePrefix, today), leadId: i.leadId, agentId: i.agentId, ownerId: null,
    contactName: i.contact.name, phone: i.contact.phone, email: i.contact.email, title: i.title, destination: i.destination, scope: pricingScope,
    startDate: i.startDate, nights: i.nights, pax: i.pax, currency: settings.baseCurrency, fx: settings.fx, markupMode: "per_component",
    packageMarkup: { kind: "percent", value: 0, per: "unit" }, taxBasis: rule.basis, gstRateBps: rule.rateBps, lines: i.lines,
    days: [], inclusions: [], exclusions: [], terms: "Prices are confirmed when you pay. Supplier rules apply to changes and cancellations.",
    status: i.send ? "sent" : "draft", shareToken: randomToken(24), validUntil: i.send ? addDays(today, i.validDays) : null,
  }, ctx.now);
  const total = priceOfQuote(q, today).total;
  const out = await patchRow(s, "quotes", q.id, { total }, ctx.now);
  if (i.leadId) {
    const lead = await s.get("leads", i.leadId);
    if (lead && ["new", "contacted"].includes(lead.stage) && i.send) await patchRow(s, "leads", lead.id, { stage: "quoted", lastActivityAt: ctx.now.toISOString() }, ctx.now);
    await log(s, ctx, { leadId: i.leadId, body: `${i.title}: quote ${out.number} created from the booking engine (${rupees(total)}).` });
  }
  return out;
}

/** Customer-facing price of one engine line (markup + GST + TCS exactly as the quote will charge). */
async function sellPrice(s: Store, ctx: Ctx, line: PriceLine, pax: { adults: number; children: number; infants: number }, scope: "domestic" | "overseas", taxKind: "service_fee" | "package"): Promise<number> {
  const settings = await getSettings(s, ctx.now);
  const today = todayOf(ctx, settings);
  const rules = await taxRules(s);
  const rule = resolveGst(taxKind === "package" ? "package" : "service_fee", scope, today, rules.gst);
  return priceQuote({
    lines: [line], pax, currency: settings.baseCurrency, fx: settings.fx, markupMode: "per_component", packageMarkup: { kind: "percent", value: 0, per: "unit" },
    taxBasis: rule.basis, gstRateBps: rule.rateBps, discount: null, tcs: null,
  }).total;
}

async function leadFor(s: Store, ctx: Ctx, contact: { name: string; phone: string; email: string }, p: { destination: string; travelDate: ISODate; adults: number; children: number; nights: number | null; service: "holiday" | "flight" | "hotel"; notes: string; campaignId?: string | null }) {
  const r = await captureLead(s, ctx, { name: contact.name, phone: contact.phone, email: contact.email, source: ctx.userId === "public" ? "website" : "other", destination: p.destination, travelDate: p.travelDate, adults: p.adults, children: p.children, nights: p.nights, service: p.service, notes: p.notes });
  if (p.campaignId && !r.lead.campaignId && (await s.get("campaigns", p.campaignId))) await patchRow(s, "leads", r.lead.id, { campaignId: p.campaignId }, ctx.now);
  return r.lead;
}

/* ───────────────────────── flights ───────────────────────── */

async function searchFlights(s: Store, ctx: Ctx, q: FlightQuery) {
  const settings = await getSettings(s, ctx.now);
  const today = todayOf(ctx, settings);
  if (q.date < today) throw new DomainError("Pick a travel date from today onwards.", 422);
  const p = providersFor(ctx).flights;
  const offers = await withProvider(() => p.search(q));
  const scope = offers.some((o) => !isIndian(o.from) || !isIndian(o.to)) ? "overseas" : "domestic";
  const out = [];
  for (const o of offers) {
    const line = flightLine(o, settings.flightMarkupBps, q, []);
    out.push({ ...o, sell: await sellPrice(s, ctx, line, { adults: q.adults, children: q.children, infants: 0 }, scope, "service_fee"), sandbox: p.sandbox });
  }
  return { offers: out, provider: p.name, sandbox: p.sandbox };
}

const INDIAN = /^(DEL|BOM|BLR|MAA|HYD|CCU|GOI|GOX|COK|AMD|PNQ|JAI|IXC|ATQ|LKO|TRV|IXB|SXR|IXZ|VNS|IXL|KUU|GAU|BBI|IXM|NAG|IDR|UDR|IXJ)$/;
const isIndian = (code: string) => INDIAN.test(code);

function flightLine(o: FlightOffer, markupBps: number, q: FlightQuery, passengers: string[]): PriceLine {
  return emptyLine({
    id: newId("ln"), type: "flight", title: `${o.airlineName} ${o.flightNo} ${o.from}→${o.to}, ${formatDate(o.departAt.slice(0, 10))} ${new Date(o.departAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })}${o.stops ? ` (${o.stops} stop)` : " non-stop"}`,
    day: 1, netCost: o.netFare, currency: o.currency, quantity: 1, markup: { kind: "percent", value: markupBps, per: "unit" },
    notes: passengers.length ? `Passengers: ${passengers.join("; ")}` : "", ref: `flight|${o.provider}|${JSON.stringify({ id: o.id, q })}`,
  });
}

/* ───────────────────────── hotels on allotments ───────────────────────── */

function nightsOf(checkIn: ISODate, nights: number): ISODate[] {
  return Array.from({ length: nights }, (_, k) => addDays(checkIn, k));
}

/** Rooms still free each night across all allotment blocks for this hotel and room type. */
export function roomsLeft(allotments: Allotment[], hotelId: string, roomType: string, night: ISODate): number | null {
  const blocks = allotments.filter((a) => a.hotelId === hotelId && a.roomType.toLowerCase() === roomType.toLowerCase() && a.from <= night && a.to >= night);
  if (!blocks.length) return null;
  return blocks.reduce((sum, a) => sum + Math.max(0, a.rooms - (a.booked[night] ?? 0)), 0);
}

async function searchHotels(s: Store, ctx: Ctx, q: { city: string; checkIn: ISODate; nights: number; rooms: number; adults: number; children: number }) {
  const settings = await getSettings(s, ctx.now);
  if (q.checkIn < todayOf(ctx, settings)) throw new DomainError("Pick a check-in date from today onwards.", 422);
  const [hotels, allotments] = await Promise.all([s.list("hotels"), s.list("allotments")]);
  const city = q.city.trim().toLowerCase();
  const nights = nightsOf(q.checkIn, q.nights);
  const out = [];
  for (const h of hotels.filter((x) => x.city.toLowerCase() === city || x.country.toLowerCase() === city)) {
    const byRoom = new Map<string, (typeof h.rates)[number]>();
    for (const r of h.rates) {
      const key = `${r.roomType}|${r.mealPlan}`;
      const peak = nights.some((n) => ["12", "01", "05", "06"].includes(n.slice(5, 7)));
      const prev = byRoom.get(key);
      if (!prev || (peak ? r.season === "peak" : r.season === "regular")) byRoom.set(key, r);
    }
    for (const r of byRoom.values()) {
      const left = nights.map((n) => roomsLeft(allotments, h.id, r.roomType, n));
      const onAllotment = left.every((x) => x !== null);
      const available = onAllotment ? Math.min(...(left as number[])) : null;
      if (available !== null && available < q.rooms) continue;
      const line = hotelLine(h, r, q.checkIn, q.nights, q.rooms, settings.defaultMarkupBps);
      const scope = h.country.toLowerCase() === "india" ? "domestic" : "overseas";
      out.push({
        hotelId: h.id, hotel: h.name, city: h.city, country: h.country, stars: h.stars, roomType: r.roomType, mealPlan: r.mealPlan, season: r.season,
        roomsLeft: available, instant: onAllotment, sell: await sellPrice(s, ctx, line, { adults: q.adults, children: q.children, infants: 0 }, scope, "service_fee"),
        description: h.description,
      });
    }
  }
  return out.sort((a, b) => a.sell - b.sell);
}

function hotelLine(h: Entity<"hotels">, r: Entity<"hotels">["rates"][number], checkIn: ISODate, nights: number, rooms: number, markupBps: number): PriceLine {
  return emptyLine({
    id: newId("ln"), type: "hotel", title: `${h.name} — ${r.roomType} (${r.mealPlan}), ${rooms} room${rooms > 1 ? "s" : ""} × ${nights} night${nights > 1 ? "s" : ""}`,
    day: 1, netCost: r.netPerNight, currency: r.currency, quantity: rooms * nights, supplierId: h.supplierId,
    markup: { kind: "percent", value: markupBps, per: "unit" }, ref: `allot|${h.id}|${r.roomType}|${checkIn}|${nights}|${rooms}`,
  });
}

/* ───────────────────────── insurance ───────────────────────── */

function premiumOf(plan: Entity<"insurancePlans">, from: ISODate, to: ISODate): number {
  const days = Math.max(1, daysBetween(from, to) + 1);
  return Math.max(plan.minPremium, plan.premiumPerDay * days);
}

function ageOn(dob: string | null | undefined, on: ISODate): number | null {
  if (!dob) return null;
  const [y, m, d] = dob.split("-").map(Number) as [number, number, number];
  const [Y, M, D] = on.split("-").map(Number) as [number, number, number];
  return Y - y - (M < m || (M === m && D < d) ? 1 : 0);
}

/* ───────────────────────── after confirmation: inventory, tickets, policies, commission ───────────────────────── */

async function consumeEngineLines(s: Store, ctx: Ctx, booking: Entity<"bookings">): Promise<void> {
  const q = booking.quoteId ? await s.get("quotes", booking.quoteId) : undefined;
  if (!q) return;
  const settings = await getSettings(s, ctx.now);
  const today = todayOf(ctx, settings);
  const services = (await s.list("services")).filter((x) => x.bookingId === booking.id);
  const serviceFor = (l: PriceLine) => services.find((sv) => sv.title === l.title && sv.type === l.type && sv.status !== "cancelled");
  for (const l of q.lines as PriceLine[]) {
    if (!l.ref || (l.optional && !l.selected)) continue;
    const [kind, ...rest] = l.ref.split("|");
    const sv = serviceFor(l);
    if (kind === "series") {
      const [id, seatsStr] = rest;
      const sf = await mustGet(s, "seriesFares", id!);
      const seats = Number(seatsStr);
      if (sf.sold + seats > sf.seats) throw new DomainError(`Only ${sf.seats - sf.sold} seat${sf.seats - sf.sold === 1 ? "" : "s"} left on ${sf.flightNo} ${sf.departDate}.`, 409);
      const names = (l.notes.replace(/^Passengers:\s*/, "").split(";").map((x) => x.trim()).filter(Boolean));
      const passengers = [...sf.passengers, ...Array.from({ length: seats }, (_, k) => ({ name: names[k] ?? `${booking.contactName}${k ? ` (guest ${k + 1})` : ""}`, phone: booking.phone, bookingId: booking.id }))];
      await patchRow(s, "seriesFares", sf.id, { sold: sf.sold + seats, passengers, status: sf.sold + seats >= sf.seats ? "closed" : sf.status }, ctx.now);
      if (sv) await patchRow(s, "services", sv.id, { status: "confirmed", confirmationNo: sf.pnr || `SER-${sf.flightNo.replace(/\s/g, "")}` }, ctx.now);
    } else if (kind === "allot") {
      const [hotelId, roomType, checkIn, nightsStr, roomsStr] = rest;
      const rooms = Number(roomsStr);
      const allotments = (await s.list("allotments")).filter((a) => a.hotelId === hotelId && a.roomType.toLowerCase() === roomType!.toLowerCase());
      if (!allotments.length) continue;
      for (const night of nightsOf(checkIn!, Number(nightsStr))) {
        let need = rooms;
        for (const a of allotments.filter((x) => x.from <= night && x.to >= night)) {
          const fresh = (await s.get("allotments", a.id))!;
          const free = fresh.rooms - (fresh.booked[night] ?? 0);
          const take = Math.min(free, need);
          if (take > 0) {
            await patchRow(s, "allotments", a.id, { booked: { ...fresh.booked, [night]: (fresh.booked[night] ?? 0) + take } }, ctx.now);
            need -= take;
          }
          if (need === 0) break;
        }
        if (need > 0) throw new DomainError(`Sold out: not enough ${roomType} rooms on ${night}.`, 409);
      }
      if (sv) await patchRow(s, "services", sv.id, { status: "confirmed", confirmationNo: `ALLOT-${randomToken(6).toUpperCase()}` }, ctx.now);
    } else if (kind === "flight") {
      const provider = rest[0]!;
      const payload = JSON.parse(rest.slice(1).join("|")) as { id: string; q: FlightQuery };
      const names = l.notes.replace(/^Passengers:\s*/, "").split(";").map((x) => x.trim()).filter(Boolean);
      const pax = payload.q.adults + payload.q.children;
      const passengers = Array.from({ length: pax }, (_, k) => names[k] ?? (k === 0 ? booking.contactName : `${booking.contactName} guest ${k + 1}`));
      const p = providersFor(ctx).flights;
      const base = { provider, offerId: payload.id, airline: "", flightNo: "", from: payload.q.from, to: payload.q.to, departAt: payload.q.date, arriveAt: payload.q.date, passengers: passengers.map((name) => ({ name })), netFare: l.netCost, bookingId: booking.id, quoteId: q.id };
      try {
        const offer = await p.reprice(payload.id, payload.q);
        if (!offer) throw new Error("The fare is no longer available");
        const res = await p.book(offer, passengers, { phone: booking.phone, email: booking.email });
        await createRow(s, "flightOrders", { ...base, airline: offer.airlineName, flightNo: offer.flightNo, departAt: offer.departAt, arriveAt: offer.arriveAt, cabin: offer.cabin, netFare: offer.netFare, pnr: res.pnr, ticketNos: res.ticketNos, status: res.status }, ctx.now);
        if (sv) await patchRow(s, "services", sv.id, { status: "confirmed", confirmationNo: res.pnr, notes: `Tickets: ${res.ticketNos.join(", ")}${p.sandbox ? " (sandbox — not a real ticket)" : ""}` }, ctx.now);
        await log(s, ctx, { bookingId: booking.id, body: `Flight ${offer.flightNo} ${res.status} — PNR ${res.pnr}${p.sandbox ? " (sandbox)" : ""}.` });
      } catch (e) {
        await createRow(s, "flightOrders", { ...base, status: "failed", error: (e instanceof Error ? e.message : String(e)).slice(0, 300) }, ctx.now);
        const ops = await firstUserWithRole(s, ["ops", "owner", "admin"]);
        await createRow(s, "tasks", { title: `Ticket manually: flight booking failed for ${booking.number}`, dueAt: new Date(ctx.now.getTime() + 30 * 60_000).toISOString(), assigneeId: ops, bookingId: booking.id, priority: "high" }, ctx.now);
      }
    } else if (kind === "insp") {
      const [planId, from, to] = rest;
      const plan = await mustGet(s, "insurancePlans", planId!);
      let travellers: { name: string; dob: string | null }[] = [];
      try { travellers = JSON.parse(l.notes.replace(/^Travellers:\s*/, "")) as { name: string; dob: string | null }[]; } catch { travellers = [{ name: booking.contactName, dob: null }]; }
      const seq = await s.nextSeq("policy");
      const pol = await createRow(s, "policies", {
        number: docNumber("POL", seq), planId: plan.id, planName: `${plan.insurer} — ${plan.name}`, contactName: booking.contactName, phone: booking.phone, email: booking.email,
        travellers: travellers.length ? travellers : [{ name: booking.contactName, dob: null }], from: from!, to: to!, destination: booking.destination, premium: l.netCost * l.quantity,
        bookingId: booking.id, agentId: booking.agentId,
      }, ctx.now);
      if (sv) await patchRow(s, "services", sv.id, { status: "confirmed", confirmationNo: pol.number }, ctx.now);
    }
  }
  void today;
}

/** Everything that should happen once a quote becomes a booking. */
export async function afterConfirm(s: Store, ctx: Ctx, bookingId: string): Promise<void> {
  const b = await mustGet(s, "bookings", bookingId);
  await consumeEngineLines(s, ctx, b);
  // Agent commission (when the agency pays commission rather than selling at a net rate)
  if (b.agentId) {
    const agent = await s.get("agents", b.agentId);
    if (agent && agent.commissionBps > 0 && !(await s.list("commissions")).some((c) => c.bookingId === b.id)) {
      await createRow(s, "commissions", { agentId: agent.id, bookingId: b.id, bookingNumber: b.number, basis: b.sellTotal, rateBps: agent.commissionBps, amount: applyBps(b.sellTotal, agent.commissionBps) }, ctx.now);
    }
  }
  const settings = await getSettings(s, ctx.now);
  await queueMessage(s, ctx, { phone: b.phone, email: b.email, subject: `Booking ${b.number} confirmed`, body: T.bookingConfirmed(b, settings.companyName, await linkFor(s, ctx, `/my/${ctx.tenantId}`)), kind: "notification", bookingId: b.id, leadId: b.leadId });
}

setAfterConfirm(afterConfirm);

/** Cancellation gives inventory back and reverses unpaid commission. */
async function releaseOnCancel(s: Store, ctx: Ctx, bookingId: string): Promise<void> {
  const b = await mustGet(s, "bookings", bookingId);
  const q = b.quoteId ? await s.get("quotes", b.quoteId) : undefined;
  for (const l of (q?.lines ?? []) as PriceLine[]) {
    if (!l.ref || (l.optional && !l.selected)) continue;
    const [kind, ...rest] = l.ref.split("|");
    if (kind === "series") {
      const sf = await s.get("seriesFares", rest[0]!);
      if (!sf) continue;
      const passengers = sf.passengers.filter((p) => p.bookingId !== b.id);
      await patchRow(s, "seriesFares", sf.id, { sold: Math.max(0, sf.sold - Number(rest[1])), passengers, status: "open" }, ctx.now);
    } else if (kind === "allot") {
      const [hotelId, roomType, checkIn, nightsStr, roomsStr] = rest;
      for (const night of nightsOf(checkIn!, Number(nightsStr))) {
        let give = Number(roomsStr);
        for (const a of (await s.list("allotments")).filter((x) => x.hotelId === hotelId && x.roomType.toLowerCase() === roomType!.toLowerCase() && x.from <= night && x.to >= night)) {
          const back = Math.min(give, a.booked[night] ?? 0);
          if (back > 0) {
            await patchRow(s, "allotments", a.id, { booked: { ...a.booked, [night]: (a.booked[night] ?? 0) - back } }, ctx.now);
            give -= back;
          }
        }
      }
    }
  }
  for (const p of (await s.list("policies")).filter((x) => x.bookingId === b.id && x.status === "issued")) await patchRow(s, "policies", p.id, { status: "cancelled" }, ctx.now);
  for (const f of (await s.list("flightOrders")).filter((x) => x.bookingId === b.id && x.status !== "cancelled")) await patchRow(s, "flightOrders", f.id, { status: "cancelled" }, ctx.now);
  for (const c of (await s.list("commissions")).filter((x) => x.bookingId === b.id && x.status === "accrued")) await patchRow(s, "commissions", c.id, { status: "reversed" }, ctx.now);
}

registerAfterHook(async (s, ctx, name, input, output) => {
  if (name === "acceptQuote" || name === "agentBook") {
    const id = (output as { booking?: { id: string } }).booking?.id;
    if (id) await afterConfirm(s, ctx, id);
  } else if (name === "public:acceptProposal") {
    const num = (output as { bookingNumber?: string }).bookingNumber;
    const b = (await s.list("bookings")).find((x) => x.number === num);
    if (b) await afterConfirm(s, ctx, b.id);
  } else if (name === "cancelBooking") {
    await releaseOnCancel(s, ctx, (input as { bookingId: string }).bookingId);
  }
});

/* ───────────────────────── actions ───────────────────────── */

registerActionRoles({
  flightSearch: ["owner", "admin", "sales", "ops", "agent"],
  flightQuote: ["owner", "admin", "sales", "ops", "agent"],
  addFlightToQuote: ["owner", "admin", "sales"],
  hotelSearch: ["owner", "admin", "sales", "ops", "agent"],
  hotelQuote: ["owner", "admin", "sales", "ops", "agent"],
  seriesQuote: ["owner", "admin", "sales", "ops", "agent"],
  insuranceQuote: ["owner", "admin", "sales", "ops", "agent"],
  decideClaim: ["owner", "admin", "ops", "accounts"],
  transportPlan: ["owner", "admin", "sales", "ops"],
  addTransportToQuote: ["owner", "admin", "sales"],
  setQuoteOptions: ["owner", "admin", "sales"],
});

const engineContact = (ctx: Ctx, c: { name: string; phone: string; email: string }) => c;

async function agentMarkup(s: Store, ctx: Ctx): Promise<{ agentId: string | null }> {
  return { agentId: ctx.role === "agent" ? ctx.agentId : null };
}

registerActions({
  flightSearch: action(flightQueryInput, (s, ctx, q) => searchFlights(s, ctx, q)),

  flightQuote: action(z.object({ offerId: z.string().min(5), query: flightQueryInput, contact: contactInput, passengers: z.array(z.string().trim().min(1)).max(9).default([]), send: z.boolean().default(false) }), async (s, ctx, i) => {
    const settings = await getSettings(s, ctx.now);
    const offer = await withProvider(() => providersFor(ctx).flights.reprice(i.offerId, i.query));
    if (!offer) throw new DomainError("That fare is no longer available. Search again.", 409);
    const { agentId } = await agentMarkup(s, ctx);
    const lead = agentId ? null : await leadFor(s, ctx, i.contact, { destination: i.query.to, travelDate: i.query.date, adults: i.query.adults, children: i.query.children, nights: null, service: "flight", notes: `${offer.flightNo} ${offer.from}→${offer.to}` });
    return createEngineQuote(s, ctx, {
      title: `Flight ${offer.from}→${offer.to} on ${formatDate(i.query.date)}`, destination: i.query.to, startDate: i.query.date, nights: 0,
      pax: { adults: i.query.adults, children: i.query.children, infants: 0 }, contact: engineContact(ctx, i.contact), lines: [flightLine(offer, settings.flightMarkupBps, i.query, i.passengers)],
      leadId: lead?.id ?? null, agentId, scope: isIndian(offer.from) && isIndian(offer.to) ? "domestic" : "overseas", taxKind: "service_fee", send: i.send, validDays: 1,
    });
  }),

  addFlightToQuote: action(z.object({ quoteId: z.string(), offerId: z.string().min(5), query: flightQueryInput }), async (s, ctx, i) => {
    const q = await mustGet(s, "quotes", i.quoteId);
    if (q.status === "accepted") throw new DomainError("A confirmed quote is locked.", 409);
    const settings = await getSettings(s, ctx.now);
    const offer = await withProvider(() => providersFor(ctx).flights.reprice(i.offerId, i.query));
    if (!offer) throw new DomainError("That fare is no longer available. Search again.", 409);
    const line = flightLine(offer, settings.flightMarkupBps, i.query, []);
    const day = Math.max(1, daysBetween(q.startDate ?? i.query.date, i.query.date) + 1);
    const lines = [...q.lines, { ...line, day: Math.min(90, day), markup: q.markupMode === "per_component" ? line.markup : null }];
    const draft = await patchRow(s, "quotes", q.id, { lines, ...(q.status !== "draft" ? { status: "draft", version: q.version + 1 } : {}) }, ctx.now);
    const out = await patchRow(s, "quotes", q.id, { total: priceOfQuote(draft, todayOf(ctx, settings)).total }, ctx.now);
    await log(s, ctx, { leadId: q.leadId, body: `Live fare added to ${q.number}: ${line.title}.` });
    return out;
  }),

  hotelSearch: action(z.object({ city: z.string().trim().min(2, "City"), checkIn: isoDate, nights: z.number().int().min(1).max(30), rooms: z.number().int().min(1).max(20).default(1), adults: z.number().int().min(1).max(40).default(2), children: z.number().int().min(0).max(20).default(0) }), (s, ctx, q) => searchHotels(s, ctx, q)),

  hotelQuote: action(z.object({ hotelId: z.string(), roomType: z.string().min(1), mealPlan: z.string().min(1), checkIn: isoDate, nights: z.number().int().min(1).max(30), rooms: z.number().int().min(1).max(20), adults: z.number().int().min(1).max(40), children: z.number().int().min(0).max(20).default(0), contact: contactInput, send: z.boolean().default(false) }), async (s, ctx, i) => {
    const settings = await getSettings(s, ctx.now);
    const h = await mustGet(s, "hotels", i.hotelId);
    const options = await searchHotels(s, ctx, { city: h.city, checkIn: i.checkIn, nights: i.nights, rooms: i.rooms, adults: i.adults, children: i.children });
    const pick = options.find((o) => o.hotelId === h.id && o.roomType === i.roomType && o.mealPlan === i.mealPlan);
    if (!pick) throw new DomainError("Those rooms are no longer available for your dates.", 409);
    const rate = h.rates.find((r) => r.roomType === i.roomType && r.mealPlan === i.mealPlan && r.season === pick.season)!;
    const { agentId } = await agentMarkup(s, ctx);
    const lead = agentId ? null : await leadFor(s, ctx, i.contact, { destination: h.city, travelDate: i.checkIn, adults: i.adults, children: i.children, nights: i.nights, service: "hotel", notes: `${h.name} ${i.roomType}` });
    return createEngineQuote(s, ctx, {
      title: `${h.name}, ${h.city} — ${i.nights} night${i.nights > 1 ? "s" : ""} from ${formatDate(i.checkIn)}`, destination: h.city, startDate: i.checkIn, nights: i.nights,
      pax: { adults: i.adults, children: i.children, infants: 0 }, contact: i.contact, lines: [hotelLine(h, rate, i.checkIn, i.nights, i.rooms, settings.defaultMarkupBps)],
      leadId: lead?.id ?? null, agentId, scope: h.country.toLowerCase() === "india" ? "domestic" : "overseas", taxKind: "service_fee", send: i.send, validDays: 2,
    });
  }),

  seriesQuote: action(z.object({ seriesId: z.string(), seats: z.number().int().min(1).max(9), contact: contactInput, passengers: z.array(z.string().trim().min(1)).max(9).default([]), send: z.boolean().default(false) }), async (s, ctx, i) => {
    const sf = await mustGet(s, "seriesFares", i.seriesId);
    if (sf.status !== "open" || sf.seats - sf.sold < i.seats) throw new DomainError(`Only ${Math.max(0, sf.seats - sf.sold)} seat(s) left on this departure.`, 409);
    const settings = await getSettings(s, ctx.now);
    if (sf.departDate < todayOf(ctx, settings)) throw new DomainError("This departure has already left.", 409);
    const { agentId } = await agentMarkup(s, ctx);
    const lead = agentId ? null : await leadFor(s, ctx, i.contact, { destination: sf.to, travelDate: sf.departDate, adults: i.seats, children: 0, nights: null, service: "flight", notes: `Series fare ${sf.flightNo}` });
    const line = emptyLine({
      id: newId("ln"), type: "flight", title: `${sf.airline} ${sf.flightNo} ${sf.from}→${sf.to} on ${formatDate(sf.departDate)} ${sf.departTime}${sf.returnDate ? `, return ${sf.returnFlightNo} on ${formatDate(sf.returnDate)}` : ""} (group fare)`,
      day: 1, netCost: sf.netFare, quantity: i.seats, supplierId: sf.supplierId, markup: { kind: "flat", value: Math.max(0, sf.sellFare - sf.netFare), per: "unit" },
      notes: i.passengers.length ? `Passengers: ${i.passengers.join("; ")}` : "", ref: `series|${sf.id}|${i.seats}`,
    });
    return createEngineQuote(s, ctx, {
      title: `${sf.from}→${sf.to} group fare, ${formatDate(sf.departDate)}`, destination: sf.to, startDate: sf.departDate, nights: sf.returnDate ? Math.max(0, daysBetween(sf.departDate, sf.returnDate)) : 0,
      pax: { adults: i.seats, children: 0, infants: 0 }, contact: i.contact, lines: [line], leadId: lead?.id ?? null, agentId,
      scope: isIndian(sf.from) && isIndian(sf.to) ? "domestic" : "overseas", taxKind: "service_fee", send: i.send, validDays: 1,
    });
  }),

  insuranceQuote: action(z.object({ planId: z.string(), from: isoDate, to: isoDate, destination: z.string().trim().min(2).max(80), travellers: z.array(z.object({ name: z.string().trim().min(1), dob: isoDate.nullable().optional() })).min(1).max(9), contact: contactInput, send: z.boolean().default(false) }), async (s, ctx, i) => {
    const plan = await mustGet(s, "insurancePlans", i.planId);
    if (!plan.active) throw new DomainError("This plan is not on sale.", 409);
    if (i.to < i.from) throw new DomainError("The return date is before the start date.", 422);
    const settings = await getSettings(s, ctx.now);
    if (i.from < todayOf(ctx, settings)) throw new DomainError("Cover must start today or later.", 422);
    for (const t of i.travellers) {
      const age = ageOn(t.dob, i.from);
      if (age !== null && age > plan.maxAge) throw new DomainError(`${t.name} is ${age}; this plan covers travellers up to ${plan.maxAge}.`, 422);
    }
    const { agentId } = await agentMarkup(s, ctx);
    const lead = agentId ? null : await leadFor(s, ctx, i.contact, { destination: i.destination, travelDate: i.from, adults: i.travellers.length, children: 0, nights: null, service: "holiday", notes: `Travel insurance: ${plan.name}` });
    const premium = premiumOf(plan, i.from, i.to);
    const line = emptyLine({
      id: newId("ln"), type: "insurance", title: `${plan.insurer} ${plan.name} — ${i.travellers.length} traveller${i.travellers.length > 1 ? "s" : ""}, ${formatDate(i.from)} to ${formatDate(i.to)}`,
      day: 1, netCost: premium, quantity: i.travellers.length, markup: { kind: "percent", value: 0, per: "unit" },
      notes: `Travellers: ${JSON.stringify(i.travellers.map((t) => ({ name: t.name, dob: t.dob ?? null })))}`.slice(0, 500), ref: `insp|${plan.id}|${i.from}|${i.to}`,
    });
    return createEngineQuote(s, ctx, {
      title: `${plan.name} travel insurance`, destination: i.destination, startDate: i.from, nights: Math.max(0, daysBetween(i.from, i.to)),
      pax: { adults: i.travellers.length, children: 0, infants: 0 }, contact: i.contact, lines: [line], leadId: lead?.id ?? null, agentId,
      scope: plan.region === "domestic" ? "domestic" : "overseas", taxKind: "service_fee", send: i.send, validDays: 3,
    });
  }),

  decideClaim: action(z.object({ claimId: z.string(), status: z.enum(["in_review", "approved", "rejected", "paid"]), note: optStr(1000) }), async (s, ctx, i) => {
    const c = await mustGet(s, "claims", i.claimId);
    const FLOW: Record<string, string[]> = { submitted: ["in_review", "rejected"], in_review: ["approved", "rejected"], approved: ["paid"], rejected: [], paid: [] };
    if (!FLOW[c.status]!.includes(i.status)) throw new DomainError(`A ${c.status.replace("_", " ")} claim can't move to ${i.status.replace("_", " ")}.`, 409);
    if (i.status === "rejected" && !i.note) throw new DomainError("Give the reason to share with the customer.", 422);
    const out = await patchRow(s, "claims", c.id, { status: i.status, decisionNote: i.note ?? c.decisionNote }, ctx.now);
    const pol = await s.get("policies", c.policyId);
    await queueMessage(s, ctx, { phone: pol?.phone, email: pol?.email, body: `Hi ${c.contactName}, your insurance claim ${c.number} is now ${i.status.replace("_", " ")}.${i.note ? ` ${i.note}` : ""}`, kind: "notification" });
    return out;
  }),

  transportPlan: action(z.object({ pax: z.number().int().min(1).max(500), days: z.number().int().min(1).max(60), kmPerDay: z.array(z.number().int().min(0).max(2000)).min(1).max(60), city: optStr(80) }), async (s, _ctx, i) => {
    const rates = (await s.list("vehicleRates")).filter((v) => !i.city || !v.city || v.city.toLowerCase() === i.city.toLowerCase());
    const plan = planTransport(rates, i.pax, i.days, i.kmPerDay);
    if (!plan) throw new DomainError("Add vehicle rates in Masters → Vehicle rates first.", 422);
    return plan;
  }),

  addTransportToQuote: action(z.object({ quoteId: z.string(), days: z.number().int().min(1).max(60), kmPerDay: z.array(z.number().int().min(0).max(2000)).min(1).max(60), city: optStr(80) }), async (s, ctx, i) => {
    const q = await mustGet(s, "quotes", i.quoteId);
    if (q.status === "accepted") throw new DomainError("A confirmed quote is locked.", 409);
    const pax = q.pax.adults + q.pax.children;
    const rates = (await s.list("vehicleRates")).filter((v) => !i.city || !v.city || v.city.toLowerCase() === i.city.toLowerCase());
    const plan = planTransport(rates, pax, i.days, i.kmPerDay);
    if (!plan) throw new DomainError("Add vehicle rates in Masters → Vehicle rates first.", 422);
    const line = emptyLine({ id: newId("ln"), type: "transfer", title: `Private transport: ${plan.breakdown.join(" + ")}, ${plan.totalKm} km`, day: 1, netCost: plan.cost, quantity: 1, ref: `transport|${plan.vehicles.map((v) => `${v.id}x${v.count}`).join(",")}` });
    const settings = await getSettings(s, ctx.now);
    const draft = await patchRow(s, "quotes", q.id, { lines: [...q.lines, line], ...(q.status !== "draft" ? { status: "draft", version: q.version + 1 } : {}) }, ctx.now);
    const out = await patchRow(s, "quotes", q.id, { total: priceOfQuote(draft, todayOf(ctx, settings)).total }, ctx.now);
    return { quote: out, plan };
  }),

  setQuoteOptions: action(z.object({ quoteId: z.string(), options: z.array(z.object({ key: z.string().min(1).max(2), name: z.string().trim().min(1).max(80) })).max(3), lineOptions: z.record(z.string().max(2)).default({}) }), async (s, ctx, i) => {
    const q = await mustGet(s, "quotes", i.quoteId);
    if (q.status === "accepted") throw new DomainError("A confirmed quote is locked.", 409);
    const keys = new Set(i.options.map((o) => o.key));
    if (keys.size !== i.options.length) throw new DomainError("Each option needs its own letter.", 422);
    const lines = q.lines.map((l) => { const k = i.lineOptions[l.id] ?? l.option; return { ...l, option: k && keys.has(k) ? k : "" }; });
    for (const o of i.options) if (!lines.some((l) => l.option === o.key)) throw new DomainError(`${o.name} has no services yet. Put at least one service in it.`, 422);
    const settings = await getSettings(s, ctx.now);
    const draft = await patchRow(s, "quotes", q.id, { options: i.options, lines, chosenOption: "", ...(q.status !== "draft" ? { status: "draft", version: q.version + 1 } : {}) }, ctx.now);
    return patchRow(s, "quotes", q.id, { total: priceOfQuote(draft, todayOf(ctx, settings)).total }, ctx.now);
  }),
});

/* ───────────────────────── public (website) actions ───────────────────────── */

registerActions({
  publicFlightSearch: action(flightQueryInput, (s, ctx, q) => searchFlights(s, ctx, q)),
  publicFlightQuote: action(z.object({ offerId: z.string().min(5), query: flightQueryInput, contact: contactInput, passengers: z.array(z.string().trim().min(1)).max(9).default([]) }), async (s, ctx, i) => {
    const settings = await getSettings(s, ctx.now);
    const offer = await withProvider(() => providersFor(ctx).flights.reprice(i.offerId, i.query));
    if (!offer) throw new DomainError("That fare is no longer available. Search again.", 409);
    if (i.passengers.length && i.passengers.length !== i.query.adults + i.query.children) throw new DomainError("Enter one name per traveller, as on the passport.", 422);
    const lead = await leadFor(s, ctx, i.contact, { destination: i.query.to, travelDate: i.query.date, adults: i.query.adults, children: i.query.children, nights: null, service: "flight", notes: `${offer.flightNo} ${offer.from}→${offer.to}` });
    const q = await createEngineQuote(s, ctx, {
      title: `Flight ${offer.from}→${offer.to} on ${formatDate(i.query.date)}`, destination: i.query.to, startDate: i.query.date, nights: 0, pax: { adults: i.query.adults, children: i.query.children, infants: 0 },
      contact: i.contact, lines: [flightLine(offer, settings.flightMarkupBps, i.query, i.passengers)], leadId: lead.id, agentId: null,
      scope: isIndian(offer.from) && isIndian(offer.to) ? "domestic" : "overseas", taxKind: "service_fee", send: true, validDays: 1,
    });
    return { token: q.shareToken, total: q.total };
  }),
  publicHotelSearch: action(z.object({ city: z.string().trim().min(2), checkIn: isoDate, nights: z.number().int().min(1).max(30), rooms: z.number().int().min(1).max(10).default(1), adults: z.number().int().min(1).max(20).default(2), children: z.number().int().min(0).max(10).default(0) }), (s, ctx, q) => searchHotels(s, ctx, q)),
  publicHotelQuote: action(z.object({ hotelId: z.string(), roomType: z.string().min(1), mealPlan: z.string().min(1), checkIn: isoDate, nights: z.number().int().min(1).max(30), rooms: z.number().int().min(1).max(10), adults: z.number().int().min(1).max(20), children: z.number().int().min(0).max(10).default(0), contact: contactInput }), async (s, ctx, i) => {
    const settings = await getSettings(s, ctx.now);
    const h = await mustGet(s, "hotels", i.hotelId);
    const options = await searchHotels(s, ctx, { city: h.city, checkIn: i.checkIn, nights: i.nights, rooms: i.rooms, adults: i.adults, children: i.children });
    const pick = options.find((o) => o.hotelId === h.id && o.roomType === i.roomType && o.mealPlan === i.mealPlan);
    if (!pick) throw new DomainError("Those rooms are no longer available for your dates.", 409);
    const rate = h.rates.find((r) => r.roomType === i.roomType && r.mealPlan === i.mealPlan && r.season === pick.season)!;
    const lead = await leadFor(s, ctx, i.contact, { destination: h.city, travelDate: i.checkIn, adults: i.adults, children: i.children, nights: i.nights, service: "hotel", notes: `${h.name} ${i.roomType}` });
    const q = await createEngineQuote(s, ctx, {
      title: `${h.name}, ${h.city} — ${i.nights} night${i.nights > 1 ? "s" : ""} from ${formatDate(i.checkIn)}`, destination: h.city, startDate: i.checkIn, nights: i.nights,
      pax: { adults: i.adults, children: i.children, infants: 0 }, contact: i.contact, lines: [hotelLine(h, rate, i.checkIn, i.nights, i.rooms, settings.defaultMarkupBps)],
      leadId: lead.id, agentId: null, scope: h.country.toLowerCase() === "india" ? "domestic" : "overseas", taxKind: "service_fee", send: true, validDays: 2,
    });
    return { token: q.shareToken, total: q.total };
  }),
  publicSeries: action(z.object({}), async (s, ctx) => {
    const today = todayOf(ctx, await getSettings(s, ctx.now));
    return (await s.list("seriesFares")).filter((x) => x.status === "open" && x.departDate >= today && x.seats > x.sold).sort((a, b) => a.departDate.localeCompare(b.departDate))
      .map((x) => ({ id: x.id, airline: x.airline, flightNo: x.flightNo, from: x.from, to: x.to, departDate: x.departDate, departTime: x.departTime, arriveTime: x.arriveTime, returnDate: x.returnDate, returnFlightNo: x.returnFlightNo, seatsLeft: x.seats - x.sold, sellFare: x.sellFare, baggage: x.baggage }));
  }),
  publicSeriesQuote: action(z.object({ seriesId: z.string(), seats: z.number().int().min(1).max(9), contact: contactInput, passengers: z.array(z.string().trim().min(1)).max(9).default([]) }), async (s, ctx, i) => {
    const sf = await mustGet(s, "seriesFares", i.seriesId);
    if (sf.status !== "open" || sf.seats - sf.sold < i.seats) throw new DomainError(`Only ${Math.max(0, sf.seats - sf.sold)} seat(s) left on this departure.`, 409);
    const lead = await leadFor(s, ctx, i.contact, { destination: sf.to, travelDate: sf.departDate, adults: i.seats, children: 0, nights: null, service: "flight", notes: `Series fare ${sf.flightNo}` });
    const line = emptyLine({ id: newId("ln"), type: "flight", title: `${sf.airline} ${sf.flightNo} ${sf.from}→${sf.to} on ${formatDate(sf.departDate)} ${sf.departTime}${sf.returnDate ? `, return ${sf.returnFlightNo} on ${formatDate(sf.returnDate)}` : ""} (group fare)`, day: 1, netCost: sf.netFare, quantity: i.seats, supplierId: sf.supplierId, markup: { kind: "flat", value: Math.max(0, sf.sellFare - sf.netFare), per: "unit" }, notes: i.passengers.length ? `Passengers: ${i.passengers.join("; ")}` : "", ref: `series|${sf.id}|${i.seats}` });
    const q = await createEngineQuote(s, ctx, { title: `${sf.from}→${sf.to} group fare, ${formatDate(sf.departDate)}`, destination: sf.to, startDate: sf.departDate, nights: sf.returnDate ? Math.max(0, daysBetween(sf.departDate, sf.returnDate)) : 0, pax: { adults: i.seats, children: 0, infants: 0 }, contact: i.contact, lines: [line], leadId: lead.id, agentId: null, scope: isIndian(sf.from) && isIndian(sf.to) ? "domestic" : "overseas", taxKind: "service_fee", send: true, validDays: 1 });
    return { token: q.shareToken, total: q.total };
  }),
  publicInsurancePlans: action(z.object({ from: isoDate.optional(), to: isoDate.optional(), travellers: z.number().int().min(1).max(9).default(1) }), async (s, _ctx, i) => {
    return (await s.list("insurancePlans")).filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, insurer: p.insurer, region: p.region, sumInsured: p.sumInsured, maxAge: p.maxAge, benefits: p.benefits, premium: i.from && i.to ? premiumOf(p, i.from, i.to) * i.travellers : null }));
  }),
  publicInsuranceQuote: action(z.object({ planId: z.string(), from: isoDate, to: isoDate, destination: z.string().trim().min(2).max(80), travellers: z.array(z.object({ name: z.string().trim().min(1), dob: isoDate.nullable().optional() })).min(1).max(9), contact: contactInput }), async (s, ctx, i) => {
    const plan = await mustGet(s, "insurancePlans", i.planId);
    if (!plan.active) throw new DomainError("This plan is not on sale.", 409);
    if (i.to < i.from) throw new DomainError("The return date is before the start date.", 422);
    for (const t of i.travellers) {
      const age = ageOn(t.dob, i.from);
      if (age !== null && age > plan.maxAge) throw new DomainError(`${t.name} is ${age}; this plan covers travellers up to ${plan.maxAge}.`, 422);
    }
    const lead = await leadFor(s, ctx, i.contact, { destination: i.destination, travelDate: i.from, adults: i.travellers.length, children: 0, nights: null, service: "holiday", notes: `Travel insurance: ${plan.name}` });
    const premium = premiumOf(plan, i.from, i.to);
    const line = emptyLine({ id: newId("ln"), type: "insurance", title: `${plan.insurer} ${plan.name} — ${i.travellers.length} traveller${i.travellers.length > 1 ? "s" : ""}, ${formatDate(i.from)} to ${formatDate(i.to)}`, day: 1, netCost: premium, quantity: i.travellers.length, markup: { kind: "percent", value: 0, per: "unit" }, notes: `Travellers: ${JSON.stringify(i.travellers.map((t) => ({ name: t.name, dob: t.dob ?? null })))}`.slice(0, 500), ref: `insp|${plan.id}|${i.from}|${i.to}` });
    const q = await createEngineQuote(s, ctx, { title: `${plan.name} travel insurance`, destination: i.destination, startDate: i.from, nights: Math.max(0, daysBetween(i.from, i.to)), pax: { adults: i.travellers.length, children: 0, infants: 0 }, contact: i.contact, lines: [line], leadId: lead.id, agentId: null, scope: plan.region === "domestic" ? "domestic" : "overseas", taxKind: "service_fee", send: true, validDays: 3 });
    return { token: q.shareToken, total: q.total };
  }),
  storefrontBook: action(z.object({ packageId: z.string(), startDate: isoDate, adults: z.number().int().min(1).max(20), children: z.number().int().min(0).max(10).default(0), contact: contactInput, campaignId: optStr(60) }), async (s, ctx, i) => {
    const pkg = await mustGet(s, "packages", i.packageId);
    if (!pkg.published) throw new DomainError("This package is not on sale.", 404);
    const settings = await getSettings(s, ctx.now);
    const today = todayOf(ctx, settings);
    if (i.startDate < addDays(today, 3)) throw new DomainError("Online booking needs at least 3 days' notice. Send an enquiry instead and we'll call you.", 422);
    const lead = await leadFor(s, ctx, i.contact, { destination: pkg.destination, travelDate: i.startDate, adults: i.adults, children: i.children, nights: pkg.nights, service: "holiday", notes: `Booking online: ${pkg.name}`, campaignId: i.campaignId ?? null });
    const draft = await createQuoteFromLead(s, ctx, { leadId: lead.id, packageId: pkg.id });
    const priced = { ...draft, startDate: i.startDate, pax: { adults: i.adults, children: i.children, infants: 0 } };
    const q = await patchRow(s, "quotes", draft.id, { startDate: i.startDate, pax: priced.pax, status: "sent", validUntil: addDays(today, 3), total: priceOfQuote(priced, today).total }, ctx.now);
    await patchRow(s, "leads", lead.id, { stage: "quoted", lastActivityAt: ctx.now.toISOString() }, ctx.now);
    return { token: q.shareToken, total: q.total };
  }),
}, true);

export { premiumOf, searchFlights, searchHotels };
export type { PriceLineInput };
