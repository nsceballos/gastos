import { handler } from "@/lib/api";
import { getDb } from "@/lib/db";
import { accountsWithBalances, netWorth } from "@/lib/domain/accounts";

export const dynamic = "force-dynamic";

/** Cuentas con saldo + patrimonio neto (sin la cuenta de la pareja). */
export const GET = handler(async () => {
  const accounts = await accountsWithBalances(getDb());
  return { accounts, net_worth: netWorth(accounts) };
});
