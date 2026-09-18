"use client";
import { useCallback, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Settings2 } from "lucide-react";
import { Button, Card, CardTitle, EmptyState, Input, PageHeader, Spinner } from "@/components/ui";
import { useApi, useDataChanged } from "@/lib/hooks";
import { todayISO } from "@/lib/domain/core";
import { formatDate, formatMoney } from "@/lib/format";
import type { SettlementListItem, SharedSummary } from "@/lib/domain/shared";
import type { Settlement } from "@/lib/types";
import { BalanceLine } from "@/components/shared/BalanceLine";
import { CloseModal } from "@/components/shared/CloseModal";
import { SettleModal } from "@/components/shared/SettleModal";
import { SharedTxList } from "@/components/shared/SharedTxList";
import { SettlementsList } from "@/components/shared/SettlementsList";
import { PersonAvatar } from "@/components/shared/PersonBadge";

/** Gastos compartidos con la pareja: período abierto, cierre y liquidaciones. */
export default function ParejaPage() {
  const [until, setUntil] = useState(() => todayISO());
  const [closing, setClosing] = useState(false);
  const [justClosed, setJustClosed] = useState<Settlement | null>(null);

  const summary = useApi<SharedSummary>(`/api/shared/summary?until=${until}`);
  const settlements = useApi<SettlementListItem[]>("/api/settlements");

  const reloadSummary = summary.reload;
  const reloadSettlements = settlements.reload;
  const reloadAll = useCallback(() => {
    void reloadSummary();
    void reloadSettlements();
  }, [reloadSummary, reloadSettlements]);
  useDataChanged(reloadAll);

  const data = summary.data;
  const partnerName = data?.partner_name ?? "Pareja";
  const myName = data?.my_name ?? "Yo";
  const currency = data?.currency ?? "ARS";

  return (
    <>
      <PageHeader
        title={`Gastos con ${partnerName}`}
        right={
          <Link
            href="/ajustes"
            className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted"
          >
            <Settings2 size={14} />
            {data ? `${data.default_my_share_pct}/${100 - data.default_my_share_pct}` : "Ajustes"}
          </Link>
        }
      >
        {data && (
          <p className="mt-1 text-xs text-muted">
            Repartís {data.default_my_share_pct}% vos y {100 - data.default_my_share_pct}% {partnerName}. Podés
            cambiarlo en Ajustes o por gasto.
          </p>
        )}
      </PageHeader>

      {summary.error && <p className="mb-4 text-sm text-danger">{summary.error}</p>}
      {summary.loading && !data && <Spinner />}

      {data && (
        <div className="flex flex-col gap-4">
          {/* -------- Período abierto -------- */}
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="mb-0">Período abierto</CardTitle>
                <p className="text-sm font-medium">
                  {formatDate(data.period_start, { day: "2-digit", month: "2-digit", year: "numeric" })} –{" "}
                  {formatDate(data.period_end, { day: "2-digit", month: "2-digit", year: "numeric" })}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted">Total compartido</p>
                <p className="text-base font-semibold tabular-nums">
                  {formatMoney(data.totals.total_shared, currency)}
                </p>
              </div>
            </div>

            <div className="my-3 grid grid-cols-2 gap-2">
              <PaidBox who="me" name={myName} amount={data.totals.paid_by_me} currency={currency} />
              <PaidBox who="partner" name={partnerName} amount={data.totals.paid_by_partner} currency={currency} />
            </div>

            <div className="rounded-2xl bg-surface-2 p-3">
              <BalanceLine balance={data.totals.balance} partnerName={partnerName} currency={currency} />
              <p className="mt-1 text-xs text-muted">
                Tu parte {formatMoney(data.totals.my_share, currency)} · parte de {partnerName}{" "}
                {formatMoney(data.totals.partner_share, currency)}
              </p>
            </div>

            <div className="mt-3 flex items-end gap-2">
              <label className="flex flex-1 flex-col gap-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted">Cerrar hasta</span>
                <Input
                  type="date"
                  value={until}
                  min={data.period_start}
                  onChange={(e) => setUntil(e.target.value || todayISO())}
                />
              </label>
              <Button
                className="flex-1"
                onClick={() => setClosing(true)}
                disabled={data.transactions.length === 0 || until < data.period_start}
              >
                Cerrar período y liquidar
              </Button>
            </div>
            {until < data.period_start && (
              <p className="mt-2 text-xs text-danger">
                La fecha de cierre no puede ser anterior al inicio del período.
              </p>
            )}
          </Card>

          {/* -------- Gastos del período -------- */}
          <Card>
            <CardTitle>Gastos compartidos del período</CardTitle>
            {data.late_count > 0 && (
              <p className="mb-2 flex items-start gap-2 rounded-xl bg-warning/10 p-2.5 text-xs text-warning">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  {data.late_count} gasto{data.late_count === 1 ? "" : "s"} con fecha anterior al período (cargado
                  {data.late_count === 1 ? "" : "s"} tarde). Se incluyen igual en este cierre.
                </span>
              </p>
            )}
            <SharedTxList
              items={data.transactions}
              categories={data.categories}
              partnerName={partnerName}
              myName={myName}
              defaultPct={data.default_my_share_pct}
              currency={currency}
              periodStart={data.period_start}
            />
          </Card>

          {/* -------- Cierres anteriores -------- */}
          <Card>
            <CardTitle>Cierres anteriores</CardTitle>
            {settlements.loading && !settlements.data ? (
              <Spinner />
            ) : settlements.data ? (
              <SettlementsList
                settlements={settlements.data}
                partnerName={partnerName}
                currency={currency}
              />
            ) : (
              <EmptyState title="No se pudieron cargar los cierres" />
            )}
          </Card>
        </div>
      )}

      {data && (
        <CloseModal
          open={closing}
          onClose={() => setClosing(false)}
          summary={data}
          periodEnd={until}
          onClosed={(s) => {
            setClosing(false);
            setJustClosed(s);
            setUntil(todayISO());
          }}
        />
      )}

      {justClosed && data && (
        <SettleModal
          open
          onClose={() => setJustClosed(null)}
          settlement={justClosed}
          accounts={data.accounts}
          partnerName={partnerName}
          currency={currency}
          onDone={() => setJustClosed(null)}
        />
      )}
    </>
  );
}

function PaidBox({
  who,
  name,
  amount,
  currency,
}: {
  who: "me" | "partner";
  name: string;
  amount: number;
  currency: string;
}) {
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-surface-2 p-3">
      <PersonAvatar who={who} name={name} />
      <div className="min-w-0">
        <p className="truncate text-xs text-muted">Puso {name}</p>
        <p className="text-sm font-semibold tabular-nums">{formatMoney(amount, currency)}</p>
      </div>
    </div>
  );
}
