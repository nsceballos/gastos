"use client";
import { useState } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { notifyDataChanged } from "@/lib/hooks";
import { cn } from "@/lib/cn";
import type { Account, AccountType } from "@/lib/types";
import { DynIcon, ICON_NAMES } from "@/components/categories/icons";

const TYPE_LABELS: { value: AccountType; label: string }[] = [
  { value: "cash", label: "Efectivo" },
  { value: "bank", label: "Banco" },
  { value: "credit_card", label: "Tarjeta de crédito" },
  { value: "wallet", label: "Billetera virtual" },
];

export const COLORS = [
  "#4f46e5", "#0ea5e9", "#14b8a6", "#22c55e", "#84cc16", "#eab308",
  "#f97316", "#ef4444", "#ec4899", "#a855f7", "#64748b", "#111827",
];

/** Alta / edición de una cuenta. Los campos de tarjeta solo aparecen si type = credit_card. */
export function AccountForm({ account, onDone }: { account?: Account | null; onDone: () => void }) {
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "bank");
  const [initial, setInitial] = useState(String(account?.initial_balance ?? 0));
  const [closingDay, setClosingDay] = useState(account?.closing_day ? String(account.closing_day) : "");
  const [dueDay, setDueDay] = useState(account?.due_day ? String(account.due_day) : "");
  const [limit, setLimit] = useState(account?.credit_limit !== null && account?.credit_limit !== undefined ? String(account.credit_limit) : "");
  const [color, setColor] = useState(account?.color ?? COLORS[0]);
  const [icon, setIcon] = useState(account?.icon ?? "wallet");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCard = type === "credit_card";

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Poné un nombre");
      return;
    }
    const body = {
      name: name.trim(),
      type,
      initial_balance: Number(initial.replace(",", ".")) || 0,
      closing_day: isCard && closingDay ? Number(closingDay) : null,
      due_day: isCard && dueDay ? Number(dueDay) : null,
      credit_limit: isCard && limit ? Number(limit.replace(",", ".")) : null,
      color,
      icon,
    };
    setSaving(true);
    try {
      if (account) await api.put(`/api/accounts/${account.id}`, body);
      else await api.post("/api/accounts", body);
      notifyDataChanged();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function archive() {
    if (!account) return;
    setSaving(true);
    try {
      await api.delete(`/api/accounts/${account.id}`);
      notifyDataChanged();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo borrar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Field label="Nombre">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Galicia, Visa, Efectivo" />
      </Field>

      <Field label="Tipo">
        <Select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
          {TYPE_LABELS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label={isCard ? "Deuda inicial (negativa)" : "Saldo inicial"}
        hint={isCard ? "Si ya venís con deuda, ponela en negativo." : undefined}
      >
        <Input inputMode="decimal" value={initial} onChange={(e) => setInitial(e.target.value)} />
      </Field>

      {isCard && (
        <div className="grid grid-cols-2 gap-3 rounded-2xl bg-surface-2 p-3">
          <Field label="Día de cierre" hint="Vacío = último día del mes">
            <Input type="number" min={1} max={31} value={closingDay} onChange={(e) => setClosingDay(e.target.value)} placeholder="20" />
          </Field>
          <Field label="Día de vencimiento" hint="Vacío = día 10">
            <Input type="number" min={1} max={31} value={dueDay} onChange={(e) => setDueDay(e.target.value)} placeholder="10" />
          </Field>
          <div className="col-span-2">
            <Field label="Límite de crédito" hint="Opcional">
              <Input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="Sin límite" />
            </Field>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Color</span>
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Color ${c}`}
              onClick={() => setColor(c)}
              className={cn("h-8 w-8 rounded-full", color === c && "ring-2 ring-foreground ring-offset-2 ring-offset-surface")}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-muted">Ícono</span>
        <div className="grid max-h-36 grid-cols-8 gap-2 overflow-y-auto">
          {ICON_NAMES.map((n) => (
            <button
              key={n}
              type="button"
              aria-label={n}
              onClick={() => setIcon(n)}
              className={cn(
                "flex h-9 items-center justify-center rounded-lg",
                icon === n ? "bg-primary text-white" : "bg-surface-2 text-muted",
              )}
            >
              <DynIcon icon={n} size={18} />
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        {account && (
          <Button variant="ghost" className="text-danger" disabled={saving} onClick={archive}>
            Borrar
          </Button>
        )}
        <Button className="flex-1" size="lg" disabled={saving} onClick={submit}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
