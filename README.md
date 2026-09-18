# Gastos

Control de gastos personal inspirado en **Money Manager** (RealByte), con cuatro mejoras:

- **Tarjetas de crédito bien modeladas**: los consumos se cargan en el momento, pero **no cuentan como gasto efectivo hasta que pagás el resumen** (vencimiento). Soporta cuotas.
- **Presupuesto mensual** por categoría o total, con **avisos** al alcanzar un umbral (80%) y al superarlo.
- **Asesor financiero IA** (OpenRouter, modelo gratuito) que conoce tus números reales: chat y sugerencia de presupuesto.
- **Gastos compartidos con tu pareja**: se cargan quién pagó y el % de reparto, y en cualquier fecha cerrás el período y liquidás la diferencia.

Stack: Next.js 16 · React 19 · Tailwind 4 · Google Sheets como base de datos · Vercel.

Plan de implementación y arquitectura: [`docs/PLAN.md`](docs/PLAN.md).

---

## Desarrollo local

```bash
npm install
cp .env.example .env.local   # DATA_DRIVER=file usa .data/db.json, sin Google
npm run dev                  # http://localhost:3000
```

Con `DATA_DRIVER=file` no hace falta ninguna credencial. La primera vez abrí `http://localhost:3000/api/setup` (o el botón "Inicializar base" en Ajustes) para crear categorías y cuentas por defecto.

```bash
npm test        # vitest
npm run lint
npm run typecheck
npm run build
```

## Deploy en Vercel + Google Sheets

### 1. La Sheet
1. Creá un Google Sheet vacío. El ID es la parte de la URL entre `/d/` y `/edit`.
2. No hace falta crear pestañas: la app las crea en el primer `/api/setup`.

### 2. Service account
1. En [Google Cloud Console](https://console.cloud.google.com/) creá un proyecto (o usá uno existente).
2. **APIs y servicios → Biblioteca → Google Sheets API → Habilitar**.
3. **IAM → Cuentas de servicio → Crear**. No necesita roles del proyecto.
4. En la cuenta de servicio: **Claves → Agregar clave → JSON**. Descargá el archivo.
5. Compartí la Sheet (botón *Compartir*) con el `client_email` del JSON, rol **Editor**.

### 3. Variables de entorno en Vercel
Importá el repo en Vercel y cargá (Settings → Environment Variables):

| Variable | Valor |
|---|---|
| `GOOGLE_SHEET_ID` | ID de la Sheet |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | `client_email` del JSON |
| `GOOGLE_PRIVATE_KEY` | `private_key` del JSON (podés pegarla con los `\n` literales o con saltos reales) |
| `DATA_DRIVER` | `sheets` |
| `APP_PASSWORD` | contraseña para entrar a la app |
| `AUTH_SECRET` | cualquier string largo aleatorio |
| `OPENROUTER_API_KEY` | tu key de [openrouter.ai](https://openrouter.ai/keys) |
| `OPENROUTER_MODEL` | opcional, default `deepseek/deepseek-v4-flash-0731:free` |
| `APP_URL` | opcional, URL pública (se envía como referer a OpenRouter) |

### 4. Inicializar
Con el deploy listo, entrá a la app, iniciá sesión y abrí **Más → Ajustes → Inicializar base** (o `POST /api/setup`). Eso crea las pestañas con sus encabezados y las categorías/cuentas iniciales. Es idempotente: podés repetirlo sin romper datos.

> **Seguridad**: la key de OpenRouter y la clave privada de Google **solo** van en variables de entorno. Nunca las subas al repo. Si una key se compartió por chat o mail, rotala.

## Estructura

```
src/
  app/               páginas (App Router) y route handlers en app/api/**
  components/        ui/ (kit), layout/, y un directorio por módulo
  lib/
    types.ts         modelo de datos (una pestaña de la Sheet por tabla)
    db/              Driver (Sheets | archivo | memoria) + repositorios tipados
    domain/          reglas de negocio puras (core, cards, transactions, budgets, shared, stats)
    ai/              cliente OpenRouter, contexto financiero, prompts
    auth.ts          contraseña única + cookie HMAC
tests/               vitest
docs/PLAN.md         plan de implementación
```

## Cómo funciona la tarjeta de crédito

1. Cargás un gasto con una cuenta de tipo **tarjeta de crédito** → queda como consumo **pendiente** (no es gasto efectivo, no baja tu saldo bancario) asignado al resumen según el día de cierre.
2. Cuando llega el vencimiento, en **Cuentas → tu tarjeta → Pagar resumen** elegís desde qué cuenta pagás. Eso crea un movimiento *pago de tarjeta* (esa es la salida real de dinero) y los consumos pasan a **gasto efectivo** con esa fecha.
3. En Presupuesto podés elegir si contás los consumos por fecha de compra (comprometido, default) o solo lo efectivamente pagado.

## Gastos compartidos

Al cargar un gasto marcás **Compartido**, quién lo pagó y qué % te corresponde (default en Ajustes). En **Más → Gastos compartidos** ves el período abierto desde el último cierre, cuánto puso cada uno y quién le debe a quién. **Cerrar período** deja constancia del cierre; **Marcar como saldado** registra el movimiento de dinero.
