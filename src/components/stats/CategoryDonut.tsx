"use client";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatMoney } from "@/lib/format";
import { EmptyState } from "@/components/ui";
import type { CategoryAmount } from "@/lib/domain/stats";

const NO_CATEGORY_COLOR = "var(--muted)";

function TooltipContent({ active, payload }: { active?: boolean; payload?: { payload: CategoryAmount }[] }) {
  if (!active || !payload?.length) return null;
  const item = payload[0].payload;
  const name = item.category?.name ?? "Sin categoría";
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-md">
      <p className="font-medium text-foreground">{name}</p>
      <p className="text-muted">{formatMoney(item.amount)} · {Math.round(item.pct)}%</p>
    </div>
  );
}

export function CategoryDonut({ items, currency, emptyLabel }: { items: CategoryAmount[]; currency: string; emptyLabel: string }) {
  if (items.length === 0) {
    return <EmptyState title={emptyLabel} />;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={items}
              dataKey="amount"
              innerRadius="62%"
              outerRadius="90%"
              paddingAngle={items.length > 1 ? 2 : 0}
              stroke="var(--surface)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {items.map((it, i) => (
                <Cell key={it.category?.id ?? `none-${i}`} fill={it.category?.color ?? NO_CATEGORY_COLOR} />
              ))}
            </Pie>
            <Tooltip content={<TooltipContent />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-col gap-1.5">
        {items.map((it, i) => (
          <li key={it.category?.id ?? `none-${i}`} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: it.category?.color ?? NO_CATEGORY_COLOR }}
              />
              <span className="truncate">{it.category?.name ?? "Sin categoría"}</span>
            </span>
            <span className="shrink-0 text-muted">
              {Math.round(it.pct)}% · {formatMoney(it.amount, currency)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
