import type { ReactNode } from "react";
import {
  BarChart3, Bot, BookOpenCheck, Briefcase, Building2, CalendarClock, ClipboardList, CreditCard, FileText,
  Globe2, Handshake, Home, Inbox, Landmark, LayoutDashboard, Megaphone, Plane, Receipt, Rocket,
  Settings as SettingsIcon, Stamp, Truck, Users, Wallet, PhoneCall, Boxes, ShieldCheck, BadgeCheck, Link2, MessagesSquare, Ticket, Workflow,
} from "lucide-react";
import { canRead, type Collection, type ModuleKey, type Role } from "@voyadesk/core";

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  module?: ModuleKey;
  needs?: Collection;
  roles?: Role[];
  end?: boolean;
}

const I = "size-[18px]";
export const NAV: { group: string; items: NavItem[] }[] = [
  { group: "", items: [
    { to: "/app", label: "Dashboard", icon: <LayoutDashboard className={I} />, end: true },
    { to: "/app/onboarding", label: "Setup guide", icon: <Rocket className={I} />, roles: ["owner", "admin"] },
    { to: "/app/inbox", label: "Inbox", icon: <Inbox className={I} />, needs: "messages" },
    { to: "/app/tasks", label: "Tasks", icon: <ClipboardList className={I} />, needs: "tasks" },
    { to: "/app/messages", label: "Messages & follow-ups", icon: <MessagesSquare className={I} />, needs: "outbox" },
  ] },
  { group: "Sales", items: [
    { to: "/app/leads", label: "Leads", icon: <Users className={I} />, module: "sales", needs: "leads" },
    { to: "/app/quotes", label: "Quotes & itineraries", icon: <FileText className={I} />, module: "itinerary", needs: "quotes" },
    { to: "/app/contacts", label: "Customers", icon: <Home className={I} />, module: "sales", needs: "contacts" },
    { to: "/app/calls", label: "Calls", icon: <PhoneCall className={I} />, module: "sales", needs: "calls" },
    { to: "/app/engines", label: "Flights, hotels & more", icon: <Ticket className={I} />, module: "itinerary", roles: ["owner", "admin", "sales", "ops"] },
    { to: "/app/ai", label: "AI studio", icon: <Bot className={I} />, module: "ai", needs: "leads" },
  ] },
  { group: "Operations", items: [
    { to: "/app/bookings", label: "Bookings", icon: <Briefcase className={I} />, module: "operations", needs: "bookings" },
    { to: "/app/operations", label: "Ops board", icon: <CalendarClock className={I} />, module: "operations", needs: "services", end: true },
    { to: "/app/operations/groups", label: "Group departures", icon: <Plane className={I} />, module: "operations", needs: "groupDepartures" },
    { to: "/app/resources", label: "Drivers & guides", icon: <Truck className={I} />, module: "operations", needs: "resources" },
    { to: "/app/inventory", label: "Inventory & rates", icon: <Boxes className={I} />, module: "operations", needs: "allotments" },
    { to: "/app/insurance", label: "Insurance", icon: <ShieldCheck className={I} />, module: "operations", needs: "policies" },
    { to: "/app/approvals", label: "Approvals", icon: <BadgeCheck className={I} />, needs: "amendments" },
  ] },
  { group: "Finance", items: [
    { to: "/app/finance", label: "Finance overview", icon: <Landmark className={I} />, module: "finance", needs: "invoices", end: true },
    { to: "/app/finance/links", label: "Payment links", icon: <Link2 className={I} />, module: "finance", needs: "paymentLinks" },
    { to: "/app/finance/invoices", label: "Invoices", icon: <Receipt className={I} />, module: "finance", needs: "invoices" },
    { to: "/app/finance/payments", label: "Payments", icon: <CreditCard className={I} />, module: "finance", needs: "payments" },
    { to: "/app/finance/payables", label: "Supplier payables", icon: <Wallet className={I} />, module: "finance", needs: "supplierBills" },
    { to: "/app/finance/ledger", label: "Ledger & books", icon: <BookOpenCheck className={I} />, module: "finance", needs: "ledger" },
    { to: "/app/finance/tax", label: "GST & TCS", icon: <Stamp className={I} />, module: "finance", needs: "invoices", roles: ["owner", "admin", "accounts"] },
  ] },
  { group: "Growth", items: [
    { to: "/app/b2b", label: "B2B agents", icon: <Handshake className={I} />, module: "b2b", needs: "agents" },
    { to: "/app/visa", label: "Visa desk", icon: <Stamp className={I} />, module: "visa", needs: "visaCases" },
    { to: "/app/marketing", label: "Marketing", icon: <Megaphone className={I} />, module: "marketing", needs: "campaigns" },
    { to: "/app/automations", label: "Automations", icon: <Workflow className={I} />, needs: "automations" },
    { to: "/app/portals", label: "Website & portals", icon: <Globe2 className={I} />, module: "portals", roles: ["owner", "admin", "marketing"] },
  ] },
  { group: "Manage", items: [
    { to: "/app/masters", label: "Masters & suppliers", icon: <Building2 className={I} />, needs: "hotels" },
    { to: "/app/reports", label: "Reports", icon: <BarChart3 className={I} />, roles: ["owner", "admin", "accounts"] },
    { to: "/app/settings", label: "Settings", icon: <SettingsIcon className={I} />, roles: ["owner", "admin"] },
  ] },
];

export function visibleNav(role: Role, moduleOn: (m: ModuleKey) => boolean) {
  return NAV.map((g) => ({
    ...g,
    items: g.items.filter((i) => (!i.module || moduleOn(i.module)) && (!i.needs || canRead(role, i.needs)) && (!i.roles || i.roles.includes(role))),
  })).filter((g) => g.items.length > 0);
}

/** The phone bottom bar: the four screens each role opens most, in order of preference. */
const BOTTOM_PREFERENCE: Record<string, string[]> = {
  owner: ["/app", "/app/leads", "/app/bookings", "/app/finance/links"],
  admin: ["/app", "/app/leads", "/app/bookings", "/app/finance/links"],
  sales: ["/app", "/app/leads", "/app/quotes", "/app/inbox"],
  ops: ["/app", "/app/bookings", "/app/operations", "/app/tasks"],
  accounts: ["/app", "/app/finance/links", "/app/finance/invoices", "/app/finance/payments"],
  visa: ["/app", "/app/visa", "/app/tasks", "/app/inbox"],
  marketing: ["/app", "/app/leads", "/app/marketing", "/app/automations"],
};
const SHORT: Record<string, string> = { "/app": "Home", "/app/finance/links": "Collect", "/app/finance/invoices": "Invoices", "/app/finance/payments": "Payments", "/app/operations": "Ops", "/app/quotes": "Quotes", "/app/visa": "Visa", "/app/automations": "Automate" };

export function bottomNav(role: Role, moduleOn: (m: ModuleKey) => boolean): NavItem[] {
  const all = visibleNav(role, moduleOn).flatMap((g) => g.items);
  const pref = BOTTOM_PREFERENCE[role] ?? ["/app", "/app/tasks", "/app/inbox"];
  return pref.map((to) => all.find((i) => i.to === to)).filter((i): i is NavItem => Boolean(i)).slice(0, 4).map((i) => ({ ...i, label: SHORT[i.to] ?? i.label }));
}
