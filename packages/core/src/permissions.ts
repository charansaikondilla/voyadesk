import { type Collection, type ModuleKey, type Role } from "./entities.js";

type Access = "none" | "read" | "write";

/**
 * Who can read/write which collection. "own" scoping (agents and drivers only see their
 * own records) is applied separately in scopeRows().
 */
const MATRIX: Record<Collection, Partial<Record<Role, Access>> & { default: Access }> = {
  users: { owner: "write", admin: "write", default: "read" },
  settings: { owner: "write", admin: "write", default: "read" },
  contacts: { owner: "write", admin: "write", sales: "write", ops: "read", accounts: "read", visa: "write", marketing: "write", default: "none" },
  agents: { owner: "write", admin: "write", accounts: "write", sales: "read", ops: "read", agent: "read", default: "none" },
  suppliers: { owner: "write", admin: "write", ops: "write", accounts: "read", sales: "read", default: "none" },
  hotels: { owner: "write", admin: "write", ops: "write", sales: "read", agent: "read", marketing: "read", default: "none" },
  sightseeing: { owner: "write", admin: "write", ops: "write", sales: "read", agent: "read", marketing: "read", default: "none" },
  transfers: { owner: "write", admin: "write", ops: "write", sales: "read", agent: "read", default: "none" },
  packages: { owner: "write", admin: "write", ops: "write", sales: "write", marketing: "write", agent: "read", default: "read" },
  visaMasters: { owner: "write", admin: "write", visa: "write", sales: "read", agent: "read", default: "read" },
  leads: { owner: "write", admin: "write", sales: "write", marketing: "write", visa: "write", agent: "write", ops: "read", default: "none" },
  tasks: { default: "write", agent: "none", driver: "none" },
  activities: { default: "write", agent: "read", driver: "none" },
  quotes: { owner: "write", admin: "write", sales: "write", agent: "write", ops: "read", accounts: "read", default: "none" },
  bookings: { owner: "write", admin: "write", sales: "write", ops: "write", accounts: "read", agent: "read", driver: "read", visa: "read", default: "none" },
  services: { owner: "write", admin: "write", ops: "write", sales: "read", accounts: "read", agent: "read", driver: "read", default: "none" },
  resources: { owner: "write", admin: "write", ops: "write", driver: "read", default: "none" },
  assignments: { owner: "write", admin: "write", ops: "write", driver: "read", default: "none" },
  groupDepartures: { owner: "write", admin: "write", ops: "write", sales: "write", agent: "read", default: "none" },
  invoices: { owner: "write", admin: "write", accounts: "write", sales: "read", agent: "read", default: "none" },
  payments: { owner: "write", admin: "write", accounts: "write", sales: "read", agent: "read", default: "none" },
  creditNotes: { owner: "write", admin: "write", accounts: "write", agent: "read", default: "none" },
  supplierBills: { owner: "write", admin: "write", accounts: "write", ops: "read", default: "none" },
  ledger: { owner: "read", admin: "read", accounts: "read", agent: "read", default: "none" },
  visaCases: { owner: "write", admin: "write", visa: "write", sales: "write", agent: "write", default: "none" },
  campaigns: { owner: "write", admin: "write", marketing: "write", sales: "read", default: "none" },
  segments: { owner: "write", admin: "write", marketing: "write", default: "none" },
  coupons: { owner: "write", admin: "write", marketing: "write", sales: "read", default: "none" },
  landingPages: { owner: "write", admin: "write", marketing: "write", default: "none" },
  dripSequences: { owner: "write", admin: "write", marketing: "write", default: "none" },
  taxRules: { owner: "write", admin: "write", accounts: "write", default: "read" },
  tcsRules: { owner: "write", admin: "write", accounts: "write", default: "read" },
  routingRules: { owner: "write", admin: "write", default: "read" },
  automations: { owner: "write", admin: "write", marketing: "write", sales: "read", accounts: "read", default: "none" },
  automationRuns: { owner: "read", admin: "read", marketing: "read", sales: "read", accounts: "read", default: "none" },
  channelSpend: { owner: "write", admin: "write", marketing: "write", accounts: "read", default: "none" },
  messages: { owner: "write", admin: "write", sales: "write", marketing: "write", visa: "write", default: "none" },
  outbox: { owner: "read", admin: "read", sales: "read", marketing: "read", visa: "read", accounts: "read", ops: "read", default: "none" },
  files: { owner: "write", admin: "write", sales: "write", ops: "write", visa: "write", accounts: "read", marketing: "read", default: "none" },
  paymentLinks: { owner: "read", admin: "read", accounts: "read", sales: "read", visa: "read", default: "none" },
  holds: { owner: "read", admin: "read", sales: "read", ops: "read", accounts: "read", default: "none" },
  tcsPayers: { owner: "read", admin: "read", accounts: "read", sales: "read", default: "none" },
  seriesFares: { owner: "write", admin: "write", ops: "write", sales: "read", agent: "read", marketing: "read", default: "none" },
  allotments: { owner: "write", admin: "write", ops: "write", sales: "read", agent: "read", default: "none" },
  flightOrders: { owner: "read", admin: "read", ops: "read", sales: "read", accounts: "read", default: "none" },
  insurancePlans: { owner: "write", admin: "write", ops: "write", sales: "read", agent: "read", marketing: "read", default: "none" },
  policies: { owner: "read", admin: "read", ops: "read", sales: "read", accounts: "read", agent: "read", default: "none" },
  claims: { owner: "read", admin: "read", ops: "read", accounts: "read", default: "none" },
  vehicleRates: { owner: "write", admin: "write", ops: "write", sales: "read", default: "none" },
  calls: { owner: "read", admin: "read", sales: "read", marketing: "read", visa: "read", default: "none" },
  chatThreads: { owner: "read", admin: "read", sales: "read", marketing: "read", visa: "read", default: "none" },
  amendments: { owner: "read", admin: "read", ops: "read", sales: "read", accounts: "read", default: "none" },
  commissions: { owner: "read", admin: "read", accounts: "read", agent: "read", default: "none" },
  customerSessions: { default: "none" },
};

