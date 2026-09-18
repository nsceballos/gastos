"use client";
import { useState } from "react";
import { PageHeader, MonthPicker, currentMonth, Card, CardTitle, Segmented, Spinner } from "@/components/ui";
import { useApi, useDataChanged } from "@/lib/hooks";
import { formatMoney } from "@/lib/format";
import type { AppSettings } from "@/lib/types";
import type { MonthStats, StatsMode, TrendPoint } from "@/lib/domain/stats";
import { CategoryDonut } from "@/components/stats/CategoryDonut";
import { TrendBars } from "@/components/stats/TrendBars";
import { DailyBars } from "@/components/stats/DailyBars";

type View = "expense" | "income";

interface StatsResponse extends MonthStats {
  trend: TrendPoint[];
  month: string;
  mode: StatsMode;
}

export default function EstadisticasPage() {
  const [month, setMonth] = useState(currentMonth());
  const [view, setView] = useState<View>("expense");
  const [mode, setMode] = useState<StatsMode>("committed");

  const settingsApi = useApi<AppSettings>("/api/settings");
  const currency = settingsApi.data?.currency ?? "ARS";

  const statsApi = useApi<StatsResponse>(`/api/stats?month=${month}&mode=${mode}`);
  useDataChanged(() => void statsApi.reload());

  const data = statsApi.data;
  const loading = statsApi.loading && !data;

  return (
    <>
      <PageHeader title="Estadísticas">
        <MonthPicker value={month} onChange={setMonth} />
      </PageHeader>

      <div className="flex flex-col gap-4">
        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "expense", label: "Gastos" },
            { value: "income", label: "Ingresos" },
          ]}
        />
        {view === "expense" && (
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "committed", label: "Comprometido" },
              { value: "effective", label: "Efectivo" },
            ]}
          />
        )}

        {loading && <Spinner />}
        {statsApi.error && <p className="text-sm text-danger">{statsApi.error}</p>}

        {data && (
          <>
            <Card>
              <CardTitle>Totales del mes</CardTitle>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted">Ingresos</dt>
                  <dd className="text-base font-semibold text-success">{formatMoney(data.totals.income, currency)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Gastos</dt>
                  <dd className="text-base font-semibold text-danger">
                    {formatMoney(mode === "committed" ? data.totals.expense_committed : data.totals.expense_effective, currency)}
                  </dd>
                </div>
                {view === "expense" && data.totals.pending_card > 0 && (
                  <div>
                    <dt className="text-muted">Pendiente de pago (tarjeta)</dt>
                    <dd className="text-base font-semibold text-warning">{formatMoney(data.totals.pending_card, currency)}</dd>
                  </div>
                )}
                <div>
                  <dt className="text-muted">Balance</dt>
                  <dd className={`text-base font-semibold ${data.totals.balance < 0 ? "text-danger" : "text-foreground"}`}>
                    {formatMoney(data.totals.balance, currency)}
                  </dd>
                </div>
                {data.shared_total > 0 && (
                  <div>
                    <dt className="text-muted">Compartido</dt>
                    <dd className="text-base font-semibold">{formatMoney(data.shared_total, currency)}</dd>
                  </div>
                )}
              </dl>
            </Card>

            <Card>
              <CardTitle>{view === "expense" ? "Gastos por categoría" : "Ingresos por categoría"}</CardTitle>
              <CategoryDonut
                items={view === "expense" ? data.by_category : data.income_by_category}
                currency={currency}
                emptyLabel={view === "expense" ? "Sin gastos este mes" : "Sin ingresos este mes"}
              />
            </Card>

            <Card>
              <CardTitle>Por día del mes</CardTitle>
              <DailyBars data={data.by_day} series={view} />
            </Card>

            <Card>
              <CardTitle>Tendencia (últimos 6 meses)</CardTitle>
              <TrendBars data={data.trend} />
            </Card>
          </>
        )}
      </div>
    </>
  );
}
