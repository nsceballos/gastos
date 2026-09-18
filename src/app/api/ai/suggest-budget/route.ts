import { HttpError, handler, query } from "@/lib/api";
import { getDb } from "@/lib/db";
import { suggestBudget } from "@/lib/ai/budget-suggest";
import { monthKey, todayISO } from "@/lib/domain/core";

export const dynamic = "force-dynamic";

/** POST /api/ai/suggest-budget?month=YYYY-MM — sugerencia de presupuesto (IA o heurística). */
export const POST = handler(async (req) => {
  const month = query(req).get("month") ?? monthKey(todayISO());
  if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, "Mes inválido (YYYY-MM)");
  return suggestBudget(getDb(), month);
});
