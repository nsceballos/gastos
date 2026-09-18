import { describe, expect, it } from "vitest";
import { createMemoryDb } from "@/lib/db";
import { alerts, budgetStatus, ensureRecurringBudgets, hasDuplicateBudget } from "@/lib/domain/budgets";
import { DEFAULT_SETTINGS } from "@/lib/types";
import type { AppSettings, Budget, Category, Transaction } from "@/lib/types";

const settings: AppSettings = { ...DEFAULT_SETTINGS, month_start_day: 1, budget_counts_pending_card: true };

const cat = (p: Partial<Category>): Category => ({
  id: "c", created_at: "", updated_at: "", name: "Cat", type: "expense", icon: "tag", color: "#f00",
  parent_id: null, archived: false, sort_order: 0, ...p,
});

const budget = (p: Partial<Budget>): Budget => ({
  id: "b", created_at: "", updated_at: "", month: "2026-09", category_id: null, amount: 1000,
  alert_threshold_pct: 80, recurring: true, ...p,
});

const tx = (p: Partial<Transaction>): Transaction => ({
  id: "t", created_at: "", updated_at: "", date: "2026-09-10", effective_date: null, type: "expense",
  status: "posted", amount: 100, currency: "ARS", account_id: "a", to_account_id: null, category_id: null,
  note: "", card_statement_id: null, installments_total: null, installment_number: null,
  installment_group_id: null, is_shared: false, paid_by: "me", my_share_pct: null, settlement_id: null, ...p,
});

describe("budgetStatus", () => {
  it("clasifica ok / warning / exceeded según el % gastado", () => {
    const comida = cat({ id: "comida", name: "Comida" });
    const budgets = [budget({ id: "b1", category_id: "comida", amount: 1000, alert_threshold_pct: 80 })];
    const txs = [tx({ category_id: "comida", amount: 500 })];
    let status = budgetStatus(budgets, txs, [comida], "2026-09", settings, "2026-09-15");
    expect(status[0].level).toBe("ok");

    status = budgetStatus(budgets, [tx({ category_id: "comida", amount: 850 })], [comida], "2026-09", settings, "2026-09-15");
    expect(status[0].level).toBe("warning");
    expect(status[0].pct).toBe(85);

    status = budgetStatus(budgets, [tx({ category_id: "comida", amount: 1200 })], [comida], "2026-09", settings, "2026-09-15");
    expect(status[0].level).toBe("exceeded");
    expect(status[0].remaining).toBe(-200);
  });

  it("presupuesto total suma todas las categorías, uno de categoría solo la suya", () => {
    const comida = cat({ id: "comida", name: "Comida" });
    const transporte = cat({ id: "transporte", name: "Transporte" });
    const budgets = [
      budget({ id: "total", category_id: null, amount: 1000 }),
      budget({ id: "bcomida", category_id: "comida", amount: 400 }),
    ];
    const txs = [
      tx({ category_id: "comida", amount: 300 }),
      tx({ category_id: "transporte", amount: 200 }),
    ];
    const status = budgetStatus(budgets, txs, [comida, transporte], "2026-09", settings, "2026-09-15");
    const total = status.find((s) => s.budget.id === "total")!;
    const bc = status.find((s) => s.budget.id === "bcomida")!;
    expect(total.spent).toBe(500);
    expect(bc.spent).toBe(300);
  });

  it("un presupuesto de categoría incluye el gasto de sus subcategorías", () => {
    const comida = cat({ id: "comida", name: "Comida" });
    const delivery = cat({ id: "delivery", name: "Delivery", parent_id: "comida" });
    const budgets = [budget({ id: "b1", category_id: "comida", amount: 1000 })];
    const txs = [tx({ category_id: "comida", amount: 200 }), tx({ category_id: "delivery", amount: 300 })];
    const status = budgetStatus(budgets, txs, [comida, delivery], "2026-09", settings, "2026-09-15");
    expect(status[0].spent).toBe(500);
  });

  it("respeta el criterio comprometido vs efectivo (pending_card)", () => {
    const comida = cat({ id: "comida", name: "Comida" });
    const budgets = [budget({ id: "b1", category_id: "comida", amount: 1000 })];
    const txs = [
      tx({ category_id: "comida", amount: 300, status: "pending_card", date: "2026-09-05" }),
      tx({ category_id: "comida", amount: 200, status: "posted", date: "2026-09-06", effective_date: "2026-09-06" }),
    ];
    const committed = budgetStatus(budgets, txs, [comida], "2026-09", { ...settings, budget_counts_pending_card: true }, "2026-09-15");
    expect(committed[0].spent).toBe(500);

    const effective = budgetStatus(budgets, txs, [comida], "2026-09", { ...settings, budget_counts_pending_card: false }, "2026-09-15");
    expect(effective[0].spent).toBe(200);
  });

  it("calcula días restantes y presupuesto diario disponible", () => {
    const budgets = [budget({ id: "total", category_id: null, amount: 300 })];
    const txs = [tx({ amount: 150, date: "2026-09-10" })];
    // Mes de 30 días, hoy 20/09 -> quedan 11 días (20..30 inclusive).
    const status = budgetStatus(budgets, txs, [], "2026-09", settings, "2026-09-20");
    expect(status[0].days_left).toBe(11);
    expect(status[0].daily_allowance).toBeCloseTo(150 / 11, 1);
  });
});

