import { CreditCard } from "lucide-react";
import { Badge, EmptyState } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import type { CategoryLite, SharedSplit } from "@/lib/domain/shared";
import { PersonAvatar } from "./PersonBadge";

/** Lista de gastos compartidos con el reparto de cada uno. */
export function SharedTxList({
  items,
  categories,
  partnerName,
  myName,
  defaultPct,
  currency,
  periodStart,
}: {
  items: SharedSplit[];
  categories: CategoryLite[];
  partnerName: string;
  myName: string;
  defaultPct: number;
  currency: string;
  /** Si se pasa, marca los gastos con fecha anterior al período. */
  periodStart?: string;
}) {
  if (!items.length) {
    return <EmptyState title="Sin gastos compartidos" hint="Marcá un gasto como compartido al cargarlo." />;
  }
  const catById = new Map(categories.map((c) => [c.id, c]));
  return (
    <ul className="divide-y divide-border">
      {items.map(({ tx, my_share }) => {
        const cat = tx.category_id ? catById.get(tx.category_id) : undefined;
        const pct = tx.my_share_pct ?? defaultPct;
        const late = periodStart ? tx.date < periodStart : false;
        return (
          <li key={tx.id} className="flex items-center gap-3 py-3">
            <PersonAvatar
              who={tx.paid_by === "me" ? "me" : "partner"}
              name={tx.paid_by === "me" ? myName : partnerName}
              size={32}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{tx.note || cat?.name || "Gasto compartido"}</p>
              <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <span>{formatDate(tx.date, { day: "2-digit", month: "2-digit" })}</span>
                {cat && tx.note ? <span style={{ color: cat.color }}>· {cat.name}</span> : null}
                <span>· pagó {tx.paid_by === "me" ? myName : partnerName}</span>
                {tx.status === "pending_card" && (
                  <Badge className="bg-surface-2 text-muted">
                    <CreditCard size={11} className="mr-1" /> tarjeta
                  </Badge>
                )}
                {late && <Badge className="bg-warning/15 text-warning">fuera del período</Badge>}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold tabular-nums">{formatMoney(tx.amount, currency)}</p>
              <p className="text-xs text-muted tabular-nums">
                tu parte {formatMoney(my_share, currency)}
                {pct !== defaultPct && <span className="ml-1 font-medium text-warning">({pct}%)</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
