import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge, EmptyState } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import type { SettlementListItem } from "@/lib/domain/shared";

/** Cierres anteriores: período, balance y estado. */
export function SettlementsList({
  settlements,
  partnerName,
  currency,
}: {
  settlements: SettlementListItem[];
  partnerName: string;
  currency: string;
}) {
  if (!settlements.length) {
    return <EmptyState title="Todavía no cerraste ningún período" hint="Cuando cierres, los vas a ver acá." />;
  }
  return (
    <ul className="divide-y divide-border">
      {settlements.map((s) => {
        const even = Math.abs(s.balance) < 0.005;
        return (
          <li key={s.id}>
            <Link href={`/pareja/${s.id}`} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {formatDate(s.period_start, { day: "2-digit", month: "2-digit" })} –{" "}
                  {formatDate(s.period_end, { day: "2-digit", month: "2-digit", year: "2-digit" })}
                </p>
                <p className="text-xs text-muted">
                  {s.transaction_count} gasto{s.transaction_count === 1 ? "" : "s"} ·{" "}
                  {formatMoney(s.total_shared, currency)}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p
                  className={`text-sm font-semibold tabular-nums ${
                    even ? "text-muted" : s.balance > 0 ? "text-success" : "text-danger"
                  }`}
                >
                  {even ? "A mano" : `${s.balance > 0 ? "+" : "−"}${formatMoney(Math.abs(s.balance), currency)}`}
                </p>
                <Badge className={s.settled ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}>
                  {s.settled ? "Saldado" : "Pendiente"}
                </Badge>
              </div>
              <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden />
            </Link>
            {!s.settled && s.balance !== 0 && (
              <p className="sr-only">
                {s.balance > 0 ? `${partnerName} te debe` : `Le debés a ${partnerName}`}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
