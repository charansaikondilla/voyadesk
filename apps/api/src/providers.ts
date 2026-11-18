/**
 * Real provider adapters, built per agency from its own keys. Each one is written against the provider's
 * published HTTP API. A service without keys stays "not connected" (core then queues or explains, never fakes);
 * an agency in sandbox mode gets the built-in sandbox.
 *
 *  WhatsApp Cloud API (Meta) · SMTP email · Razorpay payment links · Stripe Checkout · PayPal Orders v2
 *  Amadeus flight offers + orders · Claude (Anthropic Messages API) · Exotel calls (voice bot flow)
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import nodemailer from "nodemailer";
import {
  ProviderNotConfigured, sandboxProviders, unconfiguredProviders, type FlightOffer, type FlightQuery, type Providers, type SendResult,
} from "@voyadesk/core";
import { type Secrets } from "./secrets.js";

type FetchLike = typeof fetch;

const digits = (p: string) => p.replace(/\D/g, "").replace(/^0+/, "");
const intlPhone = (p: string) => {
  const d = digits(p);
  return d.length === 10 ? `91${d}` : d;
};
const absolute = (url: string) => /^https:\/\//.test(url);

async function jsonOrText(r: Response): Promise<unknown> {
  const t = await r.text();
  try { return JSON.parse(t); } catch { return t; }
}

function errorText(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    const e = (o["error"] ?? o["errors"] ?? o["message"]) as unknown;
    if (typeof e === "string") return e;
    if (e && typeof e === "object") {
      const m = (e as Record<string, unknown>)["message"] ?? (e as Record<string, unknown>)["description"] ?? (Array.isArray(e) ? (e[0] as Record<string, unknown>)?.["detail"] : undefined);
      if (typeof m === "string") return m;
    }
  }
  return typeof body === "string" && body ? body.slice(0, 200) : fallback;
}

/* ───────────────────────── messaging ───────────────────────── */

