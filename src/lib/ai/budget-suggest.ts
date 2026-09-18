/**
 * Sugerencia de presupuesto mensual: le pide al modelo un JSON estricto con
 * montos por categoría basados en el promedio de los últimos 3 meses. Si el
 * modelo no está disponible o no devuelve JSON válido (tras un reintento),
 * cae a una heurística local: promedio de 3 meses × 0.9, redondeado a
 * centenas.
 */
import { z } from "zod";
import type { Db } from "@/lib/db";
import { expensesForBudget, monthRange, round2, sum } from "@/lib/domain/core";
import { chatCompletion } from "./openrouter";
import { shiftMonthKey } from "./context";
import { buildBudgetSuggestMessages, buildBudgetSuggestRetryMessages, type CategoryAverage } from "./prompts";

const SuggestItemSchema = z.object({
  category_id: z.string().nullable(),
  category_name: z.string(),
  amount: z.coerce.number().finite().nonnegative(),
  reason: z.string().default(""),
});

const SuggestSchema = z.object({
  total: z.coerce.number().finite().nonnegative(),
  items: z.array(SuggestItemSchema),
  summary: z.string().default(""),
});

export interface BudgetSuggestionItem {
  category_id: string | null;
  category_name: string;
  amount: number;
  reason: string;
}

export interface BudgetSuggestion {
  source: "ai" | "heuristic";
  month: string;
  total: number;
  items: BudgetSuggestionItem[];
  summary: string;
}

/** Extrae el primer bloque `{...}` balanceado de un texto (robustez ante texto extra alrededor del JSON). */
export function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function tryParseJson(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return extractJsonObject(text);
  }
}

async function computeCategoryAverages(db: Db, month: string): Promise<CategoryAverage[]> {
  const [categories, transactions, settings] = await Promise.all([
    db.categories.list(),
    db.transactions.list(),
    db.settings.get(),
  ]);
  const expenseCats = categories.filter((c) => c.type === "expense" && !c.archived);
  const pastMonths = [1, 2, 3].map((n) => shiftMonthKey(month, -n));
  const perCategoryTotals = new Map<string, number[]>();

  for (const m of pastMonths) {
    const { start, end } = monthRange(m, settings.month_start_day);
    const exps = expensesForBudget(transactions, start, end, settings);
    const byCat = new Map<string, number>();
    for (const e of exps) {
      if (!e.category_id) continue;
      byCat.set(e.category_id, round2((byCat.get(e.category_id) ?? 0) + e.amount));
    }
    for (const c of expenseCats) {
      const arr = perCategoryTotals.get(c.id) ?? [];
      arr.push(byCat.get(c.id) ?? 0);
      perCategoryTotals.set(c.id, arr);
    }
  }

  return expenseCats.map((c) => {
    const arr = perCategoryTotals.get(c.id) ?? [0, 0, 0];
    return { id: c.id, name: c.name, avg3: round2(sum(arr) / arr.length) };
  });
}

function heuristicSuggestion(month: string, categories: CategoryAverage[]): BudgetSuggestion {
  const items: BudgetSuggestionItem[] = categories
    .filter((c) => c.avg3 > 0)
    .map((c) => ({
      category_id: c.id,
      category_name: c.name,
      amount: Math.round((c.avg3 * 0.9) / 100) * 100,
      reason: "Promedio de gasto de los últimos 3 meses con un recorte del 10%, redondeado a centenas.",
    }))
    .sort((a, b) => b.amount - a.amount);
  const total = round2(sum(items.map((i) => i.amount)));
  return {
    source: "heuristic",
    month,
    total,
    items,
    summary:
      "No se pudo usar la IA en este momento: esta es una estimación local calculada como el 90% del promedio de " +
      "gasto de los últimos 3 meses por categoría.",
  };
}

export async function suggestBudget(db: Db, month: string): Promise<BudgetSuggestion> {
  const settings = await db.settings.get();
  const allCategories = await computeCategoryAverages(db, month);
  const withHistory = allCategories.filter((c) => c.avg3 > 0);
  const categoriesForPrompt = withHistory.length ? withHistory : allCategories;

  if (categoriesForPrompt.length === 0) {
    return { source: "heuristic", month, total: 0, items: [], summary: "No hay categorías de gasto con historial suficiente." };
  }

  try {
    const messages = buildBudgetSuggestMessages({ month, categories: categoriesForPrompt, currency: settings.currency });
    const res = await chatCompletion({
      messages,
      model: settings.ai_model,
      response_format: { type: "json_object" },
      temperature: 0.3,
    });
    let parsed = SuggestSchema.safeParse(tryParseJson(res.content));

    if (!parsed.success) {
      const retryMessages = buildBudgetSuggestRetryMessages({
        month,
        categories: categoriesForPrompt,
        currency: settings.currency,
      });
      const res2 = await chatCompletion({
        messages: retryMessages,
        model: settings.ai_model,
        response_format: { type: "json_object" },
        temperature: 0.1,
      });
      parsed = SuggestSchema.safeParse(tryParseJson(res2.content));
    }

    if (parsed.success) {
      const items = parsed.data.items.map((i) => ({ ...i, amount: round2(i.amount) }));
      return { source: "ai", month, total: round2(parsed.data.total || sum(items.map((i) => i.amount))), items, summary: parsed.data.summary };
    }
  } catch {
    // Sigue a la heurística local (sin key configurada, modelos caídos, etc).
  }

  return heuristicSuggestion(month, allCategories);
}
