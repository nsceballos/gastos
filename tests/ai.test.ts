import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "@/lib/db";
import { HttpError } from "@/lib/api";
import type { AccountInputType, CategoryInputType } from "@/lib/types";

describe("buildFinancialContext", () => {
  async function seed() {
    const db = createMemoryDb();
    const cash = await db.accounts.create({
      name: "Efectivo", type: "cash", currency: "ARS", initial_balance: 0, closing_day: null,
      due_day: null, credit_limit: null, color: "", icon: "", archived: false, sort_order: 0,
    } satisfies AccountInputType as never);
    const bank = await db.accounts.create({
      name: "Banco", type: "bank", currency: "ARS", initial_balance: 0, closing_day: null,
      due_day: null, credit_limit: null, color: "", icon: "", archived: false, sort_order: 1,
    } satisfies AccountInputType as never);
    const visa = await db.accounts.create({
      name: "Visa", type: "credit_card", currency: "ARS", initial_balance: 0, closing_day: 25,
      due_day: 10, credit_limit: null, color: "", icon: "", archived: false, sort_order: 2,
    } satisfies AccountInputType as never);
    const comida = await db.categories.create({
      name: "Comida", type: "expense", icon: "", color: "", parent_id: null, archived: false, sort_order: 0,
    } satisfies CategoryInputType as never);

    // Ingreso del mes.
    await db.transactions.create({
      date: "2026-09-05", effective_date: "2026-09-05", type: "income", status: "posted", amount: 500000,
      currency: "ARS", account_id: bank.id, to_account_id: null, category_id: null, note: "Sueldo",
      card_statement_id: null, installments_total: null, installment_number: null, installment_group_id: null,
      is_shared: false, paid_by: "me", my_share_pct: null, settlement_id: null,
    } as never);
    // Gasto efectivo (posted) en efectivo.
    await db.transactions.create({
      date: "2026-09-06", effective_date: "2026-09-06", type: "expense", status: "posted", amount: 50000,
      currency: "ARS", account_id: cash.id, to_account_id: null, category_id: comida.id, note: "Super",
      card_statement_id: null, installments_total: null, installment_number: null, installment_group_id: null,
      is_shared: false, paid_by: "me", my_share_pct: null, settlement_id: null,
    } as never);
    // Consumo de tarjeta pendiente (comprometido, no efectivo).
    await db.transactions.create({
      date: "2026-09-10", effective_date: null, type: "expense", status: "pending_card", amount: 30000,
      currency: "ARS", account_id: visa.id, to_account_id: null, category_id: comida.id, note: "Restaurante",
      card_statement_id: null, installments_total: null, installment_number: null, installment_group_id: null,
      is_shared: false, paid_by: "me", my_share_pct: null, settlement_id: null,
    } as never);
    // Pago del resumen de tarjeta: NO debe contarse como gasto.
    await db.transactions.create({
      date: "2026-09-15", effective_date: "2026-09-15", type: "card_payment", status: "posted", amount: 20000,
      currency: "ARS", account_id: bank.id, to_account_id: visa.id, category_id: null, note: "Pago resumen",
      card_statement_id: null, installments_total: null, installment_number: null, installment_group_id: null,
      is_shared: false, paid_by: "me", my_share_pct: null, settlement_id: null,
    } as never);
    await db.budgets.create({
      month: "2026-09", category_id: comida.id, amount: 100000, alert_threshold_pct: 80, recurring: true,
    } as never);

    return { db, comida };
  }

  it("calcula totales correctos y excluye card_payment del gasto", async () => {
    const { db } = await seed();
    const { buildFinancialContext } = await import("@/lib/ai/context");
    const ctx = await buildFinancialContext(db, { month: "2026-09" });
    const cur = ctx.data.months.find((m) => m.month === "2026-09")!;
    expect(cur.income).toBe(500000);
    expect(cur.effective_expense).toBe(50000); // solo el gasto posted
    expect(cur.committed_expense).toBe(80000); // 50000 + 30000 pending_card (NO incluye card_payment)
    expect(cur.balance).toBe(450000);
  });

  it("separa la deuda pendiente de tarjeta", async () => {
    const { db } = await seed();
    const { buildFinancialContext } = await import("@/lib/ai/context");
    const ctx = await buildFinancialContext(db, { month: "2026-09" });
    const visaDebt = ctx.data.card_debt.find((c) => c.name === "Visa");
    expect(visaDebt?.pending_amount).toBe(30000);
  });

  it("lista los presupuestos del mes con lo gastado", async () => {
    const { db } = await seed();
    const { buildFinancialContext } = await import("@/lib/ai/context");
    const ctx = await buildFinancialContext(db, { month: "2026-09" });
    const b = ctx.data.budgets.find((x) => x.category_name === "Comida");
    expect(b).toBeTruthy();
    expect(b?.amount).toBe(100000);
    expect(b?.spent).toBe(80000);
    expect(b?.pct).toBe(80);
  });

  it("incluye la categoría en el top de categorías del mes", async () => {
    const { db } = await seed();
    const { buildFinancialContext } = await import("@/lib/ai/context");
    const ctx = await buildFinancialContext(db, { month: "2026-09" });
    const cat = ctx.data.top_categories.find((c) => c.name === "Comida");
    expect(cat?.amount).toBe(80000);
    expect(ctx.text).toContain("Comida");
  });
});

