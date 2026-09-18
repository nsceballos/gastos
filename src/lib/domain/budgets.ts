/**
 * Dominio de presupuestos mensuales + alertas.
 *
 * Reglas (ver docs/PLAN.md y src/lib/domain/core.ts):
 *  - El criterio "comprometido vs efectivo" para calcular el gasto de un presupuesto
 *    SIEMPRE se resuelve con `expensesForBudget` (core.ts). No se duplica acá.
 *  - Un presupuesto con `category_id = null` es el presupuesto TOTAL del mes (todas
 *    las categorías de gasto). Un presupuesto de categoría también cuenta el gasto
 *    de sus subcategorías (categorías cuyo `parent_id` sea esa categoría).
 */
import type { AppSettings, Budget, Category, Transaction } from "../types";
import type { Db } from "../db";
import { addMonths, expensesForBudget, monthKey, monthRange, round2, sum, todayISO } from "./core";

export type BudgetLevel = "ok" | "warning" | "exceeded";

export interface BudgetStatus {
  budget: Budget;
  /** null = presupuesto total del mes. */
  category: Category | null;
  spent: number;
  limit: number;
  remaining: number;
  /** % gastado sobre el límite (puede superar 100). */
  pct: number;
  level: BudgetLevel;
  /** Días restantes del período (incluye hoy), 0 si el período ya terminó. */
  days_left: number;
  /** Cuánto se puede gastar por día para no pasarse (puede ser negativo). */
  daily_allowance: number;
  /** Proyección de gasto total del período al ritmo actual. */
  projected: number;
  /** Nivel de la proyección respecto del límite ("a este ritmo vas a superar el presupuesto"). */
  level_projected: BudgetLevel;
}

export interface BudgetAlert {
  level: Exclude<BudgetLevel, "ok">;
  message: string;
}

function daysBetweenInclusive(startIso: string, endIso: string): number {
  const [sy, sm, sd] = startIso.split("-").map(Number);
  const [ey, em, ed] = endIso.split("-").map(Number);
  const a = Date.UTC(sy, sm - 1, sd);
  const b = Date.UTC(ey, em - 1, ed);
  return Math.round((b - a) / 86400000) + 1;
}

function levelFor(pct: number, thresholdPct: number): BudgetLevel {
  if (pct >= 100) return "exceeded";
  if (pct >= thresholdPct) return "warning";
  return "ok";
}

function pctOf(spent: number, limit: number): number {
  if (limit > 0) return round2((spent / limit) * 100);
  return spent > 0 ? 100 : 0;
}

/** Categorías que "pertenecen" a un presupuesto de categoría: ella misma + sus subcategorías directas. */
function categoryIdsFor(categoryId: string, categories: Category[]): Set<string> {
  const ids = new Set<string>([categoryId]);
  for (const c of categories) {
    if (c.parent_id === categoryId) ids.add(c.id);
  }
  return ids;
}

export function budgetStatus(
  budgets: Budget[],
  txs: Transaction[],
  categories: Category[],
  month: string,
  settings: AppSettings,
  today: string = todayISO(),
): BudgetStatus[] {
  const { start, end } = monthRange(month, settings.month_start_day);
  const expenses = expensesForBudget(txs, start, end, settings);
  const periodDays = daysBetweenInclusive(start, end);

  const clampedToday = today < start ? start : today > end ? end : today;
  const daysElapsed = Math.max(1, daysBetweenInclusive(start, clampedToday));
  const daysLeft = today > end ? 0 : Math.max(0, daysBetweenInclusive(clampedToday, end));

  return budgets
    .filter((b) => b.month === month)
    .map((budget) => {
      const category = budget.category_id ? (categories.find((c) => c.id === budget.category_id) ?? null) : null;
      let relevant: Transaction[];
      if (budget.category_id === null) {
        relevant = expenses;
      } else {
        const ids = categoryIdsFor(budget.category_id, categories);
        relevant = expenses.filter((t) => t.category_id !== null && ids.has(t.category_id));
      }
      const spent = sum(relevant.map((t) => t.amount));
      const limit = budget.amount;
      const remaining = round2(limit - spent);
      const pct = pctOf(spent, limit);
      const level = levelFor(pct, budget.alert_threshold_pct);
      const daily_allowance = daysLeft > 0 ? round2(remaining / daysLeft) : remaining;
      const projected = round2((spent / daysElapsed) * periodDays);
      const projectedPct = pctOf(projected, limit);
      const level_projected = levelFor(projectedPct, budget.alert_threshold_pct);

      return {
        budget,
        category,
        spent,
        limit,
        remaining,
        pct,
        level,
        days_left: daysLeft,
        daily_allowance,
        projected,
        level_projected,
      };
    });
}

/**
 * Si no hay presupuestos cargados para `month`, copia los del mes anterior marcados
 * `recurring = true`. Idempotente: si ya hay presupuestos para `month`, no hace nada.
 */
export async function ensureRecurringBudgets(db: Db, month: string): Promise<Budget[]> {
  const all = await db.budgets.list();
  const forMonth = all.filter((b) => b.month === month);
  if (forMonth.length > 0) return forMonth;

  const prevMonth = monthKey(addMonths(`${month}-01`, -1));
  const toCopy = all.filter((b) => b.month === prevMonth && b.recurring);
  if (toCopy.length === 0) return [];

  return db.budgets.createMany(
    toCopy.map((b) => ({
      month,
      category_id: b.category_id,
      amount: b.amount,
      alert_threshold_pct: b.alert_threshold_pct,
      recurring: b.recurring,
    })),
  );
}

/** true si ya existe un presupuesto para ese mes + categoría (null = total). */
export function hasDuplicateBudget(budgets: Budget[], month: string, categoryId: string | null): boolean {
  return budgets.some((b) => b.month === month && b.category_id === categoryId);
}

function money(n: number): string {
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(Math.round(n));
}

/** Alertas en español, ordenadas por severidad (superado primero, luego aviso; dentro de cada nivel, % desc). */
export function alerts(statuses: BudgetStatus[]): BudgetAlert[] {
  const out: BudgetAlert[] = [];
  const order = { exceeded: 0, warning: 1 } as const;
  const sorted = [...statuses]
    .filter((s) => s.level !== "ok")
    .sort((a, b) => order[a.level as "exceeded" | "warning"] - order[b.level as "exceeded" | "warning"] || b.pct - a.pct);

  for (const s of sorted) {
    if (s.level === "exceeded") {
      const over = round2(s.spent - s.limit);
      out.push({
        level: "exceeded",
        message: s.category
          ? `${s.category.name}: superaste el presupuesto en $${money(over)} ($${money(s.spent)} de $${money(s.limit)})`
          : `Superaste el presupuesto total del mes en $${money(over)}`,
      });
    } else {
      out.push({
        level: "warning",
        message: s.category
          ? `${s.category.name}: usaste el ${Math.round(s.pct)}% del presupuesto ($${money(s.spent)} de $${money(s.limit)})`
          : `Vas por el ${Math.round(s.pct)}% del presupuesto total del mes ($${money(s.spent)} de $${money(s.limit)})`,
      });
    }
  }
  return out;
}
