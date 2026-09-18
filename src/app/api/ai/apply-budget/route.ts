import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const ApplyBudgetInput = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "Mes inválido (YYYY-MM)"),
  items: z
    .array(
      z.object({
        category_id: z.string().nullable(),
        amount: z.coerce.number().finite().nonnegative(),
      }),
    )
    .min(1),
});

/**
 * POST /api/ai/apply-budget — crea/actualiza los presupuestos de un mes a partir
 * de una sugerencia (IA o heurística). Body: { month, items: [{category_id, amount}] }
 */
export const POST = handler(async (req) => {
  const { month, items } = await parseBody(req, ApplyBudgetInput);
  const db = getDb();
  const existing = await db.budgets.list();
  let created = 0;
  let updated = 0;
  for (const item of items) {
    const match = existing.find((b) => b.month === month && b.category_id === item.category_id);
    if (match) {
      await db.budgets.update(match.id, { amount: item.amount });
      updated++;
    } else {
      await db.budgets.create({
        month,
        category_id: item.category_id,
        amount: item.amount,
        alert_threshold_pct: 80,
        recurring: true,
      });
      created++;
    }
  }
  return { ok: true, created, updated };
});
