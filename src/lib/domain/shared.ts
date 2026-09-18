/**
 * Gastos compartidos con la pareja + liquidaciones (settlements).
 *
 * Semántica acordada:
 *  - Un gasto con `is_shared = true` se reparte: a mí me corresponde `my_share_pct`%
 *    (si es null, `settings.default_my_share_pct`), a la pareja el resto.
 *  - `paid_by = "me"`   -> la plata salió de una cuenta mía.
 *    `paid_by = "partner"` -> lo pagó la pareja (se registra contra la cuenta
 *    `type: "partner"`, así no afecta mis saldos).
 *  - Los consumos de tarjeta pendientes (`status = "pending_card"`) SÍ cuentan para el
 *    reparto: se divide por fecha de compra, no por fecha de pago del resumen.
 *  - Período abierto = desde el día siguiente al `period_end` del último cierre
 *    (o desde el primer gasto compartido si no hay ninguno) hasta la fecha de cierre.
 *    Se incluyen TODAS las transacciones compartidas sin liquidar con `date <= period_end`,
 *    incluso si su fecha es anterior al `period_start` (gastos cargados tarde): se cuentan
 *    en `late_count` para poder avisar en la UI.
 *  - balance = paid_by_me - my_share.  > 0: la pareja me debe.  < 0: yo le debo.
 */
import { z } from "zod";
import { HttpError } from "../errors";
import type { Db } from "../db";
import type { Account, Category, Settlement, Transaction } from "../types";
import { addDays, myShareAmount, round2, sum, todayISO } from "./core";

// ---------- Tipos ----------
export interface SharedSplit {
  tx: Transaction;
  my_share: number;
  partner_share: number;
}

export interface SharedTotals {
  total_shared: number;
  paid_by_me: number;
  paid_by_partner: number;
  my_share: number;
  partner_share: number;
  /** > 0: la pareja me debe. < 0: le debo. */
  balance: number;
}

export interface SharedComputation {
  items: SharedSplit[];
  totals: SharedTotals;
}

export interface OpenPeriod {
  period_start: string;
  period_end: string;
  transactions: SharedSplit[];
  totals: SharedTotals;
  /** Gastos incluidos cuya fecha es anterior al `period_start` (cargados tarde). */
  late_count: number;
  last_settlement: Settlement | null;
}

/** Cuenta elegible para registrar el movimiento de la liquidación. */
export interface AccountOption {
  id: string;
  name: string;
  type: Account["type"];
  currency: string;
  color: string;
  icon: string;
}

export interface CategoryLite {
  id: string;
  name: string;
  color: string;
  icon: string;
}

export interface SharedSummary extends OpenPeriod {
  partner_name: string;
  my_name: string;
  default_my_share_pct: number;
  currency: string;
  accounts: AccountOption[];
  categories: CategoryLite[];
}

export interface SettlementListItem extends Settlement {
  transaction_count: number;
}

export interface SettlementDetail {
  settlement: Settlement;
  transactions: SharedSplit[];
  totals: SharedTotals;
  partner_name: string;
  my_name: string;
  currency: string;
  accounts: AccountOption[];
  categories: CategoryLite[];
}

// ---------- Validación de entrada ----------
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)");

export const ClosePeriodInput = z.object({
  period_end: isoDate,
  note: z.string().max(500).default(""),
});
export type ClosePeriodInputType = z.infer<typeof ClosePeriodInput>;

export const SettleInput = z.object({
  date: isoDate,
  account_id: z.string().min(1).nullable().default(null),
  /** Solo marcar como saldado, sin registrar el movimiento de dinero. */
  transfer_only: z.coerce.boolean().default(false),
});
export type SettleInputType = z.infer<typeof SettleInput>;

// ---------- Cálculo puro ----------
const EMPTY_TOTALS: SharedTotals = {
  total_shared: 0,
  paid_by_me: 0,
  paid_by_partner: 0,
  my_share: 0,
  partner_share: 0,
  balance: 0,
};

/** ¿Esta transacción entra en el reparto con la pareja? */
export function isSharedExpense(tx: Transaction): boolean {
  return tx.is_shared && tx.type === "expense";
}

/**
 * Reparte cada gasto compartido y devuelve los totales del conjunto.
 * Garantiza `my_share + partner_share === total_shared` (el centavo de diferencia por
 * redondeo se ajusta en la última transacción).
 */
export function computeShared(txs: Transaction[], defaultPct: number): SharedComputation {
  const items: SharedSplit[] = txs.filter(isSharedExpense).map((tx) => {
    const my = myShareAmount(tx, defaultPct);
    return { tx, my_share: my, partner_share: round2(tx.amount - my) };
  });
  if (!items.length) return { items, totals: { ...EMPTY_TOTALS } };

  const total_shared = sum(items.map((i) => i.tx.amount));
  const my_share = sum(items.map((i) => i.my_share));
  let partner_share = sum(items.map((i) => i.partner_share));

  // Ajuste de centavos: la diferencia va a la última transacción (parte de la pareja).
  const drift = round2(total_shared - round2(my_share + partner_share));
  if (drift !== 0) {
    const last = items[items.length - 1];
    last.partner_share = round2(last.partner_share + drift);
    partner_share = round2(partner_share + drift);
  }

  const paid_by_me = sum(items.filter((i) => i.tx.paid_by === "me").map((i) => i.tx.amount));
  const paid_by_partner = round2(total_shared - paid_by_me);
  return {
    items,
    totals: {
      total_shared,
      paid_by_me,
      paid_by_partner,
      my_share,
      partner_share,
      balance: round2(paid_by_me - my_share),
    },
  };
}

