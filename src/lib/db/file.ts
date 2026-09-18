import { promises as fs } from "node:fs";
import path from "node:path";
import type { Driver, RawRow } from "./driver";
import { TABLE_COLUMNS } from "../types";

type Store = Record<string, RawRow[]>;

/**
 * Driver de desarrollo: guarda todo en un JSON local (`.data/db.json`).
 * Con `filePath = null` funciona 100% en memoria (tests).
 */
export class FileDriver implements Driver {
  private store: Store | null = null;
  private lock: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string | null) {}

  private async load(): Promise<Store> {
    if (this.store) return this.store;
    if (!this.filePath) {
      this.store = {};
      return this.store;
    }
    try {
      const txt = await fs.readFile(this.filePath, "utf8");
      this.store = JSON.parse(txt) as Store;
    } catch {
      this.store = {};
    }
    return this.store;
  }

  private async persist(): Promise<void> {
    if (!this.filePath || !this.store) return;
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.store, null, 2), "utf8");
    await fs.rename(tmp, this.filePath);
  }

  /** Serializa las escrituras para evitar carreras. */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async ensureSchema(): Promise<void> {
    await this.withLock(async () => {
      const s = await this.load();
      for (const t of Object.keys(TABLE_COLUMNS)) if (!s[t]) s[t] = [];
      await this.persist();
    });
  }

  async readAll(table: string): Promise<RawRow[]> {
    const s = await this.load();
    return (s[table] ?? []).map((r) => ({ ...r }));
  }

  async append(table: string, rows: RawRow[]): Promise<void> {
    await this.withLock(async () => {
      const s = await this.load();
      s[table] = [...(s[table] ?? []), ...rows.map((r) => ({ ...r }))];
      await this.persist();
    });
  }

  async update(table: string, keyField: string, key: string, row: RawRow): Promise<boolean> {
    return this.withLock(async () => {
      const s = await this.load();
      const list = s[table] ?? [];
      const idx = list.findIndex((r) => String(r[keyField]) === key);
      if (idx < 0) return false;
      list[idx] = { ...row };
      s[table] = list;
      await this.persist();
      return true;
    });
  }

  async remove(table: string, keyField: string, key: string): Promise<boolean> {
    return this.withLock(async () => {
      const s = await this.load();
      const list = s[table] ?? [];
      const idx = list.findIndex((r) => String(r[keyField]) === key);
      if (idx < 0) return false;
      list.splice(idx, 1);
      s[table] = list;
      await this.persist();
      return true;
    });
  }

  async replaceAll(table: string, rows: RawRow[]): Promise<void> {
    await this.withLock(async () => {
      const s = await this.load();
      s[table] = rows.map((r) => ({ ...r }));
      await this.persist();
    });
  }
}
