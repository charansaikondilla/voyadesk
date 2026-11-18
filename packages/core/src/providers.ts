/**
 * Outside services behind one small interface each. Core workflows only talk to these interfaces.
 *  - Demo tenants use the built-in SANDBOX: deterministic, no network, clearly labelled.
 *  - Real tenants get adapters built by the API server from their own keys (apps/api/src/providers).
 *  - A real tenant without keys gets NOT CONFIGURED providers: nothing is faked, the user is told what to connect.
 */
import { randomToken } from "./ids.js";
import { type Ctx } from "./store.js";

export interface OutboundMessage {
  channel: "whatsapp" | "email" | "sms";
  to: string;
  subject?: string;
  body: string;
  /** campaign, drip, reminder, notification… — business-initiated WhatsApp messages need an approved template. */
  kind?: string;
}
export interface SendResult {
  ok: boolean;
  ref?: string;
  error?: string;
  /** No account connected: leave the message queued so it goes out once one is. */
  notConfigured?: boolean;
  delivered?: boolean;
}

export interface PaymentLinkRequest {
  token: string;
  amount: number;
  currency: string;
  description: string;
  customer: { name: string; phone: string; email: string };
  returnUrl: string;
  emiMonths?: number;
}
export interface PaymentLinkResult {
  url: string;
  providerRef: string;
}

export interface FlightQuery {
  from: string;
  to: string;
  date: string;
  adults: number;
  children: number;
  cabin: "economy" | "premium" | "business";
}
export interface FlightOffer {
  id: string;
  provider: string;
  airline: string;
  airlineName: string;
  flightNo: string;
  from: string;
  to: string;
  departAt: string;
  arriveAt: string;
  durationMin: number;
  stops: number;
  cabin: string;
  baggage: string;
  refundable: boolean;
  seatsLeft: number;
  currency: string;
  /** Total net fare for all passengers in the query, in minor units. */
  netFare: number;
  adults: number;
  children: number;
}
export interface FlightBooking {
  pnr: string;
  ticketNos: string[];
  status: "booked" | "ticketed";
}

export interface AiRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
}

export interface VoiceCallRequest {
  phone: string;
  name: string;
  script: string;
}
export interface VoiceCallResult {
  ok: boolean;
  ref?: string;
  status: "answered" | "no_answer" | "busy" | "queued";
  durationSec?: number;
  outcome?: string;
  transcript?: string;
  notConfigured?: boolean;
}

export interface PanResult {
  valid: boolean;
  name?: string;
  note: string;
  notConfigured?: boolean;
}

export interface Providers {
  messaging: { name: string; sandbox: boolean; send(m: OutboundMessage): Promise<SendResult> };
  payments: { name: "sandbox" | "razorpay" | "stripe" | "paypal" | "none"; sandbox: boolean; createLink(r: PaymentLinkRequest): Promise<PaymentLinkResult> };
  flights: { name: string; sandbox: boolean; search(q: FlightQuery): Promise<FlightOffer[]>; reprice(offerId: string, q: FlightQuery): Promise<FlightOffer | null>; book(o: FlightOffer, passengers: string[], contact: { phone: string; email: string }): Promise<FlightBooking> };
  /** Returns null when no AI model is connected: callers fall back to their rule-based path. */
  ai: { name: string; sandbox: boolean; complete(r: AiRequest): Promise<string | null> };
  voice: { name: string; sandbox: boolean; call(r: VoiceCallRequest): Promise<VoiceCallResult> };
  pan: { name: string; sandbox: boolean; verify(pan: string, name: string): Promise<PanResult> };
}

export class ProviderNotConfigured extends Error {
  constructor(public service: string, message: string) {
    super(message);
  }
}

/* ───────────────────────── deterministic helpers ───────────────────────── */

/** FNV-1a 32-bit hash, used so sandbox results are stable for the same input. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function rng(seed: number) {
  let x = seed || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0x1_0000_0000;
  };
}

/* ───────────────────────── sandbox flights ───────────────────────── */

