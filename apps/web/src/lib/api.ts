import {
  ACTION_ONLY, canRead, canWrite, createRow, deliverQueued, scopeDriverRows, DomainError, getSettings, isDeletable, MemoryStore, patchRow, PROTECTED_FIELDS,
  redactDeep, redactForRole, runAction, runJobs, runPublicAction, runReport, scopeRows, seedDemo,
  type Collection, type Ctx, type Entity, type MemoryData, type Role, type Settings, type User,
} from "@voyadesk/core";

/** One interface for the browser demo (LocalApi) and the real backend (HttpApi). */
export interface Api {
  mode: "demo" | "server";
  tenantId: string;
  list<C extends Collection>(c: C): Promise<Entity<C>[]>;
  get<C extends Collection>(c: C, id: string): Promise<Entity<C>>;
  create<C extends Collection>(c: C, data: Record<string, unknown>): Promise<Entity<C>>;
  update<C extends Collection>(c: C, id: string, patch: Record<string, unknown>): Promise<Entity<C>>;
  remove(c: Collection, id: string): Promise<void>;
  action<T = unknown>(name: string, input: unknown): Promise<T>;
  report<T = unknown>(name: string, params?: unknown): Promise<T>;
  publicAction<T = unknown>(tenantId: string, name: string, input: unknown): Promise<T>;
  publicStore(tenantId: string): Promise<PublicStore>;
  me(): Promise<{ user: User; settings: Settings }>;
  integrations(): Promise<IntegrationsInfo>;
  setIntegration(service: string, values: Record<string, string>): Promise<void>;
  removeIntegration(service: string): Promise<void>;
  testMessage(to: string): Promise<void>;
  /** Fetch a Google Sheet as CSV (through the server; the demo tries the browser). */
  fetchSheet(url: string): Promise<string>;
}

export interface IntegrationsInfo {
  demo: boolean;
  sandbox: boolean;
  services: Record<string, { connected: boolean; fields: string[] }>;
  webhooks: Record<string, string>;
}

export interface PublicStore {
  company: { name: string; phone: string; email: string; brandColor: string };
  packages: Entity<"packages">[];
  groups: { id: string; name: string; departureDate: string; seatsLeft: number; pricePerSeat: number }[];
  landingPages: Entity<"landingPages">[];
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public fields?: Record<string, string>) {
    super(message);
  }
}

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof DomainError) {
    const fields = e.details && typeof e.details === "object" && !Array.isArray(e.details) ? (e.details as Record<string, string>) : undefined;
    return new ApiError(e.message, e.status, fields);
  }
  const msg = e instanceof Error ? e.message : String(e);
  return new ApiError(msg || "Something went wrong", 500);
}

/* ───────────────────────── Demo mode (runs entirely in the browser) ───────────────────────── */

const STORAGE_KEY = "voyadesk.demo.v3";
const SESSION_KEY = "voyadesk.demo.user";

function loadSnapshot(): MemoryData | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as MemoryData) : null;
  } catch {
    return null;
  }
}

function saveSnapshot(d: MemoryData) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
  } catch {
    /* storage full or blocked: the demo keeps working in memory */
  }
}

