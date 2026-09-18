import { handler, paramId } from "@/lib/api";
import { getDb } from "@/lib/db";
import { unsettleSettlement } from "@/lib/domain/shared";

export const dynamic = "force-dynamic";

/** POST /api/settlements/[id]/unsettle -> borra la transacción de liquidación y vuelve a pendiente. */
export const POST = handler(async (_req, ctx) => unsettleSettlement(getDb(), await paramId(ctx)));
