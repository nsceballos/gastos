"use client";
import { useState } from "react";
import { Button, Field, Modal, Textarea } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { notifyDataChanged } from "@/lib/hooks";
import { formatDate, formatMoney } from "@/lib/format";
import type { SharedSummary } from "@/lib/domain/shared";
import type { Settlement } from "@/lib/types";
import { BalanceLine } from "./BalanceLine";

/** Confirmación del cierre de período: resumen + nota. */
export function CloseModal({
  open,
  onClose,
  summary,
  periodEnd,
  onClosed,
}: {
  open: boolean;
  onClose: () => void;
  summary: SharedSummary;
  periodEnd: string;
  onClosed: (s: Settlement) => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { totals, partner_name, my_name, currency } = summary;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const s = await api.post<Settlement>("/api/settlements", { period_end: periodEnd, note });
      notifyDataChanged();
      setNote("");
      onClosed(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Cerrar período y liquidar">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Del {formatDate(summary.period_start, { day: "2-digit", month: "2-digit", year: "numeric" })} al{" "}
          {formatDate(periodEnd, { day: "2-digit", month: "2-digit", year: "numeric" })} ·{" "}
          {summary.transactions.length} gasto{summary.transactions.length === 1 ? "" : "s"}
        </p>

        <div className="rounded-2xl bg-surface-2 p-3">
          <Row label="Total compartido" value={formatMoney(totals.total_shared, currency)} />
          <Row label={`Puso ${my_name}`} value={formatMoney(totals.paid_by_me, currency)} />
          <Row label={`Puso ${partner_name}`} value={formatMoney(totals.paid_by_partner, currency)} />
          <Row label="Tu parte" value={formatMoney(totals.my_share, currency)} />
          <Row label={`Parte de ${partner_name}`} value={formatMoney(totals.partner_share, currency)} />
          <div className="mt-3 border-t border-border pt-3">
            <BalanceLine balance={totals.balance} partnerName={partner_name} currency={currency} size="sm" />
          </div>
        </div>

        {summary.late_count > 0 && (
          <p className="rounded-xl bg-warning/10 p-3 text-xs text-warning">
            Se incluyen {summary.late_count} gasto{summary.late_count === 1 ? "" : "s"} con fecha anterior al período
            (cargados tarde).
          </p>
        )}

        <Field label="Nota (opcional)">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ej: vacaciones + supermercado" />
        </Field>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button className="flex-1" onClick={() => void submit()} disabled={busy}>
            {busy ? "Cerrando…" : "Cerrar período"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
