import { mkdirSync } from "node:fs";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
}

/** Minimal interface shared by node-postgres and embedded PGlite. */
export interface Tx {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Db extends Tx {
  /** Run fn in one transaction; everything rolls back if it throws. */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: "postgres" | "pglite";
  /** Restricted role that tenant transactions switch to so row-level security always applies. */
  appRole: string | null;
}

class PgDb implements Db {
  kind = "postgres" as const;
  appRole: string | null = null;
  constructor(private pool: pg.Pool) {}

  async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const r = await this.pool.query(sql, params);
    return { rows: r.rows as T[] };
  }

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const tx: Tx = {
        query: async <R>(sql: string, params: unknown[] = []) => ({ rows: (await client.query(sql, params)).rows as R[] }),
      };
      const out = await fn(tx);
      await client.query("COMMIT");
      return out;
    } catch (e) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

class LiteDb implements Db {
  kind = "pglite" as const;
  appRole: string | null = null;
  /** PGlite runs one connection; serialise transactions so they never interleave. */
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private lite: PGlite) {}

  async query<T>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const r = await this.lite.query<T>(sql, params);
    return { rows: r.rows };
  }

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const run = async () =>
      this.lite.transaction(async (t) => fn({ query: async <R>(sql: string, params: unknown[] = []) => ({ rows: (await t.query<R>(sql, params)).rows }) }));
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  async close() {
    await this.lite.close();
  }
}

/**
 * DATABASE_URL set → real PostgreSQL (production).
 * Otherwise → embedded PostgreSQL (PGlite) stored in PGLITE_DIR, or in memory for tests.
 */
export async function openDb(opts: { url?: string | undefined; dir?: string | undefined } = {}): Promise<Db> {
  // PGlite creates only the last folder; make sure the parents exist (fresh checkout has no .data/).
  if (!opts.url && opts.dir && !opts.dir.includes("://")) mkdirSync(opts.dir, { recursive: true });
  const db: Db = opts.url
    ? new PgDb(new pg.Pool({ connectionString: opts.url, max: 10 }))
    : new LiteDb(opts.dir ? new PGlite(opts.dir) : new PGlite());
  await migrate(db);
  return db;
}

const MIGRATION = `
CREATE TABLE IF NOT EXISTS tenants (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS credentials (
  user_id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Every business record: one row per entity, payload validated by @voyadesk/core schemas.
CREATE TABLE IF NOT EXISTS records (
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  collection text NOT NULL,
  id text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id, collection, id)
);
CREATE INDEX IF NOT EXISTS records_by_collection ON records (tenant_id, collection, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS invoice_number_unique ON records (tenant_id, (data->>'number')) WHERE collection = 'invoices';
CREATE UNIQUE INDEX IF NOT EXISTS quote_token_unique ON records ((data->>'shareToken')) WHERE collection = 'quotes' AND data->>'shareToken' <> '';

CREATE TABLE IF NOT EXISTS counters (
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key text NOT NULL,
  value integer NOT NULL,
  PRIMARY KEY (tenant_id, key)
);

-- Per-agency integration keys (encrypted by the API). Not granted to the restricted app role.
CREATE TABLE IF NOT EXISTS tenant_secrets (
  tenant_id text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  service text NOT NULL,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, service)
);

-- Tenant isolation enforced by the database itself (defence in depth on top of the API).
ALTER TABLE records ENABLE ROW LEVEL SECURITY;
ALTER TABLE records FORCE ROW LEVEL SECURITY;
ALTER TABLE counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE counters FORCE ROW LEVEL SECURITY;
`;

async function migrate(db: Db) {
  const statements = MIGRATION.split(/;\s*\n/)
    .map((s) => s.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").trim())
    .filter(Boolean);
  for (const sql of statements) await db.query(sql);
  const policies = await db.query<{ policyname: string }>("SELECT policyname FROM pg_policies WHERE tablename IN ('records','counters')");
  const have = new Set(policies.rows.map((p) => p.policyname));
  if (!have.has("records_tenant")) {
    await db.query("CREATE POLICY records_tenant ON records USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true))");
  }
  if (!have.has("counters_tenant")) {
    await db.query("CREATE POLICY counters_tenant ON counters USING (tenant_id = current_setting('app.tenant_id', true)) WITH CHECK (tenant_id = current_setting('app.tenant_id', true))");
  }
  // Superusers and table owners can bypass RLS, so tenant work runs as a restricted role.
  try {
    const role = await db.query("SELECT 1 FROM pg_roles WHERE rolname = 'voyadesk_app'");
    if (role.rows.length === 0) await db.query("CREATE ROLE voyadesk_app NOLOGIN");
    await db.query("GRANT SELECT, INSERT, UPDATE, DELETE ON records, counters TO voyadesk_app");
    await db.query("GRANT voyadesk_app TO CURRENT_USER").catch(() => undefined);
    db.appRole = "voyadesk_app";
  } catch (e) {
    console.warn("[db] Could not create the voyadesk_app role; relying on API-level tenant checks plus FORCE RLS.", (e as Error).message);
    db.appRole = null;
  }
  const constraint = await db.query("SELECT 1 FROM pg_constraint WHERE conname = 'ledger_amounts_valid'");
  if (constraint.rows.length === 0) {
    await db.query(`ALTER TABLE records ADD CONSTRAINT ledger_amounts_valid CHECK (
      collection <> 'ledger' OR ((data->>'debit')::bigint >= 0 AND (data->>'credit')::bigint >= 0 AND ((data->>'debit')::bigint = 0 OR (data->>'credit')::bigint = 0))
    )`);
  }
}
