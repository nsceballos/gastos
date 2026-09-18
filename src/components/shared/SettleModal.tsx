"use client";
import { useState } from "react";
import { Button, Field, Input, Modal, Select, Toggle } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { notifyDataChanged } from "@/lib/hooks";
import { todayISO } from "@/lib/domain/core";
import type { AccountOption } from "@/lib/domain/shared";
import type { Settlement } from "@/lib/types";
import { BalanceLine } from "./BalanceLine";

/**
 * Marca una liquidación como saldada. Salvo que se active "solo marcar",
 * registra el movimiento real de dinero (income si me deben, expense si le debo).
 */
export function SettleModal({
  open,
  onClose,
  settlement,
  accounts,
  partnerName,
  currency,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  settlement: Settlement;
  accounts: AccountOption[];
  partnerName: string;
  currency: string;
  onDone: () => void;
}) {
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [transferOnly, setTransferOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const even = Math.abs(settlement.balance) < 0.005;
  const needsAccount = !even && !transferOnly;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/settlements/${settlement.id}/settle`, {
        date,
        account_id: needsAccount ? accountId : null,
        transfer_only: transferOnly || even,
      });
      notifyDataChanged();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Marcar como saldado">
      <div className="flex flex-col gap-4">
        <div className="rounded-2xl bg-surface-2 p-3">
          <BalanceLine balance={settlement.balance} partnerName={partnerName} currency={currency} size="sm" />
        </div>

        <Field label="Fecha del pago">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>

        {!even && (
          <>
            <Toggle
              checked={transferOnly}
              onChange={setTransferOnly}
              label="Solo marcar, no registrar movimiento"
            />
            {needsAccount && (
              <Field
                label={settlement.balance > 0 ? "Cuenta donde entra la plata" : "Cuenta de donde sale la plata"}
                hint={
                  settlement.balance > 0
                    ? "Se registra un ingreso por el saldo a favor."
                    : "Se registra un gasto por lo que le pagás."
                }
              >
                <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.length === 0 && <option value="">Sin cuentas disponibles</option>}
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
          </>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={busy}>
            Después
          </Button>
          <Button
            className="flex-1"
            onClick={() => void submit()}
            disabled={busy || (needsAccount && !accountId)}
          >
            {busy ? "Guardando…" : "Saldar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
