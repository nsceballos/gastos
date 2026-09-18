import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/lib/db";
import type { Account } from "@/lib/types";
import { accountBalance } from "@/lib/domain/core";
import {
  closeDueStatements,
  getOrCreateStatement,
  payStatement,
  recomputeStatementTotal,
  statementPeriodFor,
  unpayStatement,
} from "@/lib/domain/cards";
import { createTransaction } from "@/lib/domain/transactions";

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

async function makeCard(db: Db, closing: number | null, due: number | null): Promise<Account> {
  return db.accounts.create({
    ...baseAccount,
    name: "Visa",
    type: "credit_card",
    closing_day: closing,
    due_day: due,
  });
}

async function makeBank(db: Db, initial = 100000): Promise<Account> {
  return db.accounts.create({ ...baseAccount, name: "Banco", type: "bank", initial_balance: initial });
}

function card(closing: number | null, due: number | null) {
  return { closing_day: closing, due_day: due };
}

describe("statementPeriodFor", () => {
  it("compra antes del cierre cae en el resumen del mes en curso", () => {
    const p = statementPeriodFor(card(20, 10), "2026-09-10");
    expect(p.period_start).toBe("2026-08-21");
    expect(p.period_end).toBe("2026-09-20");
    // due_day (10) < closing_day (20) -> vence el mes siguiente al cierre
    expect(p.due_date).toBe("2026-10-10");
  });

  it("compra después del cierre cae en el resumen del mes siguiente", () => {
    const p = statementPeriodFor(card(20, 10), "2026-09-21");
    expect(p.period_start).toBe("2026-09-21");
    expect(p.period_end).toBe("2026-10-20");
    expect(p.due_date).toBe("2026-11-10");
  });

  it("due_day > closing_day vence en el mismo mes del cierre", () => {
    const p = statementPeriodFor(card(5, 20), "2026-09-03");
    expect(p.period_end).toBe("2026-09-05");
    expect(p.due_date).toBe("2026-09-20");
  });

  it("el día de cierre se recorta en meses cortos", () => {
    const p = statementPeriodFor(card(31, 10), "2026-02-15");
    expect(p.period_start).toBe("2026-02-01");
    expect(p.period_end).toBe("2026-02-28");
    expect(p.due_date).toBe("2026-03-10");

    const p2 = statementPeriodFor(card(30, 15), "2026-02-28");
    expect(p2.period_end).toBe("2026-02-28");
  });

  it("sin closing_day/due_day usa los defaults (último día del mes / día 10)", () => {
    const p = statementPeriodFor(card(null, null), "2026-09-18");
    expect(p.period_start).toBe("2026-09-01");
    expect(p.period_end).toBe("2026-09-30");
    expect(p.due_date).toBe("2026-10-10");
  });

  it("el período es continuo: el inicio es el día siguiente al cierre anterior", () => {
    const a = statementPeriodFor(card(20, 10), "2026-09-20");
    const b = statementPeriodFor(card(20, 10), "2026-09-21");
    expect(b.period_start > a.period_end).toBe(true);
    expect(b.period_start).toBe("2026-09-21");
  });
});

describe("resúmenes", () => {
  let db: Db;
  beforeEach(() => {
    db = createMemoryDb();
  });

  it("getOrCreateStatement es idempotente por período", async () => {
    const visa = await makeCard(db, 20, 10);
    const s1 = await getOrCreateStatement(db, visa, "2026-09-05");
    const s2 = await getOrCreateStatement(db, visa, "2026-09-18");
    expect(s2.id).toBe(s1.id);
    expect((await db.card_statements.list()).length).toBe(1);
    const s3 = await getOrCreateStatement(db, visa, "2026-09-25");
    expect(s3.id).not.toBe(s1.id);
    expect(s3.status).toBe("open");
    expect(s3.total).toBe(0);
  });

  it("recomputeStatementTotal suma los consumos del resumen", async () => {
    const visa = await makeCard(db, 20, 10);
    await createTransaction(db, {
      date: "2026-09-05", type: "expense", amount: 1500, account_id: visa.id, to_account_id: null,
      category_id: null, note: "Nafta", installments_total: null, is_shared: false, paid_by: "me",
      my_share_pct: null,
    });
    await createTransaction(db, {
      date: "2026-09-06", type: "expense", amount: 500.5, account_id: visa.id, to_account_id: null,
      category_id: null, note: "Café", installments_total: null, is_shared: false, paid_by: "me",
      my_share_pct: null,
    });
    const [statement] = await db.card_statements.list();
    expect(await recomputeStatementTotal(db, statement.id)).toBe(2000.5);
    expect((await db.card_statements.get(statement.id))?.total).toBe(2000.5);
  });

  it("closeDueStatements cierra los vencidos y es idempotente", async () => {
    const visa = await makeCard(db, 20, 10);
    const viejo = await getOrCreateStatement(db, visa, "2026-08-01");
    const nuevo = await getOrCreateStatement(db, visa, "2026-09-25");
    expect(await closeDueStatements(db, "2026-09-30")).toBe(1);
    expect(await closeDueStatements(db, "2026-09-30")).toBe(0);
    expect((await db.card_statements.get(viejo.id))?.status).toBe("closed");
    expect((await db.card_statements.get(nuevo.id))?.status).toBe("open");
  });
});

