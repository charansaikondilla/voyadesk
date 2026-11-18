import { type Collection, type Entity } from "./entities.js";
import { type Store } from "./store.js";

export interface MemoryData {
  rows: Partial<Record<Collection, Record<string, unknown>[]>>;
  seq: Record<string, number>;
}

/**
 * In-memory Store used by tests and by the browser demo (which persists the snapshot
 * to localStorage). Rows are deep-copied on the way in and out so callers can never
 * mutate stored state by accident.
 */
export class MemoryStore implements Store {
  data: MemoryData;
  private onChange: ((d: MemoryData) => void) | undefined;

  constructor(initial?: MemoryData, onChange?: (d: MemoryData) => void) {
    this.data = initial ? clone(initial) : { rows: {}, seq: {} };
    this.onChange = onChange;
  }

  private table<C extends Collection>(c: C): Entity<C>[] {
    const t = (this.data.rows[c] ??= []);
    return t as unknown as Entity<C>[];
  }

  private changed() {
    this.onChange?.(this.data);
  }

  async list<C extends Collection>(c: C): Promise<Entity<C>[]> {
    return clone(this.table(c));
  }

  async get<C extends Collection>(c: C, id: string): Promise<Entity<C> | undefined> {
    const row = this.table(c).find((r) => r.id === id);
    return row ? clone(row) : undefined;
  }

  async insert<C extends Collection>(c: C, row: Entity<C>): Promise<Entity<C>> {
    const t = this.table(c);
    if (t.some((r) => r.id === row.id)) throw new Error(`Duplicate id ${row.id}`);
    t.push(clone(row));
    this.changed();
    return clone(row);
  }

  async update<C extends Collection>(c: C, id: string, row: Entity<C>): Promise<Entity<C>> {
    const t = this.table(c);
    const i = t.findIndex((r) => r.id === id);
    if (i < 0) throw new Error(`Row ${id} not found in ${c}`);
    t[i] = clone(row);
    this.changed();
    return clone(row);
  }

  async remove(c: Collection, id: string): Promise<void> {
    const t = this.table(c);
    const i = t.findIndex((r) => r.id === id);
    if (i >= 0) t.splice(i, 1);
    this.changed();
  }

  async nextSeq(key: string): Promise<number> {
    const n = (this.data.seq[key] ?? 0) + 1;
    this.data.seq[key] = n;
    this.changed();
    return n;
  }

  /** Run fn atomically: if it throws, every change it made is rolled back. */
  async transaction<T>(fn: (s: MemoryStore) => Promise<T>): Promise<T> {
    const snapshot = clone(this.data);
    const notify = this.onChange;
    this.onChange = undefined;
    try {
      const out = await fn(this);
      this.onChange = notify;
      this.changed();
      return out;
    } catch (e) {
      this.data = snapshot;
      this.onChange = notify;
      throw e;
    }
  }
}

function clone<T>(v: T): T {
  return v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T);
}
