"use client";
import { useCallback, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { notifyDataChanged, useApi, useDataChanged } from "@/lib/hooks";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Account, Category, Transaction } from "@/lib/types";
import type { AccountWithBalance } from "@/lib/domain/accounts";
import { AccountForm } from "@/components/accounts/AccountForm";
import { PayStatementModal } from "@/components/accounts/PayStatementModal";
import { STATEMENT_LABELS, type StatementsResponse, type StatementWithTransactions } from "@/components/accounts/types";
import { TransactionList } from "@/components/transactions/TransactionList";
import { TransactionForm } from "@/components/transactions/TransactionForm";
import { IconBubble } from "@/components/categories/icons";

const STATUS_CLASSES: Record<string, string> = {
  open: "bg-primary/15 text-primary",
  closed: "bg-warning/15 text-warning",
  paid: "bg-success/15 text-success",
};

function StatementBlock({
  statement,
  accounts,
  onPay,
  onChanged,
}: {
  statement: StatementWithTransactions;
  accounts: AccountWithBalance[];
  onPay: (s: StatementWithTransactions) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function unpay() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/cards/statements/${statement.id}/unpay`);
      notifyDataChanged();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo revertir");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">
            {formatDate(statement.period_start)} — {formatDate(statement.period_end)}
          </p>
          <p className="text-xs text-muted">
            Vence {formatDate(statement.due_date)}
            {statement.paid_at && ` · pagado el ${formatDate(statement.paid_at)}`}
          </p>
        </div>
        <div className="text-right">
          <p className="text-base font-bold tabular-nums">{formatMoney(statement.total)}</p>
          <Badge className={STATUS_CLASSES[statement.status]}>{STATEMENT_LABELS[statement.status]}</Badge>
        </div>
      </div>

      <div className="divide-y divide-border/60">
        {statement.transactions.map((t) => (
          <div key={t.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate">
              <span className="text-muted">{formatDate(t.date)}</span> · {t.note || "Consumo"}
              {t.installment_number && !/cuota/i.test(t.note) && ` (${t.installment_number}/${t.installments_total})`}
            </span>
            <span className="tabular-nums">{formatMoney(t.amount, t.currency)}</span>
          </div>
        ))}
        {!statement.transactions.length && <p className="py-2 text-sm text-muted">Sin consumos.</p>}
      </div>

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      <div className="mt-3 flex justify-end gap-2">
        {statement.status === "paid" ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={unpay}>
            Despagar
          </Button>
        ) : (
          <Button size="sm" variant="secondary" disabled={statement.total <= 0} onClick={() => onPay(statement)}>
            Pagar resumen
          </Button>
        )}
      </div>
      {statement.payment && (
        <p className="mt-1 text-right text-xs text-muted">
          Pagado {formatMoney(statement.paid_amount ?? 0)} desde{" "}
          {accounts.find((a) => a.id === statement.paid_from_account_id)?.name ?? "otra cuenta"}
        </p>
      )}
    </Card>
  );
}

/** Detalle de cuenta: saldo, movimientos y (para tarjetas) resúmenes. */
export default function CuentaDetallePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  const account = useApi<AccountWithBalance>(id ? `/api/accounts/${id}` : null);
  const accounts = useApi<AccountWithBalance[]>("/api/accounts?archived=1");
  const categories = useApi<Category[]>("/api/categories");
  const txs = useApi<{ transactions: Transaction[] }>(
    id ? `/api/transactions?account_id=${id}&from=0001-01-01&to=9999-12-31` : null,
  );
  const statements = useApi<StatementsResponse>(
    account.data?.type === "credit_card" ? `/api/cards/statements?account_id=${id}` : null,
  );

  const [editOpen, setEditOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [paying, setPaying] = useState<StatementWithTransactions | null>(null);

  const reloadAll = useCallback(() => {
    void account.reload();
    void accounts.reload();
    void txs.reload();
    void statements.reload();
  }, [account, accounts, txs, statements]);
  useDataChanged(reloadAll);

  const acc = account.data;
  const isCard = acc?.type === "credit_card";

  return (
    <>
      <PageHeader
        title={acc?.name ?? "Cuenta"}
        right={
          acc && !acc.is_partner ? (
            <Button size="sm" variant="ghost" onClick={() => setEditOpen(true)} aria-label="Editar cuenta">
              <Pencil size={18} />
            </Button>
          ) : undefined
        }
      >
        <Link href="/cuentas" className="mt-1 inline-flex items-center gap-1 text-sm text-muted">
          <ArrowLeft size={16} /> Cuentas
        </Link>
      </PageHeader>

      {account.error && <p className="mb-3 text-sm text-danger">{account.error}</p>}
      {!acc && account.loading && <Spinner />}

      {acc && (
        <Card className="mb-4">
          <div className="flex items-center gap-3">
            <IconBubble icon={acc.icon} color={acc.color} size={48} />
            <div className="flex-1">
              <p className="text-xs uppercase tracking-wide text-muted">Saldo</p>
              <p className={cn("text-2xl font-bold tabular-nums", acc.balance < 0 && "text-danger")}>
                {formatMoney(acc.balance, acc.currency)}
              </p>
            </div>
          </div>
          {isCard && (
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3 text-sm">
              <div>
                <p className="text-xs text-muted">Consumos pendientes</p>
                <p className="font-semibold tabular-nums text-warning">
                  {formatMoney(acc.pending_total ?? 0, acc.currency)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted">Disponible</p>
                <p className="font-semibold tabular-nums">
                  {acc.available !== null ? formatMoney(acc.available, acc.currency) : "—"}
                </p>
              </div>
              {acc.current_statement && (
                <div className="col-span-2 text-xs text-muted">
                  Resumen en curso: cierra {formatDate(acc.current_statement.period_end)} · vence{" "}
                  {formatDate(acc.current_statement.due_date)}
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {isCard && (
        <section className="mb-4">
          <h2 className="mb-2 text-sm font-semibold text-muted">Resúmenes</h2>
          {statements.loading && !statements.data && <Spinner />}
          {statements.data?.statements.length === 0 && (
            <EmptyState title="Sin resúmenes" hint="Cargá un consumo con esta tarjeta." />
          )}
          {statements.data?.statements.map((s) => (
            <StatementBlock
              key={s.id}
              statement={s}
              accounts={accounts.data ?? []}
              onPay={setPaying}
              onChanged={reloadAll}
            />
          ))}
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold text-muted">Movimientos</h2>
        {txs.loading && !txs.data ? (
          <Spinner />
        ) : (
          <TransactionList
            transactions={txs.data?.transactions ?? []}
            accounts={(accounts.data ?? []) as Account[]}
            categories={categories.data ?? []}
            onSelect={(t) => setEditingTx(t)}
            emptyHint="Todavía no hay movimientos en esta cuenta."
          />
        )}
      </section>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Editar cuenta">
        {acc && <AccountForm account={acc} onDone={() => setEditOpen(false)} />}
      </Modal>

      <Modal open={Boolean(editingTx)} onClose={() => setEditingTx(null)} title="Editar movimiento">
        {editingTx && (
          <TransactionForm
            key={editingTx.id}
            transaction={editingTx}
            onDone={() => setEditingTx(null)}
          />
        )}
      </Modal>

      <PayStatementModal
        key={paying?.id ?? "pay"}
        open={Boolean(paying)}
        onClose={() => setPaying(null)}
        statementId={paying?.id ?? null}
        cardName={acc?.name ?? ""}
        total={paying?.total ?? 0}
        dueDate={paying?.due_date}
        currency={acc?.currency}
        accounts={accounts.data ?? []}
      />
    </>
  );
}
