/**
 * Dominio de transacciones: alta (con cuotas y consumos de tarjeta), edición,
 * borrado, listado y resumen del período.
 *
 * Reglas (ver docs/PLAN.md y ./core.ts):
 *  - Gasto con tarjeta de crédito -> status "pending_card", effective_date null,
 *    asociado al resumen (card_statement) que le corresponde por fecha.
 *  - Gasto compartido pagado por la pareja -> se imputa a la cuenta virtual `partner`
 *    para que no toque mis saldos.
 *  - Cuotas: N transacciones (una por mes), cada una en su resumen.
 */
import { randomUUID } from "node:crypto";
import { HttpError } from "../errors";
import type { Db } from "../db";
import type {
  Account,
  AppSettings,
  BaseRow,
  Transaction,
  TransactionInputType,
  TransactionStatus,
} from "../types";
import {
  addMonths,
  effectiveDate,
  inRange,
  isCommittedExpense,
  isCreditCard,
  isEffectiveExpense,
  round2,
  sum,
} from "./core";
import { getOrCreateStatement, recomputeStatementTotals, statementIsPaid } from "./cards";

export interface ListFilter {
  from?: string;
  to?: string;
  account_id?: string;
  category_id?: string;
  status?: TransactionStatus;
  type?: Transaction["type"];
}

export interface MonthSummary {
  income: number;
  /** Gasto efectivo: salida real de plata (posted), por effective_date. */
  expense_effective: number;
  /** Gasto comprometido: todo gasto por fecha de compra (incluye consumos de tarjeta). */
  expense_committed: number;
  /** Consumos de tarjeta del período todavía no pagados. */
  pending_card_total: number;
  /** Gastos compartidos que puso la pareja (no salen de mis cuentas). */
  expense_partner_paid: number;
  /** income - expense_effective */
  balance: number;
  /** El total que mira el presupuesto según `settings.budget_counts_pending_card`. */
  expense_for_budget: number;
}

// ---------------------------------------------------------------- helpers

type NewTransaction = Omit<Transaction, keyof BaseRow>;

function newTxRow(data: NewTransaction): NewTransaction {
  return data;
}

async function requireAccount(db: Db, id: string, label = "La cuenta"): Promise<Account> {
  const acc = (await db.accounts.list()).find((a) => a.id === id);
  if (!acc) throw new HttpError(400, `${label} indicada no existe`);
  return acc;
}

/** Cuenta virtual de la pareja (para gastos compartidos que paga ella/él). */
export async function partnerAccount(db: Db): Promise<Account | null> {
  return (await db.accounts.list()).find((a) => a.type === "partner") ?? null;
}

async function resolveAccount(
  db: Db,
  accountId: string,
  isShared: boolean,
  paidBy: "me" | "partner",
): Promise<Account> {
  if (isShared && paidBy === "partner") {
    const partner = await partnerAccount(db);
    if (!partner) {
      throw new HttpError(400, "No existe la cuenta de la pareja. Creala en Cuentas para registrar lo que paga.");
    }
    return partner;
  }
  return requireAccount(db, accountId);
}

async function validateCategory(db: Db, categoryId: string | null): Promise<void> {
  if (!categoryId) return;
  const cat = (await db.categories.list()).find((c) => c.id === categoryId);
  if (!cat) throw new HttpError(400, "La categoría indicada no existe");
}

/** Montos de cada cuota: reparte parejo y ajusta el redondeo en la última. */
export function installmentAmounts(amount: number, n: number): number[] {
  const base = round2(amount / n);
  const out = Array.from({ length: n }, () => base);
  out[n - 1] = round2(amount - base * (n - 1));
  return out;
}

function noteWithInstallment(note: string, i: number, n: number): string {
  const suffix = `(cuota ${i}/${n})`;
  return note ? `${note} ${suffix}` : suffix;
}

// ---------------------------------------------------------------- create