function messaging(s: Secrets, f: FetchLike): Providers["messaging"] {
  const wa = s.whatsapp?.["phoneNumberId"] && s.whatsapp?.["accessToken"] ? s.whatsapp : null;
  const em = s.email?.["host"] && s.email?.["from"] ? s.email : null;
  const transport = em ? nodemailer.createTransport({ host: em["host"]!, port: Number(em["port"] ?? 587), secure: Number(em["port"] ?? 587) === 465, auth: em["user"] ? { user: em["user"]!, pass: em["pass"] ?? "" } : undefined }) : null;
  return {
    name: [wa ? "whatsapp-cloud" : "", em ? "smtp" : ""].filter(Boolean).join("+") || "none", sandbox: false,
    async send(m): Promise<SendResult> {
      if (m.channel === "email") {
        if (!transport || !em) return { ok: false, notConfigured: true, error: "Email not connected" };
        try {
          const r = await transport.sendMail({ from: em["from"]!, to: m.to, subject: m.subject || "Message from your travel advisor", text: m.body });
          return { ok: true, ref: r.messageId ?? "" };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      }
      if (m.channel === "whatsapp") {
        if (!wa) return { ok: false, notConfigured: true, error: "WhatsApp not connected" };
        // Messages the business starts (campaigns, reminders, notifications) must use an approved template outside the 24-hour window
        const useTemplate = Boolean(wa["templateName"]) && m.kind !== "chat";
        const payload = useTemplate
          ? { messaging_product: "whatsapp", to: intlPhone(m.to), type: "template", template: { name: wa["templateName"], language: { code: wa["templateLang"] || "en" }, components: [{ type: "body", parameters: [{ type: "text", text: m.body.slice(0, 1000) }] }] } }
          : { messaging_product: "whatsapp", recipient_type: "individual", to: intlPhone(m.to), type: "text", text: { preview_url: true, body: m.body } };
        const r = await f(`https://graph.facebook.com/v21.0/${wa["phoneNumberId"]}/messages`, { method: "POST", headers: { Authorization: `Bearer ${wa["accessToken"]}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const body = (await jsonOrText(r)) as { messages?: { id: string }[] };
        if (!r.ok) {
          const msg = errorText(body, `WhatsApp error ${r.status}`);
          return { ok: false, error: /131047|re-engage|24 hours/i.test(msg) ? "Outside the 24-hour window: add an approved template name in Settings → Integrations → WhatsApp." : msg };
        }
        return { ok: true, ref: body.messages?.[0]?.id ?? "" };
      }
      return { ok: false, notConfigured: true, error: "SMS is not connected" };
    },
  };
}

/* ───────────────────────── payments ───────────────────────── */

function payments(s: Secrets, f: FetchLike): Providers["payments"] {
  const pick = s.gateway?.["provider"] ?? (s.razorpay ? "razorpay" : s.stripe ? "stripe" : s.paypal ? "paypal" : "");
  if (pick === "razorpay" && s.razorpay?.["keyId"] && s.razorpay["keySecret"]) {
    const auth = Buffer.from(`${s.razorpay["keyId"]}:${s.razorpay["keySecret"]}`).toString("base64");
    return {
      name: "razorpay", sandbox: false,
      async createLink(r) {
        const body: Record<string, unknown> = {
          amount: r.amount, currency: r.currency, accept_partial: false, description: r.description, reference_id: r.token,
          customer: { name: r.customer.name, email: r.customer.email || undefined, contact: r.customer.phone ? `+${intlPhone(r.customer.phone)}` : undefined },
          notify: { sms: false, email: false }, reminder_enable: false, notes: { token: r.token },
        };
        if (absolute(r.returnUrl)) { body["callback_url"] = r.returnUrl; body["callback_method"] = "get"; }
        const res = await f("https://api.razorpay.com/v1/payment_links", { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const out = (await jsonOrText(res)) as { id?: string; short_url?: string };
        if (!res.ok || !out.short_url) throw new Error(errorText(out, `Razorpay error ${res.status}`));
        return { url: out.short_url, providerRef: out.id ?? "" };
      },
    };
  }
  if (pick === "stripe" && s.stripe?.["secretKey"]) {
    return {
      name: "stripe", sandbox: false,
      async createLink(r) {
        if (!absolute(r.returnUrl)) throw new ProviderNotConfigured("payments", "Stripe needs your app's public https address. Set it in Settings → Company (App address)");
        const form = new URLSearchParams({
          mode: "payment", success_url: r.returnUrl, cancel_url: r.returnUrl, client_reference_id: r.token, "metadata[token]": r.token,
          "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": r.currency.toLowerCase(), "line_items[0][price_data][unit_amount]": String(r.amount),
          "line_items[0][price_data][product_data][name]": r.description.slice(0, 120),
        });
        if (r.customer.email) form.set("customer_email", r.customer.email);
        const res = await f("https://api.stripe.com/v1/checkout/sessions", { method: "POST", headers: { Authorization: `Bearer ${s.stripe!["secretKey"]}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form });
        const out = (await jsonOrText(res)) as { id?: string; url?: string };
        if (!res.ok || !out.url) throw new Error(errorText(out, `Stripe error ${res.status}`));
        return { url: out.url, providerRef: out.id ?? "" };
      },
    };
  }
  if (pick === "paypal" && s.paypal?.["clientId"] && s.paypal["clientSecret"]) {
    const pp = paypalClient(s, f);
    return {
      name: "paypal", sandbox: false,
      async createLink(r) {
        if (!absolute(r.returnUrl)) throw new ProviderNotConfigured("payments", "PayPal needs your app's public https address. Set it in Settings → Company (App address)");
        const token = await pp.token();
        const res = await f(`${pp.base}/v2/checkout/orders`, {
          method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ reference_id: r.token, custom_id: r.token, description: r.description.slice(0, 127), amount: { currency_code: r.currency, value: (r.amount / 100).toFixed(2) } }], application_context: { return_url: r.returnUrl, cancel_url: r.returnUrl, user_action: "PAY_NOW" } }),
        });
        const out = (await jsonOrText(res)) as { id?: string; links?: { rel: string; href: string }[] };
        const approve = out.links?.find((l) => l.rel === "approve" || l.rel === "payer-action")?.href;
        if (!res.ok || !approve) throw new Error(errorText(out, `PayPal error ${res.status}`));
        return { url: approve, providerRef: out.id ?? "" };
      },
    };
  }
  return unconfiguredProviders().payments;
}

