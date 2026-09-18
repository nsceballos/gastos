"use client";
import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button, Field, Input, Segmented, Select, Textarea, Toggle } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { notifyDataChanged, useApi } from "@/lib/hooks";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { AppSettings, Category, Transaction, TransactionType } from "@/lib/types";
import type { AccountWithBalance } from "@/lib/domain/accounts";
import type { StatementPeriod } from "@/lib/domain/cards";
import { IconBubble } from "@/components/categories/icons";

type FormType = Extract<TransactionType, "expense" | "income" | "transfer">;

const INSTALLMENT_OPTIONS = [1, 3, 6, 12];

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Alta / edición de una transacción.
 * - Si la cuenta es tarjeta de crédito: selector de cuotas y preview del resumen al que cae.
 * - Sección "Compartido con la pareja": quién pagó y qué % me toca.
 */
export function TransactionForm({
  transaction,
  defaultAccountId,
  onDone,
}: {
  transaction?: Transaction | null;
  defaultAccountId?: string;
  onDone: () => void;
}) {
  const { data: accounts } = useApi<AccountWithBalance[]>("/api/accounts");
  const { data: categories } = useApi<Category[]>("/api/categories");
  const { data: settings } = useApi<AppSettings>("/api/settings");

  const editing = Boolean(transaction);
  const [type, setType] = useState<FormType>(
    transaction && transaction.type !== "card_payment" ? (transaction.type as FormType) : "expense",
  );
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : "");
  const [date, setDate] = useState(transaction?.date ?? todayISO());
  const [accountId, setAccountId] = useState(transaction?.account_id ?? defaultAccountId ?? "");
  const [toAccountId, setToAccountId] = useState(transaction?.to_account_id ?? "");
  const [categoryId, setCategoryId] = useState(transaction?.category_id ?? "");
  const [note, setNote] = useState(transaction?.note ?? "");
  const [installments, setInstallments] = useState(transaction?.installments_total ?? 1);
  const [isShared, setIsShared] = useState(transaction?.is_shared ?? false);
  const [paidBy, setPaidBy] = useState<"me" | "partner">(transaction?.paid_by ?? "me");
  const [sharePct, setSharePct] = useState<string>(
    transaction?.my_share_pct !== null && transaction?.my_share_pct !== undefined
      ? String(transaction.my_share_pct)
      : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visibles = useMemo(() => (accounts ?? []).filter((a) => !a.is_partner), [accounts]);
  const partner = (accounts ?? []).find((a) => a.is_partner) ?? null;

  // Cuenta efectiva: la elegida o, mientras no se elija, la primera disponible.
  const currentAccountId = accountId || visibles[0]?.id || "";
  const account = (accounts ?? []).find((a) => a.id === currentAccountId) ?? null;
  const isCard = account?.type === "credit_card";
  const onCard = isCard && type === "expense" && !(isShared && paidBy === "partner");

  const { data: preview } = useApi<{ is_card: boolean; period: StatementPeriod | null }>(
    onCard && currentAccountId && date ? `/api/cards/preview?account_id=${currentAccountId}&date=${date}` : null,
  );

  const cats = useMemo(
    () =>
      (categories ?? [])
        .filter((c) => !c.archived && c.type === (type === "income" ? "income" : "expense"))
        .sort((a, b) => a.sort_order - b.sort_order),
    [categories, type],
  );

  // La categoría se descarta sola si no corresponde al tipo elegido.
  const currentCategoryId = cats.some((c) => c.id === categoryId) ? categoryId : "";

  const cuotaAmount = Number(amount) > 0 && installments > 1 ? Number(amount) / installments : null;

  async function submit() {
    setError(null);
    const value = Number(amount.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      setError("Ingresá un monto mayor a 0");
      return;
    }
    if (!currentAccountId) {
      setError("Elegí una cuenta");
      return;
    }
    if (type === "transfer" && !toAccountId) {
      setError("Elegí la cuenta de destino");
      return;
    }
    const body = {
      date,
      type,
      amount: value,
      account_id: currentAccountId,
      to_account_id: type === "transfer" ? toAccountId : null,
      category_id: type === "transfer" ? null : currentCategoryId || null,
      note,
      installments_total: onCard && installments > 1 ? installments : null,
      is_shared: type === "expense" ? isShared : false,
      paid_by: type === "expense" && isShared ? paidBy : "me",
      my_share_pct: isShared && sharePct !== "" ? Number(sharePct) : null,
    };
    setSaving(true);
    try {
      if (transaction) await api.put(`/api/transactions/${transaction.id}`, body);
      else await api.post("/api/transactions", body);
      notifyDataChanged();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function remove(group: boolean) {
    if (!transaction) return;
    setSaving(true);
    setError(null);
    try {
      await api.delete(`/api/transactions/${transaction.id}${group ? "?group=1" : ""}`);
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
      <Segmented<FormType>
        value={type}
        onChange={setType}
        options={[
          { value: "expense", label: "Gasto" },
          { value: "income", label: "Ingreso" },
          { value: "transfer", label: "Transferencia" },
        ]}
      />

      <div className="flex flex-col items-center gap-1 py-2">
        <input
          inputMode="decimal"
          autoFocus={!editing}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          aria-label="Monto"
          className={cn(
            "w-full bg-transparent text-center text-4xl font-bold tabular-nums outline-none placeholder:text-surface-3",
            type === "expense" && "text-danger",
            type === "income" && "text-success",
          )}
        />
        {cuotaAmount && (
          <span className="text-xs text-muted">
            {installments} cuotas de {formatMoney(Math.round(cuotaAmount * 100) / 100, account?.currency)}
          </span>
        )}
      </div>

      <Field label="Fecha">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>

      <Field label={type === "income" ? "Cuenta destino" : "Cuenta"}>
        <Select value={currentAccountId} onChange={(e) => setAccountId(e.target.value)}>
          <optgroup label="Cuentas">
            {visibles
              .filter((a) => a.type !== "credit_card")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </optgroup>
          <optgroup label="Tarjetas de crédito">
            {visibles
              .filter((a) => a.type === "credit_card")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </optgroup>
        </Select>
      </Field>

      {type === "transfer" && (
        <Field label="Cuenta destino">
          <Select value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
            <option value="">Elegir…</option>
            {visibles
              .filter((a) => a.id !== currentAccountId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </Select>
        </Field>
      )}

      {onCard && (
        <div className="flex flex-col gap-2 rounded-2xl bg-surface-2 p-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Cuotas</span>
          <div className="flex gap-2">
            {INSTALLMENT_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setInstallments(n)}
                disabled={editing}
                className={cn(
                  "h-9 flex-1 rounded-xl text-sm font-medium transition-colors disabled:opacity-40",
                  installments === n ? "bg-primary text-white" : "bg-surface",
                )}
              >
                {n === 1 ? "1 pago" : `${n}x`}
              </button>
            ))}
            <Input
              type="number"
              min={1}
              max={60}
              disabled={editing}
              value={INSTALLMENT_OPTIONS.includes(installments) ? "" : installments}
              onChange={(e) => setInstallments(Math.max(1, Number(e.target.value) || 1))}
              placeholder="Otro"
              className="h-9 w-20 text-center"
            />
          </div>
          {preview?.period && (
            <p className="text-xs text-muted">
              Entra en el resumen que cierra el {formatDate(preview.period.period_end)} y vence el{" "}
              {formatDate(preview.period.due_date)}. No cuenta como gasto efectivo hasta que lo pagues.
            </p>
          )}
          {editing && <p className="text-xs text-muted">Las cuotas no se pueden cambiar al editar.</p>}
        </div>
      )}

      {type !== "transfer" && (
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-muted">Categoría</span>
          <div className="grid grid-cols-4 gap-2">
            {cats.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoryId(c.id === currentCategoryId ? "" : c.id)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl p-2 text-[11px] leading-tight transition-colors",
                  currentCategoryId === c.id ? "bg-surface-2 ring-2 ring-primary" : "hover:bg-surface-2",
                )}
              >
                <IconBubble icon={c.icon} color={c.color} size={36} />
                <span className="line-clamp-2 text-center">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <Field label="Nota">
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" rows={2} />
      </Field>

      {type === "expense" && (
        <div className="rounded-2xl bg-surface-2 p-3">
          <Toggle checked={isShared} onChange={setIsShared} label="Compartido con la pareja" />
          {isShared && (
            <div className="mt-2 flex flex-col gap-3">
              <Segmented<"me" | "partner">
                value={paidBy}
                onChange={setPaidBy}
                options={[
                  { value: "me", label: `Pagó ${settings?.my_name ?? "yo"}` },
                  { value: "partner", label: `Pagó ${settings?.partner_name ?? "la pareja"}` },
                ]}
              />
              <Field label="Me corresponde (%)" hint={`Por defecto ${settings?.default_my_share_pct ?? 50}%`}>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={sharePct}
                  onChange={(e) => setSharePct(e.target.value)}
                  placeholder={String(settings?.default_my_share_pct ?? 50)}
                />
              </Field>
              {paidBy === "partner" && (
                <p className="text-xs text-muted">
                  Se registra en la cuenta “{partner?.name ?? "Pareja"}”: no afecta tus saldos.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        {transaction && (
          <Button
            variant="ghost"
            className="text-danger"
            disabled={saving}
            onClick={() => remove(Boolean(transaction.installment_group_id))}
            aria-label="Borrar"
          >
            <Trash2 size={18} />
            {transaction.installment_group_id ? "Borrar cuotas" : "Borrar"}
          </Button>
        )}
        <Button className="flex-1" size="lg" disabled={saving} onClick={submit}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
