"use client";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui";
import { Button } from "@/components/ui";
import { Field, Input, Select, Toggle } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { notifyDataChanged } from "@/lib/hooks";
import type { Budget, Category } from "@/lib/types";

const TOTAL_VALUE = "__total__";

export function BudgetForm({
  open,
  onClose,
  month,
  categories,
  editing,
  presetCategoryId,
}: {
  open: boolean;
  onClose: () => void;
  month: string;
  categories: Category[];
  /** Presupuesto a editar; null/undefined = alta. */
  editing?: Budget | null;
  /** Categoría preseleccionada al crear (desde "Sin presupuesto"). */
  presetCategoryId?: string | null;
}) {
  const [target, setTarget] = useState<string>(TOTAL_VALUE);
  const [amount, setAmount] = useState<string>("");
  const [thresholdPct, setThresholdPct] = useState<string>("80");
  const [recurring, setRecurring] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      setError(null);
      if (editing) {
        setTarget(editing.category_id ?? TOTAL_VALUE);
        setAmount(String(editing.amount));
        setThresholdPct(String(editing.alert_threshold_pct));
        setRecurring(editing.recurring);
      } else {
        setTarget(presetCategoryId ?? TOTAL_VALUE);
        setAmount("");
        setThresholdPct("80");
        setRecurring(true);
      }
    }, 0);
    return () => clearTimeout(t);
  }, [open, editing, presetCategoryId]);

  async function save() {
    setError(null);
    const amountNum = Number(amount);
    if (!amountNum || amountNum <= 0) {
      setError("Ingresá un monto válido");
      return;
    }
    const category_id = target === TOTAL_VALUE ? null : target;
    setSaving(true);
    try {
      if (editing) {
        await api.put(`/api/budgets/${editing.id}`, {
          amount: amountNum,
          alert_threshold_pct: Number(thresholdPct) || 80,
          recurring,
        });
      } else {
        await api.post("/api/budgets", {
          month,
          category_id,
          amount: amountNum,
          alert_threshold_pct: Number(thresholdPct) || 80,
          recurring,
        });
      }
      notifyDataChanged();
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo guardar el presupuesto");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Editar presupuesto" : "Nuevo presupuesto"}>
      <div className="flex flex-col gap-3">
        <Field label="Categoría">
          <Select value={target} onChange={(e) => setTarget(e.target.value)} disabled={Boolean(editing)}>
            <option value={TOTAL_VALUE}>Total del mes</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.parent_id ? `↳ ${c.name}` : c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Monto mensual">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            autoFocus
          />
        </Field>
        <Field label="Avisar al llegar a (%)" hint="Se muestra un aviso al superar este porcentaje del presupuesto">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={thresholdPct}
            onChange={(e) => setThresholdPct(e.target.value)}
          />
        </Field>
        <Toggle checked={recurring} onChange={setRecurring} label="Repetir todos los meses" />
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="mt-2 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} type="button">
            Cancelar
          </Button>
          <Button className="flex-1" onClick={save} disabled={saving} type="button">
            {saving ? "Guardando…" : "Guardar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