describe("ensureRecurringBudgets", () => {
  it("copia solo los presupuestos recurrentes del mes anterior y es idempotente", async () => {
    const db = createMemoryDb();
    await db.budgets.createMany([
      { month: "2026-08", category_id: "comida", amount: 500, alert_threshold_pct: 80, recurring: true },
      { month: "2026-08", category_id: "ocio", amount: 200, alert_threshold_pct: 80, recurring: false },
    ]);

    const created = await ensureRecurringBudgets(db, "2026-09");
    expect(created).toHaveLength(1);
    expect(created[0].category_id).toBe("comida");
    expect(created[0].month).toBe("2026-09");

    const all = await db.budgets.list();
    expect(all.filter((b) => b.month === "2026-09")).toHaveLength(1);

    // Segunda llamada: no duplica.
    const again = await ensureRecurringBudgets(db, "2026-09");
    expect(again).toHaveLength(1);
    const allAfter = await db.budgets.list();
    expect(allAfter.filter((b) => b.month === "2026-09")).toHaveLength(1);
  });

  it("no hace nada si no hay presupuestos recurrentes en el mes anterior", async () => {
    const db = createMemoryDb();
    const created = await ensureRecurringBudgets(db, "2026-09");
    expect(created).toEqual([]);
  });
});

describe("hasDuplicateBudget", () => {
  it("detecta duplicado por mes + categoría (incluyendo total)", () => {
    const budgets = [budget({ month: "2026-09", category_id: "comida" }), budget({ month: "2026-09", category_id: null })];
    expect(hasDuplicateBudget(budgets, "2026-09", "comida")).toBe(true);
    expect(hasDuplicateBudget(budgets, "2026-09", null)).toBe(true);
    expect(hasDuplicateBudget(budgets, "2026-09", "transporte")).toBe(false);
    expect(hasDuplicateBudget(budgets, "2026-10", "comida")).toBe(false);
  });
});

describe("alerts", () => {
  it("genera mensajes en español ordenados por severidad", () => {
    const comida = cat({ id: "comida", name: "Comida" });
    const budgets = [
      budget({ id: "b1", category_id: "comida", amount: 50000, alert_threshold_pct: 80 }),
      budget({ id: "total", category_id: null, amount: 100000, alert_threshold_pct: 80 }),
    ];
    const txs = [tx({ category_id: "comida", amount: 42500 }), tx({ category_id: "otra", amount: 60700 })];
    const status = budgetStatus(budgets, txs, [comida], "2026-09", settings, "2026-09-15");
    const list = alerts(status);
    expect(list[0].level).toBe("exceeded");
    expect(list[0].message).toContain("Superaste el presupuesto total del mes en $3.200");
    expect(list[1].level).toBe("warning");
    expect(list[1].message).toContain("Comida: usaste el 85% del presupuesto ($42.500 de $50.000)");
  });

  it("no genera alertas cuando todo está ok", () => {
    const comida = cat({ id: "comida", name: "Comida" });
    const budgets = [budget({ id: "b1", category_id: "comida", amount: 1000 })];
    const status = budgetStatus(budgets, [tx({ category_id: "comida", amount: 100 })], [comida], "2026-09", settings, "2026-09-15");
    expect(alerts(status)).toEqual([]);
  });
});
