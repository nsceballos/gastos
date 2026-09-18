"use client";
import { useMemo } from "react";
import { ArrowRightLeft, CreditCard } from "lucide-react";
import { Badge, EmptyState } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Account, Category, Transaction } from "@/lib/types";
import { IconBubble } from "@/components/categories/icons";

const NEUTRAL = "#64748b";

export function amountColor(t: Transaction): string {
  if (t.type === "income") return "text-success";
  if (t.type === "expense") return t.status === "pending_card" ? "text-danger/70" : "text-danger";
  return "text-muted";
}

function signed(t: Transaction): string {
  const money = formatMoney(t.amount, t.currency);
  if (t.type === "income") return `+${money}`;
  if (t.type === "expense") return `-${money}`;
  return money;
}

/** Una fila: ícono + título + cuenta/badges + monto. */
export function TransactionRow({
  tx,
  account,
  category,
  onClick,
}: {
  tx: Transaction;
  account?: Account;
  category?: Category;
  onClick?: () => void;
}) {
  const title =
    tx.type === "transfer"
      ? "Transferencia"
      : tx.type === "card_payment"
        ? "Pago de tarjeta"
        : (category?.name ?? (tx.type === "income" ? "Ingreso" : "Gasto"));

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-1 py-2 text-left transition-colors hover:bg-surface-2"
    >
      {tx.type === "transfer" || tx.type === "card_payment" ? (
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: `${NEUTRAL}22`, color: NEUTRAL }}
        >
          {tx.type === "transfer" ? <ArrowRightLeft size={20} /> : <CreditCard size={20} />}
        </span>
      ) : (
        <IconBubble icon={category?.icon ?? "tag"} color={category?.color ?? NEUTRAL} />
      )}

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium">{title}</span>
        </span>
        {tx.note && <span className="block truncate text-xs text-muted">{tx.note}</span>}
        <span className="mt-0.5 flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted">{account?.name ?? ""}</span>
          {tx.status === "pending_card" && (
            <Badge className="bg-warning/15 text-warning">Tarjeta · pendiente</Badge>
          )}
          {tx.type === "expense" && tx.status === "posted" && tx.card_statement_id && tx.effective_date && (
            <Badge className="bg-surface-3 text-muted">Pagado {formatDate(tx.effective_date)}</Badge>
          )}
          {tx.is_shared && <Badge className="bg-primary/15 text-primary">Compartido</Badge>}
          {tx.installment_number && tx.installments_total && (
            <Badge className="bg-surface-3 text-muted">
              Cuota {tx.installment_number}/{tx.installments_total}
            </Badge>
          )}
        </span>
      </span>

      <span className={cn("shrink-0 text-sm font-semibold tabular-nums", amountColor(tx))}>{signed(tx)}</span>
    </button>
  );
}

/** Lista agrupada por día (estilo Money Manager). */
export function TransactionList({
  transactions,
  accounts,
  categories,
  onSelect,
  emptyHint,
}: {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  onSelect?: (tx: Transaction) => void;
  emptyHint?: string;
}) {
  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const days = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const t of transactions) {
      const list = map.get(t.date);
      if (list) list.push(t);
      else map.set(t.date, [t]);
    }
    return [...map.entries()];
  }, [transactions]);

  if (!transactions.length) {
    return <EmptyState title="Sin movimientos" hint={emptyHint ?? "Tocá el + para cargar el primero."} />;
  }

  return (
    <div className="flex flex-col gap-4">
      {days.map(([date, txs]) => {
        const dayTotal = txs.reduce(
          (acc, t) => acc + (t.type === "expense" ? -t.amount : t.type === "income" ? t.amount : 0),
          0,
        );
        return (
          <section key={date}>
            <header className="flex items-baseline justify-between border-b border-border pb-1">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                {formatDate(date, { weekday: "short", day: "2-digit", month: "short" })}
              </h3>
              <span className={cn("text-xs tabular-nums", dayTotal < 0 ? "text-muted" : "text-success")}>
                {formatMoney(dayTotal, txs[0]?.currency)}
              </span>
            </header>
            <div className="divide-y divide-border/60">
              {txs.map((t) => (
                <TransactionRow
                  key={t.id}
                  tx={t}
                  account={accById.get(t.account_id)}
                  category={t.category_id ? catById.get(t.category_id) : undefined}
                  onClick={onSelect ? () => onSelect(t) : undefined}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
