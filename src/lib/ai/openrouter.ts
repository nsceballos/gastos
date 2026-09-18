/**
 * Cliente mínimo de OpenRouter (chat completions), sin SDK.
 *
 * Selección de modelo: `model` explícito (normalmente `settings.ai_model`) ->
 * `OPENROUTER_MODEL` -> `DEFAULT_MODEL`. Si la respuesta falla con un status
 * "reintentable" (404 / 429 / 5xx) o sin contenido, se reintenta en orden con
 * los modelos de `OPENROUTER_FALLBACK_MODELS` (coma-separado).
 */
import { HttpError } from "@/lib/errors";

export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ResponseFormat {
  type: "json_object" | "text";
}

export interface ChatCompletionOptions {
  messages: ChatMessage[];
  /** Modelo preferido (p.ej. `settings.ai_model`). Si es null/undefined/"" se usa el default. */
  model?: string | null;
  temperature?: number;
  response_format?: ResponseFormat;
}

export interface ChatCompletionResult {
  content: string;
  model: string;
}

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_MODEL = "deepseek/deepseek-v4-flash-0731:free";
const DEFAULT_FALLBACK_MODELS = "openrouter/free";

function resolveModelChain(preferred?: string | null): string[] {
  const primary = (preferred && preferred.trim()) || process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  const fallbacksRaw = process.env.OPENROUTER_FALLBACK_MODELS ?? DEFAULT_FALLBACK_MODELS;
  const fallbacks = fallbacksRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const chain = [primary, ...fallbacks];
  // Dedup preservando orden.
  return chain.filter((m, i) => m && chain.indexOf(m) === i);
}

function buildHeaders(): Record<string, string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new HttpError(503, "Falta OPENROUTER_API_KEY: configurá la variable de entorno para usar el asesor IA.");
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.APP_URL ?? "https://gastos.vercel.app",
    "X-Title": "Gastos",
  };
}

function isRetryableStatus(status: number): boolean {
  return status === 404 || status === 429 || status >= 500;
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return "";
  }
}

/** Chat completion no-streaming, con fallback automático de modelos. */
export async function chatCompletion(opts: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const chain = resolveModelChain(opts.model);
  const headers = buildHeaders();
  const failures: string[] = [];

  for (const model of chain) {
    let res: Response;
    try {
      res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: opts.messages,
          stream: false,
          temperature: opts.temperature ?? 0.4,
          ...(opts.response_format ? { response_format: opts.response_format } : {}),
        }),
      });
    } catch (err) {
      failures.push(`${model}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (!res.ok) {
      const text = await safeText(res);
      if (isRetryableStatus(res.status)) {
        failures.push(`${model}: HTTP ${res.status} ${text}`);
        continue;
      }
      throw new HttpError(502, `OpenRouter (${model}) devolvió un error: ${res.status} ${text}`);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      failures.push(`${model}: respuesta no-JSON`);
      continue;
    }
    const content = extractContent(json);
    if (typeof content !== "string" || !content.trim()) {
      failures.push(`${model}: respuesta vacía`);
      continue;
    }
    return { content, model };
  }

  throw new HttpError(
    502,
    `No se pudo obtener respuesta de OpenRouter (probamos ${chain.length} modelo(s)). ${failures.join(" | ")}`,
  );
}

function extractContent(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const choices = (json as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0]) return undefined;
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") return undefined;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" ? content : undefined;
}

/**
 * Chat completion en streaming. Devuelve un `ReadableStream<Uint8Array>` de
 * texto plano UTF-8 con solo los deltas de contenido (sin el "reasoning" ni
 * el resto del envoltorio SSE). El fallback entre modelos ocurre antes de
 * empezar a leer el body (si el primer chunk ya llegó con status ok).
 */
export async function chatCompletionStream(
  opts: ChatCompletionOptions,
): Promise<{ stream: ReadableStream<Uint8Array>; model: string }> {
  const chain = resolveModelChain(opts.model);
  const headers = buildHeaders();
  const failures: string[] = [];

  for (const model of chain) {
    let res: Response;
    try {
      res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          messages: opts.messages,
          stream: true,
          temperature: opts.temperature ?? 0.4,
        }),
      });
    } catch (err) {
      failures.push(`${model}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (!res.ok || !res.body) {
      const text = await safeText(res);
      if (isRetryableStatus(res.status)) {
        failures.push(`${model}: HTTP ${res.status} ${text}`);
        continue;
      }
      throw new HttpError(502, `OpenRouter (${model}) devolvió un error: ${res.status} ${text}`);
    }
    return { stream: sseToTextStream(res.body), model };
  }

  throw new HttpError(
    502,
    `No se pudo iniciar el stream de OpenRouter (probamos ${chain.length} modelo(s)). ${failures.join(" | ")}`,
  );
}

/**
 * Convierte un stream SSE de OpenRouter (`data: {...}` por línea, comentarios
 * `: ...` y terminador `data: [DONE]`) en un stream de texto plano con solo
 * los deltas de `choices[0].delta.content`. Exportado para poder testearlo
 * directamente con chunks arbitrarios (incluidos cortes a mitad de línea).
 */
export function sseToTextStream(source: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  /** Devuelve true si encoló contenido (para saber si `pull` ya puede devolver el control). */
  function processLine(line: string, controller: ReadableStreamDefaultController<Uint8Array>): boolean {
    const trimmed = line.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith(":")) return false; // comentario, p.ej. ": OPENROUTER PROCESSING"
    if (!trimmed.startsWith("data:")) return false;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") return false;
    let json: unknown;
    try {
      json = JSON.parse(data);
    } catch {
      return false; // línea parcial o mal formada: se ignora
    }
    const delta = extractDeltaContent(json);
    if (!delta) return false;
    controller.enqueue(encoder.encode(delta));
    return true;
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      // Un `pull()` debe encolar al menos un chunk (o cerrar) antes de devolver el control:
      // muchos chunks SSE de OpenRouter solo traen "reasoning" (sin `content`), y si no
      // seguimos leyendo acá, el stream se queda esperando para siempre (nadie más lo pide).
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim()) processLine(buffer, controller);
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        let enqueued = false;
        for (const line of lines) {
          if (processLine(line, controller)) enqueued = true;
        }
        if (enqueued) return;
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function extractDeltaContent(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const choices = (json as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0]) return undefined;
  const delta = (choices[0] as { delta?: unknown }).delta;
  if (!delta || typeof delta !== "object") return undefined;
  const content = (delta as { content?: unknown }).content;
  return typeof content === "string" && content.length > 0 ? content : undefined;
}
