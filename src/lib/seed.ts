import type { Db } from "./db";
import type { CategoryInputType } from "./types";

/** Categorías por defecto (estilo Money Manager) — se crean solo si la tabla está vacía. */
export const DEFAULT_CATEGORIES: CategoryInputType[] = [
  { name: "Comida", type: "expense", icon: "utensils", color: "#f97316", parent_id: null, archived: false, sort_order: 1 },
  { name: "Supermercado", type: "expense", icon: "shopping-cart", color: "#84cc16", parent_id: null, archived: false, sort_order: 2 },
  { name: "Transporte", type: "expense", icon: "bus", color: "#0ea5e9", parent_id: null, archived: false, sort_order: 3 },
  { name: "Vivienda", type: "expense", icon: "home", color: "#8b5cf6", parent_id: null, archived: false, sort_order: 4 },
  { name: "Servicios", type: "expense", icon: "zap", color: "#eab308", parent_id: null, archived: false, sort_order: 5 },
  { name: "Salud", type: "expense", icon: "heart-pulse", color: "#ef4444", parent_id: null, archived: false, sort_order: 6 },
  { name: "Ocio", type: "expense", icon: "gamepad-2", color: "#ec4899", parent_id: null, archived: false, sort_order: 7 },
  { name: "Ropa", type: "expense", icon: "shirt", color: "#14b8a6", parent_id: null, archived: false, sort_order: 8 },
  { name: "Educación", type: "expense", icon: "graduation-cap", color: "#6366f1", parent_id: null, archived: false, sort_order: 9 },
  { name: "Regalos", type: "expense", icon: "gift", color: "#f43f5e", parent_id: null, archived: false, sort_order: 10 },
  { name: "Suscripciones", type: "expense", icon: "repeat", color: "#a855f7", parent_id: null, archived: false, sort_order: 11 },
  { name: "Otros", type: "expense", icon: "tag", color: "#64748b", parent_id: null, archived: false, sort_order: 99 },
  { name: "Sueldo", type: "income", icon: "briefcase", color: "#22c55e", parent_id: null, archived: false, sort_order: 1 },
  { name: "Freelance", type: "income", icon: "laptop", color: "#10b981", parent_id: null, archived: false, sort_order: 2 },
  { name: "Inversiones", type: "income", icon: "trending-up", color: "#06b6d4", parent_id: null, archived: false, sort_order: 3 },
  { name: "Otros ingresos", type: "income", icon: "coins", color: "#64748b", parent_id: null, archived: false, sort_order: 99 },
];

/** Cuentas iniciales: efectivo + cuenta virtual de la pareja (para gastos que paga ella/él). */
export async function seedDefaults(db: Db): Promise<{ categories: number; accounts: number }> {
  let categories = 0;
  let accounts = 0;
  if ((await db.categories.list()).length === 0) {
    await db.categories.createMany(DEFAULT_CATEGORIES);
    categories = DEFAULT_CATEGORIES.length;
  }
  const existing = await db.accounts.list();
  if (existing.length === 0) {
    await db.accounts.createMany([
      { name: "Efectivo", type: "cash", currency: "ARS", initial_balance: 0, closing_day: null, due_day: null, credit_limit: null, color: "#22c55e", icon: "banknote", archived: false, sort_order: 1 },
    ]);
    accounts++;
  }
  if (!existing.some((a) => a.type === "partner")) {
    await db.accounts.create({
      name: "Pareja", type: "partner", currency: "ARS", initial_balance: 0, closing_day: null, due_day: null, credit_limit: null, color: "#ec4899", icon: "heart", archived: false, sort_order: 999,
    });
    accounts++;
  }
  return { categories, accounts };
}
