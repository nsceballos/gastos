import { handler, parseBody } from "@/lib/api";
import { getDb } from "@/lib/db";
import { CategoryInput } from "@/lib/types";

export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const cats = await getDb().categories.list();
  return cats.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
});

export const POST = handler(async (req) => {
  const input = await parseBody(req, CategoryInput);
  return getDb().categories.create(input);
});