export async function createTransaction(
  db: Db,
  input: TransactionInputType,
): Promise<Transaction[]> {
  const settings = await db.settings.get();
  const account = await resolveAccount(db, input.account_id, input.is_shared, input.paid_by);
  await validateCategory(db, input.category_id);

  let toAccountId: string | null = null;
  if (input.type === "transfer" || input.type === "card_payment") {
    if (!input.to_account_id) throw new HttpError(400, "Falta la cuenta de destino");
    const to = await requireAccount(db, input.to_account_id, "La cuenta de destino");
    if (to.id === account.id) throw new HttpError(400, "La cuenta de origen y destino no pueden ser la misma");
    toAccountId = to.id;
  }

  const currency = input.currency ?? account.currency;
  const myShare = input.is_shared ? (input.my_share_pct ?? settings.default_my_share_pct) : input.my_share_pct;
  const onCard = input.type === "expense" && isCreditCard(account);
  const installments = onCard ? Math.max(1, input.installments_total ?? 1) : 1;

  const common = {
    type: input.type,
    currency,
    account_id: account.id,
    to_account_id: toAccountId,
    category_id: input.category_id,
    is_shared: input.is_shared,
    paid_by: input.paid_by,
    my_share_pct: myShare,
    settlement_id: null,
  };

  if (installments > 1) {
    const groupId = randomUUID();
    const amounts = installmentAmounts(input.amount, installments);
    const rows = [];
    for (let i = 0; i < installments; i++) {
      const date = addMonths(input.date, i);
      const statement = await getOrCreateStatement(db, account, date);
      rows.push(
        newTxRow({
          ...common,
          date,
          effective_date: null,
          status: "pending_card",
          amount: amounts[i],
          note: noteWithInstallment(input.note, i + 1, installments),
          card_statement_id: statement.id,
          installments_total: installments,
          installment_number: i + 1,
          installment_group_id: groupId,
        }),
      );
    }
    const created = await db.transactions.createMany(rows);
    await recomputeStatementTotals(db, created.map((t) => t.card_statement_id));
    return created;
  }

  const statement = onCard ? await getOrCreateStatement(db, account, input.date) : null;
  const created = await db.transactions.create(
    newTxRow({
      ...common,
      date: input.date,
      effective_date: onCard ? null : input.date,
      status: onCard ? "pending_card" : "posted",
      amount: round2(input.amount),
      note: input.note,
      card_statement_id: statement?.id ?? null,
      installments_total: input.installments_total && input.installments_total > 1 ? input.installments_total : null,
      installment_number: null,
      installment_group_id: null,
    }),
  );
  if (statement) await recomputeStatementTotals(db, [statement.id]);
  return [created];
}

// ---------------------------------------------------------------- update

/** Lanza 409 si la transacción no se puede tocar (liquidada o en un resumen ya pagado). */
async function assertEditable(db: Db, tx: Transaction, moneyChanged: boolean): Promise<void> {
  if (tx.settlement_id) {
    throw new HttpError(409, "La transacción ya fue liquidada con la pareja. Revertí la liquidación para editarla.");
  }
  if (moneyChanged && (await statementIsPaid(db, tx.card_statement_id))) {
    throw new HttpError(
      409,
      "El consumo pertenece a un resumen ya pagado. Despagá el resumen para poder editarlo.",
    );
  }
}

export async function updateTransaction(
  db: Db,
  id: string,
  patch: Partial<TransactionInputType>,
): Promise<Transaction> {
  const existing = await db.transactions.get(id);
  if (!existing) throw new HttpError(404, "Transacción no encontrada");

  const date = patch.date ?? existing.date;
  const amount = patch.amount !== undefined ? round2(patch.amount) : existing.amount;
  const type = patch.type ?? existing.type;
  const isShared = patch.is_shared ?? existing.is_shared;
  const paidBy = patch.paid_by ?? existing.paid_by;
  const requestedAccount = patch.account_id ?? existing.account_id;

  const moneyChanged =
    date !== existing.date ||
    amount !== existing.amount ||
    type !== existing.type ||
    requestedAccount !== existing.account_id;
  await assertEditable(db, existing, moneyChanged);

  const account = await resolveAccount(db, requestedAccount, isShared, paidBy);
  const categoryId = patch.category_id !== undefined ? patch.category_id : existing.category_id;
  await validateCategory(db, categoryId);

  let toAccountId: string | null = patch.to_account_id !== undefined ? patch.to_account_id : existing.to_account_id;
  if (type === "transfer" || type === "card_payment") {
    if (!toAccountId) throw new HttpError(400, "Falta la cuenta de destino");
    const to = await requireAccount(db, toAccountId, "La cuenta de destino");
    if (to.id === account.id) throw new HttpError(400, "La cuenta de origen y destino no pueden ser la misma");
  } else {
    toAccountId = null;
  }

  const onCard = type === "expense" && isCreditCard(account);
  let statementId = existing.card_statement_id;
  let status: TransactionStatus = existing.status;
  let effective: string | null = existing.effective_date;

  if (onCard) {
    if (existing.status === "posted" && (await statementIsPaid(db, existing.card_statement_id))) {
      // Resumen pagado: no se reasigna (las ediciones de plata ya fueron bloqueadas).
      statementId = existing.card_statement_id;
    } else {
      const statement = await getOrCreateStatement(db, account, date);
      statementId = statement.id;
      status = "pending_card";
      effective = null;
    }
  } else {
    statementId = null;
    status = "posted";
    effective = date;
  }

  const updated = await db.transactions.update(id, {
    date,
    effective_date: effective,
    type,
    status,
    amount,
    currency: patch.currency ?? (account.id !== existing.account_id ? account.currency : existing.currency),
    account_id: account.id,
    to_account_id: toAccountId,
    category_id: categoryId,
    note: patch.note !== undefined ? patch.note : existing.note,
    card_statement_id: statementId,
    is_shared: isShared,
    paid_by: paidBy,
    my_share_pct: isShared
      ? (patch.my_share_pct ?? existing.my_share_pct ?? (await db.settings.get()).default_my_share_pct)
      : (patch.my_share_pct !== undefined ? patch.my_share_pct : existing.my_share_pct),
  });

  await recomputeStatementTotals(db, [existing.card_statement_id, statementId]);
  return updated;
}