export function paypalClient(s: Secrets, f: FetchLike) {
  const base = s.paypal?.["mode"] === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
  return {
    base,
    async token(): Promise<string> {
      const auth = Buffer.from(`${s.paypal!["clientId"]}:${s.paypal!["clientSecret"]}`).toString("base64");
      const r = await f(`${base}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
      const out = (await r.json()) as { access_token?: string };
      if (!out.access_token) throw new Error("PayPal sign-in failed — check the client ID and secret.");
      return out.access_token;
    },
  };
}

/* ───────────────────────── flights (Amadeus) ───────────────────────── */

function flights(s: Secrets, f: FetchLike): Providers["flights"] {
  const a = s.amadeus;
  if (!a?.["clientId"] || !a["clientSecret"]) return unconfiguredProviders().flights;
  const base = a["mode"] === "production" ? "https://api.amadeus.com" : "https://test.api.amadeus.com";
  let cached: { token: string; until: number } | null = null;
  const token = async () => {
    if (cached && cached.until > Date.now()) return cached.token;
    const r = await f(`${base}/v1/security/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "client_credentials", client_id: a["clientId"]!, client_secret: a["clientSecret"]! }) });
    const out = (await r.json()) as { access_token?: string; expires_in?: number };
    if (!out.access_token) throw new Error("Amadeus sign-in failed — check the API key and secret.");
    cached = { token: out.access_token, until: Date.now() + ((out.expires_in ?? 1700) - 60) * 1000 };
    return cached.token;
  };
  type AmadeusOffer = { id: string; numberOfBookableSeats?: number; itineraries: { duration: string; segments: { departure: { iataCode: string; at: string }; arrival: { iataCode: string; at: string }; carrierCode: string; number: string }[] }[]; price: { grandTotal: string; currency: string }; pricingOptions?: { refundableFare?: boolean }; travelerPricings?: { fareDetailsBySegment?: { includedCheckedBags?: { weight?: number; quantity?: number } }[] }[] };
  const raw = new Map<string, AmadeusOffer>();
  const search = async (q: FlightQuery): Promise<FlightOffer[]> => {
    const cls = q.cabin === "business" ? "BUSINESS" : q.cabin === "premium" ? "PREMIUM_ECONOMY" : "ECONOMY";
    const params = new URLSearchParams({ originLocationCode: q.from, destinationLocationCode: q.to, departureDate: q.date, adults: String(q.adults), travelClass: cls, currencyCode: "INR", max: "20" });
    if (q.children) params.set("children", String(q.children));
    const r = await f(`${base}/v2/shopping/flight-offers?${params}`, { headers: { Authorization: `Bearer ${await token()}` } });
    const out = (await jsonOrText(r)) as { data?: AmadeusOffer[]; dictionaries?: { carriers?: Record<string, string> } };
    if (!r.ok) throw new Error(errorText(out, `Amadeus error ${r.status}`));
    return (out.data ?? []).map((o) => {
      const segs = o.itineraries[0]!.segments;
      const first = segs[0]!, last = segs[segs.length - 1]!;
      const id = `amd~${q.from}~${q.to}~${q.date}~${segs.map((x) => `${x.carrierCode}${x.number}@${x.departure.at}`).join("+")}~${q.cabin}`;
      raw.set(id, o);
      const bags = o.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.includedCheckedBags;
      return {
        id, provider: "amadeus", airline: first.carrierCode, airlineName: out.dictionaries?.carriers?.[first.carrierCode] ?? first.carrierCode, flightNo: `${first.carrierCode} ${first.number}`,
        from: first.departure.iataCode, to: last.arrival.iataCode, departAt: new Date(first.departure.at).toISOString(), arriveAt: new Date(last.arrival.at).toISOString(),
        durationMin: Math.round((new Date(last.arrival.at).getTime() - new Date(first.departure.at).getTime()) / 60_000), stops: segs.length - 1, cabin: q.cabin,
        baggage: bags?.weight ? `${bags.weight} kg check-in` : bags?.quantity ? `${bags.quantity} checked bag(s)` : "As per fare rules", refundable: Boolean(o.pricingOptions?.refundableFare),
        seatsLeft: o.numberOfBookableSeats ?? 9, currency: o.price.currency, netFare: Math.round(Number(o.price.grandTotal) * 100), adults: q.adults, children: q.children,
      };
    });
  };
  return {
    name: "amadeus", sandbox: false, search,
    async reprice(offerId, q) {
      const offers = await search(q);
      return offers.find((o) => o.id === offerId) ?? null;
    },
    async book(o, passengers, contact) {
      const offer = raw.get(o.id);
      if (!offer) throw new Error("The fare must be searched again before ticketing.");
      const priced = await f(`${base}/v1/shopping/flight-offers/pricing`, { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ data: { type: "flight-offers-pricing", flightOffers: [offer] } }) });
      const pOut = (await jsonOrText(priced)) as { data?: { flightOffers?: unknown[] } };
      if (!priced.ok) throw new Error(errorText(pOut, "Fare could not be confirmed"));
      // Passenger strings: "Full Name|YYYY-MM-DD|M" (date of birth and gender are required by airlines)
      const travelers = passengers.map((p, k) => {
        const [full, dob, gender] = p.split("|").map((x) => x.trim());
        if (!dob || !gender) throw new Error("Each traveller's date of birth and gender are needed to ticket. Collect them and ticket from the booking.");
        const parts = full!.split(/\s+/);
        return { id: String(k + 1), dateOfBirth: dob, gender: /^f/i.test(gender) ? "FEMALE" : "MALE", name: { firstName: parts.slice(0, -1).join(" ") || parts[0], lastName: parts.length > 1 ? parts[parts.length - 1] : parts[0] }, contact: { emailAddress: contact.email || undefined, phones: contact.phone ? [{ deviceType: "MOBILE", countryCallingCode: intlPhone(contact.phone).slice(0, 2), number: digits(contact.phone).slice(-10) }] : undefined } };
      });
      const order = await f(`${base}/v1/booking/flight-orders`, { method: "POST", headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ data: { type: "flight-order", flightOffers: pOut.data?.flightOffers ?? [offer], travelers } }) });
      const oOut = (await jsonOrText(order)) as { data?: { associatedRecords?: { reference: string }[] } };
      if (!order.ok) throw new Error(errorText(oOut, `Flight order failed (${order.status})`));
      return { pnr: oOut.data?.associatedRecords?.[0]?.reference ?? "", ticketNos: [], status: "booked" };
    },
  };
}

