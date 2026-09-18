import { handler, HttpError, query } from "@/lib/api";
import { getDb } from "@/lib/db";
import { isCreditCard, todayISO } from "@/lib/domain/core";
import { statementPeriodFor } from "@/lib/domain/cards";

export const dynamic = "force-dynamic";

/**
 * GET /api/cards/preview?account_id=&date=&installments=
 * Devuelve a qué resumen (y vencimiento) cae una compra, sin escribir nada.
 */
export const GET = handler(async (req) => {
  const q = query(req);
  const accountId = q.get("account_id");
  if (!accountId) throw new HttpError(400, "Falta account_id");
  const date = q.get("date") ?? todayISO();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "Fecha inválida (YYYY-MM-DD)");

  const card = await getDb().accounts.get(accountId);
  if (!card) throw new HttpError(404, "Cuenta no encontrada");
  if (!isCreditCard(card)) return { is_card: false, period: null };

  return { is_card: true, period: statementPeriodFor(card, date) };
});