export function access(role: Role, collection: Collection): Access {
  const row = MATRIX[collection];
  return row[role] ?? row.default;
}

export function canRead(role: Role, collection: Collection): boolean {
  return access(role, collection) !== "none";
}

export function canWrite(role: Role, collection: Collection): boolean {
  return access(role, collection) === "write";
}

/** Which workflow actions each role may run. "*" = every staff role except agent/driver. */
const ACTION_ROLES: Record<string, Role[] | "*"> = {
  captureLead: "*",
  updateLeadStage: ["owner", "admin", "sales", "marketing", "visa"],
  logActivity: "*",
  createQuoteFromLead: ["owner", "admin", "sales"],
  generateAiQuote: ["owner", "admin", "sales"],
  saveQuote: ["owner", "admin", "sales", "agent"],
  sendQuote: ["owner", "admin", "sales", "agent"],
  applyCoupon: ["owner", "admin", "sales", "agent"],
  acceptQuote: ["owner", "admin", "sales"],
  updateServiceStatus: ["owner", "admin", "ops"],
  generateVoucher: ["owner", "admin", "ops"],
  assignResource: ["owner", "admin", "ops"],
  updateBookingStatus: ["owner", "admin", "ops"],
  cancelBooking: ["owner", "admin", "ops", "accounts"],
  recordPayment: ["owner", "admin", "accounts", "sales"],
  issueCreditNote: ["owner", "admin", "accounts"],
  topUpWallet: ["owner", "admin", "accounts", "agent"],
  setAgentBlocked: ["owner", "admin", "accounts"],
  paySupplierBill: ["owner", "admin", "accounts"],
  createVisaCase: ["owner", "admin", "visa", "sales", "agent"],
  advanceVisaCase: ["owner", "admin", "visa"],
  markVisaDoc: ["owner", "admin", "visa", "agent"],
  scanPassport: ["owner", "admin", "visa", "agent"],
  sendCampaign: ["owner", "admin", "marketing"],
  inboundMessage: "*",
  replyMessage: ["owner", "admin", "sales", "marketing", "visa"],
  createTask: "*",
  completeTask: "*",
  inviteUsers: ["owner", "admin"],
  completeOnboardingStep: ["owner", "admin"],
  bookGroupSeat: ["owner", "admin", "sales", "ops"],
  agentCreateQuote: ["agent", "owner", "admin", "sales"],
  agentBook: ["agent", "owner", "admin"],
  driverUpdate: ["driver", "owner", "admin", "ops"],
  loadDemoData: ["owner", "admin"],
};

/** Feature packs declare who may run their actions. */
export function registerActionRoles(map: Record<string, Role[] | "*">): void {
  Object.assign(ACTION_ROLES, map);
}

export function canRunAction(role: Role, action: string): boolean {
  const allowed = ACTION_ROLES[action];
  if (!allowed) return false;
  if (allowed === "*") return role !== "agent" && role !== "driver";
  return allowed.includes(role);
}

/** Records an external user may see: agents see their own agency's records only. */
export function scopeRows<T extends object>(
  role: Role,
  collection: Collection,
  rows: T[],
  ctx: { userId: string; agentId: string | null; resourceId?: string | null },
): T[] {
  const f = (r: T, k: string) => (r as Record<string, unknown>)[k];
  if (role === "agent") {
    if (collection === "agents") return rows.filter((r) => f(r, "id") === ctx.agentId);
    if (["leads", "quotes", "bookings", "invoices", "payments", "creditNotes", "visaCases", "policies", "commissions"].includes(collection)) {
      return rows.filter((r) => f(r, "agentId") === ctx.agentId || f(r, "partyId") === ctx.agentId);
    }
    if (collection === "ledger") return rows.filter((r) => f(r, "partyId") === ctx.agentId);
    if (collection === "activities") return [];
  }
  return rows;
}

