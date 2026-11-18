/** Calendar dates are ISO strings "YYYY-MM-DD"; timestamps are full ISO strings. */
export type ISODate = string;

export const DEFAULT_TZ = "Asia/Kolkata";

const dateFmt = new Map<string, Intl.DateTimeFormat>();

/** The calendar date of an instant in a time zone (default India), as YYYY-MM-DD. */
export function isoDate(d: Date, tz = DEFAULT_TZ): ISODate {
  let f = dateFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    dateFmt.set(tz, f);
  }
  return f.format(d);
}

export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function toUTC(s: ISODate): number {
  if (!isValidISODate(s)) throw new Error(`Invalid date "${s}" (expected YYYY-MM-DD)`);
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
}

export function addDays(s: ISODate, days: number): ISODate {
  return new Date(toUTC(s) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: ISODate, b: ISODate): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86_400_000);
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Indian financial year of a date, e.g. 2026-11-15 → "2026-27". */
export function financialYear(s: ISODate): string {
  const [y, m] = s.split("-").map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function monthKey(s: ISODate): string {
  return s.slice(0, 7);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(s: ISODate | null | undefined): string {
  if (!s) return "—";
  const date = s.slice(0, 10);
  if (!isValidISODate(date)) return s;
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatMonth(key: string): string {
  const [y, m] = key.split("-").map(Number) as [number, number];
  return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

export function formatDateTime(iso: string | null | undefined, tz = DEFAULT_TZ): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: tz, day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
  }).format(d);
}

/** Last n month keys ending with the month of `today`, oldest first. */
export function lastMonths(today: ISODate, n: number): string[] {
  const [y, m] = today.split("-").map(Number) as [number, number];
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const total = y * 12 + (m - 1) - i;
    out.push(`${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

/** True when the inclusive ranges [aFrom, aTo] and [bFrom, bTo] share at least one day. */
export function rangesOverlap(aFrom: ISODate, aTo: ISODate, bFrom: ISODate, bTo: ISODate): boolean {
  return aFrom <= bTo && bFrom <= aTo;
}
