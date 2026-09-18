import { describe, expect, it } from "vitest";
import { createMemoryDb, type Db } from "@/lib/db";
import type { Account, TransactionInputType } from "@/lib/types";
import { accountHasTransactions, accountsWithBalances, netWorth } from "@/lib/domain/accounts";
import { createTransaction } from "@/lib/domain/transactions";
import { payStatement } from "@/lib/domain/cards";

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

async function setup(): Promise<{ db: Db; banco: Account; visa: Account; pareja: Account }> {
  const db = createMemoryDb();
  const banco = await db.accounts.create({ ...baseAccount, name: "Banco", type: "bank", initial_balance: 100000, sort_order: 1 });
  const visa = await db.accounts.create({
    ...baseAccount, name: "Visa", type: "credit_card", closing_day: 20, due_day: 10, credit_limit: 500000, sort_order: 2,
  });
  const pareja = await db.accounts.create({ ...baseAccount, name: "Pareja", type: "partner", sort_order: 9 });
  return { db, banco, visa, pareja };
}

describe("accountsWithBalances", () => {
  it("calcula saldo, deuda de tarjeta, resumen actual y disponible", async () => {
    const { db, banco, visa } = await setup();
    await createTransaction(db, tx({ account_id: banco.id, amount: 20000 }));
    await createTransaction(db, tx({ account_id: visa.id, amount: 15000, date: "2026-09-10" }));
    await createTransaction(db, tx({ account_id: visa.id, amount: 5000, date: "2026-09-25" }));

    const accounts = await accountsWithBalances(db, { today: "2026-09-18" });
    const b = accounts.find((a) => a.id === banco.id)!;
    const v = accounts.find((a) => a.id === visa.id)!;

    expect(b.balance).toBe(80000);
    expect(b.pending_total).toBeNull();
    expect(b.current_statement).toBeNull();
    expect(b.available).toBeNull();

    expect(v.balance).toBe(-20000);
    expect(v.pending_total).toBe(20000);
    expect(v.available).toBe(480000);
    expect(v.current_statement?.period_end).toBe("2026-09-20");
    expect(v.current_statement?.due_date).toBe("2026-10-10");
    expect(v.current_statement?.total).toBe(15000); // el consumo del 25 va al resumen siguiente
    expect(v.current_statement?.status).toBe("open");
  });

  it("devuelve un resumen sintético (id null) cuando la tarjeta no tuvo consumos", async () => {
    const { db, visa } = await setup();
    const accounts = await accountsWithBalances(db, { today: "2026-09-18" });
    const v = accounts.find((a) => a.id === visa.id)!;
    expect(v.current_statement).toEqual({
      id: null,
      period_start: "2026-08-21",
      period_end: "2026-09-20",
      due_date: "2026-10-10",
      status: "open",
      total: 0,
    });
  });

  it("después de pagar el resumen la tarjeta queda en 0 y sin deuda", async () => {
    const { db, banco, visa } = await setup();
    await createTransaction(db, tx({ account_id: visa.id, amount: 15000 }));
    const [statement] = await db.card_statements.list();
    await payStatement(db, statement.id, { from_account_id: banco.id, amount: 15000, date: "2026-10-10" });

    const accounts = await accountsWithBalances(db, { today: "2026-10-11" });
    const v = accounts.find((a) => a.id === visa.id)!;
    expect(v.balance).toBe(0);
    expect(v.pending_total).toBe(0);
    expect(accounts.find((a) => a.id === banco.id)!.balance).toBe(85000);
  });

  it("marca la cuenta de la pareja y la excluye del patrimonio", async () => {
    const { db, banco, pareja } = await setup();
    await createTransaction(db, tx({ account_id: banco.id, is_shared: true, paid_by: "partner", amount: 8000 }));

    const accounts = await accountsWithBalances(db, { today: "2026-09-18" });
    const p = accounts.find((a) => a.id === pareja.id)!;
    expect(p.is_partner).toBe(true);
    expect(p.balance).toBe(-8000);
    expect(accounts.find((a) => a.id === banco.id)!.balance).toBe(100000);
    expect(netWorth(accounts)).toBe(100000);
  });

  it("no incluye archivadas salvo que se pidan, y no cuentan en el patrimonio", async () => {
    const { db } = await setup();
    await db.accounts.create({ ...baseAccount, name: "Vieja", type: "cash", initial_balance: 777, archived: true });
    const visibles = await accountsWithBalances(db, { today: "2026-09-18" });
    expect(visibles.some((a) => a.name === "Vieja")).toBe(false);
    const todas = await accountsWithBalances(db, { today: "2026-09-18", includeArchived: true });
    expect(todas.some((a) => a.name === "Vieja")).toBe(true);
    expect(netWorth(todas)).toBe(100000);
  });
});

describe("accountHasTransactions", () => {
  it("detecta movimientos como origen o destino", async () => {
    const { db, banco, visa } = await setup();
    await createTransaction(db, tx({ type: "transfer", account_id: banco.id, to_account_id: visa.id }));
    expect(await accountHasTransactions(db, banco.id)).toBe(true);
    expect(await accountHasTransactions(db, visa.id)).toBe(true);
    const otra = await db.accounts.create({ ...baseAccount, name: "Otra", type: "cash" });
    expect(await accountHasTransactions(db, otra.id)).toBe(false);
  });
});

describe("API /api/accounts", () => {
  it("DELETE archiva si hay movimientos, borra si no, y rechaza la cuenta partner", async () => {
    const { DELETE } = await import("@/app/api/accounts/[id]/route");
    const { getDb } = await import("@/lib/db");
    const db = getDb();

    const conMovimientos = await db.accounts.create({ ...baseAccount, name: "Con movs", type: "cash" });
    await createTransaction(db, tx({ account_id: conMovimientos.id }));
    const sinMovimientos = await db.accounts.create({ ...baseAccount, name: "Sin movs", type: "cash" });
    const pareja = await db.accounts.create({ ...baseAccount, name: "Pareja", type: "partner" });

    const req = new Request("http://x/api/accounts/x", { method: "DELETE" });
    const r1 = await DELETE(req, { params: Promise.resolve({ id: conMovimientos.id }) });
    expect(((await r1.json()) as { archived: boolean }).archived).toBe(true);
    expect((await db.accounts.get(conMovimientos.id))?.archived).toBe(true);

    const r2 = await DELETE(req, { params: Promise.resolve({ id: sinMovimientos.id }) });
    expect(r2.status).toBe(200);
    expect(await db.accounts.get(sinMovimientos.id)).toBeNull();

    const r3 = await DELETE(req, { params: Promise.resolve({ id: pareja.id }) });
    expect(r3.status).toBe(400);
  });
});