/* ───────────────────────── AI (Claude) ───────────────────────── */

function ai(s: Secrets, f: FetchLike): Providers["ai"] {
  const key = s.anthropic?.["apiKey"];
  if (!key) return unconfiguredProviders().ai;
  const model = s.anthropic?.["model"] || "claude-sonnet-5-5";
  return {
    name: "claude", sandbox: false,
    async complete(r) {
      try {
        const res = await f("https://api.anthropic.com/v1/messages", {
          method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
          body: JSON.stringify({ model, max_tokens: r.maxTokens ?? 1000, system: r.system, messages: [{ role: "user", content: r.prompt }] }),
        });
        if (!res.ok) return null; // fall back to the rule-based path
        const out = (await res.json()) as { content?: { type: string; text?: string }[] };
        return out.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") || null;
      } catch {
        return null;
      }
    },
  };
}

/* ───────────────────────── voice (Exotel) ───────────────────────── */

function voice(s: Secrets, f: FetchLike, statusCallback: string): Providers["voice"] {
  const e = s.exotel;
  if (!e?.["sid"] || !e["apiKey"] || !e["apiToken"] || !e["callerId"] || !e["flowUrl"]) return unconfiguredProviders().voice;
  const host = e["subdomain"] || "api.exotel.com";
  return {
    name: "exotel", sandbox: false,
    async call(r) {
      const auth = Buffer.from(`${e["apiKey"]}:${e["apiToken"]}`).toString("base64");
      const form = new URLSearchParams({ From: `0${digits(r.phone).slice(-10)}`, CallerId: e["callerId"]!, Url: e["flowUrl"]!, CustomField: r.script.slice(0, 900), StatusCallback: statusCallback });
      const res = await f(`https://${host}/v1/Accounts/${e["sid"]}/Calls/connect.json`, { method: "POST", headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" }, body: form });
      const out = (await jsonOrText(res)) as { Call?: { Sid?: string } };
      if (!res.ok) return { ok: false, status: "queued", outcome: errorText(out, `Exotel error ${res.status}`) };
      return { ok: true, status: "queued", ref: out.Call?.Sid ?? "", outcome: "Call placed — the result arrives from Exotel" };
    },
  };
}

/* ───────────────────────── assemble ───────────────────────── */

export function buildProviders(tenantId: string, s: Secrets, opts: { fetch?: FetchLike; publicApiUrl?: string } = {}): Providers {
  if (s.sandbox?.["enabled"] === "true") return sandboxProviders(tenantId);
  const f = opts.fetch ?? fetch;
  const callback = `${(opts.publicApiUrl ?? "").replace(/\/$/, "")}/api/v1/webhooks/${tenantId}/calls?key=${encodeURIComponent(s.calls?.["key"] ?? "")}`;
  return { messaging: messaging(s, f), payments: payments(s, f), flights: flights(s, f), ai: ai(s, f), voice: voice(s, f, callback), pan: unconfiguredProviders().pan };
}

/* ───────────────────────── webhook signature checks ───────────────────────── */

export function hmacHex(secret: string, data: string): string {
  return createHmac("sha256", secret).update(data).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Stripe-Signature: "t=<unix>,v1=<hex>" signed over "<t>.<raw body>"; rejects events older than 5 minutes. */
export function verifyStripe(raw: string, header: string | undefined, secret: string, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts["t"]);
  if (!t || Math.abs(nowSec - t) > 300) return false;
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  const expected = hmacHex(secret, `${t}.${raw}`);
  return sigs.some((s) => safeEqual(s, expected));
}
