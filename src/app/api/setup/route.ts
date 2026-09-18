import { handler } from "@/lib/api";
import { getDb } from "@/lib/db";
import { seedDefaults } from "@/lib/seed";

export const dynamic = "force-dynamic";

/** POST /api/setup — crea pestañas + headers en la Sheet y datos por defecto. Idempotente. */
export const POST = handler(async () => {
  const db = getDb();
  await db.driver.ensureSchema();
  const seeded = await seedDefaults(db);
  return { ok: true, seeded };
});

export const GET = POST;
