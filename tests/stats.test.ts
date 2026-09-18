import { describe, expect, it } from "vitest";
import { statsForMonth, trend } from "@/lib/domain/stats";
import { DEFAULT_SETTINGS } from "@/lib/types";
import type { Account, AppSettings, Category, Transaction } from "@/lib/types";

const settings: AppSettings = { ...DEFAULT_SETTINGS, month_start_day: 1 };

const cat = (p: Partial<Category>): Category => ({
  id: "c", created_at: "", updated_at: "", name: "Cat", type: "expense", icon: "tag", color: "#f00",
  parent_id: null, archived: false, sort_order: 0, ...p,
});

const acc = (p: Partial<Account>): Account => ({
  id: "a", created_at: "", updated_at: "", name: "Cuenta", type: "bank", currency: "ARS",
  initial_balance: 0, closing_day: null, due_day: null, credit_limit: null, color: "", icon: "",
  archived: false, sort_order: 0, ...p,
});

const tx = (p: Partial<Transaction>): Transaction => ({
  id: "t", created_at: "", updated_at: "", date: "2026-09-10", effective_date: null, type: "expense",
  status: "posted", amount: 100, currency: "ARS", account_id: "a", to_account_id: null, category_id: null,
  note: "", card_statement_id: null, installments_total: null, installment_number: null,
  installment_group_id: null, is_shared: false, paid_by: "me", my_share_pct: null, settlement_id: null, ...p,
});

describe("statsForMonth", () => {
  it("agrupa por categoría, suma montos y ordena de mayor a menor", () => {
    const comida = cat({ id: "comida", name: "Comida" });
    const ocio = cat({ id: "ocio", name: "Ocio" });
    const txs = [
      tx({ category_id: "comida", amount: 100 }),
      tx({ category_id: "comida", amount: 50 }),
      tx({ category_id: "ocio", amount: 300 }),
    ];
    const stats = statsForMonth(txs, [comida, ocio], [], "2026-09", settings, "committed");
    expect(stats.by_category[0].category?.id).toBe("ocio");
    expect(stats.by_category[0].amount).toBe(300);
    expect(stats.by_category[0].count).toBe(1);
    expect(stats.by_category[1].category?.id).toBe("comida");
    expect(stats.by_category[1].amount).toBe(150);
    expect(stats.by_category[1].count).toBe(2);
    const total = stats.by_category.reduce((a, c) => a + c.pct, 0);
    expect(Math.round(total)).toBe(100);
  });

  it("los totales excluyen card_payment y separan comprometido/efectivo/pendiente según el modo", () => {
    const bank = acc({ id: "bank", type: "bank" });
    const card = acc({ id: "card", type: "credit_card" });
    const txs: Transaction[] = [
      // consumo de tarjeta, aún no pagado
      tx({ account_id: "card", amount: 500, status: "pending_card", date: "2026-09-05", effective_date: null }),
      // gasto normal en efectivo, ya efectivo
      tx({ account_id: "bank", amount: 200, status: "posted", date: "2026-09-06", effective_date: "2026-09-06" }),
      // pago del resumen de tarjeta: no debe contarse como gasto
      tx({ type: "card_payment", account_id: "bank", to_account_id: "card", amount: 500, date: "2026-09-20" }),
      // ingreso
      tx({ type: "income", account_id: "bank", amount: 1000, date: "2026-09-01", status: "posted" }),
    ];

    const committed = statsForMonth(txs, [], [bank, card], "2026-09", settings, "committed");
    expect(committed.totals.expense_committed).toBe(700); // 500 pending + 200 posted, por fecha de compra
    expect(committed.totals.expense_effective).toBe(200); // solo lo efectivamente pagado
    expect(committed.totals.pending_card).toBe(500);
    expect(committed.totals.income).toBe(1000);
    expect(committed.totals.balance).toBe(1000 - 700);

    const effective = statsForMonth(txs, [], [bank, card], "2026-09", settings, "effective");
    expect(effective.totals.balance).toBe(1000 - 200);
  });

  it("usa budget_counts_pending_card como modo por defecto cuando no se pasa mode", () => {
    const txs = [tx({ amount: 300, status: "pending_card", date: "2026-09-05" })];
    const committedDefault = statsForMonth(txs, [], [], "2026-09", { ...settings, budget_counts_pending_card: true });
    expect(committedDefault.by_category.reduce((a, c) => a + c.amount, 0)).toBe(300);

    const effectiveDefault = statsForMonth(txs, [], [], "2026-09", { ...settings, budget_counts_pending_card: false });
    expect(effectiveDefault.by_category.reduce((a, c) => a + c.amount, 0)).toBe(0);
  });
});

describe("trend", () => {
  it("devuelve los últimos N meses en orden cronológico", () => {
    const txs = [
      tx({ date: "2026-07-10", amount: 100, status: "posted" }),
      tx({ date: "2026-08-10", amount: 200, status: "posted" }),
      tx({ date: "2026-09-10", amount: 300, status: "posted" }),
      tx({ type: "income", date: "2026-09-01", amount: 1000, status: "posted" }),
    ];
    const points = trend(txs, 3, "2026-09", settings);
    expect(points.map((p) => p.month)).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(points[0].expense).toBe(100);
    expect(points[1].expense).toBe(200);
    expect(points[2].expense).toBe(300);
    expect(points[2].income).toBe(1000);
    expect(points[2].balance).toBe(700);
  });
});