export const demoSession = {
  get(): string | null {
    try {
      return window.localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  },
  set(userId: string | null) {
    try {
      if (userId) window.localStorage.setItem(SESSION_KEY, userId);
      else window.localStorage.removeItem(SESSION_KEY);
    } catch {
      /* ignore */
    }
  },
};

export class LocalApi implements Api {
  mode = "demo" as const;
  tenantId = "demo";
  private store: MemoryStore;
  userId: string | null;
  private ready: Promise<void>;

  constructor() {
    const snap = loadSnapshot();
    this.store = new MemoryStore(snap ?? undefined, saveSnapshot);
    this.userId = demoSession.get();
    this.ready = snap ? Promise.resolve() : this.reseed();
    try {
      window.localStorage.removeItem("voyadesk.demo.v1");
    } catch {
      /* ignore */
    }
    // Background jobs (drips, reminders, follow-ups, holds, delivery) run every minute while the demo is open
    if (typeof window !== "undefined") window.setInterval(() => void this.jobs(), 60_000);
  }

  /** Run the scheduled jobs once (the server does this every minute for every agency). */
  async jobs() {
    await this.ready;
    const ctx: Ctx = { tenantId: "demo", userId: "system", role: "owner", agentId: null, now: new Date() };
    try {
      await this.store.transaction((s) => runJobs(s, ctx));
    } catch {
      /* a job problem never breaks the screen; it retries next minute */
    }
  }

  async reseed() {
    this.store = new MemoryStore(undefined, saveSnapshot);
    await this.store.transaction((s) => seedDemo(s, new Date(), "demo"));
    saveSnapshot(this.store.data);
  }

  async reset() {
    await this.reseed();
  }

  private async ctx(): Promise<{ ctx: Ctx; user: User }> {
    await this.ready;
    if (!this.userId) throw new ApiError("Please choose a demo user to sign in.", 401);
    const user = await this.store.get("users", this.userId);
    if (!user || !user.active) throw new ApiError("Please sign in again.", 401);
    return { user, ctx: { tenantId: "demo", userId: user.id, role: user.role as Role, agentId: user.agentId, now: new Date() } };
  }

  async users(): Promise<User[]> {
    await this.ready;
    return this.store.list("users");
  }

  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw toApiError(e);
    }
  }

  me() {
    return this.guard(async () => {
      const { user, ctx } = await this.ctx();
      return { user, settings: await getSettings(this.store, ctx.now) };
    });
  }

  list<C extends Collection>(c: C) {
    return this.guard(async () => {
      const { ctx, user } = await this.ctx();
      if (!canRead(ctx.role, c)) throw new ApiError("You don't have access to this.", 403);
      let rows = await this.store.list(c);
      if (ctx.role === "driver") rows = scopeDriverRows(c, rows, await this.store.list("assignments"), user.resourceId);
      return scopeRows(ctx.role, c, rows, { userId: user.id, agentId: user.agentId }).map((r) => redactForRole(ctx.role, c, r));
    });
  }

  get<C extends Collection>(c: C, id: string) {
    return this.guard(async () => {
      const { ctx, user } = await this.ctx();
      if (!canRead(ctx.role, c)) throw new ApiError("You don't have access to this.", 403);
      const row = await this.store.get(c, id);
      const drv = row && ctx.role === "driver" ? scopeDriverRows(c, [row], await this.store.list("assignments"), user.resourceId) : row ? [row] : [];
      const visible = drv.length ? scopeRows(ctx.role, c, drv, { userId: user.id, agentId: user.agentId })[0] : undefined;
      if (!visible) throw new ApiError("Not found", 404);
      return redactForRole(ctx.role, c, visible);
    });
  }

  private writable(ctx: Ctx, c: Collection) {
    if (["agent", "driver"].includes(ctx.role)) throw new ApiError("Use the portal actions to make changes.", 403);
    if (ACTION_ONLY.has(c)) throw new ApiError("This record is created by workflows only (to keep the books correct).", 409);
    if (!canWrite(ctx.role, c)) throw new ApiError("You don't have permission to change this.", 403);
  }

  create<C extends Collection>(c: C, data: Record<string, unknown>) {
    return this.guard(async () => {
      const { ctx } = await this.ctx();
      this.writable(ctx, c);
      const body = strip(c, data);
      return this.store.transaction((s) => createRow(s, c, body as never, ctx.now));
    });
  }

  update<C extends Collection>(c: C, id: string, patch: Record<string, unknown>) {
    return this.guard(async () => {
      const { ctx } = await this.ctx();
      this.writable(ctx, c);
      const body = strip(c, patch);
      return this.store.transaction(async (s) => {
        if (c === "users") {
          const owners = (await s.list("users")).filter((u) => u.role === "owner" && u.active);
          const target = await s.get("users", id);
          if (target?.role === "owner" && ((body["role"] !== undefined && body["role"] !== "owner") || body["active"] === false) && owners.length <= 1) {
            throw new ApiError("Keep at least one active owner.", 409);
          }
        }
        return patchRow(s, c, id, body, ctx.now);
      });
    });
  }

  remove(c: Collection, id: string) {
    return this.guard(async () => {
      const { ctx } = await this.ctx();
      this.writable(ctx, c);
      await this.store.transaction(async (s) => {
        const row = await s.get(c, id);
        if (!row) throw new ApiError("Not found", 404);
        const why = isDeletable(c, row);
        if (why !== true) throw new ApiError(why, 409);
        await s.remove(c, id);
      });
    });
  }

  action<T>(name: string, input: unknown) {
    return this.guard(async () => {
      const { ctx } = await this.ctx();
      const out = await this.store.transaction((s) => runAction(s, ctx, name, input));
      // Deliver queued WhatsApp/email notifications right away (sandbox in the demo)
      await this.store.transaction((s) => deliverQueued(s, { ...ctx, role: "owner" })).catch(() => undefined);
      return (ctx.role === "agent" ? redactDeep(out) : out) as T;
    });
  }

  report<T>(name: string, params: unknown = {}) {
    return this.guard(async () => {
      const { ctx } = await this.ctx();
      return (await runReport(this.store, ctx, name, params)) as T;
    });
  }

  publicAction<T>(_tenantId: string, name: string, input: unknown) {
    return this.guard(async () => {
      await this.ready;
      const ctx: Ctx = { tenantId: "demo", userId: "public", role: "admin", agentId: null, now: new Date() };
      const out = (await this.store.transaction((s) => runPublicAction(s, ctx, name, input))) as T;
      await this.store.transaction((s) => deliverQueued(s, ctx)).catch(() => undefined);
      return out;
    });
  }

  async integrations() {
    return DEMO_INTEGRATIONS;
  }
  async setIntegration(): Promise<void> {
    throw new ApiError("The demo runs on the built-in sandbox. Connect real accounts on your own server (see README → Going live).", 409);
  }
  async removeIntegration(): Promise<void> {
    throw new ApiError("The demo runs on the built-in sandbox.", 409);
  }
  async testMessage(): Promise<void> {
    throw new ApiError("The demo doesn't send real messages.", 409);
  }
  async fetchSheet(url: string): Promise<string> {
    const m = /\/spreadsheets\/d\/([\w-]+)/.exec(url);
    const target = m && !url.includes("/pub") ? `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv` : url;
    try {
      const r = await fetch(target);
      if (!r.ok) throw new Error(String(r.status));
      return await r.text();
    } catch {
      throw new ApiError("This preview can't reach Google Sheets. Download the sheet as CSV and upload it instead (on your own server the link works directly).", 0);
    }
  }
  publicStore() {
    return this.guard(async () => {
      await this.ready;
      const settings = await getSettings(this.store, new Date());
      const packages = (await this.store.list("packages")).filter((p) => p.published);
      const groups = (await this.store.list("groupDepartures")).filter((g) => g.status === "open").map((g) => ({ id: g.id, name: g.name, departureDate: g.departureDate, seatsLeft: g.seats - g.passengers.length, pricePerSeat: g.pricePerSeat }));
      const landingPages = (await this.store.list("landingPages")).filter((l) => l.published);
      return { company: { name: settings.companyName, phone: settings.phone, email: settings.email, brandColor: settings.brandColor }, packages, groups, landingPages };
    });
  }
}

