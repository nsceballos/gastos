import type { Cell, RawRow } from "./driver";
import type { TableName, TableRowMap } from "../types";

/**
 * Tipado de columnas por tabla. Todo lo que no figura acá se trata como string|null.
 * Sirve para convertir lo que devuelve la Sheet (strings/números) al tipo del dominio.
 */
const NUMBER_COLS: Record<TableName, string[]> = {
  accounts: ["initial_balance", "closing_day", "due_day", "credit_limit", "sort_order"],
  categories: ["sort_order"],
  transactions: ["amount", "installments_total", "installment_number", "my_share_pct"],
  card_statements: ["total", "paid_amount"],
  budgets: ["amount", "alert_threshold_pct"],
  settlements: [
    "default_my_share_pct", "total_shared", "paid_by_me", "paid_by_partner", "my_share",
    "partner_share", "balance",
  ],
  settings: [],
};

const BOOL_COLS: Record<TableName, string[]> = {
  accounts: ["archived"],
  categories: ["archived"],
  transactions: ["is_shared"],
  card_statements: [],
  budgets: ["recurring"],
  settlements: ["settled"],
  settings: [],
};

/** Columnas que nunca deben ser null (string vacío en vez de null). */
const STRING_NOT_NULL: Record<TableName, string[]> = {
  accounts: ["id", "name", "type", "currency", "color", "icon", "created_at", "updated_at"],
  categories: ["id", "name", "type", "icon", "color", "created_at", "updated_at"],
  transactions: ["id", "date", "type", "status", "currency", "account_id", "note", "paid_by", "created_at", "updated_at"],
  card_statements: ["id", "account_id", "period_start", "period_end", "due_date", "status", "created_at", "updated_at"],
  budgets: ["id", "month", "created_at", "updated_at"],
  settlements: ["id", "period_start", "period_end", "closed_at", "note", "created_at", "updated_at"],
  settings: ["key", "value"],
};

export function decodeRow<K extends TableName>(table: K, raw: RawRow): TableRowMap[K] {
  const out: Record<string, Cell> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (NUMBER_COLS[table].includes(k)) {
      out[k] = v === null || v === "" ? null : Number(v);
      if (Number.isNaN(out[k])) out[k] = null;
    } else if (BOOL_COLS[table].includes(k)) {
      out[k] = v === true || v === "TRUE" || v === "true" || v === 1 || v === "1";
    } else if (STRING_NOT_NULL[table].includes(k)) {
      out[k] = v === null || v === undefined ? "" : String(v);
    } else {
      out[k] = v === null || v === undefined || v === "" ? null : String(v);
    }
  }
  return out as unknown as TableRowMap[K];
}

export function encodeRow<K extends TableName>(_table: K, row: TableRowMap[K]): RawRow {
  const out: RawRow = {};
  for (const [k, v] of Object.entries(row as unknown as Record<string, unknown>)) {
    if (v === undefined || v === null) out[k] = null;
    else if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") out[k] = v;
    else out[k] = JSON.stringify(v);
  }
  return out;
}