const INDIA = new Set(["DEL", "BOM", "BLR", "MAA", "HYD", "CCU", "GOI", "GOX", "COK", "AMD", "PNQ", "JAI", "IXC", "ATQ", "LKO", "TRV", "IXB", "SXR", "IXZ", "VNS", "IXL", "KUU", "GAU", "BBI", "IXM", "NAG", "IDR", "UDR", "IXJ"]);
const DOMESTIC_AIRLINES = [["6E", "IndiGo"], ["AI", "Air India"], ["QP", "Akasa Air"], ["SG", "SpiceJet"], ["IX", "Air India Express"]] as const;
const INTL_AIRLINES = [["6E", "IndiGo"], ["AI", "Air India"], ["EK", "Emirates"], ["FZ", "flydubai"], ["SQ", "Singapore Airlines"], ["TG", "Thai Airways"], ["VJ", "VietJet"], ["QR", "Qatar Airways"]] as const;

/** Rough flight time between two airports, from a stable hash (sandbox only). */
function sandboxDuration(from: string, to: string, domestic: boolean): number {
  const r = hash32([from, to].sort().join("-")) % 1000 / 1000;
  return domestic ? Math.round(75 + r * 105) : Math.round(210 + r * 330);
}

export function sandboxFlightOffers(q: FlightQuery): FlightOffer[] {
  const from = q.from.toUpperCase();
  const to = q.to.toUpperCase();
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to) || from === to) return [];
  const domestic = INDIA.has(from) && INDIA.has(to);
  const airlines = domestic ? DOMESTIC_AIRLINES : INTL_AIRLINES;
  const rand = rng(hash32(`${from}|${to}|${q.date}|${q.cabin}`));
  const dur = sandboxDuration(from, to, domestic);
  const offers: FlightOffer[] = [];
  const cabinFactor = q.cabin === "business" ? 3.4 : q.cabin === "premium" ? 1.6 : 1;
  for (let k = 0; k < 6; k++) {
    const [code, name] = airlines[Math.floor(rand() * airlines.length)]!;
    const depMin = 5 * 60 + Math.floor(rand() * 17 * 60 / 5) * 5;
    const hub: Record<string, string> = { EK: "DXB", FZ: "DXB", QR: "DOH", SQ: "SIN", TG: "BKK", VJ: "SGN" };
    const homeCarrier = ["6E", "AI", "QP", "SG", "IX"].includes(code) || hub[code] === from || hub[code] === to;
    const stops = !domestic && (!homeCarrier || rand() < 0.15) ? 1 : 0;
    const duration = dur + stops * (70 + Math.floor(rand() * 120));
    const dep = new Date(`${q.date}T00:00:00+05:30`);
    dep.setMinutes(dep.getMinutes() + depMin);
    const arr = new Date(dep.getTime() + duration * 60_000);
    const baseAdult = domestic ? 3_200 + rand() * 6_500 : 11_000 + rand() * 32_000;
    const perAdult = Math.round((baseAdult * cabinFactor) / 10) * 10;
    const total = Math.round(perAdult * q.adults + perAdult * 0.75 * q.children) * 100;
    const flightNo = `${code} ${100 + Math.floor(rand() * 8900)}`;
    const id = `sbx~${from}~${to}~${q.date}~${code}~${flightNo.replace(" ", "")}~${depMin}~${duration}~${stops}~${q.cabin}`;
    offers.push({
      id, provider: "sandbox", airline: code, airlineName: name, flightNo, from, to, departAt: dep.toISOString(), arriveAt: arr.toISOString(),
      durationMin: duration, stops, cabin: q.cabin, baggage: domestic ? "15 kg check-in + 7 kg cabin" : "30 kg check-in + 7 kg cabin",
      refundable: rand() < 0.4, seatsLeft: 2 + Math.floor(rand() * 9), currency: "INR", netFare: total, adults: q.adults, children: q.children,
    });
  }
  // de-duplicate flight numbers and sort by departure
  const seen = new Set<string>();
  return offers.filter((o) => (seen.has(o.flightNo) ? false : (seen.add(o.flightNo), true))).sort((a, b) => a.departAt.localeCompare(b.departAt));
}

