"use client";
import { useState } from "react";
import { Button, Field, Input, Modal, Select } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { notifyDataChanged } from "@/lib/hooks";
import { formatDate, formatMoney } from "@/lib/format";
import type { AccountWithBalance } from "@/lib/domain/accounts";

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Pago del resumen: crea el card_payment (cuenta origen -> tarjeta) y postea los consumos.
 */
export function PayStatementModal({
  open,
  onClose,
  statementId,
  cardName,
  total,
  dueDate,
  currency,
  accounts,
}: {
  open: boolean;
  onClose: () => void;
  statementId: string | null;
  cardName: string;
  total: number;
  dueDate?: string;
  currency?: string;
  accounts: AccountWithBalance[];
}) {
  const origenes = accounts.filter((a) => !a.is_partner && a.type !== "credit_card");
  const [fromId, setFromId] = useState("");
  const [amount, setAmount] = useState(String(total));
  const [date, setDate] = useState(todayISO());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!statementId) {
      setError("Este resumen todavía no tiene consumos");
      return;
    }
    const from = fromId || origenes[0]?.id;
    if (!from) {
      setError("Necesitás una cuenta de banco o efectivo para pagar");
      return;
    }
    const value = Number(amount.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      setError("Ingresá un monto mayor a 0");
      return;
    }
    setSaving(true);
    try {
      await api.post(`/api/cards/statements/${statementId}/pay`, {
        from_account_id: from,
        amount: value,
        date,
      });
      notifyDataChanged();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo registrar el pago");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Pagar resumen · ${cardName}`}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Total del resumen: <strong className="text-foreground">{formatMoney(total, currency)}</strong>
          {dueDate && <> · vence el {formatDate(dueDate)}</>}
        </p>

        <Field label="Pagar desde">
          <Select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {origenes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {formatMoney(a.balance, a.currency)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Monto" hint="Si pagás menos, los consumos igual se marcan como pagados.">
          <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>

        <Field label="Fecha de pago">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button size="lg" disabled={saving} onClick={submit}>
          {saving ? "Guardando…" : "Registrar pago"}
        </Button>
      </div>
    </Modal>
  );
}
