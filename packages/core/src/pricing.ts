import { allocate, applyBps, assertInt, convert, roundHalfUp, sum, type Minor } from "./money.js";
import { computeTcs, type TaxBasis, type TcsRule } from "./tax.js";
import { type ISODate } from "./dates.js";

export const SERVICE_TYPES = [
  "hotel", "flight", "transfer", "sightseeing", "activity", "visa", "insurance", "meal", "other",
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

/** Percent markups use bps in `value`; flat markups use minor units. */
export interface MarkupRule {
  kind: "percent" | "flat";
  value: number;
  /** For flat markups: once per unit/package, or multiplied by paying travellers. */
  per: "unit" | "person";
}

export interface PriceLine {
  id: string;
  type: ServiceType;
  title: string;
  day: number;
  /** Net (supplier) cost of ONE unit, in `currency`. */
  netCost: Minor;
  currency: string;
  quantity: number;
  /** Multiply by paying travellers (adults + children). */
  perPerson: boolean;
  /** Overrides the package markup when markupMode is per_component. */
  markup: MarkupRule | null;
  /** Overrides the quote's GST rate for this line (itemised billing). */
  gstRateBps: number | null;
  /** Upsell shown to the customer; counts only when selected. */
  optional: boolean;
  selected: boolean;
  supplierId: string | null;
  /** Option group ("" = in every option). */
  option: string;
  /** Booking-engine reference (series seat, allotment, live fare, insurance plan). */
  ref: string;
  notes: string;
}

export interface Pax {
  adults: number;
  children: number;
  infants: number;
}

export interface Discount {
  kind: "percent" | "flat";
  /** bps for percent, minor units for flat. */
  value: number;
}

export interface TcsSettings {
  on: ISODate;
  hasPan: boolean;
  priorFyAmount: Minor;
  rules?: TcsRule[];
}

export interface PricingInput {
  lines: PriceLine[];
  pax: Pax;
  currency: string;
  /** Units of quote currency per 1 unit of each line currency. */
  fx: Record<string, number>;
  markupMode: "overall" | "per_component";
  packageMarkup: MarkupRule;
  taxBasis: TaxBasis;
  gstRateBps: number;
  discount: Discount | null;
  /** Present only for overseas packages that attract TCS. */
  tcs: TcsSettings | null;
}

export interface PricedLine {
  id: string;
  included: boolean;
  base: Minor;
  markup: Minor;
  discount: Minor;
  sell: Minor;
  taxable: Minor;
  gst: Minor;
  total: Minor;
}

export interface PricingResult {
  lines: PricedLine[];
  payingPax: number;
  base: Minor;
  markup: Minor;
  discount: Minor;
  sell: Minor;
  taxable: Minor;
  gst: Minor;
  tcs: Minor;
  tcsNote: string | null;
  total: Minor;
  perPerson: Minor;
  /** Markup left after discount: what the agency earns before overheads. */
  margin: Minor;
  /** Margin as bps of sell price (0 when sell is 0). */
  marginBps: number;
}

export const ZERO_MARKUP: MarkupRule = { kind: "percent", value: 0, per: "unit" };

export function payingPaxOf(pax: Pax): number {
  return Math.max(1, Math.floor(pax.adults) + Math.floor(pax.children));
}

function markupAmount(rule: MarkupRule, base: Minor, payingPax: number, units: number): Minor {
  if (rule.value < 0) throw new Error("Markup cannot be negative");
  if (rule.kind === "percent") return applyBps(base, rule.value);
  assertInt(rule.value, "flat markup");
  return rule.value * (rule.per === "person" ? payingPax : units);
}

function validateLine(line: PriceLine): void {
  assertInt(line.netCost, `net cost of "${line.title}"`);
  if (line.netCost < 0) throw new Error(`Net cost of "${line.title}" cannot be negative`);
  if (!(line.quantity > 0) || !Number.isInteger(line.quantity)) {
    throw new Error(`Quantity of "${line.title}" must be a whole number above 0`);
  }
}

/**
 * The pricing engine. Deterministic order:
 * base → markup → discount → GST (per line) → TCS (on total incl. GST) → per person.
 * Every split uses largest-remainder allocation so line amounts always add up to the totals.
 */
export function priceQuote(input: PricingInput): PricingResult {
  const payingPax = payingPaxOf(input.pax);
  const lines = input.lines;
  lines.forEach(validateLine);

  const included = lines.map((l) => !l.optional || l.selected);
  const bases = lines.map((l) => {
    const unitCost = convert(l.netCost, l.currency || input.currency, input.currency, input.fx);
    return unitCost * l.quantity * (l.perPerson ? payingPax : 1);
  });

  // Markup
  let markups: Minor[];
  if (input.markupMode === "per_component") {
    markups = lines.map((l, i) => markupAmount(l.markup ?? input.packageMarkup, bases[i] ?? 0, payingPax, l.quantity));
  } else {
    const includedBase = sum(bases.filter((_, i) => included[i]));
    const packageMarkup = markupAmount(input.packageMarkup, includedBase, payingPax, 1);
    const shares = allocate(packageMarkup, bases.map((b, i) => (included[i] ? b : 0)));
    // Optional lines get their own display markup so the customer sees a fair upsell price.
    markups = lines.map((l, i) => {
      if (included[i]) return shares[i] ?? 0;
      const rule = l.markup ?? (input.packageMarkup.kind === "percent" ? input.packageMarkup : ZERO_MARKUP);
      return markupAmount(rule, bases[i] ?? 0, payingPax, l.quantity);
    });
  }

  // Discount (before tax), spread over included lines by their pre-discount sell value
  const preSell = lines.map((_, i) => (bases[i] ?? 0) + (markups[i] ?? 0));
  const includedPreSell = sum(preSell.filter((_, i) => included[i]));
  let discountTotal = 0;
  if (input.discount && input.discount.value > 0) {
    discountTotal = input.discount.kind === "percent"
      ? applyBps(includedPreSell, Math.min(input.discount.value, 10_000))
      : Math.min(input.discount.value, includedPreSell);
  }
  const discounts = allocate(discountTotal, preSell.map((v, i) => (included[i] ? v : 0)));

  const priced: PricedLine[] = lines.map((l, i) => {
    const base = bases[i] ?? 0;
    const markup = markups[i] ?? 0;
    const discount = included[i] ? discounts[i] ?? 0 : 0;
    const sell = base + markup - discount;
    const taxable = input.taxBasis === "cost_plus_markup" ? sell : Math.max(0, markup - discount);
    const gst = applyBps(taxable, l.gstRateBps ?? input.gstRateBps);
    return { id: l.id, included: included[i] ?? true, base, markup, discount, sell, taxable, gst, total: sell + gst };
  });

  const inc = priced.filter((p) => p.included);
  const base = sum(inc.map((p) => p.base));
  const markup = sum(inc.map((p) => p.markup));
  const sell = sum(inc.map((p) => p.sell));
  const taxable = sum(inc.map((p) => p.taxable));
  const gst = sum(inc.map((p) => p.gst));
  const preTcs = sell + gst;

  let tcs = 0;
  let tcsNote: string | null = null;
  if (input.tcs) {
    const r = computeTcs({
      amount: preTcs,
      on: input.tcs.on,
      hasPan: input.tcs.hasPan,
      priorFyAmount: input.tcs.priorFyAmount,
      ...(input.tcs.rules ? { rules: input.tcs.rules } : {}),
    });
    tcs = r.tcs;
    tcsNote = r.note;
  }

  const total = preTcs + tcs;
  const margin = markup - discountTotal;
  return {
    lines: priced,
    payingPax,
    base,
    markup,
    discount: discountTotal,
    sell,
    taxable,
    gst,
    tcs,
    tcsNote,
    total,
    perPerson: roundHalfUp(total / payingPax),
    margin,
    marginBps: sell === 0 ? 0 : Math.round((margin * 10_000) / sell),
  };
}

export function emptyLine(partial: Partial<PriceLine> & { id: string }): PriceLine {
  return {
    type: "other", title: "", day: 1, netCost: 0, currency: "INR", quantity: 1, perPerson: false,
    markup: null, gstRateBps: null, optional: false, selected: false, supplierId: null, notes: "", option: "", ref: "",
    ...partial,
  };
}
