import { handler, paramId } from "@/lib/api";
import { getDb } from "@/lib/db";
import { unpayStatement } from "@/lib/domain/cards";

export const dynamic = "force-dynamic";

export const POST = handler(async (_req, ctx) => {
  const id = await paramId(ctx);
  return { statement: await unpayStatement(getDb(), id) };
});
