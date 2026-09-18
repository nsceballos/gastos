import { describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/lib/db";
import type { Account, TransactionInputType } from "@/lib/types";
import { DEFAULT_SETTINGS } from "@/lib/types";
import { monthRange } from "@/lib/domain/core";
import { getOrCreateStatement, payStatement } from "@/lib/domain/cards";
import {
  createTransaction,
  deleteTransaction,
  listTransactions,
  monthSummary,
  updateTransaction,
} from "@/lib/domain/transactions";

const baseAccount = {
  currency: "ARS",
  initial_balance: 0,
  closing_day: null,
  due_day: null,
  credit_limit: null,
  color: "#000",
  icon: "wallet",
  archived: false,
  sort_order: 0,
};

function tx(patch: Partial<TransactionInputType> = {}): TransactionInputType {
  return {
    date: "2026-09-10",
    type: "expense",
    amount: 1000,
    account_id: "",
    to_account_id: null,
    category_id: null,
    note: "",
    installments_total: null,
    is_shared: false,
    paid_by: "me",
    my_share_pct: null,
    ...patch,
  };
}

async function setup(): Promise<{ db: Db; visa: Account; efectivo: Account; pareja: Account }> {
  const db = createMemoryDb();
  const visa = await db.accounts.create({ ...baseAccount, name: "Visa", type: "credit_card", closing_day: 20, due_day: 10 });
  const efectivo = await db.accounts.create({ ...baseAccount, name: "Efectivo", type: "cash", initial_balance: 50000 });
  const pareja = await db.accounts.create({ ...baseAccount, name: "Pareja", type: "partner" });
  return { db, visa, efectivo, pareja };
}

describe("createTransaction", () => {
  it("el consumo con tarjeta nace pending_card y sin effective_date", async () => {
    const { db, visa } = await setup();
    const [t] = await createTransaction(db, tx({ account_id: visa.id, amount: 2500 }));
    expect(t.status).toBe("pending_card");
    expect(t.effective_date).toBeNull();
    expect(t.card_statement_id).toBeTruthy();
    expect(t.currency).toBe("ARS");
    const statement = await db.card_statements.get(t.card_statement_id!);
    expect(statement?.period_end).toBe("2026-09-20");
    expect(statement?.total).toBe(2500);
  });

  it("el gasto en efectivo nace posted con effective_date = date", async () => {
    const { db, efectivo } = await setup();
    const [t] = await createTransaction(db, tx({ account_id: efectivo.id }));
    expect(t.status).toBe("posted");
    expect(t.effective_date).toBe("2026-09-10");
    expect(t.card_statement_id).toBeNull();
  });

  it("un gasto compartido que paga la pareja va a la cuenta partner", async () => {
    const { db, efectivo, pareja } = await setup();
    const [t] = await createTransaction(
      db,
      tx({ account_id: efectivo.id, is_shared: true, paid_by: "partner", amount: 4000 }),
    );
    expect(t.account_id).toBe(pareja.id);
    expect(t.my_share_pct).toBe(DEFAULT_SETTINGS.default_my_share_pct);
    expect(t.status).toBe("posted");
  });

  it("usa el my_share_pct de settings solo si no viene en el input", async () => {
    const { db, efectivo } = await setup();
    await db.settings.set({ default_my_share_pct: 70 });
    const [a] = await createTransaction(db, tx({ account_id: efectivo.id, is_shared: true }));
    const [b] = await createTransaction(db, tx({ account_id: efectivo.id, is_shared: true, my_share_pct: 30 }));
    expect(a.my_share_pct).toBe(70);
    expect(b.my_share_pct).toBe(30);
  });

  it("la transferencia exige cuenta destino distinta", async () => {
    const { db, efectivo, visa } = await setup();
    await expect(
      createTransaction(db, tx({ type: "transfer", account_id: efectivo.id })),
    ).rejects.toThrow(/destino/);
    await expect(
      createTransaction(db, tx({ type: "transfer", account_id: efectivo.id, to_account_id: efectivo.id })),
    ).rejects.toThrow(/no pueden ser la misma/);
    const [t] = await createTransaction(
      db,
      tx({ type: "transfer", account_id: efectivo.id, to_account_id: visa.id }),
    );
    expect(t.to_account_id).toBe(visa.id);
  });

  it("valida cuenta y categoría inexistentes", async () => {
    const { db } = await setup();
    await expect(createTransaction(db, tx({ account_id: "nope" }))).rejects.toThrow(/cuenta/i);
    const { db: db2, efectivo } = await setup();
    await expect(
      createTransaction(db2, tx({ account_id: efectivo.id, category_id: "nope" })),
    ).rejects.toThrow(/categoría/i);
  });
});

describe("monthSummary", () => {
  it("excluye los consumos pendientes del gasto efectivo y no cuenta el card_payment", async () => {
    const { db, visa, efectivo } = await setup();
    await createTransaction(db, tx({ account_id: efectivo.id, amount: 1000 }));
    await createTransaction(db, tx({ account_id: visa.id, amount: 3000 }));
    await createTransaction(db, tx({ type: "income", account_id: efectivo.id, amount: 90000, date: "2026-09-01" }));

    const range = monthRange("2026-09");
    const s1 = monthSummary(await db.transactions.list(), DEFAULT_SETTINGS, range);
    expect(s1.income).toBe(90000);
    expect(s1.expense_effective).toBe(1000);
    expect(s1.expense_committed).toBe(4000);
    expect(s1.pending_card_total).toBe(3000);
    expect(s1.balance).toBe(89000);

    const [statement] = await db.card_statements.list();
    await payStatement(db, statement.id, { from_account_id: efectivo.id, amount: 3000, date: "2026-10-10" });

    // Octubre: el consumo impacta como gasto efectivo, el card_payment NO se cuenta.
    const oct = monthSummary(await db.transactions.list(), DEFAULT_SETTINGS, monthRange("2026-10"));
    expect(oct.expense_effective).toBe(3000);
    expect(oct.expense_committed).toBe(0);
    expect(oct.income).toBe(0);

    // Septiembre: el consumo sigue siendo comprometido pero ya no está pendiente.
    const sep = monthSummary(await db.transactions.list(), DEFAULT_SETTINGS, range);
    expect(sep.expense_committed).toBe(4000);
    expect(sep.pending_card_total).toBe(0);
    expect(sep.expense_effective).toBe(1000);
  });

  it("expense_for_budget sigue a budget_counts_pending_card", async () => {
    const { db, visa } = await setup();
    await createTransaction(db, tx({ account_id: visa.id, amount: 3000 }));
    const all = await db.transactions.list();
    const range = monthRange("2026-09");
    expect(monthSummary(all, { budget_counts_pending_card: true }, range).expense_for_budget).toBe(3000);
    expect(monthSummary(all, { budget_counts_pending_card: false }, range).expense_for_budget).toBe(0);
  });
});

describe("updateTransaction", () => {
  it("reasigna el resumen si cambia la fecha del consumo", async () => {
    const { db, visa } = await setup();
    const [t] = await createTransaction(db, tx({ account_id: visa.id, amount: 1000 }));
    const before = t.card_statement_id!;
    const upd = await updateTransaction(db, t.id, { date: "2026-09-25" });
    expect(upd.card_statement_id).not.toBe(before);
    expect((await db.card_statements.get(before))?.total).toBe(0);
    expect((await db.card_statements.get(upd.card_statement_id!))?.total).toBe(1000);
  });

  it("pasar el consumo a una cuenta que no es tarjeta lo postea", async () => {
    const { db, visa, efectivo } = await setup();
    const [t] = await createTransaction(db, tx({ account_id: visa.id }));
    const upd = await updateTransaction(db, t.id, { account_id: efectivo.id });
    expect(upd.status).toBe("posted");
    expect(upd.effective_date).toBe(upd.date);
    expect(upd.card_statement_id).toBeNull();
  });

  it("no se puede editar el monto de un consumo de un resumen ya pagado", async () => {
    const { db, visa, efectivo } = await setup();
    const [t] = await createTransaction(db, tx({ account_id: visa.id, amount: 1000 }));
    const statement = await db.card_statements.get(t.card_statement_id!);
    await payStatement(db, statement!.id, { from_account_id: efectivo.id, amount: 1000, date: "2026-10-10" });

    await expect(updateTransaction(db, t.id, { amount: 2000 })).rejects.toThrow(/resumen ya pagado/);
    // la nota sí se puede editar
    const upd = await updateTransaction(db, t.id, { note: "corregido" });
    expect(upd.note).toBe("corregido");
    expect(upd.status).toBe("posted");
  });

  it("no se puede editar ni borrar una transacción ya liquidada con la pareja", async () => {
    const { db, efectivo } = await setup();
    const [t] = await createTransaction(db, tx({ account_id: efectivo.id, is_shared: true }));
    await db.transactions.update(t.id, { settlement_id: "liq-1" });
    await expect(updateTransaction(db, t.id, { amount: 5 })).rejects.toThrow(/liquidada/);
    await expect(deleteTransaction(db, t.id)).rejects.toThrow(/liquidada/);
  });
});

describe("deleteTransaction", () => {
  it("borra una sola cuota o todo el grupo con group=true", async () => {
    const { db, visa } = await setup();
    const cuotas = await createTransaction(db, tx({ account_id: visa.id, amount: 1200, installments_total: 3 }));
    expect(await deleteTransaction(db, cuotas[0].id)).toEqual({ deleted: 1 });
    expect((await db.transactions.list()).length).toBe(2);
    expect((await db.card_statements.get(cuotas[0].card_statement_id!))?.total).toBe(0);

    const res = await deleteTransaction(db, cuotas[1].id, { group: true });
    expect(res.deleted).toBe(2);
    expect((await db.transactions.list()).length).toBe(0);
  });

  it("no borra un consumo de un resumen pagado", async () => {
    const { db, visa, efectivo } = await setup();
    const [t] = await createTransaction(db, tx({ account_id: visa.id }));
    const st = await getOrCreateStatement(db, visa, t.date);
    await payStatement(db, st.id, { from_account_id: efectivo.id, amount: 1000, date: "2026-10-10" });
    await expect(deleteTransaction(db, t.id)).rejects.toThrow(/resumen ya pagado/);
  });
});

describe("listTransactions", () => {
  it("filtra por rango y cuenta, ordenado por fecha desc", async () => {
    const { db, efectivo, visa } = await setup();
    await createTransaction(db, tx({ account_id: efectivo.id, date: "2026-09-01" }));
    await createTransaction(db, tx({ account_id: visa.id, date: "2026-09-15" }));
    await createTransaction(db, tx({ account_id: efectivo.id, date: "2026-10-02" }));

    const { start, end } = monthRange("2026-09");
    const sept = await listTransactions(db, { from: start, to: end });
    expect(sept.map((t) => t.date)).toEqual(["2026-09-15", "2026-09-01"]);
    const soloVisa = await listTransactions(db, { from: start, to: end, account_id: visa.id });
    expect(soloVisa.length).toBe(1);
    const pendientes = await listTransactions(db, { status: "pending_card" });
    expect(pendientes.length).toBe(1);
  });
});

describe("API /api/transactions", () => {
  it("POST crea y GET devuelve transacciones + resumen", async () => {
    const { POST, GET } = await import("@/app/api/transactions/route");
    const db = (await import("@/lib/db")).getDb();
    const efectivo = await db.accounts.create({ ...baseAccount, name: "Efectivo API", type: "cash" });

    const res = await POST(
      new Request("http://x/api/transactions", {
        method: "POST",
        body: JSON.stringify(tx({ account_id: efectivo.id, amount: 777, date: "2026-09-10" })),
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(200);
    const created = (await res.json()) as { transactions: { id: string }[] };
    expect(created.transactions.length).toBe(1);

    const listRes = await GET(new Request("http://x/api/transactions?month=2026-09"), {
      params: Promise.resolve({}),
    });
    const body = (await listRes.json()) as {
      transactions: { id: string }[];
      summary: { expense_effective: number };
    };
    expect(body.transactions.some((t) => t.id === created.transactions[0].id)).toBe(true);
    expect(body.summary.expense_effective).toBeGreaterThanOrEqual(777);
  });
});
