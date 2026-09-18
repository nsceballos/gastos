import { handler, paramId } from "@/lib/api";
import { getDb } from "@/lib/db";
import { reopenSettlement, settlementDetail } from "@/lib/domain/shared";

export const dynamic = "force-dynamic";

/** GET /api/settlements/[id] -> detalle con sus transacciones. */
export const GET = handler(async (_req, ctx) => settlementDetail(getDb(), await paramId(ctx)));

/** DELETE /api/settlements/[id] -> reabre el período (solo si no está saldada). */
export const DELETE = handler(async (_req, ctx) => reopenSettlement(getDb(), await paramId(ctx)));
