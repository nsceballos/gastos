/**
 * Helpers de dominio compartidos por todos los módulos.
 * Reglas de negocio centrales (NO duplicar en otros módulos):
 *
 *  - Un consumo con tarjeta de crédito nace con status "pending_card" y
 *    effective_date = null. NO es gasto efectivo hasta que se paga el resumen.
 *  - Al pagar el resumen, se crea una transacción `card_payment` (cuenta bancaria -> tarjeta)
 *    que es la salida real de dinero, y los consumos pasan a "posted" con
 *    effective_date = fecha de pago.
 *  - "Gasto por fecha de compra" (comprometido) vs "gasto efectivo" (cashflow) se
 *    calculan con `isCommittedExpense` / `isEffectiveExpense`.
 */
import type { Account, AppSettings, Transaction } from "../types";

// ---------- Fechas ----------
export function todayISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "2026-09-18" -> "2026-09" */
export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7);
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = daysInMonth(target.getUTCFullYear(), target.getUTCMonth() + 1);
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export function daysInMonth(year: number, month1to12: number): number {
  return new Date(Date.UTC(year, month1to12, 0)).getUTCDate();
}

/** Rango [start, end] (inclusive) del mes YYYY-MM, respetando month_start_day. */
export function monthRange(month: string, startDay = 1): { start: string; end: string } {
  const [y, m] = month.split("-").map(Number);
  const day = Math.min(Math.max(startDay, 1), 28);
  if (day === 1) {
    return { start: `${month}-01`, end: `${month}-${String(daysInMonth(y, m)).padStart(2, "0")}` };
  }
  const start = `${month}-${String(day).padStart(2, "0")}`;
  const end = addDays(addMonths(start, 1), -1);
  return { start, end };
}

export function inRange(iso: string, start: string, end: string): boolean {
  return iso >= start && iso <= end;
}

// ---------- Dinero ----------
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function sum(nums: number[]): number {
  return round2(nums.reduce((a, b) => a + b, 0));
}

// ---------- Clasificación de transacciones ----------
export function isCreditCard(acc: Pick<Account, "type"> | null | undefined): boolean {
  return acc?.type === "credit_card";
}

/**
 * ¿Es un gasto mío? Los gastos compartidos que pagó la pareja (`paid_by = "partner"`)
 * se registran contra la cuenta virtual "partner" y NO cuentan como gasto mío: mi parte
 * se salda en la liquidación con la pareja (que genera su propio movimiento).
 * Regla: "gasto = plata que salió (o va a salir) de mis cuentas".
 */
export function isMyExpense(tx: Transaction): boolean {
  return tx.type === "expense" && tx.paid_by !== "partner";
}

/**
 * Gasto "comprometido": todo expense mío por fecha de compra, incluyendo consumos de
 * tarjeta pendientes. Es lo que se usa para presupuesto cuando `budget_counts_pending_card = true`.
 */
export function isCommittedExpense(tx: Transaction): boolean {
  return isMyExpense(tx);
}

/**
 * Gasto "efectivo": salida real de dinero.
 *  - expense mío con status posted (efectivo / débito / o consumo de tarjeta ya pagado)
 *  - NO incluye card_payment (sería doble conteo con los consumos ya posteados)
 *  - NO incluye pending_card ni gastos pagados por la pareja
 */
export function isEffectiveExpense(tx: Transaction): boolean {
  return isMyExpense(tx) && tx.status === "posted";
}

/** Fecha con la que un gasto efectivo impacta el cashflow. */
export function effectiveDate(tx: Transaction): string {
  return tx.effective_date ?? tx.date;
}

export function isIncome(tx: Transaction): boolean {
  return tx.type === "income";
}

/**
 * Filtra gastos de un período según el criterio de presupuesto configurado.
 * - counts_pending_card=true  -> por fecha de compra, incluye pending_card
 * - counts_pending_card=false -> solo efectivos, por effective_date
 */
export function expensesForBudget(
  txs: Transaction[],
  start: string,
  end: string,
  settings: Pick<AppSettings, "budget_counts_pending_card">,
): Transaction[] {
  if (settings.budget_counts_pending_card) {
    return txs.filter((t) => isCommittedExpense(t) && inRange(t.date, start, end));
  }
  return txs.filter((t) => isEffectiveExpense(t) && inRange(effectiveDate(t), start, end));
}

/** Parte del gasto que me corresponde (para compartidos). Si no es compartido, todo. */
export function myShareAmount(tx: Transaction, defaultPct: number): number {
  if (!tx.is_shared) return tx.paid_by === "me" ? tx.amount : 0;
  const pct = tx.my_share_pct ?? defaultPct;
  return round2((tx.amount * pct) / 100);
}

// ---------- Saldos ----------
/**
 * Saldo de una cuenta a partir de sus transacciones.
 *  - expense (posted o pending): resta de account_id. Para tarjetas, el saldo negativo
 *    representa la deuda acumulada (consumos pendientes de pago).
 *  - income: suma a account_id.
 *  - transfer: resta de account_id, suma a to_account_id.
 *  - card_payment: resta de account_id (banco), suma a to_account_id (tarjeta).
 */
export function accountBalance(acc: Account, txs: Transaction[]): number {
  let bal = acc.initial_balance;
  for (const t of txs) {
    if (t.type === "expense") {
      if (t.account_id === acc.id) bal -= t.amount;
    } else if (t.type === "income") {
      if (t.account_id === acc.id) bal += t.amount;
    } else if (t.type === "transfer" || t.type === "card_payment") {
      if (t.account_id === acc.id) bal -= t.amount;
      if (t.to_account_id === acc.id) bal += t.amount;
    }
  }
  return round2(bal);
}

export function groupBy<T, K extends string>(items: T[], key: (t: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const it of items) {
    const k = key(it);
    (out[k] ??= []).push(it);
  }
  return out;
}
