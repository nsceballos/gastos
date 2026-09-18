import { handler, query } from "@/lib/api";
import { getDb } from "@/lib/db";
import type { StatementStatus } from "@/lib/types";
import { closeDueStatements, statementTransactions } from "@/lib/domain/cards";
import { sortTransactions } from "@/lib/domain/transactions";

export const dynamic = "force-dynamic";

/**
 * GET /api/cards/statements?account_id=&status=
 * Cierra antes los resúmenes vencidos (idempotente) y devuelve cada resumen
 * con sus consumos, del más nuevo al más viejo.
 */
export const GET = handler(async (req) => {
  const q = query(req);
  const db = getDb();
  await closeDueStatements(db);

  const accountId = q.get("account_id");
  const status = q.get("status") as StatementStatus | null;
  const [statements, txs, accounts] = await Promise.all([
    db.card_statements.list(),
    db.transactions.list(),
    db.accounts.list(),
  ]);

  const filtered = statements
    .filter((s) => (!accountId || s.account_id === accountId) && (!status || s.status === status))
    .sort((a, b) => b.period_end.localeCompare(a.period_end));

  return {
    statements: filtered.map((s) => ({
      ...s,
      account_name: accounts.find((a) => a.id === s.account_id)?.name ?? "",
      transactions: sortTransactions(statementTransactions(txs, s.id)),
      payment: txs.find((t) => t.id === s.payment_transaction_id) ?? null,
    })),
  };
});