export const DEMO_INTEGRATIONS: IntegrationsInfo = {
  demo: true, sandbox: true, webhooks: {},
  services: Object.fromEntries(["whatsapp", "email", "razorpay", "stripe", "paypal", "meta", "amadeus", "anthropic", "exotel", "calls"].map((k) => [k, { connected: false, fields: [] }])),
};

function strip(c: Collection, body: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...body };
  for (const f of PROTECTED_FIELDS[c] ?? []) delete copy[f];
  return copy;
}

/* ───────────────────────── Server mode (talks to apps/api) ───────────────────────── */

const TOKEN_KEY = "voyadesk.token";

export class HttpApi implements Api {
  mode = "server" as const;
  tenantId = "";
  constructor(private base: string) {
    try {
      this.token = window.localStorage.getItem(TOKEN_KEY);
    } catch {
      this.token = null;
    }
  }
  token: string | null;

  setToken(token: string | null, tenantId?: string) {
    this.token = token;
    if (tenantId) this.tenantId = tenantId;
    try {
      if (token) window.localStorage.setItem(TOKEN_KEY, token);
      else window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}${path}`, {
        method,
        headers: { "Content-Type": "application/json", ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
    }
    const json = (await res.json().catch(() => ({}))) as { data?: T; error?: { message: string; details?: unknown } };
    if (!res.ok) {
      const d = json.error?.details;
      throw new ApiError(json.error?.message ?? `Request failed (${res.status})`, res.status, d && typeof d === "object" && !Array.isArray(d) ? (d as Record<string, string>) : undefined);
    }
    return json.data as T;
  }

  async login(email: string, password: string) {
    const r = await this.call<{ token: string; tenantId: string }>("POST", "/api/v1/auth/login", { email, password });
    this.setToken(r.token, r.tenantId);
  }

  async signup(input: { companyName: string; name: string; email: string; password: string; businessTypes: string[]; demo: boolean }) {
    const r = await this.call<{ token: string; tenantId: string }>("POST", "/api/v1/auth/signup", input);
    this.setToken(r.token, r.tenantId);
  }

  async me() {
    const r = await this.call<{ user: User; settings: Settings; tenantId: string }>("GET", "/api/v1/auth/me");
    this.tenantId = r.tenantId;
    return r;
  }
  list<C extends Collection>(c: C) { return this.call<Entity<C>[]>("GET", `/api/v1/data/${c}`); }
  get<C extends Collection>(c: C, id: string) { return this.call<Entity<C>>("GET", `/api/v1/data/${c}/${encodeURIComponent(id)}`); }
  create<C extends Collection>(c: C, data: Record<string, unknown>) { return this.call<Entity<C>>("POST", `/api/v1/data/${c}`, data); }
  update<C extends Collection>(c: C, id: string, patch: Record<string, unknown>) { return this.call<Entity<C>>("PATCH", `/api/v1/data/${c}/${encodeURIComponent(id)}`, patch); }
  async remove(c: Collection, id: string) { await this.call("DELETE", `/api/v1/data/${c}/${encodeURIComponent(id)}`); }
  action<T>(name: string, input: unknown) { return this.call<T>("POST", `/api/v1/actions/${name}`, input); }
  report<T>(name: string, params: unknown = {}) { return this.call<T>("GET", `/api/v1/reports/${name}?params=${encodeURIComponent(JSON.stringify(params))}`); }
  publicAction<T>(tenantId: string, name: string, input: unknown) { return this.call<T>("POST", `/api/v1/public/${encodeURIComponent(tenantId)}/actions/${name}`, input); }
  publicStore(tenantId: string) { return this.call<PublicStore>("GET", `/api/v1/public/${encodeURIComponent(tenantId)}/store`); }
  async integrations() { return { ...(await this.call<Omit<IntegrationsInfo, "demo">>("GET", "/api/v1/integrations")), demo: false }; }
  async setIntegration(service: string, values: Record<string, string>) { await this.call("PUT", `/api/v1/integrations/${service}`, values); }
  async removeIntegration(service: string) { await this.call("DELETE", `/api/v1/integrations/${service}`); }
  async testMessage(to: string) { await this.call("POST", "/api/v1/integrations/test-message", { to }); }
  async fetchSheet(url: string) { return (await this.call<{ csv: string }>("GET", `/api/v1/import/sheet?url=${encodeURIComponent(url)}`)).csv; }
}

const apiUrl = (import.meta.env["VITE_API_URL"] as string | undefined)?.replace(/\/$/, "");
export const api: Api = apiUrl !== undefined && apiUrl !== "" ? new HttpApi(apiUrl) : new LocalApi();
export const isDemo = api.mode === "demo";
