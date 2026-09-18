import { z } from "zod";
import { handler, paramId, parseBody } from "@/lib/api";
import { getDb } from "@/lib/db";
import { payStatement } from "@/lib/domain/cards";

export const dynamic = "force-dynamic";

const PayInput = z.object({
  from_account_id: z.string().min(1),
  amount: z.coerce.number().finite().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida (YYYY-MM-DD)"),
});

export const POST = handler(async (req, ctx) => {
  const id = await paramId(ctx);
  const input = await parseBody(req, PayInput);
  return payStatement(getDb(), id, input);
});
