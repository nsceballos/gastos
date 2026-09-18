import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Autenticación mínima: una contraseña única (APP_PASSWORD) y cookie firmada con HMAC.
 * Si APP_PASSWORD no está definida, la app queda abierta (útil en desarrollo).
 */
export const SESSION_COOKIE = "gastos_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 días

function secret(): string {
  return process.env.AUTH_SECRET || process.env.APP_PASSWORD || "dev-secret";
}

export function authEnabled(): boolean {
  return Boolean(process.env.APP_PASSWORD);
}

export function checkPassword(pw: string): boolean {
  const expected = process.env.APP_PASSWORD ?? "";
  if (!expected) return true;
  const a = Buffer.from(pw);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createSessionToken(now = Date.now()): string {
  const exp = Math.floor(now / 1000) + MAX_AGE_SEC;
  const payload = `v1.${exp}`;
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [v, expStr, sig] = parts;
  const payload = `${v}.${expStr}`;
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  return Number(expStr) * 1000 > now;
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SEC,
};