/* ───────────────────────── sandbox + not-configured sets ───────────────────────── */

const VOICE_OUTCOMES = [
  ["answered", "Interested — asked for a WhatsApp quote", "Customer confirmed dates and asked for options on WhatsApp."],
  ["answered", "Booked a call-back with a consultant", "Customer wants to speak to a consultant tomorrow evening."],
  ["answered", "Not travelling this season", "Customer said plans are on hold until next year."],
  ["no_answer", "No answer", ""],
] as const;

export function sandboxProviders(tenantId: string): Providers {
  return {
    messaging: {
      name: "sandbox", sandbox: true,
      async send(m) {
        if (!m.to.trim()) return { ok: false, error: "No recipient" };
        return { ok: true, ref: `sbx_${randomToken(10)}`, delivered: true };
      },
    },
    payments: {
      name: "sandbox", sandbox: true,
      async createLink(r) {
        return { url: `#/pay/${tenantId}/${r.token}`, providerRef: `sbx_pay_${randomToken(10)}` };
      },
    },
    flights: {
      name: "sandbox", sandbox: true,
      async search(q) { return sandboxFlightOffers(q); },
      async reprice(offerId, q) { return sandboxFlightOffers(q).find((o) => o.id === offerId) ?? null; },
      async book(o, passengers) {
        const r = rng(hash32(o.id + passengers.join("|")));
        const pnr = Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(r() * 32)]).join("");
        return { pnr, ticketNos: passengers.map((_, i) => `098${String(Math.floor(r() * 1e9)).padStart(9, "0")}${i}`), status: "ticketed" };
      },
    },
    ai: { name: "rules", sandbox: true, async complete() { return null; } },
    voice: {
      name: "sandbox", sandbox: true,
      async call(req) {
        const pick = VOICE_OUTCOMES[hash32(req.phone + req.script.length) % VOICE_OUTCOMES.length]!;
        const answered = pick[0] === "answered";
        return {
          ok: true, ref: `sbx_call_${randomToken(8)}`, status: pick[0], durationSec: answered ? 40 + (hash32(req.phone) % 140) : 0, outcome: pick[1],
          transcript: answered ? `[Sandbox call — no real call was placed]\nBot: ${req.script.slice(0, 280)}\nCustomer: ${pick[2]}` : "",
        };
      },
    },
    pan: {
      name: "sandbox", sandbox: true,
      async verify(pan, name) {
        const valid = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.toUpperCase());
        return { valid, name: valid ? name.toUpperCase() : undefined, note: valid ? "Format and checksum pattern OK (sandbox: name not checked with the tax department)" : "PAN format is wrong" };
      },
    },
  };
}

const nc = (service: string, what: string) => new ProviderNotConfigured(service, `${what} isn't connected yet. Add your keys in Settings → Integrations.`);

export function unconfiguredProviders(): Providers {
  return {
    messaging: { name: "none", sandbox: false, async send() { return { ok: false, notConfigured: true, error: "No WhatsApp/email provider connected" }; } },
    payments: { name: "none", sandbox: false, async createLink() { throw nc("payments", "A payment gateway"); } },
    flights: {
      name: "none", sandbox: false,
      async search() { throw nc("flights", "A flight supplier API"); },
      async reprice() { throw nc("flights", "A flight supplier API"); },
      async book() { throw nc("flights", "A flight supplier API"); },
    },
    ai: { name: "rules", sandbox: false, async complete() { return null; } },
    voice: { name: "none", sandbox: false, async call() { return { ok: false, status: "queued", notConfigured: true }; } },
    pan: { name: "none", sandbox: false, async verify(pan) { const valid = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan.toUpperCase()); return { valid, note: valid ? "Format OK (no PAN verification API connected)" : "PAN format is wrong", notConfigured: true }; } },
  };
}

/** The providers for this request: explicit ones, else the sandbox for demo tenants, else "not configured". */
export function providersFor(ctx: Pick<Ctx, "tenantId" | "providers">): Providers {
  if (ctx.providers) return ctx.providers;
  return ctx.tenantId === "demo" ? sandboxProviders(ctx.tenantId) : unconfiguredProviders();
}
