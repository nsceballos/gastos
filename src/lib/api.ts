import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";
import { cookies } from "next/headers";
import { authEnabled, SESSION_COOKIE, verifySessionToken } from "./auth";
import { NotFoundError } from "./db";

/**
 * Helpers para route handlers (src/app/api/**).
 *
 *   export const GET = handler(async () => ({ ok: true }));
 *   export const POST = handler(async (req) => {
 *     const body = await parseBody(req, TransactionInput);
 *     ...
 *   });
 *
 * - Verifica la sesión (cookie) en cada request.
 * - Convierte errores en JSON {error} con status adecuado.
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

type Ctx = { params: Promise<Record<string, string>> };
type Handler = (req: Request, ctx: Ctx) => Promise<unknown>;

export function handler(fn: Handler) {
  return async (req: Request, ctx: Ctx): Promise<Response> => {
    try {
      if (authEnabled()) {
        const jar = await cookies();
        if (!verifySessionToken(jar.get(SESSION_COOKIE)?.value)) {
          throw new HttpError(401, "No autorizado");
        }
      }
      const result = await fn(req, ctx);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message, details: err.details }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: "Datos inválidos", details: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 400 },
    );
  }
  if (err instanceof NotFoundError) {
    return NextResponse.json({ error: err.message }, { status: 404 });
  }
  console.error(err);
  const msg = err instanceof Error ? err.message : "Error interno";
  return NextResponse.json({ error: msg }, { status: 500 });
}

export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw new HttpError(400, "Body JSON inválido");
  }
  return schema.parse(json);
}

export async function paramId(ctx: Ctx, name = "id"): Promise<string> {
  const p = await ctx.params;
  const v = p[name];
  if (!v) throw new HttpError(400, `Falta parámetro ${name}`);
  return v;
}

export function query(req: Request): URLSearchParams {
  return new URL(req.url).searchParams;
}
