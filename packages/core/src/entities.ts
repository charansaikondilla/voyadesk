import { z } from "zod";
import { SERVICE_TYPES } from "./pricing.js";
import {
  BOOKING_STATUSES, INVOICE_STATUSES, LEAD_SOURCES, LEAD_STAGES, QUOTE_STATUSES, SERVICE_STATUSES, VISA_STATUSES,
} from "./rules.js";
import { isValidISODate } from "./dates.js";

/* Shared field validators */
const date = z.string().refine(isValidISODate, "Use a valid date (YYYY-MM-DD)");
const optDate = date.nullable().default(null);
const money = z.number().int("Amounts are stored in paise (whole numbers)").min(0, "Amount cannot be negative");
const bps = z.number().int().min(0).max(100_000);
const text = (max = 200) => z.string().trim().max(max);
const name = z.string().trim().min(1, "Required").max(160);
const email = z.string().trim().toLowerCase().email("Enter a valid email").or(z.literal("")).default("");
const phone = z.string().trim().regex(/^[+\d][\d\s-]{6,17}$/, "Enter a valid phone number").or(z.literal("")).default("");
const id = z.string().min(1).nullable().default(null);

export const ROLES = ["owner", "admin", "sales", "ops", "accounts", "visa", "marketing", "agent", "driver"] as const;
export type Role = (typeof ROLES)[number];

export const MODULES = ["sales", "itinerary", "operations", "finance", "marketing", "b2b", "visa", "ai", "portals"] as const;
export type ModuleKey = (typeof MODULES)[number];

/** What starts an automation. Event triggers run right after the action; time triggers run in the background job every minute. */
export const AUTOMATION_TRIGGERS = [
  "lead_created", "lead_stage_changed", "quote_sent", "quote_accepted", "booking_confirmed", "payment_received", "visa_status_changed",
  "lead_idle", "quote_idle", "invoice_overdue", "trip_upcoming", "trip_completed",
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];
export const AUTOMATION_TIME_TRIGGERS: readonly AutomationTrigger[] = ["lead_idle", "quote_idle", "invoice_overdue", "trip_upcoming", "trip_completed"];
/** Fields a condition can test (resolved from the subject and its linked lead). Money fields are in paise. */
export const AUTOMATION_FIELDS = ["source", "destination", "service", "stage", "temperature", "score", "budget", "amount", "ownerId", "pax", "status", "country"] as const;
export type AutomationField = (typeof AUTOMATION_FIELDS)[number];
export const AUTOMATION_STEPS = ["send_message", "send_payment_link", "create_task", "assign_owner", "set_temperature", "set_stage", "add_tag", "notify_owner"] as const;
export type AutomationStepKind = (typeof AUTOMATION_STEPS)[number];