describe("pago del resumen", () => {
  it("postea los consumos, crea el card_payment y deja la tarjeta en 0", async () => {
    const db = createMemoryDb();
    const visa = await makeCard(db, 20, 10);
    const banco = await makeBank(db, 100000);
    for (const [date, amount] of [["2026-09-05", 1000], ["2026-09-12", 2000]] as const) {
      await createTransaction(db, {
        date, type: "expense", amount, account_id: visa.id, to_account_id: null, category_id: null,
        note: "compra", installments_total: null, is_shared: false, paid_by: "me", my_share_pct: null,
      });
    }
    const [statement] = await db.card_statements.list();
    expect(statement.total).toBe(3000);

    const res = await payStatement(db, statement.id, {
      from_account_id: banco.id, amount: 3000, date: "2026-10-10",
    });

    expect(res.posted).toBe(2);
    expect(res.statement.status).toBe("paid");
    expect(res.statement.paid_amount).toBe(3000);
    expect(res.statement.paid_at).toBe("2026-10-10");
    expect(res.statement.paid_from_account_id).toBe(banco.id);
    expect(res.statement.payment_transaction_id).toBe(res.payment.id);

    const txs = await db.transactions.list();
    const consumos = txs.filter((t) => t.type === "expense");
    expect(consumos.every((t) => t.status === "posted")).toBe(true);
    expect(consumos.every((t) => t.effective_date === "2026-10-10")).toBe(true);

    const pago = txs.find((t) => t.type === "card_payment")!;
    expect(pago.account_id).toBe(banco.id);
    expect(pago.to_account_id).toBe(visa.id);
    expect(pago.status).toBe("posted");
    expect(pago.category_id).toBeNull();
    expect(pago.note).toContain("Pago tarjeta");

    expect(accountBalance(banco, txs)).toBe(97000);
    expect(accountBalance(visa, txs)).toBe(0);
  });

  it("rechaza pagar dos veces", async () => {
    const db = createMemoryDb();
    const visa = await makeCard(db, 20, 10);
    const banco = await makeBank(db);
    const statement = await getOrCreateStatement(db, visa, "2026-09-05");
    await payStatement(db, statement.id, { from_account_id: banco.id, amount: 100, date: "2026-10-10" });
    await expect(
      payStatement(db, statement.id, { from_account_id: banco.id, amount: 100, date: "2026-10-10" }),
    ).rejects.toThrow(/ya está pagado/);
  });

  it("pago parcial: postea igual los consumos y guarda paid_amount", async () => {
    const db = createMemoryDb();
    const visa = await makeCard(db, 20, 10);
    const banco = await makeBank(db);
    await createTransaction(db, {
      date: "2026-09-05", type: "expense", amount: 5000, account_id: visa.id, to_account_id: null,
      category_id: null, note: "", installments_total: null, is_shared: false, paid_by: "me", my_share_pct: null,
    });
    const [statement] = await db.card_statements.list();
    const res = await payStatement(db, statement.id, {
      from_account_id: banco.id, amount: 2000, date: "2026-10-10",
    });
    expect(res.statement.paid_amount).toBe(2000);
    expect(res.statement.total).toBe(5000);
    const txs = await db.transactions.list();
    expect(txs.filter((t) => t.status === "pending_card").length).toBe(0);
    expect(accountBalance(visa, txs)).toBe(-3000);
  });

  it("unpayStatement revierte todo", async () => {
    const db = createMemoryDb();
    const visa = await makeCard(db, 20, 10);
    const banco = await makeBank(db, 100000);
    await createTransaction(db, {
      date: "2026-09-05", type: "expense", amount: 1000, account_id: visa.id, to_account_id: null,
      category_id: null, note: "", installments_total: null, is_shared: false, paid_by: "me", my_share_pct: null,
    });
    const [statement] = await db.card_statements.list();
    await payStatement(db, statement.id, { from_account_id: banco.id, amount: 1000, date: "2026-10-10" });

    const reverted = await unpayStatement(db, statement.id, "2026-10-11");
    expect(reverted.status).toBe("closed");
    expect(reverted.paid_at).toBeNull();
    expect(reverted.payment_transaction_id).toBeNull();

    const txs = await db.transactions.list();
    expect(txs.filter((t) => t.type === "card_payment").length).toBe(0);
    const consumo = txs.find((t) => t.type === "expense")!;
    expect(consumo.status).toBe("pending_card");
    expect(consumo.effective_date).toBeNull();
    expect(accountBalance(banco, txs)).toBe(100000);
    expect(accountBalance(visa, txs)).toBe(-1000);

    await expect(unpayStatement(db, statement.id)).rejects.toThrow(/no está pagado/);
  });
});

