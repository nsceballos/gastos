import { handler, HttpError, parseBody, query } from "@/lib/api";
import { getDb } from "@/lib/db";
import { BudgetInput } from "@/lib/types";
import { alerts, budgetStatus, ensureRecurringBudgets, hasDuplicateBudget } from "@/lib/domain/budgets";
import { monthKey, monthRange, todayISO } from "@/lib/domain/core";

export const dynamic = "force-dynamic";

export const GET = handler(async (req) => {
  const month = query(req).get("month") ?? monthKey(todayISO());
  const db = getDb();
  await ensureRecurringBudgets(db, month);
  const [budgets, txs, categories, settings] = await Promise.all([
    db.budgets.list(),
    db.transactions.list(),
    db.categories.list(),
    db.settings.get(),
  ]);
  const monthBudgets = budgets.filter((b) => b.month === month);
  const status = budgetStatus(monthBudgets, txs, categories, month, settings);
  return {
    budgets: monthBudgets,
    status,
    alerts: alerts(status),
    month,
    range: monthRange(month, settings.month_start_day),
  };
});

export const POST = handler(async (req) => {
  const input = await parseBody(req, BudgetInput);
  const db = getDb();
  const existing = await db.budgets.list();
  if (hasDuplicateBudget(existing, input.month, input.category_id)) {
    throw new HttpError(409, "Ya existe un presupuesto para ese mes y categoría");
  }
  return db.budgets.create(input);
});
