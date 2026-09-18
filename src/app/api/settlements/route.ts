import { handler, parseBody } from "@/lib/api";
import { getDb } from "@/lib/db";
import { ClosePeriodInput, closePeriod, listSettlements } from "@/lib/domain/shared";

export const dynamic = "force-dynamic";

/** GET /api/settlements -> cierres anteriores (period_end desc). */
export const GET = handler(async () => listSettlements(getDb()));

/** POST /api/settlements { period_end, note? } -> cierra el período abierto. */
export const POST = handler(async (req) => {
  const input = await parseBody(req, ClosePeriodInput);
  return closePeriod(getDb(), input);
});