/** % que me corresponde en esa transacción (el propio o el default). */
export function txSharePct(tx: Transaction, defaultPct: number): number {
  return tx.my_share_pct ?? defaultPct;
}

/** Último cierre por `period_end` (desempata por `closed_at`). */
export function lastSettlementOf(settlements: Settlement[]): Settlement | null {
  return sortSettlements(settlements)[0] ?? null;
}

function sortSettlements(settlements: Settlement[]): Settlement[] {
  return [...settlements].sort(
    (a, b) => b.period_end.localeCompare(a.period_end) || b.closed_at.localeCompare(a.closed_at),
  );
}

// ---------- Operaciones con db ----------

/** Período abierto: todo lo compartido sin liquidar hasta `until` (default: hoy). */
export async function openPeriod(db: Db, until?: string | null): Promise<OpenPeriod> {
  const [settings, settlements, allTxs] = await Promise.all([
    db.settings.get(),
    db.settlements.list(),
    db.transactions.list(),
  ]);
  return buildOpenPeriod(settings.default_my_share_pct, settlements, allTxs, until);
}

/** Versión pura de `openPeriod` (para reutilizar datos ya cargados). */
export function buildOpenPeriod(
  defaultPct: number,
  settlements: Settlement[],
  allTxs: Transaction[],
  until?: string | null,
): OpenPeriod {
  const period_end = until || todayISO();
  const last = lastSettlementOf(settlements);

  const pending = allTxs
    .filter((t) => isSharedExpense(t) && !t.settlement_id && t.date <= period_end)
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));

  const firstDate = pending.length ? pending[pending.length - 1].date : period_end;
  const period_start = last ? addDays(last.period_end, 1) : firstDate;
  const { items, totals } = computeShared(pending, defaultPct);

  return {
    period_start,
    period_end,
    transactions: items,
    totals,
    late_count: items.filter((i) => i.tx.date < period_start).length,
    last_settlement: last,
  };
}

/** Período abierto + datos de settings/cuentas/categorías que necesita la UI. */
export async function sharedSummary(db: Db, until?: string | null): Promise<SharedSummary> {
  const [settings, settlements, txs, accounts, categories] = await Promise.all([
    db.settings.get(),
    db.settlements.list(),
    db.transactions.list(),
    db.accounts.list(),
    db.categories.list(),
  ]);
  const period = buildOpenPeriod(settings.default_my_share_pct, settlements, txs, until);
  return {
    ...period,
    partner_name: settings.partner_name,
    my_name: settings.my_name,
    default_my_share_pct: settings.default_my_share_pct,
    currency: settings.currency,
    accounts: settleableAccounts(accounts),
    categories: categories.map(toCategoryLite),
  };
}

/** Cuentas donde puede entrar/salir la plata de una liquidación. */
export function settleableAccounts(accounts: Account[]): AccountOption[] {
  return accounts
    .filter((a) => a.type !== "partner" && a.type !== "credit_card" && !a.archived)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((a) => ({ id: a.id, name: a.name, type: a.type, currency: a.currency, color: a.color, icon: a.icon }));
}

function toCategoryLite(c: Category): CategoryLite {
  return { id: c.id, name: c.name, color: c.color, icon: c.icon };
}

/**
 * Cierra el período: crea el `Settlement` y marca las transacciones incluidas.
 * Rechaza si no hay nada para liquidar (409) o si el `period_end` es anterior al
 * inicio del período (400).
 */
export async function closePeriod(db: Db, input: ClosePeriodInputType): Promise<Settlement> {
  const settings = await db.settings.get();
  const period = await openPeriod(db, input.period_end);

  if (input.period_end < period.period_start) {
    throw new HttpError(
      400,
      `La fecha de cierre (${input.period_end}) es anterior al inicio del período (${period.period_start})`,
    );
  }
  if (!period.transactions.length) {
    throw new HttpError(409, "No hay gastos compartidos sin liquidar en el período");
  }

  const settlement = await db.settlements.create({
    period_start: period.period_start,
    period_end: period.period_end,
    closed_at: new Date().toISOString(),
    default_my_share_pct: settings.default_my_share_pct,
    total_shared: period.totals.total_shared,
    paid_by_me: period.totals.paid_by_me,
    paid_by_partner: period.totals.paid_by_partner,
    my_share: period.totals.my_share,
    partner_share: period.totals.partner_share,
    balance: period.totals.balance,
    settled: false,
    settlement_transaction_id: null,
    note: input.note ?? "",
  });

  await db.transactions.updateMany(
    period.transactions.map((i) => ({ id: i.tx.id, patch: { settlement_id: settlement.id } })),
  );
  return settlement;
}

