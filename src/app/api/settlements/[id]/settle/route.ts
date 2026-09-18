import { handler, paramId, parseBody } from "@/lib/api";
import { getDb } from "@/lib/db";
import { SettleInput, settleSettlement } from "@/lib/domain/shared";

export const dynamic = "force-dynamic";

/** POST /api/settlements/[id]/settle { date, account_id?, transfer_only? } */
export const POST = handler(async (req, ctx) => {
  const id = await paramId(ctx);
  const input = await parseBody(req, SettleInput);
  return settleSettlement(getDb(), id, input);
});
