import express, { type NextFunction, type Request, type Response } from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  ACTION_ONLY, canRead, canWrite, COLLECTIONS, scopeDriverRows, createRow, DomainError, getSettings, isDeletable, newId, patchRow,
  PROTECTED_FIELDS, redactDeep, redactForRole, runAction, runPublicAction, runReport, scopeRows, seedDemo,
  type BusinessType, type Collection, type Ctx, type ModuleKey, type Role, type User,
} from "@voyadesk/core";
import { hashPassword, RateLimiter, signToken, verifyPassword, verifySignature, verifyToken } from "./auth.js";
import { type Db, type Tx } from "./db.js";
import { PgStore } from "./pgStore.js";
import { mountExtras } from "./extra.js";
import { buildProviders } from "./providers.js";
import { SecretBox, TenantSecrets } from "./secrets.js";

export interface AppConfig {
  db: Db;
  jwtSecret: string;
  webhookSecret: string;
  metaVerifyToken: string;
  corsOrigin?: string | undefined;
  webDist?: string | undefined;
  now?: () => Date;
  /** Encrypts per-agency integration keys (defaults to a key derived from jwtSecret). */
  secretsKey?: string | undefined;
  /** Public https address of this API, used in webhook and call-back URLs. */
  publicApiUrl?: string | undefined;
  fetch?: typeof fetch;
}

interface Authed {
  user: User;
  tenantId: string;
  ctx: Ctx;
}

type Handler = (req: Request, res: Response) => Promise<unknown>;

const signupInput = z.object({
  companyName: z.string().trim().min(2, "Company name is required").max(160),
  name: z.string().trim().min(1, "Your name is required").max(160),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").max(200),
  businessTypes: z.array(z.enum(["b2c", "b2b_dmc", "portal", "visa"])).min(1).default(["b2c"]),
  demo: z.boolean().default(false),
});

const loginInput = z.object({ email: z.string().trim().toLowerCase().email("Enter a valid email"), password: z.string().min(1, "Enter your password") });

export function modulesFor(types: BusinessType[]): Partial<Record<ModuleKey, boolean>> {
  return {
    sales: true, itinerary: true, operations: true, finance: true, ai: true,
    marketing: types.includes("b2c") || types.includes("portal"),
    b2b: types.includes("b2b_dmc") || types.includes("portal"),
    portals: types.includes("portal") || types.includes("b2c"),
    visa: types.includes("visa"),
  };
}

