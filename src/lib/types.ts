/**
 * Modelo de dominio de "Gastos" (clon mejorado de Money Manager).
 *
 * Cada interface corresponde a una pestaña (tab) de la Google Sheet.
 * Todas las filas tienen `id` (uuid) y `created_at`/`updated_at` ISO.
 * Los montos se guardan como número (unidad de la moneda, 2 decimales).
 * Las fechas se guardan como string ISO `YYYY-MM-DD` (fecha) o ISO completo (timestamps).
 */
import { z } from "zod";

// ---------- Enums ----------
export const AccountTypes = ["cash", "bank", "credit_card", "wallet", "partner"] as const;
export type AccountType = (typeof AccountTypes)[number];

export const TransactionTypes = ["expense", "income", "transfer", "card_payment"] as const;
export type TransactionType = (typeof TransactionTypes)[number];

/** posted: impacta cashflow. pending_card: consumo de tarjeta aún no pagado (no es gasto efectivo). */
export const TransactionStatuses = ["posted", "pending_card"] as const;
export type TransactionStatus = (typeof TransactionStatuses)[number];

export const CategoryTypes = ["expense", "income"] as const;
export type CategoryType = (typeof CategoryTypes)[number];

export const PaidBy = ["me", "partner"] as const;
export type PaidByType = (typeof PaidBy)[number];

export const StatementStatuses = ["open", "closed", "paid"] as const;
export type StatementStatus = (typeof StatementStatuses)[number];

// ---------- Base ----------
export interface BaseRow {
  id: string;
  created_at: string;
  updated_at: string;
}

// ---------- Accounts ----------
export interface Account extends BaseRow {
  name: string;
  type: AccountType;
  currency: string; // "ARS", "USD", ...
  initial_balance: number;
  /** Solo tarjetas de crédito: día del mes en que cierra el resumen (1-31). */
  closing_day: number | null;
  /** Solo tarjetas de crédito: día del mes de vencimiento del pago (1-31). */
  due_day: number | null;
  /** Solo tarjetas de crédito: límite de crédito opcional. */
  credit_limit: number | null;
  color: string;
  icon: string;
  archived: boolean;
  sort_order: number;
}

// ---------- Categories ----------
export interface Category extends BaseRow {
  name: string;
  type: CategoryType;
  icon: string;
  color: string;
  parent_id: string | null;
  archived: boolean;
  sort_order: number;
}

// ---------- Transactions ----------
export interface Transaction extends BaseRow {
  /** Fecha de la operación (compra / ingreso). YYYY-MM-DD */
  date: string;
  /**
   * Fecha en que impacta el cashflow. Para gastos normales = date.
   * Para consumos con tarjeta = fecha de pago del resumen (null hasta que se paga).
   */
  effective_date: string | null;
  type: TransactionType;
  status: TransactionStatus;
  amount: number; // siempre positivo
  currency: string;
  account_id: string; // cuenta origen (para income: cuenta destino)
  to_account_id: string | null; // solo transfer / card_payment (tarjeta que se paga)
  category_id: string | null;
  note: string;
  // --- Tarjeta de crédito ---
  card_statement_id: string | null; // resumen al que quedó asociado el consumo
  installments_total: number | null; // cantidad de cuotas (null o 1 = sin cuotas)
  installment_number: number | null; // nro de cuota (1..N)
  installment_group_id: string | null; // agrupa las N cuotas de una misma compra
  // --- Gasto compartido con la pareja ---
  is_shared: boolean;
  paid_by: PaidByType; // quién puso la plata
  /** Porcentaje (0-100) del gasto que me corresponde a mí. */
  my_share_pct: number | null;
  settlement_id: string | null; // liquidación en la que se saldó
}

// ---------- Card statements (resúmenes de tarjeta) ----------
export interface CardStatement extends BaseRow {
  account_id: string; // tarjeta
  period_start: string; // YYYY-MM-DD
  period_end: string; // YYYY-MM-DD (fecha de cierre)
  due_date: string; // YYYY-MM-DD (vencimiento)
  status: StatementStatus;
  total: number; // suma de consumos del período
  paid_amount: number | null;
  paid_at: string | null; // YYYY-MM-DD
  paid_from_account_id: string | null;
  payment_transaction_id: string | null; // transacción card_payment generada
}

// ---------- Budgets ----------
export interface Budget extends BaseRow {
  /** YYYY-MM. Presupuesto del mes. */
  month: string;
  /** null = presupuesto total del mes (todas las categorías de gasto). */
  category_id: string | null;
  amount: number;
  /** Umbral (%) a partir del cual se avisa que se está alcanzando. */
  alert_threshold_pct: number;
  /** Si true, se copia automáticamente al mes siguiente. */
  recurring: boolean;
}

// ---------- Settlements (liquidaciones de gastos compartidos) ----------
export interface Settlement extends BaseRow {
  period_start: string; // YYYY-MM-DD (día siguiente al cierre anterior)
  period_end: string; // YYYY-MM-DD (fecha de cierre)
  closed_at: string; // ISO
  default_my_share_pct: number;
  total_shared: number;
  paid_by_me: number;
  paid_by_partner: number;
  my_share: number;
  partner_share: number;
  /** balance > 0: la pareja me debe. balance < 0: yo le debo. */
  balance: number;
  settled: boolean;
  settlement_transaction_id: string | null;
  note: string;
}

// ---------- Settings (clave / valor) ----------
export interface Setting {
  key: string;
  value: string;
}

