import { handler, query } from "@/lib/api";
import { getDb } from "@/lib/db";
import { sharedSummary } from "@/lib/domain/shared";

export const dynamic = "force-dynamic";

/** GET /api/shared/summary?until=YYYY-MM-DD -> período abierto + datos para la UI. */
export const GET = handler(async (req) => {
  const until = query(req).get("until");
  return sharedSummary(getDb(), until);
});