/** Drivers and guides only see their own assignments and the bookings/services behind them. */
export function scopeDriverRows<T extends object>(
  collection: Collection, rows: T[], assignments: { resourceId: string; serviceId: string; bookingId: string }[], resourceId: string | null,
): T[] {
  const mine = assignments.filter((a) => resourceId && a.resourceId === resourceId);
  const get = (r: T, k: string) => (r as Record<string, unknown>)[k];
  switch (collection) {
    case "assignments": return rows.filter((r) => resourceId !== null && get(r, "resourceId") === resourceId);
    case "services": return rows.filter((r) => mine.some((a) => a.serviceId === get(r, "id")));
    case "bookings": return rows.filter((r) => mine.some((a) => a.bookingId === get(r, "id")));
    case "resources": return rows.filter((r) => get(r, "id") === resourceId);
    default: return rows;
  }
}

/** Strip supplier net costs from anything shown to external agents. */
export function redactForRole<T>(role: Role, collection: Collection, row: T): T {
  if (role !== "agent" && role !== "driver") return row;
  const copy = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
  if (collection === "quotes" && Array.isArray(copy["lines"])) {
    copy["lines"] = (copy["lines"] as Record<string, unknown>[]).map((l) => ({ ...l, netCost: 0, supplierId: null }));
  }
  if (collection === "bookings") copy["costTotal"] = 0;
  if (collection === "services") copy["netCost"] = 0;
  if (collection === "seriesFares") { copy["netFare"] = 0; copy["pnr"] = ""; copy["passengers"] = []; delete copy["supplierId"]; }
  if (["hotels", "sightseeing", "transfers"].includes(collection)) {
    delete copy["supplierId"];
  }
  return copy as T;
}

/** Module each role lands on and what the left navigation shows. */
export const ROLE_HOME: Record<Role, string> = {
  owner: "/app", admin: "/app", sales: "/app/leads", ops: "/app/operations", accounts: "/app/finance",
  visa: "/app/visa", marketing: "/app/marketing", agent: "/agent", driver: "/field",
};

export const MODULE_ROLES: Record<ModuleKey, Role[]> = {
  sales: ["owner", "admin", "sales", "marketing"],
  itinerary: ["owner", "admin", "sales"],
  operations: ["owner", "admin", "ops"],
  finance: ["owner", "admin", "accounts"],
  marketing: ["owner", "admin", "marketing"],
  b2b: ["owner", "admin", "accounts", "sales"],
  visa: ["owner", "admin", "visa", "sales"],
  ai: ["owner", "admin", "sales", "marketing"],
  portals: ["owner", "admin", "marketing"],
};

const COST_KEYS = new Set(["netCost", "costTotal", "base", "markup", "margin", "marginBps", "netFare", "costImpact"]);
const HIDDEN_KEYS = new Set(["supplierId", "supplierName"]);

/** Deep redaction for anything returned to a B2B agent (action results can nest quotes, pricing and services). */
export function redactDeep<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (HIDDEN_KEYS.has(k)) continue;
        out[k] = COST_KEYS.has(k) && typeof x === "number" ? 0 : walk(x);
      }
      return out;
    }
    return v;
  };
  return walk(value) as T;
}

/** True if a record may be hard-deleted; otherwise the reason to show the user. */
export function isDeletable(collection: Collection, row: Record<string, unknown> | object): true | string {
  const r = row as Record<string, unknown>;
  switch (collection) {
    case "ledger": case "invoices": case "payments": case "creditNotes": case "supplierBills":
      return "Financial records can't be deleted. Issue a credit note or reversal instead.";
    case "bookings": case "services": case "assignments":
      return "Bookings can't be deleted. Cancel the booking instead so the history and accounts stay correct.";
    case "settings": case "activities": case "messages":
      return "This history can't be deleted.";
    case "users":
      return "Deactivate the user instead so their history stays attached.";
    case "agents":
      return "Agents with a ledger can't be deleted. Block the agent instead.";
    case "quotes":
      return r["status"] === "draft" ? true : "Only draft quotes can be deleted.";
    case "leads":
      return (r["stage"] === "new" || r["stage"] === "lost") && !r["bookingId"] ? true : "Only new or lost leads without a booking can be deleted.";
    case "visaCases":
      return ["enquiry", "docs_pending"].includes(String(r["status"])) && !Number(r["paid"]) ? true : "Visa cases in progress can't be deleted.";
    case "campaigns":
      return r["status"] === "sent" ? "Sent campaigns are kept for reporting." : true;
    case "groupDepartures":
      return Array.isArray(r["passengers"]) && r["passengers"].length > 0 ? "Remove the passengers first." : true;
    case "contacts":
      return Number(r["trips"]) > 0 ? "Customers with trips can't be deleted." : true;
    default:
      return true;
  }
}