export interface AppSettings {
  partner_name: string;
  my_name: string;
  default_my_share_pct: number;
  currency: string;
  /** Si true, el presupuesto cuenta consumos de tarjeta por fecha de compra (comprometido). */
  budget_counts_pending_card: boolean;
  ai_model: string;
  /** Primer día del mes contable (1-28). */
  month_start_day: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  partner_name: "Pareja",
  my_name: "Yo",
  default_my_share_pct: 50,
  currency: "ARS",
  budget_counts_pending_card: true,
  ai_model: "deepseek/deepseek-v4-flash-0731:free",
  month_start_day: 1,
};

// ---------- Tablas ----------
export const TABLES = {
  accounts: "accounts",
  categories: "categories",
  transactions: "transactions",
  card_statements: "card_statements",
  budgets: "budgets",
  settlements: "settlements",
  settings: "settings",
} as const;
export type TableName = keyof typeof TABLES;

export interface TableRowMap {
  accounts: Account;
  categories: Category;
  transactions: Transaction;
  card_statements: CardStatement;
  budgets: Budget;
  settlements: Settlement;
  settings: Setting;
}

/** Orden de columnas de cada tab. La primera fila de la Sheet es este header. */
export const TABLE_COLUMNS: { [K in TableName]: (keyof TableRowMap[K] & string)[] } = {
  accounts: [
    "id", "name", "type", "currency", "initial_balance", "closing_day", "due_day",
    "credit_limit", "color", "icon", "archived", "sort_order", "created_at", "updated_at",
  ],
  categories: [
    "id", "name", "type", "icon", "color", "parent_id", "archived", "sort_order",
    "created_at", "updated_at",
  ],
  transactions: [
    "id", "date", "effective_date", "type", "status", "amount", "currency", "account_id",
    "to_account_id", "category_id", "note", "card_statement_id", "installments_total",
    "installment_number", "installment_group_id", "is_shared", "paid_by", "my_share_pct",
    "settlement_id", "created_at", "updated_at",
  ],
  card_statements: [
    "id", "account_id", "period_start", "period_end", "due_date", "status", "total",
    "paid_amount", "paid_at", "paid_from_account_id", "payment_transaction_id",
    "created_at", "updated_at",
  ],
  budgets: [
    "id", "month", "category_id", "amount", "alert_threshold_pct", "recurring",
    "created_at", "updated_at",
  ],
  settlements: [
    "id", "period_start", "period_end", "closed_at", "default_my_share_pct", "total_shared",
    "paid_by_me", "paid_by_partner", "my_share", "partner_share", "balance", "settled",
    "settlement_transaction_id", "note", "created_at", "updated_at",
  ],
  settings: ["key", "value"],
};

// ---------- Zod schemas (validación de entrada de la API) ----------
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)");
const yearMonth = z.string().regex(/^\d{4}-\d{2}$/, "Mes inválido (YYYY-MM)");
const money = z.coerce.number().finite().nonnegative();

export const AccountInput = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(AccountTypes),
  currency: z.string().min(3).max(3).default("ARS"),
  initial_balance: z.coerce.number().finite().default(0),
  closing_day: z.coerce.number().int().min(1).max(31).nullable().default(null),
  due_day: z.coerce.number().int().min(1).max(31).nullable().default(null),
  credit_limit: z.coerce.number().finite().nonnegative().nullable().default(null),
  color: z.string().default("#6366f1"),
  icon: z.string().default("wallet"),
  archived: z.coerce.boolean().default(false),
  sort_order: z.coerce.number().int().default(0),
});
export type AccountInputType = z.infer<typeof AccountInput>;

export const CategoryInput = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(CategoryTypes),
  icon: z.string().default("tag"),
  color: z.string().default("#64748b"),
  parent_id: z.string().nullable().default(null),
  archived: z.coerce.boolean().default(false),
  sort_order: z.coerce.number().int().default(0),
});
export type CategoryInputType = z.infer<typeof CategoryInput>;

export const TransactionInput = z.object({
  date: isoDate,
  type: z.enum(TransactionTypes),
  amount: money.positive(),
  currency: z.string().min(3).max(3).optional(),
  account_id: z.string().min(1),
  to_account_id: z.string().nullable().default(null),
  category_id: z.string().nullable().default(null),
  note: z.string().max(500).default(""),
  installments_total: z.coerce.number().int().min(1).max(60).nullable().default(null),
  is_shared: z.coerce.boolean().default(false),
  paid_by: z.enum(PaidBy).default("me"),
  my_share_pct: z.coerce.number().min(0).max(100).nullable().default(null),
});
export type TransactionInputType = z.infer<typeof TransactionInput>;

export const BudgetInput = z.object({
  month: yearMonth,
  category_id: z.string().nullable().default(null),
  amount: money,
  alert_threshold_pct: z.coerce.number().min(1).max(100).default(80),
  recurring: z.coerce.boolean().default(true),
});
export type BudgetInputType = z.infer<typeof BudgetInput>;

export const SettingsInput = z.object({
  partner_name: z.string().min(1).max(40).optional(),
  my_name: z.string().min(1).max(40).optional(),
  default_my_share_pct: z.coerce.number().min(0).max(100).optional(),
  currency: z.string().min(3).max(3).optional(),
  budget_counts_pending_card: z.coerce.boolean().optional(),
  ai_model: z.string().min(1).optional(),
  month_start_day: z.coerce.number().int().min(1).max(28).optional(),
});
export type SettingsInputType = z.infer<typeof SettingsInput>;
