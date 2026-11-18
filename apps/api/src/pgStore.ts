import { type Collection, type Entity, type Store } from "@voyadesk/core";
import { type Tx } from "./db.js";

/**
 * Store backed by PostgreSQL, bound to one tenant and one transaction.
 * The transaction first sets app.tenant_id so row-level security only exposes this tenant's rows.
 */
export class PgStore implements Store {
  private constructor(private tx: Tx, private tenantId: string) {}

  static async open(tx: Tx, tenantId: string, appRole: string | null): Promise<PgStore> {
    await tx.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    if (appRole) await tx.query(`SET LOCAL ROLE ${appRole.replace(/[^a-z_]/g, "")}`);
    return new PgStore(tx, tenantId);
  }

  async list<C extends Collection>(c: C): Promise<Entity<C>[]> {
    const r = await this.tx.query<{ data: Entity<C> }>(
      "SELECT data FROM records WHERE tenant_id = $1 AND collection = $2 ORDER BY created_at, id",
      [this.tenantId, c],
    );
    return r.rows.map((x) => parse(x.data));
  }

  async get<C extends Collection>(c: C, id: string): Promise<Entity<C> | undefined> {
    const r = await this.tx.query<{ data: Entity<C> }>(
      "SELECT data FROM records WHERE tenant_id = $1 AND collection = $2 AND id = $3",
      [this.tenantId, c, id],
    );
    return r.rows[0] ? parse(r.rows[0].data) : undefined;
  }

  async insert<C extends Collection>(c: C, row: Entity<C>): Promise<Entity<C>> {
    await this.tx.query(
      "INSERT INTO records (tenant_id, collection, id, data, created_at, updated_at) VALUES ($1, $2, $3, $4::jsonb, $5, $6)",
      [this.tenantId, c, row.id, JSON.stringify(row), row.createdAt, row.updatedAt],
    );
    return row;
  }

  async update<C extends Collection>(c: C, id: string, row: Entity<C>): Promise<Entity<C>> {
    const r = await this.tx.query(
      "UPDATE records SET data = $4::jsonb, updated_at = $5 WHERE tenant_id = $1 AND collection = $2 AND id = $3 RETURNING id",
      [this.tenantId, c, id, JSON.stringify(row), row.updatedAt],
    );
    if (r.rows.length === 0) throw new Error(`Row ${id} not found in ${c}`);
    return row;
  }

  async remove(c: Collection, id: string): Promise<void> {
    await this.tx.query("DELETE FROM records WHERE tenant_id = $1 AND collection = $2 AND id = $3", [this.tenantId, c, id]);
  }

  async nextSeq(key: string): Promise<number> {
    const r = await this.tx.query<{ value: number }>(
      `INSERT INTO counters (tenant_id, key, value) VALUES ($1, $2, 1)
       ON CONFLICT (tenant_id, key) DO UPDATE SET value = counters.value + 1 RETURNING value`,
      [this.tenantId, key],
    );
    return Number(r.rows[0]!.value);
  }
}

function parse<T>(data: T | string): T {
  return typeof data === "string" ? (JSON.parse(data) as T) : data;
}
