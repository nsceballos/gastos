import { handler, paramId, parseBody } from "@/lib/api";
import { getDb } from "@/lib/db";
import { CategoryInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export const PUT = handler(async (req, ctx) => {
  const id = await paramId(ctx);
  const input = await parseBody(req, CategoryInput.partial());
  return getDb().categories.update(id, input);
});

export const DELETE = handler(async (_req, ctx) => {
  const id = await paramId(ctx);
  // Soft delete: si tiene transacciones, se archiva.
  const db = getDb();
  const used = (await db.transactions.list()).some((t) => t.category_id === id);
  if (used) return db.categories.update(id, { archived: true });
  await db.categories.remove(id);
  return { ok: true };
});