export function createApp(cfg: AppConfig) {
  const app = express();
  const now = cfg.now ?? (() => new Date());
  const loginLimiter = new RateLimiter(10, 15 * 60_000);
  const db = cfg.db;
  const secrets = new TenantSecrets(db, new SecretBox(cfg.secretsKey ?? cfg.jwtSecret));
  const providersOf = async (tenantId: string) => buildProviders(tenantId, await secrets.get(tenantId), { fetch: cfg.fetch, publicApiUrl: cfg.publicApiUrl });

  app.disable("x-powered-by");
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    if (cfg.corsOrigin) {
      res.setHeader("Access-Control-Allow-Origin", cfg.corsOrigin);
      res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Signature");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
      if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
      }
    }
    next();
  });
  // Keep the raw body for webhook signature checks
  app.use(express.json({ limit: "12mb", verify: (req, _res, buf) => { (req as Request & { rawBody?: string }).rawBody = buf.toString("utf8"); } }));

  const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).then((out) => {
      if (!res.headersSent) res.json({ data: out ?? null });
    }).catch(next);
  };

  /** Run work inside one transaction scoped to a tenant. */
  const inTenant = <T>(tenantId: string, fn: (store: PgStore, tx: Tx) => Promise<T>) =>
    db.transaction(async (tx) => fn(await PgStore.open(tx, tenantId, db.appRole), tx));

  async function authenticate(req: Request): Promise<Authed> {
    const header = req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const claims = token ? verifyToken(token, cfg.jwtSecret) : null;
    if (!claims) throw new DomainError("Please sign in again.", 401);
    const user = await inTenant(claims.tid, (s) => s.get("users", claims.sub));
    if (!user || !user.active) throw new DomainError("Your account is not active.", 401);
    const ctx: Ctx = { tenantId: claims.tid, userId: user.id, role: user.role as Role, agentId: user.agentId, now: now(), providers: await providersOf(claims.tid) };
    return { user, tenantId: claims.tid, ctx };
  }

  const collectionParam = (raw: string | undefined): Collection => {
    if (!raw || !(COLLECTIONS as string[]).includes(raw)) throw new DomainError(`Unknown collection "${raw ?? ""}"`, 404);
    return raw as Collection;
  };

  /* ───────────── health ───────────── */
  app.get("/health", wrap(async () => {
    await db.query("SELECT 1");
    return { ok: true, db: db.kind, rls: Boolean(db.appRole), time: now().toISOString() };
  }));

  /* ───────────── auth ───────────── */
  app.post("/api/v1/auth/signup", wrap(async (req) => {
    const i = signupInput.parse(req.body);
    const exists = await db.query("SELECT 1 FROM credentials WHERE email = $1", [i.email]);
    if (exists.rows.length) throw new DomainError("An account with this email already exists. Sign in instead.", 409);
    const tenantId = newId("tnt");
    const passwordHash = await hashPassword(i.password);
    const t = now();
    // One transaction: tenant, settings, owner and credentials are created together or not at all
    const user = await db.transaction(async (tx) => {
      await tx.query("INSERT INTO tenants (id, name) VALUES ($1, $2)", [tenantId, i.companyName]);
      const s = await PgStore.open(tx, tenantId, db.appRole);
      if (i.demo) await seedDemo(s, t, tenantId);
      const st = await getSettings(s, t);
      await patchRow(s, "settings", st.id, { companyName: i.companyName, businessTypes: i.businessTypes, modules: modulesFor(i.businessTypes), email: i.email }, t);
      const u = await createRow(s, "users", { name: i.name, email: i.email, role: "owner", title: "Owner" }, t);
      await tx.query("RESET ROLE");
      await tx.query("INSERT INTO credentials (user_id, tenant_id, email, password_hash) VALUES ($1, $2, $3, $4)", [u.id, tenantId, i.email, passwordHash]);
      return u;
    });
    // Agencies that start with sample data begin in sandbox (test) mode; they switch it off when they connect real accounts
    if (i.demo) await secrets.set(tenantId, "sandbox", { enabled: "true" });
    return { token: signToken({ sub: user.id, tid: tenantId }, cfg.jwtSecret), user, tenantId };
  }));

  app.post("/api/v1/auth/login", wrap(async (req) => {
    const i = loginInput.parse(req.body);
    if (!loginLimiter.allow(`${req.ip}:${i.email}`)) throw new DomainError("Too many attempts. Try again in 15 minutes.", 429);
    const r = await db.query<{ user_id: string; tenant_id: string; password_hash: string }>("SELECT user_id, tenant_id, password_hash FROM credentials WHERE email = $1", [i.email]);
    const row = r.rows[0];
    const ok = row ? await verifyPassword(i.password, row.password_hash) : await verifyPassword(i.password, "scrypt$AAAA$AAAA").then(() => false);
    if (!row || !ok) throw new DomainError("Email or password is incorrect.", 401);
    const user = await inTenant(row.tenant_id, (s) => s.get("users", row.user_id));
    if (!user?.active) throw new DomainError("Your account is not active. Ask your admin.", 403);
    return { token: signToken({ sub: user.id, tid: row.tenant_id }, cfg.jwtSecret), user, tenantId: row.tenant_id };
  }));

  app.get("/api/v1/auth/me", wrap(async (req) => {
    const a = await authenticate(req);
    const settings = await inTenant(a.tenantId, (s) => getSettings(s, a.ctx.now));
    return { user: a.user, tenantId: a.tenantId, settings };
  }));

  app.post("/api/v1/auth/password", wrap(async (req) => {
    const a = await authenticate(req);
    const i = z.object({ userId: z.string().optional(), password: z.string().min(8, "Use at least 8 characters").max(200) }).parse(req.body);
    const target = i.userId ?? a.user.id;
    if (target !== a.user.id && !["owner", "admin"].includes(a.user.role)) throw new DomainError("Only an admin can set another person's password.", 403);
    const u = await inTenant(a.tenantId, (s) => s.get("users", target));
    if (!u) throw new DomainError("User not found", 404);
    const hash = await hashPassword(i.password);
    await db.query(
      `INSERT INTO credentials (user_id, tenant_id, email, password_hash) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, email = EXCLUDED.email`,
      [u.id, a.tenantId, u.email, hash],
    );
    return { ok: true };
  }));

  /* ───────────── generic data API ───────────── */
  app.get("/api/v1/data/:collection", wrap(async (req) => {
    const a = await authenticate(req);
    const c = collectionParam(req.params["collection"]);
    if (!canRead(a.user.role as Role, c)) throw new DomainError("You don't have access to this.", 403);
    const rows = await inTenant(a.tenantId, async (s) => {
      const all = await s.list(c);
      return a.ctx.role === "driver" ? scopeDriverRows(c, all, await s.list("assignments"), a.user.resourceId) : all;
    });
    return scopeRows(a.ctx.role, c, rows, { userId: a.user.id, agentId: a.user.agentId }).map((r) => redactForRole(a.ctx.role, c, r));
  }));

  app.get("/api/v1/data/:collection/:id", wrap(async (req) => {
    const a = await authenticate(req);
    const c = collectionParam(req.params["collection"]);
    if (!canRead(a.ctx.role, c)) throw new DomainError("You don't have access to this.", 403);
    const scoped = await inTenant(a.tenantId, async (s) => {
      const row = await s.get(c, String(req.params["id"]));
      if (!row) return [];
      return a.ctx.role === "driver" ? scopeDriverRows(c, [row], await s.list("assignments"), a.user.resourceId) : [row];
    });
    const visible = scoped.length ? scopeRows(a.ctx.role, c, scoped, { userId: a.user.id, agentId: a.user.agentId })[0] : undefined;
    if (!visible) throw new DomainError("Not found", 404);
    return redactForRole(a.ctx.role, c, visible);
  }));

  const assertWritable = (a: Authed, c: Collection) => {
    if (["agent", "driver"].includes(a.ctx.role)) throw new DomainError("Use the portal actions to make changes.", 403);
    if (ACTION_ONLY.has(c)) throw new DomainError("This record is created by workflows only (to keep the books correct).", 409);
    if (!canWrite(a.ctx.role, c)) throw new DomainError("You don't have permission to change this.", 403);
  };

  app.post("/api/v1/data/:collection", wrap(async (req, res) => {
    const a = await authenticate(req);
    const c = collectionParam(req.params["collection"]);
    assertWritable(a, c);
    const body = stripProtected(c, req.body);
    const row = await inTenant(a.tenantId, async (s) => {
      if (c === "settings" && (await s.list("settings")).length) throw new DomainError("Settings already exist; update them instead.", 409);
      if (c === "users" && body["role"] === "owner" && a.ctx.role !== "owner") throw new DomainError("Only the owner can add another owner.", 403);
      return createRow(s, c, body as never, a.ctx.now);
    });
    res.status(201);
    return row;
  }));

  app.patch("/api/v1/data/:collection/:id", wrap(async (req) => {
    const a = await authenticate(req);
    const c = collectionParam(req.params["collection"]);
    assertWritable(a, c);
    const id = String(req.params["id"]);
    const body = stripProtected(c, req.body);
    return inTenant(a.tenantId, async (s) => {
      if (c === "users") {
        const target = await s.get("users", id);
        const owners = (await s.list("users")).filter((u) => u.role === "owner" && u.active);
        if (target?.role === "owner" && (body["role"] !== undefined && body["role"] !== "owner" || body["active"] === false) && owners.length <= 1) {
          throw new DomainError("Keep at least one active owner.", 409);
        }
        if (body["role"] === "owner" && a.ctx.role !== "owner") throw new DomainError("Only the owner can make someone an owner.", 403);
      }
      return patchRow(s, c, id, body, a.ctx.now);
    });
  }));

  app.delete("/api/v1/data/:collection/:id", wrap(async (req) => {
    const a = await authenticate(req);
    const c = collectionParam(req.params["collection"]);
    assertWritable(a, c);
    const id = String(req.params["id"]);
    return inTenant(a.tenantId, async (s) => {
      const row = await s.get(c, id);
      if (!row) throw new DomainError("Not found", 404);
      const why = isDeletable(c, row);
      if (why !== true) throw new DomainError(why, 409);
      await s.remove(c, id);
      return { ok: true };
    });
  }));

  /* ───────────── workflows and reports ───────────── */
  app.post("/api/v1/actions/:name", wrap(async (req) => {
    const a = await authenticate(req);
    const out = await inTenant(a.tenantId, (s) => runAction(s, a.ctx, String(req.params["name"]), req.body));
    return a.ctx.role === "agent" ? redactDeep(out) : out;
  }));

  app.get("/api/v1/reports/:name", wrap(async (req) => {
    const a = await authenticate(req);
    let params: unknown = {};
    if (typeof req.query["params"] === "string") {
      try {
        params = JSON.parse(req.query["params"]);
      } catch {
        throw new DomainError("Report parameters must be JSON", 422);
      }
    }
    return inTenant(a.tenantId, (s) => runReport(s, a.ctx, String(req.params["name"]), params));
  }));

  /* ───────────── public pages: proposal, storefront, visa tracker ───────────── */
  const publicCtx = async (tenantId: string): Promise<Ctx> => ({ tenantId, userId: "public", role: "admin", agentId: null, now: now(), providers: await providersOf(tenantId) });

  app.get("/api/v1/public/:tenantId/store", wrap(async (req) => {
    const tenantId = String(req.params["tenantId"]);
    return inTenant(tenantId, async (s) => {
      const settings = await getSettings(s, now());
      const packages = (await s.list("packages")).filter((p) => p.published);
      const groups = (await s.list("groupDepartures")).filter((g) => g.status === "open").map((g) => ({ id: g.id, name: g.name, departureDate: g.departureDate, seatsLeft: g.seats - g.passengers.length, pricePerSeat: g.pricePerSeat }));
      const landingPages = (await s.list("landingPages")).filter((l) => l.published);
      return { company: { name: settings.companyName, phone: settings.phone, email: settings.email, brandColor: settings.brandColor }, packages, groups, landingPages };
    });
  }));

  app.post("/api/v1/public/:tenantId/actions/:name", wrap(async (req) => {
    const tenantId = String(req.params["tenantId"]);
    const t = await db.query("SELECT 1 FROM tenants WHERE id = $1", [tenantId]);
    if (!t.rows.length) throw new DomainError("Not found", 404);
    const ctx = await publicCtx(tenantId);
    return inTenant(tenantId, (s) => runPublicAction(s, ctx, String(req.params["name"]), req.body));
  }));

  /* ───────────── integrations, payment/WhatsApp/Meta/call/email webhooks, sheet import ───────────── */
  mountExtras(app, {
    db, secrets, providersOf, inTenant: (tid, fn) => inTenant(tid, (s) => fn(s)), now, publicApiUrl: cfg.publicApiUrl, webhookSecret: cfg.webhookSecret, fetch: cfg.fetch,
    authenticate: async (req) => { const a = await authenticate(req); return { ctx: a.ctx, tenantId: a.tenantId }; },
  });
  app.locals["voyadesk"] = { secrets, providersOf, inTenant: <T>(tid: string, fn: (s: PgStore) => Promise<T>) => inTenant(tid, (s) => fn(s)) };

  /* ───────────── webhooks: WhatsApp and Meta lead ads ───────────── */
  app.get("/api/v1/webhooks/:tenantId/meta", (req, res) => {
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === cfg.metaVerifyToken) {
      res.status(200).send(String(req.query["hub.challenge"] ?? ""));
    } else res.status(403).json({ error: { message: "Verification failed" } });
  });

  app.post("/api/v1/webhooks/:tenantId/:source", wrap(async (req) => {
    const raw = (req as Request & { rawBody?: string }).rawBody ?? "";
    if (!verifySignature(raw, req.header("x-signature") ?? req.header("x-hub-signature-256"), cfg.webhookSecret)) {
      throw new DomainError("Invalid signature", 401);
    }
    const tenantId = String(req.params["tenantId"]);
    const source = String(req.params["source"]);
    const body = z.object({ name: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), text: z.string().min(1) }).parse(req.body);
    const ctx: Ctx = { tenantId, userId: "webhook", role: "admin", agentId: null, now: now(), providers: await providersOf(tenantId) };
    return inTenant(tenantId, (s) =>
      source === "whatsapp"
        ? runAction(s, ctx, "inboundMessage", { channel: "whatsapp", from: body.name, phone: body.phone, body: body.text })
        : runAction(s, ctx, "captureLead", { name: body.name, phone: body.phone, email: body.email, text: body.text, source: source === "meta" ? "meta_ads" : "website" }),
    );
  }));

  /* ───────────── single-server deploy: serve the web app ───────────── */
  if (cfg.webDist && existsSync(path.join(cfg.webDist, "index.html"))) {
    app.use(express.static(cfg.webDist, { index: "index.html", maxAge: "1h" }));
  }

  app.use("/api", (_req, res) => res.status(404).json({ error: { message: "Not found" } }));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof DomainError) {
      res.status(err.status).json({ error: { message: err.message, details: err.details ?? null } });
      return;
    }
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      res.status(422).json({ error: { message: first ? `${first.path.join(".") || "Input"}: ${first.message}` : "Invalid input", details: err.issues } });
      return;
    }
    if (err instanceof SyntaxError && "body" in (err as object)) {
      res.status(400).json({ error: { message: "Request body is not valid JSON" } });
      return;
    }
    const pgErr = err as { code?: string; constraint?: string };
    if (pgErr?.code === "23505") {
      res.status(409).json({ error: { message: "That record already exists (duplicate number or email)." } });
      return;
    }
    const ref = newId("err");
    console.error(JSON.stringify({ level: "error", ref, path: req.path, message: (err as Error)?.message, stack: (err as Error)?.stack }));
    res.status(500).json({ error: { message: `Something went wrong on our side (ref ${ref}). Nothing was saved.` } });
  });

  return app;
}

function stripProtected(c: Collection, body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new DomainError("Send a JSON object", 422);
  const copy = { ...(body as Record<string, unknown>) };
  for (const f of PROTECTED_FIELDS[c] ?? []) delete copy[f];
  return copy;
}
