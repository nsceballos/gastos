import { handler, HttpError, paramId, parseBody } from "@/lib/api";
import { getDb } from "@/lib/db";
import { BudgetInput } from "@/lib/types";
import { hasDuplicateBudget } from "@/lib/domain/budgets";

export const dynamic = "force-dynamic";

export const PUT = handler(async (req, ctx) => {
  const id = await paramId(ctx);
  const input = await parseBody(req, BudgetInput.partial());
  const db = getDb();
  const current = await db.budgets.get(id);
  if (!current) throw new HttpError(404, "Presupuesto no encontrado");
  const month = input.month ?? current.month;
  const category_id = input.category_id !== undefined ? input.category_id : current.category_id;
  const others = (await db.budgets.list()).filter((b) => b.id !== id);
  if (hasDuplicateBudget(others, month, category_id)) {
    throw new HttpError(409, "Ya existe un presupuesto para ese mes y categoría");
  }
  return db.budgets.update(id, input);
});

export const DELETE = handler(async (_req, ctx) => {
  const id = await paramId(ctx);
  await getDb().budgets.remove(id);
  return { ok: true };
});
