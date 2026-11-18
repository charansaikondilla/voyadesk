import { daysBetween, rangesOverlap, type ISODate } from "./dates.js";
import { type Minor } from "./money.js";

/* ───────────────────────── Status machines ───────────────────────── */

export const LEAD_STAGES = ["new", "contacted", "quoted", "negotiation", "won", "lost"] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const QUOTE_STATUSES = ["draft", "sent", "viewed", "accepted", "rejected", "expired"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const BOOKING_STATUSES = ["confirmed", "in_progress", "completed", "cancelled"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export const SERVICE_STATUSES = ["pending", "requested", "confirmed", "cancelled"] as const;
export type ServiceStatus = (typeof SERVICE_STATUSES)[number];

export const INVOICE_STATUSES = ["issued", "partially_paid", "paid", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const VISA_STATUSES = [
  "enquiry", "docs_pending", "docs_received", "submitted", "in_process", "approved", "rejected", "delivered",
] as const;
export type VisaStatus = (typeof VISA_STATUSES)[number];

type Machine<S extends string> = Record<S, readonly S[]>;

export const LEAD_FLOW: Machine<LeadStage> = {
  new: ["contacted", "quoted", "lost"],
  contacted: ["quoted", "negotiation", "lost"],
  quoted: ["negotiation", "contacted", "won", "lost"],
  negotiation: ["quoted", "won", "lost"],
  won: [],
  lost: ["contacted"], // a lost lead can be revived
};

export const QUOTE_FLOW: Machine<QuoteStatus> = {
  draft: ["sent"],
  sent: ["viewed", "accepted", "rejected", "expired", "draft"],
  viewed: ["accepted", "rejected", "expired", "draft"],
  accepted: [],
  rejected: ["draft"],
  expired: ["draft"],
};

export const BOOKING_FLOW: Machine<BookingStatus> = {
  confirmed: ["in_progress", "cancelled", "completed"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export const SERVICE_FLOW: Machine<ServiceStatus> = {
  pending: ["requested", "confirmed", "cancelled"],
  requested: ["confirmed", "cancelled", "pending"],
  confirmed: ["cancelled"],
  cancelled: [],
};

export const VISA_FLOW: Machine<VisaStatus> = {
  enquiry: ["docs_pending", "rejected"],
  docs_pending: ["docs_received"],
  docs_received: ["submitted", "docs_pending"],
  submitted: ["in_process", "approved", "rejected"],
  in_process: ["approved", "rejected"],
  approved: ["delivered"],
  rejected: [],
  delivered: [],
};

export function canTransition<S extends string>(flow: Machine<S>, from: S, to: S): boolean {
  return from === to || (flow[from]?.includes(to) ?? false);
}

export function assertTransition<S extends string>(flow: Machine<S>, from: S, to: S, what: string): void {
  if (!canTransition(flow, from, to)) {
    const allowed = flow[from]?.join(", ") || "none (final state)";
    throw new DomainError(`${what} cannot move from "${from}" to "${to}". Allowed next: ${allowed}.`, 409);
  }
}

/** Error with an HTTP-style status the API and UI can show directly to users. */
export class DomainError extends Error {
  constructor(message: string, public readonly status = 400, public readonly details?: unknown) {
    super(message);
    this.name = "DomainError";
  }
}

/* ───────────────────────── Resource conflicts ───────────────────────── */

export interface Assignment {
  id: string;
  resourceId: string;
  from: ISODate;
  to: ISODate;
  serviceId: string;
}

/** Assignments of the same driver/guide/vehicle whose date ranges overlap the candidate. */
export function findConflicts(existing: Assignment[], candidate: Omit<Assignment, "id">): Assignment[] {
  if (candidate.to < candidate.from) throw new DomainError("Assignment end date is before its start date");
  return existing.filter(
    (a) => a.resourceId === candidate.resourceId && a.serviceId !== candidate.serviceId &&
      rangesOverlap(a.from, a.to, candidate.from, candidate.to),
  );
}

/* ───────────────────────── Lead scoring ───────────────────────── */

export const LEAD_SOURCES = [
  "whatsapp", "website", "meta_ads", "google_ads", "instagram", "ivr", "walk_in", "referral", "repeat", "b2b_agent", "email", "landing_page", "other",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

const SOURCE_POINTS: Record<LeadSource, number> = {
  referral: 20, repeat: 20, walk_in: 15, website: 15, whatsapp: 15, b2b_agent: 15, landing_page: 12,
  email: 10, meta_ads: 10, google_ads: 12, instagram: 10, ivr: 10, other: 5,
};

export interface ScoreInput {
  source: LeadSource;
  budget: Minor | null;
  payingPax: number;
  travelDate: ISODate | null;
  destination: string | null;
  phone: string | null;
  email: string | null;
  activityCount: number;
  today: ISODate;
}

export type Temperature = "hot" | "warm" | "cold";

/** Transparent rule-based score (0–100) with the reason for every point. */
export function scoreLead(i: ScoreInput): { score: number; temperature: Temperature; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const add = (pts: number, why: string) => {
    if (pts > 0) {
      score += pts;
      reasons.push(`+${pts} ${why}`);
    }
  };
  if (i.budget && i.budget > 0) {
    add(15, "budget shared");
    const perPax = i.budget / Math.max(1, i.payingPax);
    if (perPax >= 50_000_00) add(10, "high budget per traveller (₹50K+)");
    else if (perPax >= 20_000_00) add(5, "healthy budget per traveller (₹20K+)");
  }
  if (i.travelDate) {
    const d = daysBetween(i.today, i.travelDate);
    if (d >= 0 && d <= 45) add(20, "travelling within 45 days");
    else if (d > 45 && d <= 120) add(10, "travelling within 4 months");
  }
  add(SOURCE_POINTS[i.source] ?? 5, `source: ${i.source.replace("_", " ")}`);
  if (i.destination) add(10, "destination known");
  if (i.phone) add(5, "phone number");
  if (i.email) add(5, "email address");
  add(Math.min(15, i.activityCount * 3), "engagement so far");
  score = Math.min(100, score);
  const temperature: Temperature = score >= 65 ? "hot" : score >= 40 ? "warm" : "cold";
  return { score, temperature, reasons };
}

/* ───────────────────────── Aging ───────────────────────── */

export interface AgingItem {
  dueDate: ISODate;
  outstanding: Minor;
}

export interface AgingBuckets {
  notDue: Minor;
  d1_30: Minor;
  d31_60: Minor;
  d61_90: Minor;
  d90plus: Minor;
  total: Minor;
}

export function aging(items: AgingItem[], asOf: ISODate): AgingBuckets {
  const b: AgingBuckets = { notDue: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
  for (const it of items) {
    if (it.outstanding <= 0) continue;
    const overdue = daysBetween(it.dueDate, asOf);
    if (overdue <= 0) b.notDue += it.outstanding;
    else if (overdue <= 30) b.d1_30 += it.outstanding;
    else if (overdue <= 60) b.d31_60 += it.outstanding;
    else if (overdue <= 90) b.d61_90 += it.outstanding;
    else b.d90plus += it.outstanding;
    b.total += it.outstanding;
  }
  return b;
}
