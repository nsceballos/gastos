/**
 * Dominio de estadísticas. Funciones puras (sin acceso a red/DB).
 *
 * Reutiliza las reglas de "gasto efectivo vs comprometido" de core.ts. No las duplica.
 */
import type { Account, AppSettings, Category, Transaction } from "../types";
import {
  addDays,
  addMonths,
  effectiveDate,
  expensesForBudget,
  inRange,
  isIncome,
  monthKey,
  monthRange,
  round2,
  sum,
} from "./core";

export type StatsMode = "committed" | "effective";

export interface CategoryAmount {
  category: Category | null;
  amount: number;
  pct: number;
  count: number;
}

export interface DayAmount {
  date: string;
  expense: number;
  income: number;
}

export interface AccountAmount {
  account: Account;
  expense: number;
}

export interface StatsTotals {
  income: number;
  expense_effective: number;
  expense_committed: number;
  /** Consumos de tarjeta del período aún no pagados (comprometido pero no efectivo). */
  pending_card: number;
  balance: number;
}

export interface MonthStats {
  by_category: CategoryAmount[];
  income_by_category: CategoryAmount[];
  totals: StatsTotals;
  by_day: DayAmount[];
  by_account: AccountAmount[];
  shared_total: number;
}

export interface TrendPoint {
  month: string;
  income: number;
  expense: number;
  balance: number;
}

function resolveMode(settings: Pick<AppSettings, "budget_counts_pending_card">, mode?: StatsMode): StatsMode {
  return mode ?? (settings.budget_counts_pending_card ? "committed" : "effective");
}

function categoryAmounts(items: Transaction[], categories: Category[]): CategoryAmount[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const total = sum(items.map((t) => t.amount));
  const groups = new Map<string | null, Transaction[]>();
  for (const t of items) {
    const key = t.category_id;
    const arr = groups.get(key) ?? [];
    arr.push(t);
    groups.set(key, arr);
  }
  const out: CategoryAmount[] = [];
  for (const [categoryId, txs] of groups) {
    const amount = sum(txs.map((t) => t.amount));
    out.push({
      category: categoryId ? (byId.get(categoryId) ?? null) : null,
      amount,
      pct: total > 0 ? round2((amount / total) * 100) : 0,
      count: txs.length,
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

/**
 * Estadísticas de un mes. `mode` decide si los gastos se cuentan por fecha de compra
 * (committed, incluye consumos de tarjeta pendientes) o por fecha efectiva (effective,
 * solo lo que ya salió de la cuenta). Por defecto usa `settings.budget_counts_pending_card`.
 */
export function statsForMonth(
  txs: Transaction[],
  categories: Category[],
  accounts: Account[],
  month: string,
  settings: AppSettings,
  mode?: StatsMode,
): MonthStats {
  const { start, end } = monthRange(month, settings.month_start_day);
  const resolvedMode = resolveMode(settings, mode);

  const expenses = expensesForBudget(txs, start, end, { budget_counts_pending_card: resolvedMode === "committed" });
  const expenseDate = resolvedMode === "committed" ? (t: Transaction) => t.date : effectiveDate;

  const incomes = txs.filter((t) => isIncome(t) && inRange(t.date, start, end));

  const expenseCommitted = sum(
    txs.filter((t) => t.type === "expense" && inRange(t.date, start, end)).map((t) => t.amount),
  );
  const expenseEffective = sum(
    txs
      .filter((t) => t.type === "expense" && t.status === "posted" && inRange(effectiveDate(t), start, end))
      .map((t) => t.amount),
  );
  const pendingCard = sum(
    txs
      .filter((t) => t.type === "expense" && t.status === "pending_card" && inRange(t.date, start, end))
      .map((t) => t.amount),
  );
  const income = sum(incomes.map((t) => t.amount));
  const expenseForBalance = resolvedMode === "committed" ? expenseCommitted : expenseEffective;

  const by_day: DayAmount[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const dayExpense = sum(expenses.filter((t) => expenseDate(t) === d).map((t) => t.amount));
    const dayIncome = sum(incomes.filter((t) => t.date === d).map((t) => t.amount));
    by_day.push({ date: d, expense: dayExpense, income: dayIncome });
  }

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const accGroups = new Map<string, Transaction[]>();
  for (const t of expenses) {
    const arr = accGroups.get(t.account_id) ?? [];
    arr.push(t);
    accGroups.set(t.account_id, arr);
  }
  const by_account: AccountAmount[] = [];
  for (const [accountId, list] of accGroups) {
    const account = accountById.get(accountId);
    if (!account) continue;
    by_account.push({ account, expense: sum(list.map((t) => t.amount)) });
  }
  by_account.sort((a, b) => b.expense - a.expense);

  const shared_total = sum(expenses.filter((t) => t.is_shared).map((t) => t.amount));

  return {
    by_category: categoryAmounts(expenses, categories),
    income_by_category: categoryAmounts(incomes, categories),
    totals: {
      income,
      expense_effective: expenseEffective,
      expense_committed: expenseCommitted,
      pending_card: pendingCard,
      balance: round2(income - expenseForBalance),
    },
    by_day,
    by_account,
    shared_total,
  };
}

/** Últimos `months` meses (incluyendo `endMonth`), ordenados cronológicamente. */
export function trend(txs: Transaction[], months: number, endMonth: string, settings: AppSettings): TrendPoint[] {
  const n = Math.max(1, months);
  const out: TrendPoint[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const month = monthKey(addMonths(`${endMonth}-01`, -i));
    const { start, end } = monthRange(month, settings.month_start_day);
    const expense = sum(expensesForBudget(txs, start, end, settings).map((t) => t.amount));
    const income = sum(txs.filter((t) => isIncome(t) && inRange(t.date, start, end)).map((t) => t.amount));
    out.push({ month, income, expense, balance: round2(income - expense) });
  }
  return out;
}
