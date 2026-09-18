"use client";
import { useCallback, useState } from "react";
import { Plus } from "lucide-react";
import { Card, Modal, MonthPicker, PageHeader, Spinner, currentMonth } from "@/components/ui";
import { useApi, useDataChanged } from "@/lib/hooks";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { Account, Category, Transaction } from "@/lib/types";
import type { MonthSummary } from "@/lib/domain/transactions";
import { TransactionList } from "@/components/transactions/TransactionList";
import { TransactionForm } from "@/components/transactions/TransactionForm";

interface TxResponse {
  transactions: Transaction[];
  summary: MonthSummary;
  range: { start: string; end: string };
}

function Stat({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-muted">{label}</span>
      <span className={cn("text-base font-semibold tabular-nums", className)}>{value}</span>
    </div>
  );
}

/** Inicio: resumen del mes + transacciones agrupadas por día. */
export default function HomePage() {
  const [month, setMonth] = useState(currentMonth());
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Transaction | null>(null);

  const txs = useApi<TxResponse>(`/api/transactions?month=${month}`);
  const accounts = useApi<Account[]>("/api/accounts");
  const categories = useApi<Category[]>("/api/categories");

  const reload = useCallback(() => {
    void txs.reload();
    void accounts.reload();
  }, [txs, accounts]);
  useDataChanged(reload);

  const summary = txs.data?.summary;
  const currency = accounts.data?.[0]?.currency ?? "ARS";

  return (
    <>
      <PageHeader title="Gastos">
        <MonthPicker value={month} onChange={setMonth} />
      </PageHeader>

      <Card className="mb-4">
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Ingresos" value={formatMoney(summary?.income ?? 0, currency)} className="text-success" />
          <Stat
            label="Gastos efectivos"
            value={formatMoney(summary?.expense_effective ?? 0, currency)}
            className="text-danger"
          />
          <Stat
            label="Tarjeta pendiente"
            value={formatMoney(summary?.pending_card_total ?? 0, currency)}
            className="text-warning"
          />
          <Stat
            label="Balance"
            value={formatMoney(summary?.balance ?? 0, currency)}
            className={(summary?.balance ?? 0) < 0 ? "text-danger" : undefined}
          />
        </div>
        {Boolean(summary?.expense_committed) && (
          <p className="mt-3 border-t border-border pt-2 text-xs text-muted">
            Gasto del mes por fecha de compra (incluye consumos de tarjeta):{" "}
            <strong className="font-semibold">{formatMoney(summary?.expense_committed ?? 0, currency)}</strong>
          </p>
        )}
      </Card>

      {txs.error && <p className="mb-3 text-sm text-danger">{txs.error}</p>}
      {txs.loading && !txs.data ? (
        <Spinner />
      ) : (
        <TransactionList
          transactions={txs.data?.transactions ?? []}
          accounts={accounts.data ?? []}
          categories={categories.data ?? []}
          onSelect={(t) => {
            setEditing(t);
            setOpen(true);
          }}
          emptyHint="Tocá el + para cargar tu primer movimiento del mes."
        />
      )}

      <button
        type="button"
        onClick={() => {
          setEditing(null);
          setOpen(true);
        }}
        aria-label="Nueva transacción"
        className="fixed bottom-20 right-[max(1rem,calc(50%-14rem))] z-30 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-colors hover:bg-primary-hover"
      >
        <Plus size={26} />
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? "Editar movimiento" : "Nuevo movimiento"}
      >
        <TransactionForm
          key={editing?.id ?? "new"}
          transaction={editing}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}
