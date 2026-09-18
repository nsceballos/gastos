import { NextResponse, type NextRequest } from "next/server";

/**
 * Gate de autenticación. Si APP_PASSWORD está definida, toda ruta (salvo /login y
 * /api/auth/*) requiere cookie de sesión. La verificación HMAC completa se hace en
 * src/lib/api.ts (route handlers) y en las páginas; acá solo se chequea presencia
 * para redirigir rápido (edge runtime no tiene node:crypto).
 */
export function proxy(req: NextRequest) {
  if (!process.env.APP_PASSWORD) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth")) return NextResponse.next();
  const has = req.cookies.get("gastos_session")?.value;
  if (has) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.json).*)"],
};