export const BUSINESS_TYPES = ["b2c", "b2b_dmc", "portal", "visa"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const markupRule = z.object({
  kind: z.enum(["percent", "flat"]),
  value: z.number().int().min(0),
  per: z.enum(["unit", "person"]).default("unit"),
});

export const paxSchema = z.object({
  adults: z.number().int().min(1, "At least one adult").max(500).default(2),
  children: z.number().int().min(0).max(500).default(0),
  infants: z.number().int().min(0).max(100).default(0),
});

export const priceLine = z.object({
  id: z.string().min(1),
  type: z.enum(SERVICE_TYPES),
  title: text(160).min(1, "Give the service a name"),
  day: z.number().int().min(1).max(90).default(1),
  netCost: money,
  currency: z.string().length(3).default("INR"),
  quantity: z.number().int().min(1).max(999).default(1),
  perPerson: z.boolean().default(false),
  markup: markupRule.nullable().default(null),
  gstRateBps: bps.nullable().default(null),
  optional: z.boolean().default(false),
  selected: z.boolean().default(false),
  supplierId: id,
  notes: text(500).default(""),
  /** Itinerary option this line belongs to ("" = shared by every option, "A"/"B"/"C" = only that option). */
  option: z.string().max(2).default(""),
  /** Booking-engine reference, e.g. "series:sf_1", "allot:allot_1:2026-01-10:3:2", "flight:sandbox:<offer id>", "insp:insp_1". */
  ref: z.string().max(600).default(""),
});

const dayPlan = z.object({ title: text(120).default(""), description: text(2000).default(""), photoId: id });

/* ───────────── Collections ───────────── */

export const schemas = {
  users: z.object({
    name, email: z.string().trim().toLowerCase().email("Enter a valid email"), phone,
    role: z.enum(ROLES).default("sales"), active: z.boolean().default(true), agentId: id, title: text(80).default(""),
    /** For driver/guide logins: the resource whose jobs they see in the field app. */
    resourceId: id,
  }),
  contacts: z.object({
    kind: z.enum(["customer", "corporate"]).default("customer"), name, email, phone, city: text(80).default(""),
    pan: text(10).default(""), passportNo: text(20).default(""), dob: optDate, tags: z.array(text(40)).default([]),
    family: z.array(z.object({ name, relation: text(40).default(""), dob: optDate, passportNo: text(20).default("") })).default([]),
    preferences: text(1000).default(""), totalSpend: money.default(0), trips: z.number().int().min(0).default(0),
  }),
  agents: z.object({
    name, contactName: text(120).default(""), email, phone, city: text(80).default(""), gstin: text(15).default(""),
    slab: z.enum(["silver", "gold", "platinum"]).default("silver"), markupBps: bps.default(800),
    creditLimit: money.default(0), creditDays: z.number().int().min(0).max(180).default(15),
    blocked: z.boolean().default(false), brandName: text(120).default(""), currency: z.string().length(3).default("INR"),
    /** Commission on the pre-tax sell value of each booking (0 = the agent earns through slab markup only). */
    commissionBps: bps.default(0), brandPhone: text(20).default(""), brandEmail: text(160).default(""),
  }),
  suppliers: z.object({
    name, category: z.enum([...SERVICE_TYPES, "dmc"]).default("hotel"), city: text(80).default(""),
    country: text(80).default("India"), email, phone, contractNotes: text(2000).default(""),
    paymentTermsDays: z.number().int().min(0).max(180).default(7),
  }),
  hotels: z.object({
    name, city: text(80).min(1, "Required"), country: text(80).default("India"), stars: z.number().int().min(1).max(7).default(3),
    supplierId: id, description: text(2000).default(""),
    rates: z.array(z.object({
      roomType: text(80).min(1), mealPlan: z.enum(["EP", "CP", "MAP", "AP", "AI"]).default("CP"),
      season: z.enum(["regular", "peak"]).default("regular"), netPerNight: money, currency: z.string().length(3).default("INR"),
    })).default([]),
  }),
  sightseeing: z.object({
    name, city: text(80).min(1), country: text(80).default("India"), durationHours: z.number().min(0).max(240).default(4),
    netPerPerson: money, currency: z.string().length(3).default("INR"), supplierId: id, description: text(2000).default(""),
  }),
  transfers: z.object({
    name, city: text(80).min(1), country: text(80).default("India"), vehicle: text(60).default("Sedan"),
    capacity: z.number().int().min(1).max(60).default(3), netPerVehicle: money, currency: z.string().length(3).default("INR"),
    supplierId: id,
  }),
  packages: z.object({
    name, destination: text(80).min(1), country: text(80).default("India"), nights: z.number().int().min(1).max(60),
    theme: text(40).default("leisure"), days: z.array(dayPlan).default([]), inclusions: z.array(text(200)).default([]),
    exclusions: z.array(text(200)).default([]), startingPrice: money.default(0), published: z.boolean().default(false),
    scope: z.enum(["domestic", "overseas"]).default("domestic"), highlights: z.array(text(120)).default([]),
  }),
  visaMasters: z.object({
    country: name, visaType: text(80).default("Tourist"), processingDays: z.number().int().min(0).max(365).default(5),
    fee: money, serviceFee: money.default(0), validity: text(80).default(""), checklist: z.array(text(200)).default([]),
  }),
  leads: z.object({
    contactId: id, name, phone, email, source: z.enum(LEAD_SOURCES).default("other"),
    service: z.enum(["holiday", "visa", "flight", "hotel", "transfer"]).default("holiday"),
    destination: text(80).default(""), travelDate: optDate, nights: z.number().int().min(0).max(90).nullable().default(null),
    pax: paxSchema.default({ adults: 2, children: 0, infants: 0 }), budget: money.nullable().default(null),
    notes: text(4000).default(""), stage: z.enum(LEAD_STAGES).default("new"),
    temperature: z.enum(["hot", "warm", "cold"]).default("cold"), score: z.number().int().min(0).max(100).default(0),
    scoreReasons: z.array(z.string()).default([]), ownerId: id, agentId: id, lostReason: text(200).default(""),
    lastActivityAt: z.string().nullable().default(null), bookingId: id, campaignId: id,
  }),
  tasks: z.object({
    title: text(200).min(1, "Required"), dueAt: z.string().min(1), done: z.boolean().default(false), assigneeId: id,
    leadId: id, bookingId: id, visaCaseId: id, priority: z.enum(["low", "normal", "high"]).default("normal"),
  }),
  activities: z.object({
    leadId: id, bookingId: id, visaCaseId: id,
    kind: z.enum(["call", "whatsapp", "email", "note", "system", "quote_view", "payment"]).default("note"),
    direction: z.enum(["in", "out"]).nullable().default(null), body: text(4000).default(""), at: z.string().min(1),
    byId: id, durationSec: z.number().int().min(0).nullable().default(null),
  }),
  quotes: z.object({
    number: text(40).default(""), leadId: id, agentId: id, contactName: name, phone, email, title: text(160).default("Holiday proposal"),
    destination: text(80).default(""), scope: z.enum(["domestic", "overseas"]).default("domestic"), startDate: optDate,
    nights: z.number().int().min(0).max(90).default(0), pax: paxSchema.default({ adults: 2, children: 0, infants: 0 }),
    currency: z.string().length(3).default("INR"), fx: z.record(z.number().positive()).default({}),
    markupMode: z.enum(["overall", "per_component"]).default("overall"),
    packageMarkup: markupRule.default({ kind: "percent", value: 1000, per: "unit" }),
    taxBasis: z.enum(["cost_plus_markup", "markup_only"]).default("cost_plus_markup"), gstRateBps: bps.default(500),
    hasPan: z.boolean().default(true), priorFyAmount: money.default(0),
    discount: z.object({ kind: z.enum(["percent", "flat"]), value: z.number().int().min(0) }).nullable().default(null),
    couponCode: text(40).default(""), lines: z.array(priceLine).default([]), days: z.array(dayPlan).default([]),
    inclusions: z.array(text(200)).default([]), exclusions: z.array(text(200)).default([]),
    terms: text(4000).default("50% advance to confirm. Balance 15 days before travel. Rates subject to availability at the time of booking."),
    status: z.enum(QUOTE_STATUSES).default("draft"), version: z.number().int().min(1).default(1),
    shareToken: text(40).default(""), validUntil: optDate, views: z.number().int().min(0).default(0),
    total: money.default(0), bookingId: id, ownerId: id,
    /** Side-by-side itinerary options (Option A / B / C). Empty = a single itinerary. */
    options: z.array(z.object({ key: z.string().min(1).max(2), name: text(80).min(1) })).max(3).default([]),
    chosenOption: z.string().max(2).default(""),
  }),
  bookings: z.object({
    number: text(40).default(""), quoteId: id, leadId: id, agentId: id, contactName: name, phone, email,
    title: text(160).default(""), destination: text(80).default(""), startDate: date, endDate: date,
    pax: paxSchema, status: z.enum(BOOKING_STATUSES).default("confirmed"), currency: z.string().length(3).default("INR"),
    sellTotal: money.default(0), costTotal: money.default(0), invoiceId: id, ownerId: id, notes: text(4000).default(""),
    scope: z.enum(["domestic", "overseas"]).default("domestic"), groupDepartureId: id,
  }),
  services: z.object({
    bookingId: z.string().min(1), type: z.enum(SERVICE_TYPES), title: text(160).min(1), supplierId: id, date,
    endDate: optDate, confirmationNo: text(60).default(""), status: z.enum(SERVICE_STATUSES).default("pending"),
    netCost: money.default(0), voucherNo: text(40).default(""), notes: text(1000).default(""),
  }),
  resources: z.object({
    kind: z.enum(["driver", "guide", "vehicle"]), name, phone, city: text(80).default(""), active: z.boolean().default(true),
    details: text(200).default(""),
  }),
  assignments: z.object({
    serviceId: z.string().min(1), bookingId: z.string().min(1), resourceId: z.string().min(1), from: date, to: date,
    notifiedVia: z.enum(["whatsapp", "email", "app"]).default("whatsapp"),
    status: z.enum(["assigned", "started", "completed", "issue"]).default("assigned"),
    lastLat: z.number().min(-90).max(90).nullable().default(null), lastLng: z.number().min(-180).max(180).nullable().default(null),
    lastSeenAt: z.string().nullable().default(null),
  }),
  groupDepartures: z.object({
    packageId: id, name, departureDate: date, seats: z.number().int().min(1).max(1000), pricePerSeat: money,
    passengers: z.array(z.object({ name, phone, room: text(20).default(""), paid: z.boolean().default(false) })).default([]),
    status: z.enum(["open", "closed", "departed"]).default("open"),
  }),
  invoices: z.object({
    number: text(40).default(""), bookingId: id, partyType: z.enum(["customer", "agent"]).default("customer"), partyId: id,
    partyName: name, gstin: text(15).default(""), pan: text(10).default(""), placeOfSupply: text(80).default(""),
    supplierState: text(80).default(""), scope: z.enum(["domestic", "overseas"]).default("domestic"), issueDate: date,
    dueDate: date, currency: z.string().length(3).default("INR"),
    lines: z.array(z.object({ description: text(300), sac: text(10).default(""), amount: money })).default([]),
    sell: money, gst: money, cgst: money.default(0), sgst: money.default(0), igst: money.default(0), tcs: money.default(0),
    total: money, paid: money.default(0), credited: money.default(0), status: z.enum(INVOICE_STATUSES).default("issued"),
  }),
  payments: z.object({
    invoiceId: id, partyType: z.enum(["customer", "agent", "supplier"]).default("customer"), partyId: id, partyName: name,
    amount: money.refine((v) => v > 0, "Amount must be more than zero"),
    method: z.enum(["upi", "card", "netbanking", "bank_transfer", "cash", "wallet", "cheque", "emi"]).default("upi"),
    gateway: z.enum(["razorpay", "stripe", "paypal", "manual", "sandbox"]).default("manual"), reference: text(80).default(""),
    date, direction: z.enum(["in", "out"]).default("in"), purpose: z.enum(["invoice", "wallet_topup", "supplier", "refund"]).default("invoice"),
  }),
  creditNotes: z.object({
    number: text(40).default(""), invoiceId: z.string().min(1), amount: money, reason: text(300).min(1, "Give a reason"),
    refundTo: z.enum(["none", "bank", "wallet"]).default("none"), date,
  }),
  supplierBills: z.object({
    supplierId: z.string().min(1), supplierName: text(160).default(""), bookingId: id, amount: money, dueDate: date,
    paid: money.default(0), status: z.enum(["open", "partially_paid", "paid"]).default("open"), reference: text(80).default(""),
  }),
  ledger: z.object({
    txnId: z.string(), date, account: z.string(), partyType: z.enum(["customer", "agent", "supplier"]).nullable(),
    partyId: z.string().nullable(), partyName: z.string().nullable(), debit: money, credit: money, memo: z.string(),
    refType: z.string(), refId: z.string(),
  }),
  visaCases: z.object({
    number: text(40).default(""), contactName: name, phone, email, contactId: id, agentId: id, country: name,
    visaType: text(80).default("Tourist"), visaMasterId: id, travelDate: optDate,
    applicants: z.array(z.object({
      name, passportNo: text(20).default(""), nationality: text(3).default(""), dob: optDate, expiry: optDate,
      docs: z.array(z.object({ name: text(200), received: z.boolean().default(false) })).default([]),
    })).default([]),
    status: z.enum(VISA_STATUSES).default("enquiry"), assigneeId: id, fee: money.default(0), paid: money.default(0),
    notes: text(4000).default(""), uploadToken: text(40).default(""), decisionNote: text(1000).default(""), invoiceId: id,
  }),
  campaigns: z.object({
    name, channel: z.enum(["whatsapp", "email", "sms"]).default("whatsapp"), segmentId: id, message: text(2000).min(1, "Write the message"),
    status: z.enum(["draft", "scheduled", "sent"]).default("draft"), scheduledAt: z.string().nullable().default(null),
    sentCount: z.number().int().min(0).default(0), openCount: z.number().int().min(0).default(0),
    leadCount: z.number().int().min(0).default(0), cost: money.default(0),
  }),
  segments: z.object({
    name, description: text(300).default(""),
    rules: z.array(z.object({
      field: z.enum(["tag", "city", "trips", "totalSpend", "destination", "temperature"]),
      op: z.enum(["eq", "gte", "lte", "contains"]), value: z.string().min(1),
    })).default([]),
  }),
  coupons: z.object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,20}$/, "3–20 letters or digits"),
    kind: z.enum(["percent", "flat"]), value: z.number().int().min(1), validFrom: optDate, validTo: optDate,
    maxUses: z.number().int().min(0).default(0), uses: z.number().int().min(0).default(0), active: z.boolean().default(true),
  }),
  landingPages: z.object({
    title: name, slug: z.string().regex(/^[a-z0-9-]{3,60}$/, "lowercase-words-with-dashes"), packageId: id,
    headline: text(160).default(""), body: text(4000).default(""), published: z.boolean().default(false),
    leads: z.number().int().min(0).default(0),
  }),
  dripSequences: z.object({
    name, trigger: z.enum(["new_lead", "quote_sent", "trip_completed", "no_reply_3d"]),
    steps: z.array(z.object({ afterDays: z.number().int().min(0).max(365), channel: z.enum(["whatsapp", "email", "sms"]), message: text(2000) })).default([]),
    active: z.boolean().default(true),
  }),
  taxRules: z.object({
    appliesTo: text(40).min(1), scope: z.enum(["domestic", "overseas", "*"]), rateBps: bps,
    basis: z.enum(["cost_plus_markup", "markup_only"]), sac: text(10).default(""), effectiveFrom: date, effectiveTo: optDate,
    note: text(400).default(""),
  }),
  tcsRules: z.object({
    effectiveFrom: date, effectiveTo: optDate, thresholdMinor: money.nullable(), rateBelowBps: bps, rateAboveBps: bps,
    noPanRateBps: bps.nullable(), note: text(400).default(""),
  }),
  /* ───────────── Automations (When → If → Then) and marketing spend ───────────── */
  automations: z.object({
    name, description: text(300).default(""),
    trigger: z.enum(AUTOMATION_TRIGGERS),
    /** Time-based triggers: idle for N days, N days before travel, overdue by N days, N days after the trip. Ignored by event triggers. */
    days: z.number().int().min(0).max(365).default(0),
    conditions: z.array(z.object({
      field: z.enum(AUTOMATION_FIELDS), op: z.enum(["eq", "neq", "gte", "lte", "contains"]), value: z.string().trim().min(1, "Enter a value").max(120),
    })).default([]),
    steps: z.array(z.object({
      kind: z.enum(AUTOMATION_STEPS),
      channel: z.enum(["whatsapp", "email", "sms"]).default("whatsapp"),
      /** send_message / send_payment_link / notify_owner text; placeholders {name} {destination} {company} {link} {amount} {owner} {date}. */
      message: text(2000).default(""),
      /** create_task title, or the tag for add_tag. */
      title: text(200).default(""),
      /** set_temperature / set_stage target value. */
      value: text(40).default(""),
      /** assign_owner / create_task assignee; null = round-robin (assign) or the record owner (task). */
      userId: id,
      dueInDays: z.number().int().min(0).max(60).default(0),
    })).min(1, "Add at least one action").max(10),
    active: z.boolean().default(true),
    /** Key of the built-in recipe this was installed from, if any. */
    template: text(60).default(""),
    runs: z.number().int().min(0).default(0), lastRunAt: z.string().nullable().default(null),
  }),
  automationRuns: z.object({
    automationId: z.string().min(1), automationName: text(160).default(""), trigger: z.enum(AUTOMATION_TRIGGERS),
    subjectType: z.enum(["lead", "quote", "booking", "invoice", "visaCase"]), subjectId: z.string().min(1), subjectName: text(160).default(""),
    status: z.enum(["done", "partial", "skipped", "failed"]),
    steps: z.array(z.object({ kind: z.enum(AUTOMATION_STEPS), ok: z.boolean(), detail: text(300).default("") })).default([]),
    error: text(300).default(""), at: z.string().min(1),
    /** Idempotency key: the same automation never runs twice for the same subject and event. */
    key: text(240).min(1),
  }),
  channelSpend: z.object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use YYYY-MM"), source: z.enum(LEAD_SOURCES), amount: money, note: text(300).default(""),
  }),
  routingRules: z.object({
    name, service: z.enum(["any", "holiday", "visa", "flight", "hotel", "transfer"]).default("any"),
    destination: text(80).default(""), assigneeIds: z.array(z.string()).min(1, "Pick at least one person"),
    cursor: z.number().int().min(0).default(0), active: z.boolean().default(true),
  }),
  messages: z.object({
    channel: z.enum(["whatsapp", "email", "web_chat"]).default("whatsapp"), from: text(120).default(""), phone,
    body: text(4000).min(1), at: z.string().min(1), leadId: id, direction: z.enum(["in", "out"]),
    handledBy: z.enum(["bot", "human"]).nullable().default(null), read: z.boolean().default(false),
  }),
  settings: z.object({
    companyName: name, legalName: text(160).default(""), gstin: text(15).default(""), pan: text(10).default(""),
    state: text(80).default("Maharashtra"), address: text(400).default(""), phone, email,
    brandColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#1d5fd1"), website: text(120).default(""),
    timezone: z.string().default("Asia/Kolkata"), baseCurrency: z.string().length(3).default("INR"),
    invoicePrefix: text(10).default("INV"), quotePrefix: text(10).default("QT"), bookingPrefix: text(10).default("FILE"),
    businessTypes: z.array(z.enum(BUSINESS_TYPES)).default(["b2c"]),
    modules: z.record(z.enum(MODULES), z.boolean()).default({}),
    defaultMarkupBps: bps.default(1000),
    gateways: z.object({ razorpay: z.boolean().default(false), stripe: z.boolean().default(false), paypal: z.boolean().default(false) }).default({}),
    integrations: z.record(z.string(), z.boolean()).default({}),
    onboarding: z.record(z.string(), z.boolean()).default({}),
    fx: z.record(z.number().positive()).default({ USD: 84, EUR: 91, AED: 22.9, GBP: 107, THB: 2.45, SGD: 63 }),
    emiPlans: z.array(z.object({ months: z.number().int().min(2).max(36), rateBps: bps })).default([{ months: 3, rateBps: 0 }, { months: 6, rateBps: 1300 }, { months: 9, rateBps: 1400 }, { months: 12, rateBps: 1500 }]),
    holdHours: z.number().int().min(1).max(168).default(48),
    autoFollowUps: z.boolean().default(true),
    paymentReminders: z.boolean().default(true),
    languages: z.array(z.enum(["en", "hi", "ar"])).default(["en", "hi", "ar"]),
    advancePercent: z.number().int().min(0).max(100).default(30),
    /** Public address of this app (e.g. https://crm.youragency.in/) used in links inside WhatsApp and email messages. */
    appUrl: text(200).default(""),
    flightMarkupBps: bps.default(300),
  }),

  /* ───────────── Messaging, payments, files ───────────── */
  outbox: z.object({
    channel: z.enum(["whatsapp", "email", "sms"]), to: text(200).min(1), subject: text(200).default(""), body: text(4000).min(1),
    kind: z.enum(["campaign", "drip", "reminder", "notification", "followup", "otp", "chat"]).default("notification"),
    status: z.enum(["draft", "queued", "sent", "delivered", "read", "failed", "skipped"]).default("queued"),
    provider: text(40).default(""), providerRef: text(120).default(""), error: text(300).default(""), attempts: z.number().int().min(0).default(0),
    scheduledAt: z.string().nullable().default(null), sentAt: z.string().nullable().default(null),
    leadId: id, bookingId: id, visaCaseId: id, campaignId: id, contactId: id, invoiceId: id, dripId: id, dripStep: z.number().int().min(0).nullable().default(null),
  }),
  files: z.object({
    name: text(200).min(1), mime: text(100).min(1), size: z.number().int().min(1).max(8_000_000), dataUrl: z.string().min(10).max(11_000_000),
    ownerType: z.enum(["contact", "visaCase", "booking", "package", "quote", "claim", "other"]), ownerId: id, label: text(200).default(""),
    uploadedVia: z.enum(["staff", "customer", "agent"]).default("staff"), applicantIndex: z.number().int().min(0).nullable().default(null),
  }),
  paymentLinks: z.object({
    purpose: z.enum(["invoice", "proposal", "visa", "policy"]), invoiceId: id, quoteId: id, visaCaseId: id, policyId: id,
    amount: money.refine((v) => v > 0, "Amount must be more than zero"), currency: z.string().length(3).default("INR"),
    provider: z.enum(["sandbox", "razorpay", "stripe", "paypal"]), url: text(600).default(""), providerRef: text(120).default(""),
    token: text(40).min(8), status: z.enum(["created", "paid", "expired", "cancelled"]).default("created"), paidAt: z.string().nullable().default(null),
    method: text(20).default(""), emiMonths: z.number().int().min(0).max(36).default(0), customerName: text(160).default(""), phone, email,
    expiresAt: z.string().nullable().default(null), optionKey: z.string().max(2).default(""), selectedOptionalIds: z.array(z.string()).default([]),
  }),
  holds: z.object({
    quoteId: z.string().min(1), contactName: name, phone, amount: money, holdUntil: z.string().min(1),
    status: z.enum(["held", "converted", "expired", "released"]).default("held"), optionKey: z.string().max(2).default(""),
  }),
  tcsPayers: z.object({
    invoiceId: z.string().min(1), name, pan: z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "PAN looks wrong (e.g. ABCDE1234F)"),
    relation: text(40).default(""), amount: money, verified: z.boolean().default(false), verifiedName: text(160).default(""), verifyNote: text(200).default(""),
  }),

  /* ───────────── Booking engines and inventory ───────────── */
  seriesFares: z.object({
    airline: text(60).min(1), flightNo: text(12).min(1), from: z.string().trim().toUpperCase().length(3, "3-letter airport code"),
    to: z.string().trim().toUpperCase().length(3, "3-letter airport code"), departDate: date, departTime: text(5).default("06:00"), arriveTime: text(5).default("09:00"),
    returnFlightNo: text(12).default(""), returnDate: optDate, seats: z.number().int().min(1).max(500), sold: z.number().int().min(0).default(0),
    netFare: money, sellFare: money, baggage: text(60).default("15 kg check-in, 7 kg cabin"), pnr: text(12).default(""), supplierId: id,
    status: z.enum(["open", "closed"]).default("open"),
    passengers: z.array(z.object({ name, phone, bookingId: id })).default([]),
  }),
  allotments: z.object({
    hotelId: z.string().min(1), roomType: text(80).min(1), from: date, to: date, rooms: z.number().int().min(1).max(500),
    booked: z.record(z.number().int().min(0)).default({}), releaseDays: z.number().int().min(0).max(60).default(7),
  }),
  flightOrders: z.object({
    provider: text(40), offerId: text(600), airline: text(60), flightNo: text(20), from: text(3), to: text(3), departAt: z.string(), arriveAt: z.string(),
    cabin: text(20).default("economy"), passengers: z.array(z.object({ name })).default([]), netFare: money, currency: z.string().length(3).default("INR"),
    pnr: text(12).default(""), ticketNos: z.array(text(20)).default([]), status: z.enum(["booked", "ticketed", "cancelled", "failed"]).default("booked"),
    bookingId: id, quoteId: id, error: text(300).default(""),
  }),
  insurancePlans: z.object({
    name, insurer: text(120).min(1), region: z.enum(["domestic", "asia", "worldwide", "schengen"]).default("asia"), sumInsured: money,
    premiumPerDay: money, minPremium: money.default(0), maxAge: z.number().int().min(1).max(100).default(70),
    benefits: z.array(text(200)).default([]), active: z.boolean().default(true),
  }),
  policies: z.object({
    number: text(40).default(""), planId: z.string().min(1), planName: text(160).default(""), contactName: name, phone, email, contactId: id,
    travellers: z.array(z.object({ name, dob: optDate })).min(1), from: date, to: date, destination: text(80).default(""), premium: money,
    status: z.enum(["issued", "cancelled"]).default("issued"), bookingId: id, agentId: id,
  }),
  claims: z.object({
    number: text(40).default(""), policyId: z.string().min(1), policyNumber: text(40).default(""), contactName: name,
    type: z.enum(["medical", "baggage", "cancellation", "delay", "other"]).default("medical"), amount: money, description: text(2000).min(1, "Describe what happened"),
    status: z.enum(["submitted", "in_review", "approved", "rejected", "paid"]).default("submitted"), decisionNote: text(1000).default(""),
    fileIds: z.array(z.string()).default([]),
  }),
  vehicleRates: z.object({
    name, city: text(80).default(""), capacity: z.number().int().min(1).max(60), perDay: money, perKm: money.default(0),
    kmIncludedPerDay: z.number().int().min(0).max(2000).default(250), allowancePerDay: money.default(0), currency: z.string().length(3).default("INR"),
  }),

  /* ───────────── Sales, calls, inbox, B2B ───────────── */
  calls: z.object({
    phone: text(20).min(1), name: text(160).default(""), direction: z.enum(["in", "out"]),
    status: z.enum(["answered", "missed", "no_answer", "busy", "voicemail", "queued"]).default("answered"),
    durationSec: z.number().int().min(0).default(0), startedAt: z.string().min(1), recordingUrl: z.string().max(3_000_000).default(""),
    leadId: id, contactId: id, userId: id, source: z.enum(["sim", "ivr", "ai_voice", "manual"]).default("ivr"), provider: text(40).default(""),
    outcome: text(300).default(""), transcript: text(8000).default(""), callbackTaskId: id, script: text(2000).default(""), providerRef: text(120).default(""),
  }),
  chatThreads: z.object({
    phone: text(60).min(1), name: text(160).default(""), channel: z.enum(["whatsapp", "email", "web_chat"]).default("whatsapp"), ownerId: id,
    status: z.enum(["open", "closed"]).default("open"), leadId: id,
    notes: z.array(z.object({ byId: z.string(), byName: text(120).default(""), at: z.string(), body: text(2000) })).default([]),
  }),
  amendments: z.object({
    number: text(40).default(""), bookingId: z.string().min(1), reason: text(500).min(1, "Say why the booking is changing"),
    changes: z.array(z.object({
      kind: z.enum(["add", "change", "remove"]), serviceId: id, type: z.enum(SERVICE_TYPES).default("other"), title: text(160).default(""),
      date: optDate, netCost: money.default(0), sell: money.default(0), supplierId: id,
    })).min(1, "Add at least one change"),
    costImpact: z.number().int(), sellImpact: z.number().int(), gstImpact: z.number().int().default(0),
    status: z.enum(["pending", "approved", "rejected"]).default("pending"), requestedById: id, decidedById: id, decisionNote: text(500).default(""),
    invoiceId: id, creditNoteId: id,
  }),
  commissions: z.object({
    agentId: z.string().min(1), bookingId: z.string().min(1), bookingNumber: text(40).default(""), basis: money, rateBps: bps, amount: money,
    status: z.enum(["accrued", "paid", "reversed"]).default("accrued"), paidAt: z.string().nullable().default(null),
  }),
  customerSessions: z.object({
    contactId: z.string().min(1), login: text(160).min(1), codeHash: text(128).default(""), codeExpires: z.string().nullable().default(null),
    attempts: z.number().int().min(0).default(0), tokenHash: text(128).default(""), tokenExpires: z.string().nullable().default(null),
  }),
} as const;

