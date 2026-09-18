"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { formatMoney, formatMonth } from "@/lib/format";
import type { TrendPoint } from "@/lib/domain/stats";

const INCOME_COLOR = "var(--success)";
const EXPENSE_COLOR = "var(--danger)";

function shortMonth(month: string): string {
  return formatMonth(month).replace(/ de \d+$/, "").slice(0, 3);
}

function TooltipContent({ active, payload, label }: { active?: boolean; payload?: { value: number; dataKey: string }[]; label?: string }) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium capitalize text-foreground">{formatMonth(label)}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.dataKey === "income" ? INCOME_COLOR : EXPENSE_COLOR }}>
          {p.dataKey === "income" ? "Ingresos" : "Gastos"}: {formatMoney(p.value)}
        </p>
      ))}
    </div>
  );
}

export function TrendBars({ data }: { data: TrendPoint[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: INCOME_COLOR }} /> Ingresos
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: EXPENSE_COLOR }} /> Gastos
        </span>
      </div>
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={4} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="month"
              tickFormatter={shortMonth}
              tickLine={false}
              axisLine={false}
              tick={{ fill: "var(--muted)", fontSize: 11 }}
            />
            <Tooltip content={<TooltipContent />} cursor={{ fill: "var(--surface-2)" }} />
            <Bar dataKey="income" fill={INCOME_COLOR} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            <Bar dataKey="expense" fill={EXPENSE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