describe("cuotas", () => {
  it("3 cuotas de 1000 suman exacto y caen en 3 resúmenes distintos", async () => {
    const db = createMemoryDb();
    const visa = await makeCard(db, 20, 10);
    const cuotas = await createTransaction(db, {
      date: "2026-09-05", type: "expense", amount: 1000, account_id: visa.id, to_account_id: null,
      category_id: null, note: "TV", installments_total: 3, is_shared: false, paid_by: "me", my_share_pct: null,
    });

    expect(cuotas.length).toBe(3);
    expect(cuotas.map((c) => c.amount)).toEqual([333.33, 333.33, 333.34]);
    expect(cuotas.reduce((a, c) => a + c.amount, 0)).toBeCloseTo(1000, 10);
    expect(cuotas.map((c) => c.installment_number)).toEqual([1, 2, 3]);
    expect(new Set(cuotas.map((c) => c.installment_group_id)).size).toBe(1);
    expect(cuotas.map((c) => c.date)).toEqual(["2026-09-05", "2026-10-05", "2026-11-05"]);
    expect(cuotas[0].note).toBe("TV (cuota 1/3)");
    expect(cuotas.every((c) => c.status === "pending_card" && c.effective_date === null)).toBe(true);

    const statementIds = new Set(cuotas.map((c) => c.card_statement_id));
    expect(statementIds.size).toBe(3);
    const statements = await db.card_statements.list();
    expect(statements.length).toBe(3);
    expect(statements.every((s) => s.total === 333.33 || s.total === 333.34)).toBe(true);
  });

  it("las cuotas solo aplican a tarjetas de crédito", async () => {
    const db = createMemoryDb();
    const banco = await makeBank(db);
    const res = await createTransaction(db, {
      date: "2026-09-05", type: "expense", amount: 900, account_id: banco.id, to_account_id: null,
      category_id: null, note: "", installments_total: 3, is_shared: false, paid_by: "me", my_share_pct: null,
    });
    expect(res.length).toBe(1);
    expect(res[0].status).toBe("posted");
  });
});

describe("API de tarjetas", () => {
  it("consumo -> resumen -> pago -> despago vía route handlers", async () => {
    const { getDb } = await import("@/lib/db");
    const txRoute = await import("@/app/api/transactions/route");
    const statementsRoute = await import("@/app/api/cards/statements/route");
    const payRoute = await import("@/app/api/cards/statements/[id]/pay/route");
    const unpayRoute = await import("@/app/api/cards/statements/[id]/unpay/route");
    const previewRoute = await import("@/app/api/cards/preview/route");
    const balancesRoute = await import("@/app/api/accounts/balances/route");

    const db = getDb();
    const visa = await db.accounts.create({ ...baseAccount, name: "Visa API", type: "credit_card", closing_day: 20, due_day: 10 });
    const banco = await db.accounts.create({ ...baseAccount, name: "Banco API", type: "bank", initial_balance: 50000 });
    const noCtx = { params: Promise.resolve({}) };

    const preview = await previewRoute.GET(
      new Request(`http://x/api/cards/preview?account_id=${visa.id}&date=2026-09-05`),
      noCtx,
    );
    expect((await preview.json()) as unknown).toMatchObject({
      is_card: true,
      period: { period_end: "2026-09-20", due_date: "2026-10-10" },
    });

    await txRoute.POST(
      new Request("http://x/api/transactions", {
        method: "POST",
        body: JSON.stringify({
          date: "2026-09-05", type: "expense", amount: 4000, account_id: visa.id, note: "Zapatillas",
        }),
      }),
      noCtx,
    );

    const listed = await statementsRoute.GET(
      new Request(`http://x/api/cards/statements?account_id=${visa.id}`),
      noCtx,
    );
    const { statements } = (await listed.json()) as {
      statements: { id: string; total: number; status: string; transactions: unknown[] }[];
    };
    expect(statements.length).toBe(1);
    expect(statements[0].total).toBe(4000);
    expect(statements[0].transactions.length).toBe(1);

    const payRes = await payRoute.POST(
      new Request("http://x/pay", {
        method: "POST",
        body: JSON.stringify({ from_account_id: banco.id, amount: 4000, date: "2026-10-10" }),
      }),
      { params: Promise.resolve({ id: statements[0].id }) },
    );
    expect(payRes.status).toBe(200);

    const balances = await balancesRoute.GET(new Request("http://x/api/accounts/balances"), noCtx);
    const { accounts } = (await balances.json()) as { accounts: { id: string; balance: number }[] };
    expect(accounts.find((a) => a.id === visa.id)?.balance).toBe(0);
    expect(accounts.find((a) => a.id === banco.id)?.balance).toBe(46000);

    const unpayRes = await unpayRoute.POST(new Request("http://x/unpay", { method: "POST" }), {
      params: Promise.resolve({ id: statements[0].id }),
    });
    expect(unpayRes.status).toBe(200);
    const after = await db.transactions.list();
    expect(after.filter((t) => t.type === "card_payment").length).toBe(0);
    expect(after.find((t) => t.note === "Zapatillas")?.status).toBe("pending_card");

    // Segundo despago: 409
    const again = await unpayRoute.POST(new Request("http://x/unpay", { method: "POST" }), {
      params: Promise.resolve({ id: statements[0].id }),
    });
    expect(again.status).toBe(409);
  });
});
