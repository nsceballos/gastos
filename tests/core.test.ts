import { describe, expect, it } from "vitest";
import { addMonths, monthRange, accountBalance, isEffectiveExpense, expensesForBudget } from "@/lib/domain/core";
import type { Account, Transaction } from "@/lib/types";

const tx = (p: Partial<Transaction>): Transaction => ({
  id: "t", created_at: "", updated_at: "", date: "2026-09-10", effective_date: null, type: "expense",
  status: "posted", amount: 100, currency: "ARS", account_id: "a", to_account_id: null, category_id: null,
  note: "", card_statement_id: null, installments_total: null, installment_number: null,
  installment_group_id: null, is_shared: false, paid_by: "me", my_share_pct: null, settlement_id: null, ...p,
});

describe("core", () => {
  it("addMonths respeta fin de mes", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
  });
  it("monthRange", () => {
    expect(monthRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthRange("2026-09", 10)).toEqual({ start: "2026-09-10", end: "2026-10-09" });
  });
  it("pending_card no es gasto efectivo", () => {
    expect(isEffectiveExpense(tx({ status: "pending_card" }))).toBe(false);
    expect(isEffectiveExpense(tx({ status: "posted" }))).toBe(true);
  });
  it("presupuesto comprometido vs efectivo", () => {
    const txs = [tx({ status: "pending_card", date: "2026-09-05" }), tx({ status: "posted", date: "2026-09-06" })];
    expect(expensesForBudget(txs, "2026-09-01", "2026-09-30", { budget_counts_pending_card: true }).length).toBe(2);
    expect(expensesForBudget(txs, "2026-09-01", "2026-09-30", { budget_counts_pending_card: false }).length).toBe(1);
  });
  it("saldo de cuentas con card_payment", () => {
    const bank: Account = { id: "b", name: "Banco", type: "bank", currency: "ARS", initial_balance: 1000, closing_day: null, due_day: null, credit_limit: null, color: "", icon: "", archived: false, sort_order: 0, created_at: "", updated_at: "" };
    const card: Account = { ...bank, id: "c", type: "credit_card", initial_balance: 0 };
    const txs = [
      tx({ account_id: "c", status: "pending_card", amount: 300 }),
      tx({ type: "card_payment", account_id: "b", to_account_id: "c", amount: 300 }),
    ];
    expect(accountBalance(card, txs)).toBe(0);
    expect(accountBalance(bank, txs)).toBe(700);
  });
});
