import { handler, HttpError, parseBody, query } from "@/lib/api";
import { getDb } from "@/lib/db";
import { TransactionInput } from "@/lib/types";
import { monthRange, todayISO, monthKey } from "@/lib/domain/core";
import { createTransaction, listTransactions, monthSummary } from "@/lib/domain/transactions";
import type { TransactionStatus, TransactionType } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/transactions?month=YYYY-MM  (o ?from=&to=)
 * Filtros opcionales: account_id, category_id, status, type.
 * -> { transactions, summary, range }
 */
export const GET = handler(async (req) => {
  const q = query(req);
  const db = getDb();
  const settings = await db.settings.get();

  let from = q.get("from") ?? undefined;
  let to = q.get("to") ?? undefined;
  const month = q.get("month") ?? (from || to ? null : monthKey(todayISO()));
  if (month) {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new HttpError(400, "Mes inválido (YYYY-MM)");
    const r = monthRange(month, settings.month_start_day);
    from = r.start;
    to = r.end;
  }

  const transactions = await listTransactions(db, {
    from,
    to,
    account_id: q.get("account_id") ?? undefined,
    category_id: q.get("category_id") ?? undefined,
    status: (q.get("status") as TransactionStatus | null) ?? undefined,
    type: (q.get("type") as TransactionType | null) ?? undefined,
  });

  // El resumen se calcula sobre TODAS las transacciones del rango (por fecha de compra
  // y por effective_date), no sobre la lista ya filtrada por cuenta/categoría.
  const range = { start: from ?? "0000-01-01", end: to ?? "9999-12-31" };
  const summary = monthSummary(await db.transactions.list(), settings, range);

  return { transactions, summary, range };
});

export const POST = handler(async (req) => {
  const input = await parseBody(req, TransactionInput);
  const transactions = await createTransaction(getDb(), input);
  return { transactions };
});
