"use client";
import { useState } from "react";
import { Button, Field, Input, Segmented } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { notifyDataChanged } from "@/lib/hooks";
import { cn } from "@/lib/cn";
import type { Category, CategoryType } from "@/lib/types";
import { DynIcon, ICON_NAMES } from "./icons";
import { COLORS } from "@/components/accounts/AccountForm";

/** Alta / edición de una categoría (nombre, tipo, color e ícono). */
export function CategoryForm({
  category,
  defaultType = "expense",
  onDone,
}: {
  category?: Category | null;
  defaultType?: CategoryType;
  onDone: () => void;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [type, setType] = useState<CategoryType>(category?.type ?? defaultType);
  const [color, setColor] = useState(category?.color ?? COLORS[0]);
  const [icon, setIcon] = useState(category?.icon ?? "tag");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!name.trim()) {
      setError("Poné un nombre");
      return;
    }
    setSaving(true);
    try {
      const body = { name: name.trim(), type, color, icon };
      if (category) await api.put(`/api/categories/${category.id}`, body);
      else await api.post("/api/categories", body);
      notifyDataChanged();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo guardar");
    } finally {
      setSaving(false);
    }
  }

  async function toggleArchived() {
    if (!category) return;
    setSaving(true);
    setError(null);
    try {
      if (category.archived) await api.put(`/api/categories/${category.id}`, { archived: false });
      else await api.delete(`/api/categories/${category.id}`);
      notifyDataChanged();
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo archivar");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Segmented<CategoryType>
        value={type}
        onChange={setType}
        options={[
          { value: "expense", label: "Gasto" },
          { value: "income", label: "Ingreso" },
        ]}
      />

      <Field label="Nombre">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Delivery" />
      </Field>

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
        <div className="grid max-h-40 grid-cols-8 gap-2 overflow-y-auto">
          {ICON_NAMES.map((n) => (
            <button
              key={n}
              type="button"
              aria-label={n}
              onClick={() => setIcon(n)}
              className={cn(
                "flex h-9 items-center justify-center rounded-lg",
                icon === n ? "text-white" : "bg-surface-2 text-muted",
              )}
              style={icon === n ? { backgroundColor: color } : undefined}
            >
              <DynIcon icon={n} size={18} />
            </button>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      <div className="flex gap-2">
        {category && (
          <Button variant="ghost" className="text-danger" disabled={saving} onClick={toggleArchived}>
            {category.archived ? "Restaurar" : "Archivar"}
          </Button>
        )}
        <Button className="flex-1" size="lg" disabled={saving} onClick={submit}>
          {saving ? "Guardando…" : "Guardar"}
        </Button>
      </div>
    </div>
  );
}
