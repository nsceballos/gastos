import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Driver } from "./driver";
import { FileDriver } from "./file";
import { SheetsDriver } from "./sheets";
import { decodeRow, encodeRow } from "./codec";
import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type BaseRow,
  type TableName,
  type TableRowMap,
} from "../types";

/**
 * Punto de entrada a la base de datos.
 *
 *   const db = getDb();
 *   const txs = await db.transactions.list();
 *   const acc = await db.accounts.create({ name: "Banco", ... });
 *   await db.transactions.update(id, { note: "x" });
 *   await db.transactions.remove(id);
 *
 * Driver según env:
 *   DATA_DRIVER=sheets  -> Google Sheets (default si hay GOOGLE_SHEET_ID)
 *   DATA_DRIVER=file    -> .data/db.json (default en dev sin credenciales)
 *   DATA_DRIVER=memory  -> solo memoria (tests)
 */

type RowTables = Exclude<TableName, "settings">;
type NewRow<K extends RowTables> = Omit<TableRowMap[K], keyof BaseRow> & Partial<BaseRow>;

export class Repo<K extends RowTables> {
  constructor(
    private readonly driver: Driver,
    readonly table: K,
  ) {}

  async list(): Promise<TableRowMap[K][]> {
    const raw = await this.driver.readAll(this.table);
    return raw.map((r) => decodeRow(this.table, r));
  }

  async get(id: string): Promise<TableRowMap[K] | null> {
    const all = await this.list();
    return all.find((r) => (r as BaseRow).id === id) ?? null;
  }

  async create(data: NewRow<K>): Promise<TableRowMap[K]> {
    const [row] = await this.createMany([data]);
    return row;
  }

  async createMany(items: NewRow<K>[]): Promise<TableRowMap[K][]> {
    const now = new Date().toISOString();
    const rows = items.map(
      (d) =>
        ({
          ...d,
          id: d.id ?? randomUUID(),
          created_at: d.created_at ?? now,
          updated_at: now,
        }) as unknown as TableRowMap[K],
    );
    await this.driver.append(
      this.table,
      rows.map((r) => encodeRow(this.table, r)),
    );
    return rows;
  }

  async update(id: string, patch: Partial<Omit<TableRowMap[K], "id" | "created_at">>): Promise<TableRowMap[K]> {
    const current = await this.get(id);
    if (!current) throw new NotFoundError(this.table, id);
    const next = { ...current, ...patch, id, updated_at: new Date().toISOString() } as TableRowMap[K];
    const ok = await this.driver.update(this.table, "id", id, encodeRow(this.table, next));
    if (!ok) throw new NotFoundError(this.table, id);
    return next;
  }

  /** Actualiza varias filas de una sola vez (reescribe la tabla completa). */
  async updateMany(patches: { id: string; patch: Partial<TableRowMap[K]> }[]): Promise<void> {
    if (!patches.length) return;
    const all = await this.list();
    const now = new Date().toISOString();
    const byId = new Map(patches.map((p) => [p.id, p.patch]));
    const next = all.map((r) => {
      const p = byId.get((r as BaseRow).id);
      return p ? ({ ...r, ...p, id: (r as BaseRow).id, updated_at: now } as TableRowMap[K]) : r;
    });
    await this.driver.replaceAll(
      this.table,
      next.map((r) => encodeRow(this.table, r)),
    );
  }

  async remove(id: string): Promise<boolean> {
    return this.driver.remove(this.table, "id", id);
  }

  async removeMany(ids: string[]): Promise<void> {
    if (!ids.length) return;
    const set = new Set(ids);
    const all = await this.list();
    const kept = all.filter((r) => !set.has((r as BaseRow).id));
    await this.driver.replaceAll(
      this.table,
      kept.map((r) => encodeRow(this.table, r)),
    );
  }
}

export class NotFoundError extends Error {
  constructor(table: string, id: string) {
    super(`${table}/${id} no encontrado`);
    this.name = "NotFoundError";
  }
}

export class SettingsRepo {
  constructor(private readonly driver: Driver) {}

  async get(): Promise<AppSettings> {
    const rows = await this.driver.readAll("settings");
    const map = Object.fromEntries(rows.map((r) => [String(r.key), r.value]));
    const s: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
      const v = map[k];
      if (v === undefined || v === null || v === "") continue;
      const def = DEFAULT_SETTINGS[k];
      if (typeof def === "number") s[k] = Number(v);
      else if (typeof def === "boolean") s[k] = v === true || v === "TRUE" || v === "true";
      else s[k] = String(v);
    }
    return s as unknown as AppSettings;
  }

  async set(patch: Partial<AppSettings>): Promise<AppSettings> {
    const current = await this.get();
    const next = { ...current, ...patch };
    await this.driver.replaceAll(
      "settings",
      Object.entries(next).map(([key, value]) => ({ key, value: String(value) })),
    );
    return next;
  }
}

export interface Db {
  driver: Driver;
  accounts: Repo<"accounts">;
  categories: Repo<"categories">;
  transactions: Repo<"transactions">;
  card_statements: Repo<"card_statements">;
  budgets: Repo<"budgets">;
  settlements: Repo<"settlements">;
  settings: SettingsRepo;
}

export function createDb(driver: Driver): Db {
  return {
    driver,
    accounts: new Repo(driver, "accounts"),
    categories: new Repo(driver, "categories"),
    transactions: new Repo(driver, "transactions"),
    card_statements: new Repo(driver, "card_statements"),
    budgets: new Repo(driver, "budgets"),
    settlements: new Repo(driver, "settlements"),
    settings: new SettingsRepo(driver),
  };
}

function resolveDriver(): Driver {
  const mode = process.env.DATA_DRIVER ?? (process.env.GOOGLE_SHEET_ID ? "sheets" : "file");
  if (mode === "sheets") {
    const id = process.env.GOOGLE_SHEET_ID;
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
    const key = process.env.GOOGLE_PRIVATE_KEY;
    if (!id || !email || !key) {
      throw new Error(
        "Faltan GOOGLE_SHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY para DATA_DRIVER=sheets",
      );
    }
    return new SheetsDriver(id, email, key);
  }
  if (mode === "memory") return new FileDriver(null);
  return new FileDriver(process.env.DATA_FILE ?? path.join(process.cwd(), ".data", "db.json"));
}

declare global {
  var __gastosDb: Db | undefined;
}

/** Singleton por proceso (en Vercel: por instancia de función). */
export function getDb(): Db {
  if (!globalThis.__gastosDb) globalThis.__gastosDb = createDb(resolveDriver());
  return globalThis.__gastosDb;
}

/** Solo para tests: DB en memoria aislada. */
export function createMemoryDb(): Db {
  return createDb(new FileDriver(null));
}
