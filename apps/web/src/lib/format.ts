import { formatCompact, formatDate, formatDateTime, formatMoney, fromMinor, toMinor } from "@voyadesk/core";

export { formatCompact, formatDate, formatDateTime, formatMoney, fromMinor, toMinor };

export const money = (minor: number | null | undefined, currency = "INR") => (minor === null || minor === undefined ? "—" : formatMoney(minor, currency));
export const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
export const titleCase = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

export function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - Date.parse(iso);
  if (Number.isNaN(diff)) return "—";
  const m = Math.round(diff / 60_000);
  if (Math.abs(m) < 1) return "just now";
  if (m > 0) {
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} h ago`;
    const d = Math.round(h / 24);
    return d < 30 ? `${d} d ago` : formatDate(iso.slice(0, 10));
  }
  const fm = -m;
  if (fm < 60) return `in ${fm} min`;
  const fh = Math.round(fm / 60);
  if (fh < 24) return `in ${fh} h`;
  return `in ${Math.round(fh / 24)} d`;
}

export const SOURCE_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp", website: "Website", meta_ads: "Meta Ads", google_ads: "Google Ads", instagram: "Instagram", ivr: "IVR call", walk_in: "Walk-in", referral: "Referral",
  repeat: "Repeat customer", b2b_agent: "B2B agent", email: "Email", landing_page: "Landing page", other: "Other",
};

export const ROLE_LABEL: Record<string, string> = {
  owner: "Owner", admin: "Admin", sales: "Sales", ops: "Operations", accounts: "Accounts", visa: "Visa desk",
  marketing: "Marketing", agent: "B2B agent", driver: "Driver / guide",
};

export const SERVICE_ICON_LABEL: Record<string, string> = {
  hotel: "Hotel", flight: "Flight", transfer: "Transfer", sightseeing: "Sightseeing", activity: "Activity", visa: "Visa",
  insurance: "Insurance", meal: "Meal", other: "Other",
};