async function requireSettlement(db: Db, id: string): Promise<Settlement> {
  const s = await db.settlements.get(id);
  if (!s) throw new HttpError(404, "Liquidación no encontrada");
  return s;
}

/** Etiqueta del período, para la nota de la transacción de liquidación. */
export function periodLabel(s: Pick<Settlement, "period_start" | "period_end">): string {
  return `${s.period_start} a ${s.period_end}`;
}

/**
 * Marca la liquidación como saldada y (salvo `transfer_only`) registra el movimiento real:
 *  - balance > 0 (me deben): `income` en `account_id`.
 *  - balance < 0 (le debo):  `expense` desde `account_id`.
 *  - balance = 0: solo marca `settled`.
 */
export async function settleSettlement(
  db: Db,
  id: string,
  input: SettleInputType,
): Promise<{ settlement: Settlement; transaction: Transaction | null }> {
  const s = await requireSettlement(db, id);
  if (s.settled) throw new HttpError(409, "La liquidación ya está saldada");

  const amount = round2(Math.abs(s.balance));
  if (input.transfer_only || amount === 0) {
    const settlement = await db.settlements.update(id, { settled: true, settlement_transaction_id: null });
    return { settlement, transaction: null };
  }

  if (!input.account_id) throw new HttpError(400, "Falta la cuenta donde entra/sale la plata");
  const account = await db.accounts.get(input.account_id);
  if (!account) throw new HttpError(400, "La cuenta no existe");
  if (account.type === "partner" || account.type === "credit_card") {
    throw new HttpError(400, "Elegí una cuenta propia (no la de la pareja ni una tarjeta)");
  }

  const settings = await db.settings.get();
  const transaction = await db.transactions.create({
    date: input.date,
    effective_date: input.date,
    type: s.balance > 0 ? "income" : "expense",
    status: "posted",
    amount,
    currency: account.currency || settings.currency,
    account_id: account.id,
    to_account_id: null,
    category_id: null,
    note: `Liquidación pareja ${periodLabel(s)}`,
    card_statement_id: null,
    installments_total: null,
    installment_number: null,
    installment_group_id: null,
    is_shared: false,
    paid_by: "me",
    my_share_pct: null,
    settlement_id: null,
  });

  const settlement = await db.settlements.update(id, {
    settled: true,
    settlement_transaction_id: transaction.id,
  });
  return { settlement, transaction };
}

/** Vuelve atrás el saldo: borra la transacción de liquidación y deja `settled = false`. */
export async function unsettleSettlement(db: Db, id: string): Promise<Settlement> {
  const s = await requireSettlement(db, id);
  if (!s.settled) throw new HttpError(409, "La liquidación no está saldada");
  if (s.settlement_transaction_id) await db.transactions.remove(s.settlement_transaction_id);
  return db.settlements.update(id, { settled: false, settlement_transaction_id: null });
}

/** Reabre el período: devuelve las transacciones al período abierto y borra el cierre. */
export async function reopenSettlement(db: Db, id: string): Promise<{ ok: true; reopened: number }> {
  const s = await requireSettlement(db, id);
  if (s.settled) {
    throw new HttpError(409, "La liquidación está saldada: primero des-saldala para poder reabrirla");
  }
  const txs = (await db.transactions.list()).filter((t) => t.settlement_id === id);
  await db.transactions.updateMany(txs.map((t) => ({ id: t.id, patch: { settlement_id: null } })));
  await db.settlements.remove(id);
  return { ok: true, reopened: txs.length };
}

/** Cierres anteriores, del más reciente al más viejo. */
export async function listSettlements(db: Db): Promise<SettlementListItem[]> {
  const [settlements, txs] = await Promise.all([db.settlements.list(), db.transactions.list()]);
  const counts = new Map<string, number>();
  for (const t of txs) {
    if (t.settlement_id) counts.set(t.settlement_id, (counts.get(t.settlement_id) ?? 0) + 1);
  }
  return sortSettlements(settlements).map((s) => ({ ...s, transaction_count: counts.get(s.id) ?? 0 }));
}

/** Detalle de un cierre: sus transacciones con el reparto que se aplicó. */
export async function settlementDetail(db: Db, id: string): Promise<SettlementDetail> {
  const s = await requireSettlement(db, id);
  const [settings, txs, accounts, categories] = await Promise.all([
    db.settings.get(),
    db.transactions.list(),
    db.accounts.list(),
    db.categories.list(),
  ]);
  const mine = txs
    .filter((t) => t.settlement_id === id)
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
  const { items, totals } = computeShared(mine, s.default_my_share_pct);
  return {
    settlement: s,
    transactions: items,
    totals,
    partner_name: settings.partner_name,
    my_name: settings.my_name,
    currency: settings.currency,
    accounts: settleableAccounts(accounts),
    categories: categories.map(toCategoryLite),
  };
}
