"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { formatDate, formatMoney } from "@/lib/format";
import type { DayAmount } from "@/lib/domain/stats";

function TooltipContent({
  active,
  payload,
  label,
  color,
  seriesLabel,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
  color: string;
  seriesLabel: string;
}) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{formatDate(label, { day: "2-digit", month: "short" })}</p>
      <p style={{ color }}>
        {seriesLabel}: {formatMoney(payload[0].value)}
      </p>
    </div>
  );
}

/** Barras por día del mes de una sola serie (gasto o ingreso, según la pestaña activa). */
export function DailyBars({ data, series }: { data: DayAmount[]; series: "expense" | "income" }) {
  const color = series === "income" ? "var(--success)" : "var(--danger)";
  const seriesLabel = series === "income" ? "Ingresos" : "Gastos";
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => d.slice(8, 10)}
            tickLine={false}
            axisLine={false}
            interval={Math.max(0, Math.ceil(data.length / 8) - 1)}
            tick={{ fill: "var(--muted)", fontSize: 10 }}
          />
          <Tooltip content={<TooltipContent color={color} seriesLabel={seriesLabel} />} cursor={{ fill: "var(--surface-2)" }} />
          <Bar dataKey={series} fill={color} radius={[3, 3, 0, 0]} maxBarSize={10} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