// ---------------------------------------------------------------- delete

export async function deleteTransaction(
  db: Db,
  id: string,
  opts: { group?: boolean } = {},
): Promise<{ deleted: number }> {
  const all = await db.transactions.list();
  const existing = all.find((t) => t.id === id);
  if (!existing) throw new HttpError(404, "Transacción no encontrada");

  const targets =
    opts.group && existing.installment_group_id
      ? all.filter((t) => t.installment_group_id === existing.installment_group_id)
      : [existing];

  for (const t of targets) await assertEditable(db, t, true);

  await db.transactions.removeMany(targets.map((t) => t.id));
  await recomputeStatementTotals(db, targets.map((t) => t.card_statement_id));
  return { deleted: targets.length };
}

// ---------------------------------------------------------------- read

export function sortTransactions(txs: Transaction[]): Transaction[] {
  return [...txs].sort(
    (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.created_at.localeCompare(a.created_at)),
  );
}

export async function listTransactions(db: Db, filter: ListFilter = {}): Promise<Transaction[]> {
  const all = await db.transactions.list();
  const filtered = all.filter((t) => {
    if (filter.from && t.date < filter.from) return false;
    if (filter.to && t.date > filter.to) return false;
    if (filter.account_id && t.account_id !== filter.account_id && t.to_account_id !== filter.account_id) return false;
    if (filter.category_id && t.category_id !== filter.category_id) return false;
    if (filter.status && t.status !== filter.status) return false;
    if (filter.type && t.type !== filter.type) return false;
    return true;
  });
  return sortTransactions(filtered);
}

/**
 * Totales del período. `range` (opcional) permite contar los gastos efectivos por
 * `effective_date` aunque la lista venga filtrada por fecha de compra.
 */
export function monthSummary(
  txs: Transaction[],
  settings: Pick<AppSettings, "budget_counts_pending_card">,
  range?: { start: string; end: string },
): MonthSummary {
  const byPurchase = range ? txs.filter((t) => inRange(t.date, range.start, range.end)) : txs;
  const byEffective = range
    ? txs.filter((t) => t.effective_date !== null && inRange(effectiveDate(t), range.start, range.end))
    : txs;

  const income = sum(byPurchase.filter((t) => t.type === "income").map((t) => t.amount));
  const expense_effective = sum(byEffective.filter(isEffectiveExpense).map((t) => t.amount));
  const expense_committed = sum(byPurchase.filter(isCommittedExpense).map((t) => t.amount));
  const pending_card_total = sum(
    byPurchase.filter((t) => t.type === "expense" && t.status === "pending_card").map((t) => t.amount),
  );
  const expense_partner_paid = sum(
    byPurchase.filter((t) => t.type === "expense" && t.is_shared && t.paid_by === "partner").map((t) => t.amount),
  );

  return {
    income,
    expense_effective,
    expense_committed,
    pending_card_total,
    expense_partner_paid,
    balance: round2(income - expense_effective),
    expense_for_budget: settings.budget_counts_pending_card ? expense_committed : expense_effective,
  };
}
