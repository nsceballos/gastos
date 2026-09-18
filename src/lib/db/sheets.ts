import { JWT } from "google-auth-library";
import type { Cell, Driver, RawRow } from "./driver";
import { TABLE_COLUMNS, type TableName } from "../types";

/**
 * Driver Google Sheets (API v4 vía REST + fetch).
 *
 * Cada tabla es una pestaña del spreadsheet. La fila 1 es el header
 * (nombres de columna según TABLE_COLUMNS). Cada fila siguiente es un registro.
 *
 * Variables de entorno:
 *  - GOOGLE_SHEET_ID
 *  - GOOGLE_SERVICE_ACCOUNT_EMAIL
 *  - GOOGLE_PRIVATE_KEY  (con \n escapados o reales)
 *
 * La hoja debe estar compartida con el email de la service account (rol Editor).
 */
const API = "https://sheets.googleapis.com/v4/spreadsheets";

interface SheetMeta {
  sheetId: number;
  title: string;
}

export class SheetsDriver implements Driver {
  private jwt: JWT;
  private metaCache: SheetMeta[] | null = null;
  /** Cache de lecturas por request (se invalida en cada escritura). */
  private readCache = new Map<string, { at: number; rows: RawRow[] }>();
  private readonly cacheMs: number;

  constructor(
    private readonly spreadsheetId: string,
    clientEmail: string,
    privateKey: string,
    opts: { cacheMs?: number } = {},
  ) {
    this.jwt = new JWT({
      email: clientEmail,
      key: privateKey.replace(/\\n/g, "\n"),
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    this.cacheMs = opts.cacheMs ?? 2000;
  }

  // ---------- HTTP ----------
  private async token(): Promise<string> {
    const t = await this.jwt.getAccessToken();
    if (!t.token) throw new Error("No se pudo obtener token de Google");
    return t.token;
  }

  private async call<T>(pathAndQuery: string, init: RequestInit = {}): Promise<T> {
    const token = await this.token();
    const res = await fetch(`${API}/${this.spreadsheetId}${pathAndQuery}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Google Sheets ${res.status}: ${body.slice(0, 500)}`);
    }
    return (await res.json()) as T;
  }

  // ---------- Metadata ----------
  private async meta(force = false): Promise<SheetMeta[]> {
    if (this.metaCache && !force) return this.metaCache;
    const data = await this.call<{ sheets: { properties: { sheetId: number; title: string } }[] }>(
      "?fields=sheets.properties(sheetId,title)",
    );
    this.metaCache = data.sheets.map((s) => ({ sheetId: s.properties.sheetId, title: s.properties.title }));
    return this.metaCache;
  }

  private async sheetId(table: string): Promise<number> {
    const m = (await this.meta()).find((s) => s.title === table);
    if (!m) throw new Error(`No existe la pestaña "${table}". Ejecutá /api/setup`);
    return m.sheetId;
  }

  async ensureSchema(): Promise<void> {
    const existing = await this.meta(true);
    const missing = (Object.keys(TABLE_COLUMNS) as TableName[]).filter(
      (t) => !existing.some((s) => s.title === t),
    );
    if (missing.length) {
      await this.call(":batchUpdate", {
        method: "POST",
        body: JSON.stringify({
          requests: missing.map((title) => ({ addSheet: { properties: { title } } })),
        }),
      });
      await this.meta(true);
    }
    // Header en fila 1 de cada tab (se reescribe siempre: idempotente).
    const data = (Object.keys(TABLE_COLUMNS) as TableName[]).map((t) => ({
      range: `${quote(t)}!A1`,
      values: [TABLE_COLUMNS[t] as string[]],
    }));
    await this.call(":values:batchUpdate", {
      method: "POST",
      body: JSON.stringify({ valueInputOption: "RAW", data }),
    });
    this.readCache.clear();
  }

  // ---------- Lectura ----------
  private async readRaw(table: string): Promise<{ header: string[]; rows: string[][] }> {
    const data = await this.call<{ values?: string[][] }>(
      `/values/${encodeURIComponent(quote(table))}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
    );
    const values = data.values ?? [];
    const header = (values[0] ?? []).map(String);
    return { header, rows: values.slice(1) };
  }

  async readAll(table: string): Promise<RawRow[]> {
    const c = this.readCache.get(table);
    if (c && Date.now() - c.at < this.cacheMs) return c.rows.map((r) => ({ ...r }));
    const { header, rows } = await this.readRaw(table);
    const cols = header.length ? header : (TABLE_COLUMNS[table as TableName] as string[]);
    const out: RawRow[] = [];
    for (const r of rows) {
      if (!r || r.every((v) => v === "" || v === undefined)) continue;
      const obj: RawRow = {};
      cols.forEach((c, i) => (obj[c] = fromCell(r[i])));
      out.push(obj);
    }
    this.readCache.set(table, { at: Date.now(), rows: out });
    return out.map((r) => ({ ...r }));
  }

  // ---------- Escritura ----------
  private serialize(table: string, row: RawRow): Cell[] {
    const cols = TABLE_COLUMNS[table as TableName] as string[];
    return cols.map((c) => toCell(row[c]));
  }

  async append(table: string, rows: RawRow[]): Promise<void> {
    if (!rows.length) return;
    await this.call(
      `/values/${encodeURIComponent(quote(table))}!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      {
        method: "POST",
        body: JSON.stringify({ values: rows.map((r) => this.serialize(table, r)) }),
      },
    );
    this.readCache.delete(table);
  }

  /** Devuelve el índice de fila (1-based en la hoja) para la clave, o -1. */
  private async findRowIndex(table: string, keyField: string, key: string): Promise<number> {
    const { header, rows } = await this.readRaw(table);
    const col = header.indexOf(keyField);
    if (col < 0) return -1;
    const idx = rows.findIndex((r) => String(r[col] ?? "") === key);
    return idx < 0 ? -1 : idx + 2; // +1 header, +1 base-1
  }

  async update(table: string, keyField: string, key: string, row: RawRow): Promise<boolean> {
    const rowIdx = await this.findRowIndex(table, keyField, key);
    if (rowIdx < 0) return false;
    const range = `${quote(table)}!A${rowIdx}`;
    await this.call(`/values/${encodeURIComponent(range)}?valueInputOption=RAW`, {
      method: "PUT",
      body: JSON.stringify({ values: [this.serialize(table, row)] }),
    });
    this.readCache.delete(table);
    return true;
  }

  async remove(table: string, keyField: string, key: string): Promise<boolean> {
    const rowIdx = await this.findRowIndex(table, keyField, key);
    if (rowIdx < 0) return false;
    const sheetId = await this.sheetId(table);
    await this.call(":batchUpdate", {
      method: "POST",
      body: JSON.stringify({
        requests: [
          {
            deleteDimension: {
              range: { sheetId, dimension: "ROWS", startIndex: rowIdx - 1, endIndex: rowIdx },
            },
          },
        ],
      }),
    });
    this.readCache.delete(table);
    return true;
  }

  async replaceAll(table: string, rows: RawRow[]): Promise<void> {
    await this.call(`/values/${encodeURIComponent(`${quote(table)}!A2:ZZ`)}:clear`, {
      method: "POST",
      body: "{}",
    });
    if (rows.length) {
      await this.call(`/values/${encodeURIComponent(`${quote(table)}!A2`)}?valueInputOption=RAW`, {
        method: "PUT",
        body: JSON.stringify({ values: rows.map((r) => this.serialize(table, r)) }),
      });
    }
    this.readCache.delete(table);
  }
}

function quote(title: string): string {
  return `'${title.replace(/'/g, "''")}'`;
}

function toCell(v: Cell | undefined): Cell {
  if (v === undefined || v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return v;
}

function fromCell(v: unknown): Cell {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  const s = String(v);
  if (s === "TRUE") return true;
  if (s === "FALSE") return false;
  return s;
}