describe("sseToTextStream", () => {
  it("extrae los deltas de contenido ignorando comentarios y [DONE], incluso con cortes a mitad de línea", async () => {
    const { sseToTextStream } = await import("@/lib/ai/openrouter");
    const encoder = new TextEncoder();
    const chunk1 = 'data: {"choices":[{"delta":{"content":"Hola"}}]}\n\ndata: {"choices":[{"delta":{"content":" mun';
    const chunk2 = 'do","reasoning":"pensando"}}]}\n\n: OPENROUTER PROCESSING\n\ndata: {"choices":[{"delta":{"content":"!"}}]}\n\ndata: [DONE]\n\n';

    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(chunk1));
        controller.enqueue(encoder.encode(chunk2));
        controller.close();
      },
    });

    const reader = sseToTextStream(source).getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    expect(text).toBe("Hola mundo!");
  });
});

describe("chatCompletion — fallback de modelos", () => {
  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubEnv("OPENROUTER_FALLBACK_MODELS", "model-b");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("usa el segundo modelo si el primero devuelve 429", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => "rate limited" })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "respuesta ok" } }] }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { chatCompletion } = await import("@/lib/ai/openrouter");
    const res = await chatCompletion({ messages: [{ role: "user", content: "hola" }], model: "model-a" });
    expect(res.content).toBe("respuesta ok");
    expect(res.model).toBe("model-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("lanza HttpError 502 si todos los modelos fallan", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => "boom" });
    vi.stubGlobal("fetch", fetchMock);

    const { chatCompletion } = await import("@/lib/ai/openrouter");
    let error: unknown;
    try {
      await chatCompletion({ messages: [{ role: "user", content: "hola" }], model: "model-a" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).status).toBe(502);
  });
});

describe("suggestBudget", () => {
  async function seedWithHistory() {
    const db = createMemoryDb();
    const cash = await db.accounts.create({
      name: "Efectivo", type: "cash", currency: "ARS", initial_balance: 0, closing_day: null,
      due_day: null, credit_limit: null, color: "", icon: "", archived: false, sort_order: 0,
    } as never);
    const comida = await db.categories.create({
      name: "Comida", type: "expense", icon: "", color: "", parent_id: null, archived: false, sort_order: 0,
    } as never);
    const months = ["2026-06", "2026-07", "2026-08"];
    const amounts = [50000, 40000, 30000]; // promedio = 40000
    for (let i = 0; i < months.length; i++) {
      await db.transactions.create({
        date: `${months[i]}-10`, effective_date: `${months[i]}-10`, type: "expense", status: "posted",
        amount: amounts[i], currency: "ARS", account_id: cash.id, to_account_id: null, category_id: comida.id,
        note: "", card_statement_id: null, installments_total: null, installment_number: null,
        installment_group_id: null, is_shared: false, paid_by: "me", my_share_pct: null, settlement_id: null,
      } as never);
    }
    return { db, comida };
  }

  beforeEach(() => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("devuelve source 'ai' cuando el modelo responde JSON válido", async () => {
    const { db, comida } = await seedWithHistory();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                total: 36000,
                items: [{ category_id: comida.id, category_name: "Comida", amount: 36000, reason: "test" }],
                summary: "ok",
              }),
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { suggestBudget } = await import("@/lib/ai/budget-suggest");
    const res = await suggestBudget(db, "2026-09");
    expect(res.source).toBe("ai");
    expect(res.items[0].amount).toBe(36000);
  });

  it("cae a la heurística si el JSON es inválido dos veces", async () => {
    const { db } = await seedWithHistory();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "esto no es JSON" } }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { suggestBudget } = await import("@/lib/ai/budget-suggest");
    const res = await suggestBudget(db, "2026-09");
    expect(res.source).toBe("heuristic");
    expect(fetchMock).toHaveBeenCalledTimes(2); // 1 intento + 1 reintento
    const comidaItem = res.items.find((i) => i.category_name === "Comida");
    // promedio 40000 * 0.9 = 36000, redondeado a centenas = 36000
    expect(comidaItem?.amount).toBe(36000);
  });
});
