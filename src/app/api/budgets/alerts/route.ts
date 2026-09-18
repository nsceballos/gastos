import { handler, query } from "@/lib/api";
import { getDb } from "@/lib/db";
import { alerts, budgetStatus, ensureRecurringBudgets } from "@/lib/domain/budgets";
import { monthKey, todayISO } from "@/lib/domain/core";

export const dynamic = "force-dynamic";

/** Endpoint liviano usado por el banner de alertas (se llama en cada pantalla). */
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
  return { alerts: alerts(status) };
});
