/**
 * Dominio de tarjetas de crédito: períodos de resumen, resúmenes (statements),
 * pago y reversa del pago.
 *
 * Regla central (ver docs/PLAN.md):
 *   Un `expense` cuya cuenta es de tipo `credit_card` nace con status "pending_card"
 *   y effective_date = null. NO es gasto efectivo hasta que se paga el resumen.
 *   Al pagar: se crea un `card_payment` (banco -> tarjeta) y los consumos pasan a
 *   "posted" con effective_date = fecha de pago.
 */
import { HttpError } from "../api";
import type { Db } from "../db";
import type { Account, CardStatement, Transaction } from "../types";
import { addDays, daysInMonth, round2, todayISO } from "./core";

/** Si la tarjeta no define closing_day: cierra el último día del mes (31 se recorta al último día). */
export const DEFAULT_CLOSING_DAY = 31;
/** Si la tarjeta no define due_day: vence el 10 del mes siguiente al cierre. */
export const DEFAULT_DUE_DAY = 10;

export interface StatementPeriod {
  period_start: string;
  period_end: string;
  due_date: string;
}

interface YM {
  y: number;
  m: number;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function ymOf(iso: string): YM {
  const [y, m] = iso.split("-").map(Number);
  return { y, m };
}

function shiftYM({ y, m }: YM, delta: number): YM {
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}

/** Día `day` del mes (recortado al último día si el mes es corto). */
function dayOfMonth({ y, m }: YM, day: number): string {
  const clamped = Math.min(Math.max(day, 1), daysInMonth(y, m));
  return `${y}-${pad(m)}-${pad(clamped)}`;
}

/**
 * Resumen (período de cierre) al que cae una compra hecha con `card` el día `purchaseDate`.
 * - Si la compra es posterior al día de cierre del mes, cae en el resumen del mes siguiente.
 * - `due_date` cae en el mes del cierre si due_day > closing_day, si no en el mes siguiente.
 */
export function statementPeriodFor(
  card: Pick<Account, "closing_day" | "due_day">,
  purchaseDate: string,
): StatementPeriod {
  const closingDay = card.closing_day ?? DEFAULT_CLOSING_DAY;
  const dueDay = card.due_day ?? DEFAULT_DUE_DAY;

  const purchaseYM = ymOf(purchaseDate);
  const closeThisMonth = dayOfMonth(purchaseYM, closingDay);
  const endYM = purchaseDate > closeThisMonth ? shiftYM(purchaseYM, 1) : purchaseYM;

  const period_end = dayOfMonth(endYM, closingDay);
  const period_start = addDays(dayOfMonth(shiftYM(endYM, -1), closingDay), 1);
  const dueYM = dueDay > closingDay ? endYM : shiftYM(endYM, 1);

  return { period_start, period_end, due_date: dayOfMonth(dueYM, dueDay) };
}

/** Busca el resumen de la tarjeta para la fecha dada; si no existe, lo crea abierto en 0. */
export async function getOrCreateStatement(
  db: Db,
  card: Account,
  purchaseDate: string,
): Promise<CardStatement> {
  const period = statementPeriodFor(card, purchaseDate);
  const all = await db.card_statements.list();
  const found = all.find(
    (s) =>
      s.account_id === card.id &&
      s.period_start === period.period_start &&
      s.period_end === period.period_end,
  );
  if (found) return found;
  return db.card_statements.create({
    account_id: card.id,
    period_start: period.period_start,
    period_end: period.period_end,
    due_date: period.due_date,
    status: "open",
    total: 0,
    paid_amount: null,
    paid_at: null,
    paid_from_account_id: null,
    payment_transaction_id: null,
  });
}

/** Consumos (gastos / devoluciones) asociados a un resumen. No incluye el card_payment. */
export function statementTransactions(txs: Transaction[], statementId: string): Transaction[] {
  return txs.filter(
    (t) =>
      t.card_statement_id === statementId &&
      (t.type === "expense" || t.type === "income") &&
      (t.status === "pending_card" || t.status === "posted"),
  );
}

/** Recalcula y persiste el total del resumen (gastos suman, devoluciones restan). */
export async function recomputeStatementTotal(db: Db, statementId: string): Promise<number> {
  const statement = await db.card_statements.get(statementId);
  if (!statement) return 0;
  const txs = statementTransactions(await db.transactions.list(), statementId);
  const total = round2(
    txs.reduce((acc, t) => acc + (t.type === "expense" ? t.amount : -t.amount), 0),
  );
  if (total !== statement.total) await db.card_statements.update(statementId, { total });
  return total;
}

export async function recomputeStatementTotals(db: Db, ids: (string | null | undefined)[]): Promise<void> {
  const unique = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  for (const id of unique) await recomputeStatementTotal(db, id);
}

/** Pasa a "closed" los resúmenes abiertos cuyo período ya cerró. Idempotente. */
export async function closeDueStatements(db: Db, today: string = todayISO()): Promise<number> {
  const all = await db.card_statements.list();
  const toClose = all.filter((s) => s.status === "open" && s.period_end < today);
  if (!toClose.length) return 0;
  await db.card_statements.updateMany(
    toClose.map((s) => ({ id: s.id, patch: { status: "closed" as const } })),
  );
  return toClose.length;
}

export interface PayStatementInput {
  from_account_id: string;
  amount: number;
  date: string;
}

export interface PayStatementResult {
  statement: CardStatement;
  payment: Transaction;
  posted: number;
}

/**
 * Paga un resumen:
 *  - crea la transacción `card_payment` (cuenta origen -> tarjeta), que es la salida real de plata;
 *  - marca todos los consumos `pending_card` del resumen como `posted` con effective_date = date;
 *  - deja el resumen en `paid`.
 *
 * Pago parcial (amount < total): se acepta y se registra `paid_amount`, pero igualmente se
 * postean todos los consumos (simplificación; el saldo remanente queda como diferencia de saldo
 * en la tarjeta).
 */
export async function payStatement(
  db: Db,
  statementId: string,
  input: PayStatementInput,
): Promise<PayStatementResult> {
  const statement = await db.card_statements.get(statementId);
  if (!statement) throw new HttpError(404, "Resumen no encontrado");
  if (statement.status === "paid") throw new HttpError(409, "El resumen ya está pagado");
  if (input.amount <= 0) throw new HttpError(400, "El monto del pago debe ser mayor a 0");

  const accounts = await db.accounts.list();
  const card = accounts.find((a) => a.id === statement.account_id);
  if (!card) throw new HttpError(404, "Tarjeta no encontrada");
  const from = accounts.find((a) => a.id === input.from_account_id);
  if (!from) throw new HttpError(400, "La cuenta de origen del pago no existe");
  if (from.id === card.id) throw new HttpError(400, "No se puede pagar la tarjeta con la misma tarjeta");

  const payment = await db.transactions.create({
    date: input.date,
    effective_date: input.date,
    type: "card_payment",
    status: "posted",
    amount: round2(input.amount),
    currency: from.currency,
    account_id: from.id,
    to_account_id: card.id,
    category_id: null,
    note: `Pago tarjeta ${card.name}`,
    card_statement_id: statement.id,
    installments_total: null,
    installment_number: null,
    installment_group_id: null,
    is_shared: false,
    paid_by: "me",
    my_share_pct: null,
    settlement_id: null,
  });

  const pending = (await db.transactions.list()).filter(
    (t) => t.card_statement_id === statement.id && t.status === "pending_card",
  );
  if (pending.length) {
    await db.transactions.updateMany(
      pending.map((t) => ({
        id: t.id,
        patch: { status: "posted" as const, effective_date: input.date },
      })),
    );
  }

  const total = await recomputeStatementTotal(db, statement.id);
  const updated = await db.card_statements.update(statement.id, {
    status: "paid",
    total,
    paid_amount: round2(input.amount),
    paid_at: input.date,
    paid_from_account_id: from.id,
    payment_transaction_id: payment.id,
  });

  return { statement: updated, payment, posted: pending.length };
}

/** Revierte el pago de un resumen (para corregir errores). */
export async function unpayStatement(
  db: Db,
  statementId: string,
  today: string = todayISO(),
): Promise<CardStatement> {
  const statement = await db.card_statements.get(statementId);
  if (!statement) throw new HttpError(404, "Resumen no encontrado");
  if (statement.status !== "paid") throw new HttpError(409, "El resumen no está pagado");

  const txs = await db.transactions.list();
  if (statement.payment_transaction_id) {
    await db.transactions.remove(statement.payment_transaction_id);
  }

  const consumos = txs.filter(
    (t) =>
      t.card_statement_id === statement.id &&
      t.id !== statement.payment_transaction_id &&
      t.type === "expense" &&
      t.status === "posted",
  );
  const liquidada = consumos.find((t) => t.settlement_id);
  if (liquidada) {
    throw new HttpError(409, "Hay consumos del resumen ya liquidados con la pareja");
  }
  if (consumos.length) {
    await db.transactions.updateMany(
      consumos.map((t) => ({
        id: t.id,
        patch: { status: "pending_card" as const, effective_date: null },
      })),
    );
  }

  return db.card_statements.update(statement.id, {
    status: statement.period_end < today ? "closed" : "open",
    paid_amount: null,
    paid_at: null,
    paid_from_account_id: null,
    payment_transaction_id: null,
  });
}

/** ¿El consumo pertenece a un resumen ya pagado? (bloquea ediciones). */
export async function statementIsPaid(db: Db, statementId: string | null): Promise<boolean> {
  if (!statementId) return false;
  const s = await db.card_statements.get(statementId);
  return s?.status === "paid";
}
