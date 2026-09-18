/**
 * Construye el contexto financiero real que se le pasa al modelo de IA como
 * parte del system prompt: resumen de los últimos 3 meses, top categorías,
 * saldos de cuentas, deuda de tarjetas, presupuestos, gastos compartidos sin
 * liquidar y últimas transacciones. Devuelve tanto el objeto (por si algún
 * consumidor lo necesita estructurado) como un texto markdown compacto
 * (sin ids, montos redondeados) pensado para no superar ~3000 tokens.
 */
import type { Db } from "@/lib/db";
import type { Account, Budget, Transaction } from "@/lib/types";
import { formatMoney, formatMonth, formatDate } from "@/lib/format";
import {
  accountBalance,
  expensesForBudget,
  inRange,
  isCommittedExpense,
  isIncome,
  monthRange,
  myShareAmount,
  round2,
  sum,
} from "@/lib/domain/core";

/**
 * Suma/resta meses a una clave YYYY-MM (a diferencia de `addMonths` de
 * `domain/core`, que opera sobre fechas completas YYYY-MM-DD).
 */
export function shiftMonthKey(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface MonthSummary {
  month: string;
  label: string;
  income: number;
  effective_expense: number;
  committed_expense: number;
  balance: number;
}

export interface CategorySummary {
  name: string;
  amount: number;
  pct_of_total: number;
  prev_amount: number;
  change_pct: number | null;
}

export interface AccountSummary {
  name: string;
  type: string;
  balance: number;
}

export interface CardDebt {
  name: string;
  pending_amount: number;
}

export interface BudgetSummary {
  category_name: string;
  amount: number;
  spent: number;
  pct: number;
}

export interface SharedSummary {
  total_unsettled: number;
  balance: number; // > 0: te deben, < 0: debés
}

export interface RecentTransaction {
  date: string;
  category: string;
  amount: number;
  type: string;
  account: string;
  note: string;
}

export interface FinancialContextData {
  currency: string;
  my_name: string;
  partner_name: string;
  months: MonthSummary[];
  top_categories: CategorySummary[];
  accounts: AccountSummary[];
  card_debt: CardDebt[];
  budgets: BudgetSummary[];
  shared: SharedSummary;
  recent_transactions: RecentTransaction[];
}

export interface FinancialContext {
  data: FinancialContextData;
  /** Markdown compacto para incluir en el system prompt. */
  text: string;
}

const MAX_TOP_CATEGORIES = 8;
const MAX_RECENT_TX = 15;
const MAX_NOTE_LEN = 60;

function categoryTotals(
  txs: Transaction[],
  start: string,
  end: string,
  settings: Parameters<typeof expensesForBudget>[3],
  categoryNames: Map<string, string>,
): Map<string, number> {
  const exps = expensesForBudget(txs, start, end, settings);
  const byCat = new Map<string, number>();
  for (const t of exps) {
    const name = t.category_id ? (categoryNames.get(t.category_id) ?? "Sin categoría") : "Sin categoría";
    byCat.set(name, round2((byCat.get(name) ?? 0) + t.amount));
  }
  return byCat;
}

export async function buildFinancialContext(
  db: Db,
  { month }: { month: string },
): Promise<FinancialContext> {
  const [settings, accounts, categories, transactions, budgetsRaw] = await Promise.all([
    db.settings.get(),
    db.accounts.list(),
    db.categories.list(),
    db.transactions.list(),
    db.budgets.list(),
  ]);

  const currency = settings.currency;
  const categoryNames = new Map(categories.map((c) => [c.id, c.name] as const));
  const accountNames = new Map(accounts.map((a) => [a.id, a.name] as const));

  // ---------- Resumen de los últimos 3 meses ----------
  const monthKeys = [shiftMonthKey(month, -2), shiftMonthKey(month, -1), month];
  const months: MonthSummary[] = monthKeys.map((m) => {
    const { start, end } = monthRange(m, settings.month_start_day);
    const income = round2(
      sum(transactions.filter((t) => isIncome(t) && inRange(t.date, start, end)).map((t) => t.amount)),
    );
    const effective_expense = round2(
      sum(
        expensesForBudget(transactions, start, end, { budget_counts_pending_card: false }).map((t) => t.amount),
      ),
    );
    const committed_expense = round2(
      sum(transactions.filter((t) => isCommittedExpense(t) && inRange(t.date, start, end)).map((t) => t.amount)),
    );
    return {
      month: m,
      label: formatMonth(m),
      income,
      effective_expense,
      committed_expense,
      balance: round2(income - effective_expense),
    };
  });

  // ---------- Top categorías del mes actual (según criterio de presupuesto configurado) ----------
  const { start: curStart, end: curEnd } = monthRange(month, settings.month_start_day);
  const { start: prevStart, end: prevEnd } = monthRange(shiftMonthKey(month, -1), settings.month_start_day);
  const curTotals = categoryTotals(transactions, curStart, curEnd, settings, categoryNames);
  const prevTotals = categoryTotals(transactions, prevStart, prevEnd, settings, categoryNames);
  const curTotalAmount = round2(sum([...curTotals.values()]));
  const top_categories: CategorySummary[] = [...curTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TOP_CATEGORIES)
    .map(([name, amount]) => {
      const prev_amount = prevTotals.get(name) ?? 0;
      const change_pct = prev_amount > 0 ? round2(((amount - prev_amount) / prev_amount) * 100) : null;
      return {
        name,
        amount,
        pct_of_total: curTotalAmount > 0 ? round2((amount / curTotalAmount) * 100) : 0,
        prev_amount,
        change_pct,
      };
    });

  // ---------- Saldos de cuentas (excluye "partner") y deuda de tarjetas ----------
  const visibleAccounts = accounts.filter((a) => a.type !== "partner" && !a.archived);
  const accountSummaries: AccountSummary[] = visibleAccounts.map((a: Account) => ({
    name: a.name,
    type: a.type,
    balance: accountBalance(a, transactions),
  }));
  const cardDebt: CardDebt[] = visibleAccounts
    .filter((a) => a.type === "credit_card")
    .map((card) => ({
      name: card.name,
      pending_amount: round2(
        sum(
          transactions
            .filter((t) => t.type === "expense" && t.status === "pending_card" && t.account_id === card.id)
            .map((t) => t.amount),
        ),
      ),
    }));

  // ---------- Presupuestos del mes ----------
  const monthBudgets: Budget[] = budgetsRaw.filter((b) => b.month === month);
  const budgets: BudgetSummary[] = monthBudgets.slice(0, 15).map((b) => {
    const exps = expensesForBudget(transactions, curStart, curEnd, settings).filter(
      (t) => b.category_id === null || t.category_id === b.category_id,
    );
    const spent = round2(sum(exps.map((t) => t.amount)));
    return {
      category_name: b.category_id ? (categoryNames.get(b.category_id) ?? "Categoría eliminada") : "Total del mes",
      amount: b.amount,
      spent,
      pct: b.amount > 0 ? round2((spent / b.amount) * 100) : 0,
    };
  });

  // ---------- Gastos compartidos sin liquidar ----------
  const unsettledShared = transactions.filter((t) => t.is_shared && !t.settlement_id);
  const total_unsettled = round2(sum(unsettledShared.map((t) => t.amount)));
  const balance = round2(
    sum(
      unsettledShared.map((t) => {
        const paidByMe = t.paid_by === "me" ? t.amount : 0;
        return round2(paidByMe - myShareAmount(t, settings.default_my_share_pct));
      }),
    ),
  );

  // ---------- Últimas transacciones ----------
  const sorted = [...transactions].sort((a, b) =>
    a.date === b.date ? b.created_at.localeCompare(a.created_at) : b.date.localeCompare(a.date),
  );
  const recent_transactions: RecentTransaction[] = sorted.slice(0, MAX_RECENT_TX).map((t) => ({
    date: t.date,
    category: t.category_id ? (categoryNames.get(t.category_id) ?? "-") : "-",
    amount: t.amount,
    type: t.type,
    account: accountNames.get(t.account_id) ?? "-",
    note: t.note.length > MAX_NOTE_LEN ? `${t.note.slice(0, MAX_NOTE_LEN)}…` : t.note,
  }));

  const data: FinancialContextData = {
    currency,
    my_name: settings.my_name,
    partner_name: settings.partner_name,
    months,
    top_categories,
    accounts: accountSummaries,
    card_debt: cardDebt,
    budgets,
    shared: { total_unsettled, balance },
    recent_transactions,
  };

  return { data, text: renderMarkdown(data) };
}

function money(n: number, currency: string): string {
  return formatMoney(n, currency);
}

function renderMarkdown(d: FinancialContextData): string {
  const lines: string[] = [];
  lines.push(`Moneda: ${d.currency}. Yo: ${d.my_name}. Pareja: ${d.partner_name}.`);

  lines.push("", "### Resumen mensual (últimos 3 meses)");
  for (const m of d.months) {
    lines.push(
      `- ${m.label}: ingresos ${money(m.income, d.currency)}, gasto efectivo ${money(m.effective_expense, d.currency)}, ` +
        `gasto comprometido ${money(m.committed_expense, d.currency)}, balance ${money(m.balance, d.currency)}`,
    );
  }

  lines.push("", "### Top categorías del mes actual");
  if (d.top_categories.length === 0) {
    lines.push("- (sin gastos categorizados este mes)");
  }
  for (const c of d.top_categories) {
    const variation =
      c.change_pct === null
        ? c.prev_amount === 0
          ? "sin dato del mes anterior"
          : ""
        : `${c.change_pct >= 0 ? "+" : ""}${c.change_pct}% vs mes anterior`;
    lines.push(`- ${c.name}: ${money(c.amount, d.currency)} (${c.pct_of_total}% del total)${variation ? ` — ${variation}` : ""}`);
  }

  lines.push("", "### Cuentas");
  for (const a of d.accounts) {
    lines.push(`- ${a.name} (${a.type}): ${money(a.balance, d.currency)}`);
  }
  if (d.card_debt.length) {
    lines.push("", "### Deuda pendiente de tarjetas (consumos sin pagar)");
    for (const c of d.card_debt) {
      lines.push(`- ${c.name}: ${money(c.pending_amount, d.currency)}`);
    }
  }

  if (d.budgets.length) {
    lines.push("", "### Presupuestos del mes actual");
    for (const b of d.budgets) {
      lines.push(`- ${b.category_name}: ${money(b.spent, d.currency)} / ${money(b.amount, d.currency)} (${b.pct}%)`);
    }
  } else {
    lines.push("", "### Presupuestos del mes actual", "- No hay presupuestos cargados para este mes.");
  }

  lines.push("", "### Gastos compartidos sin liquidar");
  if (d.shared.total_unsettled === 0) {
    lines.push("- No hay gastos compartidos pendientes de liquidar.");
  } else {
    const who = d.shared.balance > 0 ? `${d.partner_name} le debe a ${d.my_name}` : `${d.my_name} le debe a ${d.partner_name}`;
    lines.push(
      `- Total compartido sin liquidar: ${money(d.shared.total_unsettled, d.currency)}. Balance aproximado: ${who} ${money(Math.abs(d.shared.balance), d.currency)}.`,
    );
  }

  lines.push("", "### Últimas transacciones");
  for (const t of d.recent_transactions) {
    const notePart = t.note ? ` "${t.note}"` : "";
    lines.push(`- ${formatDate(t.date)} · ${t.category} · ${money(t.amount, d.currency)} · ${t.account}${notePart}`);
  }

  return lines.join("\n");
}
