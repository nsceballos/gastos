import { handler } from "@/lib/api";
import { getDb } from "@/lib/db";
import { DEFAULT_MODEL } from "@/lib/ai/openrouter";

export const dynamic = "force-dynamic";

/** GET /api/ai/status — para mostrar avisos en el chat y en Ajustes. */
export const GET = handler(async () => {
  const settings = await getDb().settings.get();
  return {
    configured: Boolean(process.env.OPENROUTER_API_KEY),
    model: settings.ai_model || process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
    data_driver: process.env.DATA_DRIVER ?? (process.env.GOOGLE_SHEET_ID ? "sheets" : "file"),
  };
});
