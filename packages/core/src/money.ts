/**
 * Money is always an integer number of minor units (paise for INR, cents for USD).
 * Never store or add money as floating-point rupees.
 * Percentages are basis points (bps): 10% = 1000 bps, 5% = 500 bps.
 */
export type Minor = number;

/** Round half away from zero (the "half-up" most accountants expect). */
export function roundHalfUp(x: number): number {
  if (!Number.isFinite(x)) throw new Error(`Cannot round non-finite value: ${x}`);
  const r = Math.sign(x) * Math.round(Math.abs(x));
  return r === 0 ? 0 : r; // normalise -0
}

/** Convert a major-unit amount (e.g. 1234.5 rupees) to minor units (123450 paise). */
export function toMinor(major: number): Minor {
  if (!Number.isFinite(major)) throw new Error(`Invalid amount: ${major}`);
  // toFixed(4) removes binary noise such as 1.005 * 100 = 100.49999999999999
  return roundHalfUp(Number((major * 100).toFixed(4)));
}

export function fromMinor(minor: Minor): number {
  return minor / 100;
}

/** Parse user-typed money such as "1,20,000", "₹ 1.2L", "45k", "2.5 cr". Returns minor units or null. */
export function parseMoney(input: string): Minor | null {
  const s = input.trim().toLowerCase().replace(/[₹,\s]|rs\.?|inr/g, "");
  const m = /^(\d+(?:\.\d+)?)(k|l|lac|lakh|lakhs|cr|crore|crores)?$/.exec(s);
  if (!m || m[1] === undefined) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const mult = !unit ? 1 : unit === "k" ? 1_000 : unit.startsWith("l") ? 100_000 : 10_000_000;
  return toMinor(n * mult);
}

/** amount × bps / 10000, rounded half-up. Exact for amounts below ~9×10^11 minor units. */
export function applyBps(amount: Minor, bps: number): Minor {
  assertInt(amount, "amount");
  if (!Number.isFinite(bps)) throw new Error(`Invalid bps: ${bps}`);
  return roundHalfUp((amount * bps) / 10_000);
}

export function assertInt(n: number, label = "value"): void {
  if (!Number.isInteger(n)) throw new Error(`${label} must be an integer number of minor units, got ${n}`);
}

/**
 * Split an integer total across weights so the parts always sum exactly to the total
 * (largest-remainder method). Used to spread package markup, discounts and tax across lines.
 */
export function allocate(total: Minor, weights: number[]): Minor[] {
  assertInt(total, "total");
  if (weights.length === 0) return [];
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const w = weights.map((x) => (x > 0 && Number.isFinite(x) ? x : 0));
  const sum = w.reduce((a, b) => a + b, 0);
  const shares = sum === 0 ? w.map(() => abs / w.length) : w.map((x) => (abs * x) / sum);
  const floors = shares.map((s) => Math.floor(s));
  let remainder = abs - floors.reduce((a, b) => a + b, 0);
  const order = shares
    .map((s, i) => ({ i, frac: s - Math.floor(s) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] = (floors[i] ?? 0) + 1;
    remainder -= 1;
  }
  return floors.map((f) => (f === 0 ? 0 : f * sign));
}

export function sum(values: Minor[]): Minor {
  return values.reduce((a, b) => a + b, 0);
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Format minor units for display, e.g. 11550000 → "₹1,15,500". */
export function formatMoney(minor: Minor, currency = "INR", opts: { decimals?: boolean } = {}): string {
  // Whole rupees print without decimals; any paise print as exactly two digits (₹1,545.60, never ₹1,545.6).
  const digits = opts.decimals || minor % 100 !== 0 ? 2 : 0;
  const key = `${currency}:${digits}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits });
    formatters.set(key, f);
  }
  return f.format(fromMinor(minor));
}

/** Compact display for dashboards: ₹1.2L, ₹3.4Cr, ₹950. */
export function formatCompact(minor: Minor, currency = "INR"): string {
  const major = fromMinor(minor);
  const abs = Math.abs(major);
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  const sign = major < 0 ? "-" : "";
  if (currency === "INR") {
    if (abs >= 1e7) return `${sign}${symbol}${trim(abs / 1e7)}Cr`;
    if (abs >= 1e5) return `${sign}${symbol}${trim(abs / 1e5)}L`;
    if (abs >= 1e3) return `${sign}${symbol}${trim(abs / 1e3)}K`;
  } else {
    if (abs >= 1e6) return `${sign}${symbol}${trim(abs / 1e6)}M`;
    if (abs >= 1e3) return `${sign}${symbol}${trim(abs / 1e3)}K`;
  }
  return `${sign}${symbol}${Math.round(abs)}`;
}

function trim(n: number): string {
  return n.toFixed(n >= 100 ? 0 : 1).replace(/\.0$/, "");
}

/** Convert an amount between currencies using a frozen rate table (units of `to` per 1 unit of `from`). */
export function convert(amount: Minor, from: string, to: string, rates: Record<string, number>): Minor {
  if (from === to) return amount;
  const rate = rates[from];
  if (rate === undefined || !(rate > 0)) {
    throw new Error(`No exchange rate from ${from} to ${to}. Add it to the quote's currency rates.`);
  }
  return roundHalfUp(amount * rate);
}
