import {
  formatZodError, ID_PREFIX, schemas, type Collection, type Entity, type Input, type Meta, type Role, type Settings,
} from "./entities.js";
import { DomainError } from "./rules.js";
import { isoDate } from "./dates.js";
import { newId } from "./ids.js";
import type { Providers } from "./providers.js";

/**
 * Persistence contract shared by the Postgres backend and the in-browser demo store.
 * Implementations only persist rows; all validation and business rules live in core.
 * Every implementation is already scoped to ONE tenant.
 */
export interface Store {
  list<C extends Collection>(c: C): Promise<Entity<C>[]>;
  get<C extends Collection>(c: C, id: string): Promise<Entity<C> | undefined>;
  insert<C extends Collection>(c: C, row: Entity<C>): Promise<Entity<C>>;
  update<C extends Collection>(c: C, id: string, row: Entity<C>): Promise<Entity<C>>;
  remove(c: Collection, id: string): Promise<void>;
  /** Atomically increment and return a named counter (used for document numbers). */
  nextSeq(key: string): Promise<number>;
}

export interface Ctx {
  tenantId: string;
  userId: string;
  role: Role;
  /** Set for B2B sub-agent users. */
  agentId: string | null;
  now: Date;
  /** Outside services (messaging, payments, flights, AI, calls). Demo tenants fall back to the built-in sandbox. */
  providers?: Providers;
}

export type Body<C extends Collection> = Omit<Entity<C>, keyof Meta>;

/** Validate input against the collection schema (filling defaults) and insert it. */
export async function createRow<C extends Collection>(store: Store, c: C, input: Input<C> | Body<C>, now: Date): Promise<Entity<C>> {
  const parsed = schemas[c].safeParse(input);
  if (!parsed.success) {
    const f = formatZodError(parsed.error);
    throw new DomainError(f.message, 422, f.fields);
  }
  const ts = now.toISOString();
  const row = { ...(parsed.data as object), id: newId(ID_PREFIX[c]), createdAt: ts, updatedAt: ts } as Entity<C>;
  return store.insert(c, row);
}

/** Merge a partial update into an existing row, re-validate the whole row, and save it. */
export async function patchRow<C extends Collection>(
  store: Store, c: C, id: string, patch: Partial<Body<C>> | Record<string, unknown>, now: Date,
): Promise<Entity<C>> {
  const existing = await store.get(c, id);
  if (!existing) throw new DomainError(`${label(c)} not found`, 404);
  const { id: _i, createdAt, updatedAt: _u, ...body } = existing as Entity<C> & Record<string, unknown>;
  const cleanPatch = { ...(patch as Record<string, unknown>) };
  delete cleanPatch["id"];
  delete cleanPatch["createdAt"];
  delete cleanPatch["updatedAt"];
  const parsed = schemas[c].safeParse({ ...body, ...cleanPatch });
  if (!parsed.success) {
    const f = formatZodError(parsed.error);
    throw new DomainError(f.message, 422, f.fields);
  }
  const row = { ...(parsed.data as object), id, createdAt, updatedAt: now.toISOString() } as Entity<C>;
  return store.update(c, id, row);
}

export async function mustGet<C extends Collection>(store: Store, c: C, id: string | null | undefined): Promise<Entity<C>> {
  if (!id) throw new DomainError(`${label(c)} is required`, 422);
  const row = await store.get(c, id);
  if (!row) throw new DomainError(`${label(c)} not found`, 404);
  return row;
}

export function label(c: Collection): string {
  const map: Partial<Record<Collection, string>> = {
    leads: "Lead", quotes: "Quote", bookings: "Booking", services: "Service", invoices: "Invoice", agents: "Agent",
    visaCases: "Visa case", campaigns: "Campaign", resources: "Resource", supplierBills: "Supplier bill",
    groupDepartures: "Group departure", packages: "Package", contacts: "Contact", users: "User", tasks: "Task",
    messages: "Message", assignments: "Assignment", coupons: "Coupon", suppliers: "Supplier",
  };
  return map[c] ?? c;
}

export const DEFAULT_SETTINGS = (companyName = "My Travel Company"): Input<"settings"> => ({
  companyName,
  businessTypes: ["b2c"],
  modules: { sales: true, itinerary: true, operations: true, finance: true, marketing: false, b2b: false, visa: false, ai: true, portals: false },
});

/** The tenant's single settings row, created with defaults on first use. */
export async function getSettings(store: Store, now: Date): Promise<Settings> {
  const rows = await store.list("settings");
  if (rows[0]) return rows[0];
  return createRow(store, "settings", DEFAULT_SETTINGS(), now);
}

export function todayOf(ctx: Ctx, settings?: Pick<Settings, "timezone">): string {
  return isoDate(ctx.now, settings?.timezone ?? "Asia/Kolkata");
}
