"use client";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Plus } from "lucide-react";
import { Badge, Button, Card, CardTitle, Modal, PageHeader, Spinner } from "@/components/ui";
import { useApi, useDataChanged } from "@/lib/hooks";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { AccountType } from "@/lib/types";
import type { AccountWithBalance } from "@/lib/domain/accounts";
import { IconBubble } from "@/components/categories/icons";
import { AccountForm } from "@/components/accounts/AccountForm";
import { PayStatementModal } from "@/components/accounts/PayStatementModal";
import type { StatementsResponse, StatementWithTransactions } from "@/components/accounts/types";

interface BalancesResponse {
  accounts: AccountWithBalance[];
  net_worth: number;
}

interface PayTarget {
  id: string | null;
  total: number;
  due_date?: string;
  period_end?: string;
}

const GROUPS: { type: AccountType; title: string }[] = [
  { type: "cash", title: "Efectivo" },
  { type: "bank", title: "Bancos" },
  { type: "wallet", title: "Billeteras" },
  { type: "credit_card", title: "Tarjetas de crédito" },
];

function AccountLine({ account }: { account: AccountWithBalance }) {
  return (
    <Link
      href={`/cuentas/${account.id}`}
      className="flex items-center gap-3 rounded-xl px-1 py-2 transition-colors hover:bg-surface-2"
    >
      <IconBubble icon={account.icon} color={account.color} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{account.name}</span>
        {account.type === "credit_card" && account.current_statement && (
          <span className="block text-xs text-muted">
            Cierra {formatDate(account.current_statement.period_end)} · vence{" "}
            {formatDate(account.current_statement.due_date)}
          </span>
        )}
      </span>
      <span className="text-right">
        <span
          className={cn(
            "block text-sm font-semibold tabular-nums",
            account.balance < 0 ? "text-danger" : "text-foreground",
          )}
        >
          {formatMoney(account.balance, account.currency)}
        </span>
        {account.available !== null && (
          <span className="block text-[11px] text-muted">
            Disponible {formatMoney(account.available, account.currency)}
          </span>
        )}
      </span>
      <ChevronRight size={18} className="text-muted" />
    </Link>
  );
}

/** Cuentas: patrimonio neto, saldos por tipo y pago de resúmenes de tarjeta. */
export default function CuentasPage() {
  const { data, loading, error, reload } = useApi<BalancesResponse>("/api/accounts/balances");
  const statements = useApi<StatementsResponse>("/api/cards/statements");
  const [formOpen, setFormOpen] = useState(false);
  const [paying, setPaying] = useState<{ account: AccountWithBalance; statement: PayTarget } | null>(null);

  const cb = useCallback(() => {
    void reload();
    void statements.reload();
  }, [reload, statements]);
  useDataChanged(cb);

  const accounts = useMemo(() => data?.accounts ?? [], [data]);
  const partner = accounts.find((a) => a.is_partner) ?? null;
  const currency = accounts[0]?.currency ?? "ARS";

  /** Resumen a pagar: el impago más viejo (ya cerrado); si no hay, el que está en curso. */
  const payTarget = useCallback(
    (account: AccountWithBalance): PayTarget => {
      const impagos = (statements.data?.statements ?? [])
        .filter((s: StatementWithTransactions) => s.account_id === account.id && s.status !== "paid" && s.total > 0)
        .sort((a, b) => a.period_end.localeCompare(b.period_end));
      const target = impagos[0];
      if (target) {
        return { id: target.id, total: target.total, due_date: target.due_date, period_end: target.period_end };
      }
      const current = account.current_statement;
      return current
        ? { id: current.id, total: current.total, due_date: current.due_date, period_end: current.period_end }
        : { id: null, total: 0, due_date: undefined, period_end: undefined };
    },
    [statements.data],
  );

  return (
    <>
      <PageHeader
        title="Cuentas"
        right={
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus size={16} /> Nueva
          </Button>
        }
      />

      <Card className="mb-4">
        <CardTitle>Patrimonio neto</CardTitle>
        <p
          className={cn(
            "text-2xl font-bold tabular-nums",
            (data?.net_worth ?? 0) < 0 ? "text-danger" : "text-foreground",
          )}
        >
          {formatMoney(data?.net_worth ?? 0, currency)}
        </p>
        <p className="mt-1 text-xs text-muted">Sin contar la cuenta de la pareja. Las tarjetas restan.</p>
      </Card>

      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      {loading && !data && <Spinner />}

      <div className="flex flex-col gap-4">
        {GROUPS.map(({ type, title }) => {
          const list = accounts.filter((a) => a.type === type);
          if (!list.length) return null;
          return (
            <Card key={type}>
              <CardTitle>{title}</CardTitle>
              <div className="divide-y divide-border/60">
                {list.map((a) => (
                  <div key={a.id}>
                    <AccountLine account={a} />
                    {a.type === "credit_card" && (
                      <div className="flex items-center justify-between gap-2 px-1 pb-2">
                        <span className="flex flex-wrap items-center gap-1 text-xs text-muted">
                          <Badge className="bg-warning/15 text-warning">
                            Pendiente {formatMoney(a.pending_total ?? 0, a.currency)}
                          </Badge>
                          {a.current_statement && a.current_statement.total > 0 && (
                            <Badge className="bg-surface-3 text-muted">
                              Resumen actual {formatMoney(a.current_statement.total, a.currency)}
                            </Badge>
                          )}
                        </span>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setPaying({ account: a, statement: payTarget(a) })}
                          disabled={!payTarget(a).id}
                        >
                          Pagar resumen
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          );
        })}

        {partner && (
          <Card>
            <CardTitle>Cuenta de la pareja</CardTitle>
            <div className="flex items-center gap-3 px-1 py-2">
              <IconBubble icon={partner.icon} color={partner.color} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{partner.name}</span>
                <span className="block text-xs text-muted">
                  Lo que puso la pareja en gastos compartidos. No se edita ni se borra.
                </span>
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {formatMoney(partner.balance, partner.currency)}
              </span>
            </div>
          </Card>
        )}
      </div>

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title="Nueva cuenta">
        <AccountForm onDone={() => setFormOpen(false)} />
      </Modal>

      <PayStatementModal
        key={paying?.statement.id ?? "pay"}
        open={Boolean(paying)}
        onClose={() => setPaying(null)}
        statementId={paying?.statement.id ?? null}
        cardName={paying?.account.name ?? ""}
        total={paying?.statement.total ?? 0}
        dueDate={paying?.statement.due_date}
        currency={paying?.account.currency}
        accounts={accounts}
      />
    </>
  );
}
