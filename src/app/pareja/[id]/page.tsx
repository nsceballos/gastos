"use client";
import { use, useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, RotateCcw, Undo2 } from "lucide-react";
import { Badge, Button, Card, CardTitle, Modal, PageHeader, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { useApi, notifyDataChanged, useDataChanged } from "@/lib/hooks";
import { formatDate, formatMoney } from "@/lib/format";
import type { SettlementDetail } from "@/lib/domain/shared";
import { BalanceLine } from "@/components/shared/BalanceLine";
import { SettleModal } from "@/components/shared/SettleModal";
import { SharedTxList } from "@/components/shared/SharedTxList";

/** Detalle de un cierre: transacciones incluidas y acciones (saldar / des-saldar / reabrir). */
export default function SettlementDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { data, loading, error, reload } = useApi<SettlementDetail>(`/api/settlements/${id}`);
  const [settling, setSettling] = useState(false);
  const [confirmReopen, setConfirmReopen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(() => void reload(), [reload]);
  useDataChanged(refresh);

  async function run(fn: () => Promise<unknown>, after?: () => void) {
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      notifyDataChanged();
      if (after) after();
      else refresh();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const s = data?.settlement;
  const partnerName = data?.partner_name ?? "Pareja";
  const currency = data?.currency ?? "ARS";

  return (
    <>
      <PageHeader
        title="Cierre"
        right={
          <Link href="/pareja" className="rounded-full p-2 text-muted hover:bg-surface-2" aria-label="Volver">
            <ArrowLeft size={20} />
          </Link>
        }
      />

      {error && <p className="mb-4 text-sm text-danger">{error}</p>}
      {loading && !data && <Spinner />}

      {data && s && (
        <div className="flex flex-col gap-4">
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="mb-0">Período</CardTitle>
                <p className="text-sm font-medium">
                  {formatDate(s.period_start, { day: "2-digit", month: "2-digit", year: "numeric" })} –{" "}
                  {formatDate(s.period_end, { day: "2-digit", month: "2-digit", year: "numeric" })}
                </p>
                <p className="text-xs text-muted">
                  Cerrado el {formatDate(s.closed_at.slice(0, 10), { day: "2-digit", month: "2-digit", year: "numeric" })}
                  {" · "}reparto {s.default_my_share_pct}/{100 - s.default_my_share_pct}
                </p>
              </div>
              <Badge className={s.settled ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}>
                {s.settled ? "Saldado" : "Pendiente"}
              </Badge>
            </div>

            <dl className="my-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
              <Row label="Total compartido" value={formatMoney(s.total_shared, currency)} />
              <Row label="Tu parte" value={formatMoney(s.my_share, currency)} />
              <Row label={`Puso ${data.my_name}`} value={formatMoney(s.paid_by_me, currency)} />
              <Row label={`Puso ${partnerName}`} value={formatMoney(s.paid_by_partner, currency)} />
            </dl>

            <div className="rounded-2xl bg-surface-2 p-3">
              <BalanceLine balance={s.balance} partnerName={partnerName} currency={currency} />
            </div>

            {s.note && <p className="mt-3 text-sm text-muted">{s.note}</p>}

            {actionError && <p className="mt-3 text-sm text-danger">{actionError}</p>}

            <div className="mt-3 flex flex-col gap-2">
              {!s.settled ? (
                <>
                  <Button onClick={() => setSettling(true)} disabled={busy}>
                    Marcar como saldado
                  </Button>
                  <Button variant="secondary" onClick={() => setConfirmReopen(true)} disabled={busy}>
                    <RotateCcw size={16} /> Reabrir período
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(() => api.post(`/api/settlements/${id}/unsettle`))
                  }
                >
                  <Undo2 size={16} /> Des-saldar
                </Button>
              )}
            </div>
            {s.settled && (
              <p className="mt-2 text-xs text-muted">
                {s.settlement_transaction_id
                  ? "Al des-saldar se borra la transacción de liquidación."
                  : "Se marcó como saldado sin registrar movimiento."}
              </p>
            )}
          </Card>

          <Card>
            <CardTitle>Gastos incluidos ({data.transactions.length})</CardTitle>
            <SharedTxList
              items={data.transactions}
              categories={data.categories}
              partnerName={partnerName}
              myName={data.my_name}
              defaultPct={s.default_my_share_pct}
              currency={currency}
            />
          </Card>
        </div>
      )}

      {data && s && (
        <SettleModal
          open={settling}
          onClose={() => setSettling(false)}
          settlement={s}
          accounts={data.accounts}
          partnerName={partnerName}
          currency={currency}
          onDone={() => {
            setSettling(false);
            refresh();
          }}
        />
      )}

      <Modal open={confirmReopen} onClose={() => setConfirmReopen(false)} title="Reabrir período">
        <p className="text-sm text-muted">
          Se borra este cierre y sus gastos vuelven al período abierto. No se borra ninguna transacción.
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmReopen(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant="danger"
            className="flex-1"
            disabled={busy}
            onClick={() =>
              void run(
                () => api.delete(`/api/settlements/${id}`),
                () => router.push("/pareja"),
              )
            }
          >
            Reabrir
          </Button>
        </div>
      </Modal>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}
