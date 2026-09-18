/**
 * Dominio de cuentas: saldos, datos de tarjeta (deuda pendiente, resumen actual,
 * crédito disponible) y patrimonio neto.
 *
 * La cuenta virtual `partner` (lo que paga la pareja) NO forma parte del patrimonio:
 * se devuelve marcada con `is_partner` para que los formularios puedan usarla.
 */
import type { Db } from "../db";
import type { Account, CardStatement, StatementStatus, Transaction } from "../types";
import { accountBalance, isCreditCard, round2, sum, todayISO } from "./core";
import { statementPeriodFor } from "./cards";

export interface CurrentStatement {
  /** null si el resumen todavía no existe en la base (no hubo consumos). */
  id: string | null;
  period_start: string;
  period_end: string;
  due_date: string;
  status: StatementStatus;
  total: number;
}

export interface AccountWithBalance extends Account {
  balance: number;
  is_partner: boolean;
  /** Solo tarjetas: consumos cargados y todavía no pagados (deuda). */
  pending_total: number | null;
  /** Solo tarjetas: resumen en curso (el que incluye el día de hoy). */
  current_statement: CurrentStatement | null;
  /** Solo tarjetas con credit_limit: crédito disponible. */
  available: number | null;
}

function cardCurrentStatement(
  card: Account,
  statements: CardStatement[],
  today: string,
): CurrentStatement {
  const period = statementPeriodFor(card, today);
  const found = statements.find(
    (s) =>
      s.account_id === card.id &&
      s.period_start === period.period_start &&
      s.period_end === period.period_end,
  );
  if (found) {
    return {
      id: found.id,
      period_start: found.period_start,
      period_end: found.period_end,
      due_date: found.due_date,
      status: found.status,
      total: found.total,
    };
  }
  return { id: null, ...period, status: "open", total: 0 };
}

export function pendingCardTotal(txs: Transaction[], cardId: string): number {
  return sum(
    txs
      .filter((t) => t.account_id === cardId && t.type === "expense" && t.status === "pending_card")
      .map((t) => t.amount),
  );
}

export interface BalancesOptions {
  includeArchived?: boolean;
  today?: string;
}

/** Cuentas (activas por defecto) con saldo y, para tarjetas, datos del resumen. */
export async function accountsWithBalances(
  db: Db,
  opts: BalancesOptions = {},
): Promise<AccountWithBalance[]> {
  const today = opts.today ?? todayISO();
  const [accounts, txs, statements] = await Promise.all([
    db.accounts.list(),
    db.transactions.list(),
    db.card_statements.list(),
  ]);

  return accounts
    .filter((a) => opts.includeArchived || !a.archived)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    .map((a) => {
      const balance = accountBalance(a, txs);
      const card = isCreditCard(a);
      const pending = card ? pendingCardTotal(txs, a.id) : null;
      return {
        ...a,
        balance,
        is_partner: a.type === "partner",
        pending_total: pending,
        current_statement: card ? cardCurrentStatement(a, statements, today) : null,
        available: card && a.credit_limit !== null ? round2(a.credit_limit + balance) : null,
      };
    });
}

/** Patrimonio neto: saldos de las cuentas no archivadas, sin la cuenta de la pareja. */
export function netWorth(accounts: Pick<AccountWithBalance, "balance" | "is_partner" | "archived">[]): number {
  return sum(accounts.filter((a) => !a.is_partner && !a.archived).map((a) => a.balance));
}

/** ¿La cuenta tiene movimientos? (define si se borra o se archiva). */
export async function accountHasTransactions(db: Db, accountId: string): Promise<boolean> {
  const txs = await db.transactions.list();
  return txs.some((t) => t.account_id === accountId || t.to_account_id === accountId);
}
