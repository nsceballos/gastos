import { handler, parseBody, query } from "@/lib/api";
import { getDb } from "@/lib/db";
import { AccountInput } from "@/lib/types";
import { accountsWithBalances } from "@/lib/domain/accounts";

export const dynamic = "force-dynamic";

/** Lista de cuentas con saldo (y datos de tarjeta). `?archived=1` incluye archivadas. */
export const GET = handler(async (req) => {
  const includeArchived = query(req).get("archived") === "1";
  return accountsWithBalances(getDb(), { includeArchived });
});

export const POST = handler(async (req) => {
  const input = await parseBody(req, AccountInput);
  return getDb().accounts.create(input);
});
