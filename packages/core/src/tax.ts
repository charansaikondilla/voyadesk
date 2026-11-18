import { applyBps, type Minor } from "./money.js";
import { type ISODate } from "./dates.js";

/**
 * Tax rules are DATA, not code: rates change with each Budget, so every rule carries
 * the dates it applies to. Defaults below were checked in November 2026.
 * Always confirm current rates with a chartered accountant before invoicing customers.
 */

export type TaxBasis = "cost_plus_markup" | "markup_only";
export type TripScope = "domestic" | "overseas";

export interface GstRule {
  id: string;
  /** "package" = bundled tour sold at one gross price; otherwise a service type, or "*" for any. */
  appliesTo: string;
  scope: TripScope | "*";
  rateBps: number;
  basis: TaxBasis;
  sac: string;
  effectiveFrom: ISODate;
  effectiveTo: ISODate | null;
  note: string;
}

export interface TcsRule {
  id: string;
  effectiveFrom: ISODate;
  effectiveTo: ISODate | null;
  /** Amount per buyer per financial year up to which `rateBelowBps` applies; null = no threshold. */
  thresholdMinor: Minor | null;
  rateBelowBps: number;
  rateAboveBps: number;
  /** Rate used when the buyer has no PAN on file; null = same as normal rate. */
  noPanRateBps: number | null;
  note: string;
}

export const DEFAULT_GST_RULES: GstRule[] = [
  {
    id: "gst_package", appliesTo: "package", scope: "*", rateBps: 500, basis: "cost_plus_markup", sac: "998555",
    effectiveFrom: "2017-07-01", effectiveTo: null,
    note: "Tour operator services billed as one gross package price: 5% without input tax credit (SAC 998555, tour operator services).",
  },
  {
    id: "gst_service_fee", appliesTo: "*", scope: "*", rateBps: 1800, basis: "markup_only", sac: "998559",
    effectiveFrom: "2017-07-01", effectiveTo: null,
    note: "Agent acting as intermediary for flights, hotels or other services: 18% on the service fee / markup only (SAC 998559; use 998551/998552 for transport/accommodation reservations if your CA prefers).",
  },
];

export const DEFAULT_TCS_RULES: TcsRule[] = [
  {
    id: "tcs_2023", effectiveFrom: "2023-10-01", effectiveTo: "2025-03-31",
    thresholdMinor: 700_000_00, rateBelowBps: 500, rateAboveBps: 2000, noPanRateBps: 1000,
    note: "Overseas tour packages: 5% up to ₹7 lakh per FY, 20% above.",
  },
  {
    id: "tcs_2025", effectiveFrom: "2025-04-01", effectiveTo: "2026-03-31",
    thresholdMinor: 1_000_000_00, rateBelowBps: 500, rateAboveBps: 2000, noPanRateBps: 1000,
    note: "Overseas tour packages: 5% up to ₹10 lakh per FY, 20% above (Budget 2025).",
  },
  {
    id: "tcs_2026", effectiveFrom: "2026-04-01", effectiveTo: null,
    thresholdMinor: null, rateBelowBps: 200, rateAboveBps: 200, noPanRateBps: 500,
    note: "Overseas tour packages: flat 2% from the first rupee, no threshold (Finance Act 2026). No-PAN rate: confirm with your CA.",
  },
];

function inForce(from: ISODate, to: ISODate | null, on: ISODate): boolean {
  return from <= on && (to === null || on <= to);
}

/** Pick the most specific GST rule in force on a date. */
export function resolveGst(
  appliesTo: string,
  scope: TripScope,
  on: ISODate,
  rules: GstRule[] = DEFAULT_GST_RULES,
): GstRule {
  const candidates = rules
    .filter((r) => inForce(r.effectiveFrom, r.effectiveTo, on))
    .filter((r) => r.appliesTo === appliesTo || r.appliesTo === "*")
    .filter((r) => r.scope === scope || r.scope === "*")
    .sort((a, b) => specificity(b, appliesTo, scope) - specificity(a, appliesTo, scope) || (a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  const rule = candidates[0];
  if (!rule) throw new Error(`No GST rule in force on ${on} for ${appliesTo} (${scope}). Add one in Settings → Tax rules.`);
  return rule;
}

function specificity(r: GstRule, appliesTo: string, scope: TripScope): number {
  return (r.appliesTo === appliesTo ? 2 : 0) + (r.scope === scope ? 1 : 0);
}

export interface TcsInput {
  /** Amount received for the overseas package (including GST). */
  amount: Minor;
  on: ISODate;
  /** Overseas package amount already billed to this buyer earlier in the same financial year. */
  priorFyAmount?: Minor;
  hasPan: boolean;
  rules?: TcsRule[];
}

export interface TcsResult {
  tcs: Minor;
  ruleId: string;
  /** Effective rate on this amount, in bps (for display). */
  effectiveBps: number;
  note: string;
}

export function computeTcs(input: TcsInput): TcsResult {
  const rules = input.rules ?? DEFAULT_TCS_RULES;
  const rule = rules.find((r) => inForce(r.effectiveFrom, r.effectiveTo, input.on));
  if (!rule) throw new Error(`No TCS rule in force on ${input.on}. Add one in Settings → Tax rules.`);
  const amount = Math.max(0, input.amount);
  if (amount === 0) return { tcs: 0, ruleId: rule.id, effectiveBps: 0, note: rule.note };
  if (!input.hasPan && rule.noPanRateBps !== null) {
    const tcs = applyBps(amount, rule.noPanRateBps);
    return { tcs, ruleId: rule.id, effectiveBps: rule.noPanRateBps, note: `${rule.note} Higher rate applied: no PAN on file.` };
  }
  let tcs: Minor;
  if (rule.thresholdMinor === null) {
    tcs = applyBps(amount, rule.rateBelowBps);
  } else {
    const prior = Math.max(0, input.priorFyAmount ?? 0);
    const roomBelow = Math.max(0, rule.thresholdMinor - prior);
    const below = Math.min(amount, roomBelow);
    const above = amount - below;
    tcs = applyBps(below, rule.rateBelowBps) + applyBps(above, rule.rateAboveBps);
  }
  return { tcs, ruleId: rule.id, effectiveBps: Math.round((tcs * 10_000) / amount), note: rule.note };
}

export interface GstSplit {
  cgst: Minor;
  sgst: Minor;
  igst: Minor;
}

/** Intra-state supply → CGST + SGST (half each); inter-state → IGST. */
export function splitGst(gst: Minor, supplierState: string, placeOfSupply: string): GstSplit {
  const same = supplierState.trim().toLowerCase() === placeOfSupply.trim().toLowerCase();
  if (!same) return { cgst: 0, sgst: 0, igst: gst };
  const cgst = Math.floor(gst / 2);
  return { cgst, sgst: gst - cgst, igst: 0 };
}

export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
  "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Andaman and Nicobar Islands", "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
  "Outside India",
];

/** Basic GSTIN shape check (15 chars: 2-digit state code, PAN, entity, Z, checksum). */
export function isValidGstin(gstin: string): boolean {
  return /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin.trim().toUpperCase());
}

export function isValidPan(pan: string): boolean {
  return /^[A-Z]{5}\d{4}[A-Z]$/.test(pan.trim().toUpperCase());
}
