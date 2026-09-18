import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryDb, getDb, type Db } from "@/lib/db";
import { seedDefaults } from "@/lib/seed";
import type { Transaction } from "@/lib/types";
import {
  closePeriod,
  computeShared,
  listSettlements,
  openPeriod,
  reopenSettlement,
  settleSettlement,
  settlementDetail,
  sharedSummary,
  unsettleSettlement,
} from "@/lib/domain/shared";
import { HttpError } from "@/lib/api";

const tx = (p: Partial<Transaction>): Transaction => ({
  id: "t", created_at: "2026-01-01T00:00:00.000Z", updated_at: "", date: "2026-09-10",
  effective_date: null, type: "expense", status: "posted", amount: 100, currency: "ARS",
  account_id: "a", to_account_id: null, category_id: null, note: "", card_statement_id: null,
  installments_total: null, installment_number: null, installment_group_id: null,
  is_shared: true, paid_by: "me", my_share_pct: null, settlement_id: null, ...p,
});

/** Crea un gasto compartido en la db. */
async function addShared(db: Db, p: Partial<Transaction> & { amount: number; date: string }) {
  return db.transactions.create({ ...tx(p), id: undefined, created_at: undefined, updated_at: undefined });
}

async function freshDb(): Promise<{ db: Db; myAccount: string; partnerAccount: string }> {
  const db = createMemoryDb();
  await db.driver.ensureSchema();
  await seedDefaults(db);
  const accounts = await db.accounts.list();
  return {
    db,
    myAccount: accounts.find((a) => a.type === "cash")!.id,
    partnerAccount: accounts.find((a) => a.type === "partner")!.id,
  };
}

async function expectHttpError(fn: () => Promise<unknown>, status: number) {
  await expect(fn()).rejects.toMatchObject({ status });
  await expect(fn()).rejects.toBeInstanceOf(HttpError);
}

// ---------------------------------------------------------------- computeShared
describe("computeShared", () => {
  it("50/50 con dos gastos que pagué yo", () => {
    const { items, totals } = computeShared([tx({ amount: 1000 }), tx({ amount: 500 })], 50);
    expect(items.map((i) => i.my_share)).toEqual([500, 250]);
    expect(items.map((i) => i.partner_share)).toEqual([500, 250]);
    expect(totals).toEqual({
      total_shared: 1500, paid_by_me: 1500, paid_by_partner: 0,
      my_share: 750, partner_share: 750, balance: 750,
    });
  });

  it("respeta el % propio de cada transacción (70/30)", () => {
    const { items, totals } = computeShared(
      [tx({ amount: 1000, my_share_pct: 70 }), tx({ amount: 1000 })],
      30,
    );
    expect(items[0].my_share).toBe(700);
    expect(items[0].partner_share).toBe(300);
    expect(items[1].my_share).toBe(300); // usa el default
    expect(totals.my_share).toBe(1000);
    expect(totals.partner_share).toBe(1000);
    expect(totals.total_shared).toBe(2000);
  });

  it("mezcla me/partner: balance positivo cuando puse más de lo que me toca", () => {
    const { totals } = computeShared(
      [tx({ amount: 1000, paid_by: "me" }), tx({ amount: 200, paid_by: "partner" })],
      50,
    );
    expect(totals.paid_by_me).toBe(1000);
    expect(totals.paid_by_partner).toBe(200);
    expect(totals.my_share).toBe(600);
    expect(totals.balance).toBe(400); // la pareja me debe 400
  });

  it("balance negativo cuando pagó más la pareja", () => {
    const { totals } = computeShared(
      [tx({ amount: 100, paid_by: "me" }), tx({ amount: 900, paid_by: "partner" })],
      50,
    );
    expect(totals.balance).toBe(-400); // le debo 400
  });

  it("redondeo de centavos: my_share + partner_share === total_shared", () => {
    const amounts = [10.01, 0.01, 33.33, 99.99, 0.03];
    const { items, totals } = computeShared(amounts.map((amount) => tx({ amount })), 50);
    for (const i of items) {
      expect(i.my_share + i.partner_share).toBeCloseTo(i.tx.amount, 10);
    }
    expect(items[0].my_share).toBe(5.01); // 5.005 -> 5.01
    expect(items[0].partner_share).toBe(5);
    expect(totals.my_share + totals.partner_share).toBeCloseTo(totals.total_shared, 10);
    expect(totals.total_shared).toBe(143.37);
  });

  it("ajusta el centavo sobrante en la última transacción", () => {
    // 3 gastos de 0.01 al 50%: cada my_share redondea a 0.01 (0.005 -> 0.01)
    const { items, totals } = computeShared([0.01, 0.01, 0.01].map((amount) => tx({ amount })), 50);
    expect(totals.total_shared).toBe(0.03);
    expect(totals.my_share).toBe(0.03);
    expect(totals.partner_share).toBe(0);
    expect(items[items.length - 1].partner_share).toBe(0);
  });

  it("ignora las transacciones que no son gastos compartidos", () => {
    const { items } = computeShared(
      [tx({ amount: 100 }), tx({ amount: 50, is_shared: false }), tx({ amount: 20, type: "income" })],
      50,
    );
    expect(items.length).toBe(1);
  });

  it("sin transacciones devuelve totales en cero", () => {
    expect(computeShared([], 50).totals.balance).toBe(0);
  });
});

