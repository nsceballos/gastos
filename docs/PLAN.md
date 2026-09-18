# Plan de implementación — Gastos

Clon de Money Manager (RealByte) con mejoras:

1. **Tarjetas de crédito**: los consumos se cargan pero **no son gasto efectivo** hasta que se paga el resumen (vencimiento).
2. **Presupuesto mensual** con avisos al alcanzar un umbral (80% por defecto) y al superarlo.
3. **Asesor financiero IA** (OpenRouter, modelo gratuito): chat con contexto real de tus finanzas y sugerencia de presupuesto.
4. **Gastos compartidos con la pareja** con cierre de período y liquidación (50/50 o el % que se defina).

Deploy: **Vercel**. Base de datos: **Google Sheets API** (service account).

---

## Arquitectura

| Capa | Tecnología | Ubicación |
|---|---|---|
| UI | Next.js 16 (App Router) + React 19 + Tailwind 4 + lucide-react + recharts | `src/app/**`, `src/components/**` |
| API | Route handlers JSON (`/api/*`), validación con zod | `src/app/api/**` |
| Dominio | Funciones puras testeables (vitest) | `src/lib/domain/*` |
| Datos | `Driver` abstracto → `SheetsDriver` (prod) / `FileDriver` (dev/tests) | `src/lib/db/*` |
| IA | OpenRouter (chat completions, modelo `:free`) | `src/lib/ai/*` |
| Auth | Contraseña única + cookie HMAC (`APP_PASSWORD`) | `src/lib/auth.ts`, `src/proxy.ts` |

Flujo de datos: página cliente → `useApi()` / `api.*` (`src/lib/api-client.ts`) → route handler → `getDb()` → Sheet.

### Modelo de datos (una pestaña por tabla en la Sheet)

Ver `src/lib/types.ts` (fuente de verdad). Resumen:

- `accounts`: cash | bank | credit_card (closing_day, due_day, credit_limit) | wallet | **partner** (cuenta virtual de la pareja).
- `categories`: expense | income, con ícono y color.
- `transactions`: expense | income | transfer | **card_payment**. Campos clave:
  - `status`: `posted` (impacta cashflow) | `pending_card` (consumo de tarjeta aún no pagado).
  - `effective_date`: fecha en que impacta el cashflow (= fecha de pago del resumen para consumos de tarjeta).
  - cuotas: `installments_total`, `installment_number`, `installment_group_id`.
  - compartido: `is_shared`, `paid_by` (me|partner), `my_share_pct`, `settlement_id`.
- `card_statements`: resúmenes por tarjeta y período (open → closed → paid).
- `budgets`: por mes (`YYYY-MM`), por categoría o total (`category_id = null`), `alert_threshold_pct`, `recurring`.
- `settlements`: cierres de gastos compartidos (período, totales, balance, si se saldó).
- `settings`: clave/valor (nombre de la pareja, % por defecto, moneda, modelo IA, …).

### Reglas de negocio centrales (`src/lib/domain/core.ts`)

- Gasto **comprometido** = todo `expense` por fecha de compra (incluye `pending_card`).
- Gasto **efectivo** = `expense` con `status = posted`, por `effective_date`. `card_payment` **no** se cuenta como gasto (evita doble conteo).
- Pagar un resumen: crea `card_payment` (banco → tarjeta), marca consumos como `posted` con `effective_date = fecha de pago`.
- Presupuesto: usa comprometido o efectivo según `settings.budget_counts_pending_card` (default: comprometido).

---

## Módulos y asignación de subagentes

Trabajo paralelo con archivos disjuntos. Lo compartido (tipos, db, ui kit, layout, nav) lo mantiene el orquestador.

| # | Módulo | Modelo | Motivo | Archivos exclusivos |
|---|---|---|---|---|
| A | Transacciones + Cuentas + **Tarjetas de crédito** (resúmenes, pago de vencimiento, cuotas) | **Opus** | Lógica de fechas de cierre/vencimiento, estados y doble impacto; es el núcleo | `src/lib/domain/{cards,transactions,accounts}.ts`, `src/app/api/{accounts,transactions,cards}/**`, `src/app/page.tsx`, `src/app/cuentas/**`, `src/app/categorias/**`, `src/components/{transactions,accounts}/**` |
| B | **Gastos compartidos** y liquidaciones | **Opus** | Cálculo de balances multi-período, cierre y saldo; debe ser exacto | `src/lib/domain/shared.ts`, `src/app/api/{settlements,shared}/**`, `src/app/pareja/**`, `src/components/shared/**` |
| C | **Presupuestos** + alertas + Estadísticas | **Sonnet** | CRUD y agregaciones claras, mucha UI | `src/lib/domain/{budgets,stats}.ts`, `src/app/api/{budgets,stats}/**`, `src/app/{presupuesto,estadisticas}/**`, `src/components/{budgets,stats}/**` |
| D | **Asesor IA** (OpenRouter) + Ajustes | **Sonnet** | Integración HTTP + prompt engineering + UI de chat | `src/lib/ai/**`, `src/app/api/ai/**`, `src/app/asesor/**`, `src/app/ajustes/**`, `src/components/ai/**` |

Orquestador (Fable): scaffold, capa de datos, auth, UI kit, integración final, tests, README, revisión cruzada.

### Contratos de API (acordados de antemano)

- `GET/POST /api/accounts`, `PUT/DELETE /api/accounts/[id]`, `GET /api/accounts/balances`
- `GET /api/transactions?month=YYYY-MM|from&to`, `POST /api/transactions`, `PUT/DELETE /api/transactions/[id]`
- `GET /api/cards/statements?account_id=`, `POST /api/cards/statements/[id]/pay` `{ from_account_id, amount, date }`
- `GET/POST /api/budgets?month=`, `PUT/DELETE /api/budgets/[id]`, `GET /api/budgets/status?month=` (gastado/limite/alertas)
- `GET /api/stats?month=` (por categoría, por día, ingresos vs gastos, tendencia 6 meses)
- `GET /api/shared/summary` (período abierto desde el último cierre), `POST /api/settlements` (cerrar), `GET /api/settlements`, `POST /api/settlements/[id]/settle`
- `POST /api/ai/chat` `{ messages }` (stream), `POST /api/ai/suggest-budget?month=`
- `GET/PUT /api/settings`, `GET/POST /api/categories`, `POST /api/setup`

---

## Fases

1. **Fase 0 — Base** (orquestador): scaffold Next 16, tipos, drivers Sheets/File, auth, UI kit, nav, tests base. ✅
2. **Fase 1 — Módulos en paralelo** (A, B, C, D).
3. **Fase 2 — Integración**: montar componentes en layout (banner de alertas), enlaces cruzados, `npm run build`, `npm test`, lint.
4. **Fase 3 — Deploy**: crear Sheet + service account, variables en Vercel, `POST /api/setup`.

## Deploy (resumen)

1. Crear un Google Sheet vacío. Copiar su ID.
2. Google Cloud: crear proyecto → habilitar *Google Sheets API* → crear *Service Account* → generar clave JSON.
3. Compartir el Sheet con el email de la service account (Editor).
4. Vercel: importar el repo y cargar las variables de `.env.example`.
5. Abrir `https://<app>.vercel.app/api/setup` (una vez) para crear pestañas y datos por defecto.