export type Collection = keyof typeof schemas;
export const COLLECTIONS = Object.keys(schemas) as Collection[];

export interface Meta {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export type Input<C extends Collection> = z.input<(typeof schemas)[C]>;
export type Entity<C extends Collection> = z.output<(typeof schemas)[C]> & Meta;

export type User = Entity<"users">;
export type Contact = Entity<"contacts">;
export type Agent = Entity<"agents">;
export type Supplier = Entity<"suppliers">;
export type Hotel = Entity<"hotels">;
export type Sightseeing = Entity<"sightseeing">;
export type Transfer = Entity<"transfers">;
export type Package = Entity<"packages">;
export type VisaMaster = Entity<"visaMasters">;
export type Lead = Entity<"leads">;
export type Task = Entity<"tasks">;
export type Activity = Entity<"activities">;
export type Quote = Entity<"quotes">;
export type Booking = Entity<"bookings">;
export type Service = Entity<"services">;
export type Resource = Entity<"resources">;
export type AssignmentRow = Entity<"assignments">;
export type GroupDeparture = Entity<"groupDepartures">;
export type Invoice = Entity<"invoices">;
export type Payment = Entity<"payments">;
export type CreditNote = Entity<"creditNotes">;
export type SupplierBill = Entity<"supplierBills">;
export type LedgerRow = Entity<"ledger">;
export type VisaCase = Entity<"visaCases">;
export type Campaign = Entity<"campaigns">;
export type Segment = Entity<"segments">;
export type Coupon = Entity<"coupons">;
export type LandingPage = Entity<"landingPages">;
export type DripSequence = Entity<"dripSequences">;
export type TaxRuleRow = Entity<"taxRules">;
export type TcsRuleRow = Entity<"tcsRules">;
export type RoutingRule = Entity<"routingRules">;
export type Automation = Entity<"automations">;
export type AutomationRun = Entity<"automationRuns">;
export type ChannelSpend = Entity<"channelSpend">;
export type Message = Entity<"messages">;
export type Settings = Entity<"settings">;
export type Outbox = Entity<"outbox">;
export type FileRow = Entity<"files">;
export type PaymentLink = Entity<"paymentLinks">;
export type Hold = Entity<"holds">;
export type SeriesFare = Entity<"seriesFares">;
export type Allotment = Entity<"allotments">;
export type FlightOrder = Entity<"flightOrders">;
export type InsurancePlan = Entity<"insurancePlans">;
export type Policy = Entity<"policies">;
export type Claim = Entity<"claims">;
export type VehicleRate = Entity<"vehicleRates">;
export type Call = Entity<"calls">;
export type ChatThread = Entity<"chatThreads">;
export type Amendment = Entity<"amendments">;
export type Commission = Entity<"commissions">;
export type PriceLineInput = z.input<typeof priceLine>;

export const ID_PREFIX: Record<Collection, string> = {
  users: "usr", contacts: "con", agents: "agt", suppliers: "sup", hotels: "htl", sightseeing: "sgt", transfers: "trf",
  packages: "pkg", visaMasters: "vsm", leads: "lead", tasks: "task", activities: "act", quotes: "qt", bookings: "bk",
  services: "svc", resources: "res", assignments: "asg", groupDepartures: "grp", invoices: "inv", payments: "pay",
  creditNotes: "cn", supplierBills: "sb", ledger: "led", visaCases: "visa", campaigns: "cmp", segments: "seg",
  coupons: "cpn", landingPages: "lp", dripSequences: "drip", taxRules: "tax", tcsRules: "tcs", routingRules: "rr", automations: "auto", automationRuns: "arun", channelSpend: "spend",
  messages: "msg", settings: "set", outbox: "out", files: "file", paymentLinks: "plink", holds: "hold", tcsPayers: "tcsp",
  seriesFares: "sf", allotments: "allot", flightOrders: "fo", insurancePlans: "insp", policies: "pol", claims: "clm", vehicleRates: "veh",
  calls: "call", chatThreads: "thr", amendments: "amd", commissions: "com", customerSessions: "cs",
};

/** Turn a Zod error into one readable sentence per field. */
export function formatZodError(err: z.ZodError): { message: string; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!fields[key]) fields[key] = issue.message;
  }
  const first = Object.entries(fields)[0];
  const message = first ? (first[0] === "_" ? first[1] : `${humanize(first[0])}: ${first[1]}`) : "Invalid input";
  return { message, fields };
}

function humanize(path: string): string {
  const last = path.split(".").filter((p) => !/^\d+$/.test(p)).pop() ?? path;
  return last.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}
