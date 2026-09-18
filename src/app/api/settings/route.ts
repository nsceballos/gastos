import { handler, parseBody } from "@/lib/api";
import { getDb } from "@/lib/db";
import { SettingsInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = handler(async () => getDb().settings.get());

export const PUT = handler(async (req) => {
  const patch = await parseBody(req, SettingsInput);
  return getDb().settings.set(patch);
});
