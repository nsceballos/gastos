import { z } from "zod";
import { handler, parseBody } from "@/lib/api";
import { getDb } from "@/lib/db";
import { buildFinancialContext } from "@/lib/ai/context";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { chatCompletionStream } from "@/lib/ai/openrouter";
import { monthKey, todayISO } from "@/lib/domain/core";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ChatInput = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(30),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
});

/**
 * POST /api/ai/chat — stream de texto plano con la respuesta del asesor IA.
 * Body: { messages: [{role: "user"|"assistant", content}], month? }
 */
export const POST = handler(async (req) => {
  const { messages, month } = await parseBody(req, ChatInput);
  const db = getDb();
  const settings = await db.settings.get();
  const ctx = await buildFinancialContext(db, { month: month ?? monthKey(todayISO()) });
  const system = buildSystemPrompt(settings, ctx.text);

  const { stream } = await chatCompletionStream({
    messages: [{ role: "system", content: system }, ...messages],
    model: settings.ai_model,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Encoding": "none",
      "Cache-Control": "no-store",
    },
  });
});
