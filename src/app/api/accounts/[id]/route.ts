import { handler, HttpError, paramId, parseBody } from "@/lib/api";
import { getDb } from "@/lib/db";
import { AccountInput } from "@/lib/types";
import { accountHasTransactions, accountsWithBalances } from "@/lib/domain/accounts";

export const dynamic = "force-dynamic";

export const GET = handler(async (_req, ctx) => {
  const id = await paramId(ctx);
  const acc = (await accountsWithBalances(getDb(), { includeArchived: true })).find((a) => a.id === id);
  if (!acc) throw new HttpError(404, "Cuenta no encontrada");
  return acc;
});

export const PUT = handler(async (req, ctx) => {
  const id = await paramId(ctx);
  const input = await parseBody(req, AccountInput.partial());
  const db = getDb();
  const current = await db.accounts.get(id);
  if (!current) throw new HttpError(404, "Cuenta no encontrada");
  if (current.type === "partner" && input.type && input.type !== "partner") {
    throw new HttpError(400, "La cuenta de la pareja no puede cambiar de tipo");
  }
  return db.accounts.update(id, input);
});

/** Si la cuenta tiene movimientos se archiva (para no romper el histórico). */
export const DELETE = handler(async (_req, ctx) => {
  const id = await paramId(ctx);
  const db = getDb();
  const current = await db.accounts.get(id);
  if (!current) throw new HttpError(404, "Cuenta no encontrada");
  if (current.type === "partner") throw new HttpError(400, "La cuenta de la pareja no se puede borrar");
  if (await accountHasTransactions(db, id)) {
    const archived = await db.accounts.update(id, { archived: true });
    return { archived: true, account: archived };
  }
  await db.accounts.remove(id);
  return { archived: false, ok: true };
});
