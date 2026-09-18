import { handler, HttpError, paramId, parseBody, query } from "@/lib/api";
import { getDb } from "@/lib/db";
import { TransactionInput } from "@/lib/types";
import { deleteTransaction, updateTransaction } from "@/lib/domain/transactions";

export const dynamic = "force-dynamic";

export const GET = handler(async (_req, ctx) => {
  const id = await paramId(ctx);
  const tx = await getDb().transactions.get(id);
  if (!tx) throw new HttpError(404, "Transacción no encontrada");
  return tx;
});

export const PUT = handler(async (req, ctx) => {
  const id = await paramId(ctx);
  const patch = await parseBody(req, TransactionInput.partial());
  return updateTransaction(getDb(), id, patch);
});

/** `?group=1` borra todas las cuotas de la compra. */
export const DELETE = handler(async (req, ctx) => {
  const id = await paramId(ctx);
  const group = query(req).get("group") === "1";
  return deleteTransaction(getDb(), id, { group });
});
