import { addDays, isValidISODate, type ISODate } from "./dates.js";
import { parseMoney, type Minor } from "./money.js";

/**
 * Smart enquiry parser: turns free text such as
 *   "5N Dubai, 4 pax, 27 Jan, 1.2L, 4 star, honeymoon"
 * into structured trip requirements. Rule-based so it works offline and is testable;
 * an LLM provider can be plugged in behind the same output shape.
 */
export interface ParsedEnquiry {
  destination: string | null;
  nights: number | null;
  adults: number | null;
  children: number | null;
  travelDate: ISODate | null;
  budget: Minor | null;
  hotelStars: number | null;
  theme: string | null;
  service: "holiday" | "visa" | "flight" | "hotel" | "transfer";
  phone: string | null;
  email: string | null;
  confidence: number;
  matched: string[];
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const THEMES = ["honeymoon", "family", "group", "corporate", "adventure", "pilgrimage", "luxury", "budget", "solo", "friends"];

export function parseEnquiry(text: string, knownDestinations: string[], today: ISODate): ParsedEnquiry {
  const t = ` ${text.replace(/\s+/g, " ")} `;
  const lower = t.toLowerCase();
  const matched: string[] = [];

  // Destination: longest known destination mentioned, else "to X" / "in X"
  let destination: string | null = null;
  const sorted = [...knownDestinations].sort((a, b) => b.length - a.length);
  for (const d of sorted) {
    const re = new RegExp(`\\b${d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (re.test(t)) {
      destination = d;
      break;
    }
  }
  if (!destination) {
    const m = /\b(?:to|in|for|visit(?:ing)?)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/.exec(t);
    if (m?.[1]) destination = m[1];
  }
  if (destination) matched.push("destination");

  // Nights / days
  let nights: number | null = null;
  const n = /\b(\d{1,2})\s*(?:n|nts?|nights?)\b/i.exec(t);
  const d = /\b(\d{1,2})\s*(?:d|days?)\b/i.exec(t);
  if (n?.[1]) nights = Number(n[1]);
  else if (d?.[1]) nights = Math.max(1, Number(d[1]) - 1);
  if (nights !== null) matched.push("nights");

  // Travellers
  let adults: number | null = null;
  let children: number | null = null;
  const pax = /\b(\d{1,3})\s*(?:pax|people|persons?|adults?|travell?ers?|ppl|guests?|members?)\b/i.exec(t);
  if (pax?.[1]) adults = Number(pax[1]);
  const family = /\bfamily of (\d{1,2})\b/i.exec(t);
  if (adults === null && family?.[1]) adults = Number(family[1]);
  if (adults === null && /\b(couple|honeymoon|two of us)\b/i.test(t)) adults = 2;
  const kids = /\b(\d{1,2})\s*(?:kids?|children|child|cnb|cwb)\b/i.exec(t);
  if (kids?.[1]) children = Number(kids[1]);
  if (adults !== null) matched.push("travellers");

  // Travel date: "27 Jan", "27th January 2027", "Jan 27", or ISO
  let travelDate: ISODate | null = null;
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(t);
  const dm = /\b(\d{1,2})(?:st|nd|rd|th)?\s*(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?(?:\s*,?\s*(\d{4}))?/i.exec(t);
  const md = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s*(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/i.exec(t);
  if (iso?.[1] && isValidISODate(iso[1])) travelDate = iso[1];
  else if (dm) travelDate = nextOccurrence(Number(dm[1]), MONTHS[dm[2]!.toLowerCase().slice(0, 3)] ?? 1, dm[3], today);
  else if (md) travelDate = nextOccurrence(Number(md[2]), MONTHS[md[1]!.toLowerCase().slice(0, 3)] ?? 1, md[3], today);
  else if (/\bnext week\b/i.test(t)) travelDate = addDays(today, 7);
  else if (/\bnext month\b/i.test(t)) travelDate = addDays(today, 30);
  if (travelDate) matched.push("date");

  // Budget: "1.2L", "₹80,000", "budget 90k", "2 lakh"
  let budget: Minor | null = null;
  const bud =
    /(?:budget|₹|rs\.?|inr)\s*(?:of|is|:)?\s*(\d[\d,]*(?:\.\d+)?\s*(?:k|l|lac|lakhs?|cr|crores?)?)\b/i.exec(t) ??
    /\b(\d+(?:\.\d+)?\s*(?:k|l|lac|lakhs?|cr|crores?))\b/i.exec(t);
  if (bud?.[1]) budget = parseMoney(bud[1]);
  if (budget !== null) matched.push("budget");

  const stars = /\b([3-7])\s*(?:\*|star|stars|-star)\b/i.exec(t);
  const hotelStars = stars?.[1] ? Number(stars[1]) : /\bluxury\b/i.test(t) ? 5 : null;

  const theme = THEMES.find((th) => lower.includes(th)) ?? null;

  let service: ParsedEnquiry["service"] = "holiday";
  if (/\bvisa\b/i.test(t)) service = "visa";
  else if (/\b(flight|ticket|airfare)s?\b/i.test(t) && !nights) service = "flight";
  else if (/\bhotel only\b/i.test(t)) service = "hotel";
  else if (/\b(cab|taxi|transfer)s?\b/i.test(t) && !nights) service = "transfer";

  const phoneM = /(?:\+?91[\s-]?)?\b([6-9]\d{9})\b/.exec(t);
  const emailM = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/.exec(t);

  const confidence = Math.round((matched.length / 5) * 100) / 100;
  return {
    destination,
    nights,
    adults,
    children,
    travelDate,
    budget,
    hotelStars,
    theme,
    service,
    phone: phoneM?.[1] ?? null,
    email: emailM?.[0] ?? null,
    confidence,
    matched,
  };
}

function nextOccurrence(day: number, month: number, year: string | undefined, today: ISODate): ISODate | null {
  const pad = (x: number) => String(x).padStart(2, "0");
  if (year) {
    const s = `${year}-${pad(month)}-${pad(day)}`;
    return isValidISODate(s) ? s : null;
  }
  const y = Number(today.slice(0, 4));
  for (const yr of [y, y + 1]) {
    const s = `${yr}-${pad(month)}-${pad(day)}`;
    if (isValidISODate(s) && s >= today) return s;
  }
  return null;
}