// ---------------------------------------------------------------- flujo completo
describe("flujo de período abierto + cierre + liquidación", () => {
  it("openPeriod sin cierres previos arranca en el primer gasto compartido", async () => {
    const { db, partnerAccount, myAccount } = await freshDb();
    await addShared(db, { date: "2026-08-05", amount: 1000, paid_by: "me", account_id: myAccount });
    await addShared(db, { date: "2026-08-20", amount: 500, paid_by: "partner", account_id: partnerAccount });
    await addShared(db, { date: "2026-09-10", amount: 300, paid_by: "me", account_id: myAccount, status: "pending_card", effective_date: null });

    const p = await openPeriod(db, "2026-09-18");
    expect(p.period_start).toBe("2026-08-05");
    expect(p.period_end).toBe("2026-09-18");
    expect(p.last_settlement).toBeNull();
    expect(p.transactions.length).toBe(3); // el pending_card cuenta igual
    expect(p.totals.total_shared).toBe(1800);
    expect(p.totals.paid_by_me).toBe(1300);
    expect(p.totals.paid_by_partner).toBe(500);
    expect(p.totals.my_share).toBe(900);
    expect(p.totals.balance).toBe(400);
    expect(p.late_count).toBe(0);
  });

  it("cierra, arranca el período siguiente al día siguiente y no repite gastos", async () => {
    const { db, partnerAccount, myAccount } = await freshDb();
    await addShared(db, { date: "2026-08-05", amount: 1000, paid_by: "me", account_id: myAccount });
    await addShared(db, { date: "2026-08-20", amount: 500, paid_by: "partner", account_id: partnerAccount });
    await addShared(db, { date: "2026-09-10", amount: 300, paid_by: "me", account_id: myAccount, status: "pending_card" });

    const s = await closePeriod(db, { period_end: "2026-09-18", note: "Cierre de prueba" });
    expect(s.period_start).toBe("2026-08-05");
    expect(s.period_end).toBe("2026-09-18");
    expect(s.balance).toBe(400);
    expect(s.settled).toBe(false);
    expect(s.default_my_share_pct).toBe(50);

    const txs = await db.transactions.list();
    expect(txs.every((t) => t.settlement_id === s.id)).toBe(true);

    const p2 = await openPeriod(db, "2026-09-30");
    expect(p2.period_start).toBe("2026-09-19");
    expect(p2.transactions.length).toBe(0);
    expect(p2.last_settlement?.id).toBe(s.id);

    const list = await listSettlements(db);
    expect(list.length).toBe(1);
    expect(list[0].transaction_count).toBe(3);

    const detail = await settlementDetail(db, s.id);
    expect(detail.transactions.length).toBe(3);
    expect(detail.totals.balance).toBe(400);
  });

  it("cuenta como 'tardíos' los gastos con fecha anterior al período", async () => {
    const { db, myAccount } = await freshDb();
    await addShared(db, { date: "2026-08-10", amount: 100, account_id: myAccount });
    await closePeriod(db, { period_end: "2026-08-31", note: "" });
    // Gasto cargado tarde, con fecha dentro del período ya cerrado
    await addShared(db, { date: "2026-08-25", amount: 60, account_id: myAccount });
    await addShared(db, { date: "2026-09-12", amount: 40, account_id: myAccount });

    const p = await openPeriod(db, "2026-09-18");
    expect(p.period_start).toBe("2026-09-01");
    expect(p.transactions.length).toBe(2);
    expect(p.late_count).toBe(1);
    expect(p.totals.total_shared).toBe(100);
  });

  it("settle con balance positivo crea un income y unsettle lo borra", async () => {
    const { db, myAccount } = await freshDb();
    await addShared(db, { date: "2026-09-01", amount: 1000, paid_by: "me", account_id: myAccount });
    const s = await closePeriod(db, { period_end: "2026-09-18", note: "" });
    expect(s.balance).toBe(500);

    const { settlement, transaction } = await settleSettlement(db, s.id, {
      date: "2026-09-19", account_id: myAccount, transfer_only: false,
    });
    expect(settlement.settled).toBe(true);
    expect(transaction!.type).toBe("income");
    expect(transaction!.amount).toBe(500);
    expect(transaction!.status).toBe("posted");
    expect(transaction!.effective_date).toBe("2026-09-19");
    expect(transaction!.account_id).toBe(myAccount);
    expect(transaction!.category_id).toBeNull();
    expect(transaction!.is_shared).toBe(false);
    expect(transaction!.note).toContain("Liquidación pareja");
    expect(settlement.settlement_transaction_id).toBe(transaction!.id);

    // no se puede saldar dos veces
    await expectHttpError(
      () => settleSettlement(db, s.id, { date: "2026-09-19", account_id: myAccount, transfer_only: false }),
      409,
    );
    // ni reabrir mientras esté saldada
    await expectHttpError(() => reopenSettlement(db, s.id), 409);

    const after = await unsettleSettlement(db, s.id);
    expect(after.settled).toBe(false);
    expect(after.settlement_transaction_id).toBeNull();
    expect(await db.transactions.get(transaction!.id)).toBeNull();
  });

  it("settle con balance negativo crea un expense", async () => {
    const { db, myAccount, partnerAccount } = await freshDb();
    await addShared(db, { date: "2026-09-01", amount: 1000, paid_by: "partner", account_id: partnerAccount });
    const s = await closePeriod(db, { period_end: "2026-09-18", note: "" });
    expect(s.balance).toBe(-500);

    const { transaction } = await settleSettlement(db, s.id, {
      date: "2026-09-20", account_id: myAccount, transfer_only: false,
    });
    expect(transaction!.type).toBe("expense");
    expect(transaction!.amount).toBe(500);
    expect(transaction!.account_id).toBe(myAccount);
    expect(transaction!.settlement_id).toBeNull();
  });

  it("transfer_only marca saldado sin registrar movimiento", async () => {
    const { db, myAccount } = await freshDb();
    await addShared(db, { date: "2026-09-01", amount: 1000, paid_by: "me", account_id: myAccount });
    const s = await closePeriod(db, { period_end: "2026-09-18", note: "" });
    const before = (await db.transactions.list()).length;

    const { settlement, transaction } = await settleSettlement(db, s.id, {
      date: "2026-09-19", account_id: null, transfer_only: true,
    });
    expect(settlement.settled).toBe(true);
    expect(transaction).toBeNull();
    expect((await db.transactions.list()).length).toBe(before);
  });

  it("balance 0 se salda sin cuenta ni movimiento", async () => {
    const { db, myAccount, partnerAccount } = await freshDb();
    await addShared(db, { date: "2026-09-01", amount: 500, paid_by: "me", account_id: myAccount });
    await addShared(db, { date: "2026-09-02", amount: 500, paid_by: "partner", account_id: partnerAccount });
    const s = await closePeriod(db, { period_end: "2026-09-18", note: "" });
    expect(s.balance).toBe(0);

    const { settlement, transaction } = await settleSettlement(db, s.id, {
      date: "2026-09-19", account_id: null, transfer_only: false,
    });
    expect(settlement.settled).toBe(true);
    expect(transaction).toBeNull();
  });

  it("settle sin cuenta y con movimiento pedido falla (400)", async () => {
    const { db, myAccount, partnerAccount } = await freshDb();
    await addShared(db, { date: "2026-09-01", amount: 500, paid_by: "me", account_id: myAccount });
    const s = await closePeriod(db, { period_end: "2026-09-18", note: "" });
    await expectHttpError(
      () => settleSettlement(db, s.id, { date: "2026-09-19", account_id: null, transfer_only: false }),
      400,
    );
    await expectHttpError(
      () => settleSettlement(db, s.id, { date: "2026-09-19", account_id: partnerAccount, transfer_only: false }),
      400,
    );
  });

  it("reopen devuelve las transacciones al período abierto", async () => {
    const { db, myAccount } = await freshDb();
    await addShared(db, { date: "2026-09-01", amount: 1000, paid_by: "me", account_id: myAccount });
    await addShared(db, { date: "2026-09-05", amount: 200, paid_by: "me", account_id: myAccount });
    const s = await closePeriod(db, { period_end: "2026-09-18", note: "" });

    const res = await reopenSettlement(db, s.id);
    expect(res.reopened).toBe(2);
    expect(await db.settlements.get(s.id)).toBeNull();
    expect((await db.transactions.list()).every((t) => t.settlement_id === null)).toBe(true);

    const p = await openPeriod(db, "2026-09-18");
    expect(p.period_start).toBe("2026-09-01");
    expect(p.transactions.length).toBe(2);
    expect(p.last_settlement).toBeNull();
  });

  it("cerrar sin gastos compartidos falla (409)", async () => {
    const { db } = await freshDb();
    await expectHttpError(() => closePeriod(db, { period_end: "2026-09-18", note: "" }), 409);
  });

  it("cerrar con period_end anterior al inicio del período falla (400)", async () => {
    const { db, myAccount } = await freshDb();
    await addShared(db, { date: "2026-08-10", amount: 100, account_id: myAccount });
    await closePeriod(db, { period_end: "2026-08-31", note: "" }); // period_start siguiente: 2026-09-01
    await addShared(db, { date: "2026-08-25", amount: 50, account_id: myAccount });
    await expectHttpError(() => closePeriod(db, { period_end: "2026-08-20", note: "" }), 400);
  });

  it("settlement inexistente da 404", async () => {
    const { db } = await freshDb();
    await expectHttpError(() => settlementDetail(db, "no-existe"), 404);
    await expectHttpError(() => unsettleSettlement(db, "no-existe"), 404);
    await expectHttpError(() => reopenSettlement(db, "no-existe"), 404);
  });

  it("sharedSummary trae settings y cuentas elegibles", async () => {
    const { db, myAccount } = await freshDb();
    await db.settings.set({ partner_name: "Ana", default_my_share_pct: 60 });
    await addShared(db, { date: "2026-09-01", amount: 1000, paid_by: "me", account_id: myAccount });

    const s = await sharedSummary(db, "2026-09-18");
    expect(s.partner_name).toBe("Ana");
    expect(s.default_my_share_pct).toBe(60);
    expect(s.totals.my_share).toBe(600);
    expect(s.totals.balance).toBe(400);
    expect(s.accounts.some((a) => a.id === myAccount)).toBe(true);
    expect(s.accounts.some((a) => a.type === "partner")).toBe(false);
    expect(s.categories.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- route handlers
describe("route handlers", () => {
  let db: Db;
  let myAccount: string;

  beforeEach(async () => {
    globalThis.__gastosDb = undefined;
    db = getDb();
    await db.driver.ensureSchema();
    await seedDefaults(db);
    myAccount = (await db.accounts.list()).find((a) => a.type === "cash")!.id;
  });

  const noParams = { params: Promise.resolve({} as Record<string, string>) };
  const withId = (id: string) => ({ params: Promise.resolve({ id }) });

  it("GET /api/shared/summary y POST /api/settlements", async () => {
    await addShared(db, { date: "2026-09-01", amount: 800, paid_by: "me", account_id: myAccount });

    const { GET: getSummary } = await import("@/app/api/shared/summary/route");
    const summaryRes = await getSummary(
      new Request("http://x/api/shared/summary?until=2026-09-18"),
      noParams,
    );
    expect(summaryRes.status).toBe(200);
    const summary = await summaryRes.json();
    expect(summary.period_start).toBe("2026-09-01");
    expect(summary.totals.balance).toBe(400);

    const { GET: listRoute, POST: closeRoute } = await import("@/app/api/settlements/route");
    const closed = await closeRoute(
      new Request("http://x/api/settlements", {
        method: "POST",
        body: JSON.stringify({ period_end: "2026-09-18", note: "Septiembre" }),
      }),
      noParams,
    );
    expect(closed.status).toBe(200);
    const settlement = await closed.json();
    expect(settlement.balance).toBe(400);

    const listed = await (await listRoute(new Request("http://x/api/settlements"), noParams)).json();
    expect(listed.length).toBe(1);
    expect(listed[0].transaction_count).toBe(1);

    // saldar
    const { POST: settleRoute } = await import("@/app/api/settlements/[id]/settle/route");
    const settled = await settleRoute(
      new Request("http://x/settle", {
        method: "POST",
        body: JSON.stringify({ date: "2026-09-19", account_id: myAccount }),
      }),
      withId(settlement.id),
    );
    expect(settled.status).toBe(200);
    expect((await settled.json()).transaction.type).toBe("income");

    // reabrir estando saldada -> 409
    const { DELETE: reopenRoute, GET: detailRoute } = await import("@/app/api/settlements/[id]/route");
    const failed = await reopenRoute(new Request("http://x", { method: "DELETE" }), withId(settlement.id));
    expect(failed.status).toBe(409);

    // des-saldar y reabrir
    const { POST: unsettleRoute } = await import("@/app/api/settlements/[id]/unsettle/route");
    expect((await unsettleRoute(new Request("http://x", { method: "POST" }), withId(settlement.id))).status).toBe(200);
    const detail = await (await detailRoute(new Request("http://x"), withId(settlement.id))).json();
    expect(detail.settlement.settled).toBe(false);
    expect(detail.transactions.length).toBe(1);

    const reopened = await reopenRoute(new Request("http://x", { method: "DELETE" }), withId(settlement.id));
    expect(reopened.status).toBe(200);
    expect((await db.settlements.list()).length).toBe(0);
  });

  it("POST /api/settlements sin gastos devuelve 409 y con body inválido 400", async () => {
    const { POST } = await import("@/app/api/settlements/route");
    const empty = await POST(
      new Request("http://x/api/settlements", { method: "POST", body: JSON.stringify({ period_end: "2026-09-18" }) }),
      noParams,
    );
    expect(empty.status).toBe(409);

    const bad = await POST(
      new Request("http://x/api/settlements", { method: "POST", body: JSON.stringify({ period_end: "18/09/2026" }) }),
      noParams,
    );
    expect(bad.status).toBe(400);
  });
});
