"use client";
import { useState } from "react";
import { Save } from "lucide-react";
import { Button, Card, CardTitle, Field, Input, Select, Spinner, Toggle } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { notifyDataChanged, useApi } from "@/lib/hooks";
import type { AppSettings } from "@/lib/types";

const CURRENCIES = ["ARS", "USD", "EUR"] as const;

/** Modelos gratuitos de OpenRouter sugeridos (ver https://openrouter.ai/models?q=free). */
const AI_MODELS = [
  { value: "deepseek/deepseek-v4-flash-0731:free", label: "DeepSeek v4 Flash (default)" },
  { value: "openrouter/free", label: "OpenRouter Auto (free)" },
  { value: "nvidia/nemotron-3-super-120b-a12b:free", label: "Nvidia Nemotron 3 Super 120B" },
  { value: "google/gemma-4-31b-it:free", label: "Google Gemma 4 31B" },
  { value: "qwen/qwen3.8-27b:free", label: "Qwen 3.8 27B" },
];

export function SettingsForm() {
  const { data, loading, reload } = useApi<AppSettings>("/api/settings");
  if (loading || !data) {
    return (
      <Card>
        <Spinner />
      </Card>
    );
  }
  // `key` fuerza a remontar (y re-derivar el estado local desde `data`) cuando cambia el
  // contenido real de settings (p.ej. tras guardar y recargar), sin necesitar un efecto
  // para sincronizar props -> estado.
  return <SettingsFormFields key={JSON.stringify(data)} data={data} reload={reload} />;
}

function SettingsFormFields({ data, reload }: { data: AppSettings; reload: () => Promise<void> }) {
  const [form, setForm] = useState<AppSettings>(data);
  const [currencyMode, setCurrencyMode] = useState<"known" | "other">(() =>
    (CURRENCIES as readonly string[]).includes(data.currency) ? "known" : "other",
  );
  const [modelMode, setModelMode] = useState<"known" | "other">(() =>
    AI_MODELS.some((m) => m.value === data.ai_model) ? "known" : "other",
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setForm((cur) => (cur ? { ...cur, [key]: value } : cur));
    setSaved(false);
  }

  async function save() {
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      await api.put("/api/settings", form);
      setSaved(true);
      notifyDataChanged();
      void reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  const myPct = form.default_my_share_pct;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-4">
        <CardTitle className="mb-0">Nombres</CardTitle>
        <Field label="Mi nombre">
          <Input value={form.my_name} onChange={(e) => set("my_name", e.target.value)} maxLength={40} />
        </Field>
        <Field label="Nombre de mi pareja">
          <Input value={form.partner_name} onChange={(e) => set("partner_name", e.target.value)} maxLength={40} />
        </Field>
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle className="mb-0">Gastos compartidos</CardTitle>
        <Field label={`Mi porcentaje por defecto — ${form.my_name} ${myPct}% / ${form.partner_name} ${100 - myPct}%`}>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={myPct}
            onChange={(e) => set("default_my_share_pct", Number(e.target.value))}
            className="w-full accent-primary"
          />
        </Field>
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle className="mb-0">General</CardTitle>
        <Field label="Moneda">
          <div className="flex gap-2">
            <Select
              value={currencyMode === "known" ? form.currency : "other"}
              onChange={(e) => {
                if (e.target.value === "other") {
                  setCurrencyMode("other");
                } else {
                  setCurrencyMode("known");
                  set("currency", e.target.value);
                }
              }}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="other">Otra…</option>
            </Select>
            {currencyMode === "other" && (
              <Input
                value={form.currency}
                onChange={(e) => set("currency", e.target.value.toUpperCase().slice(0, 3))}
                placeholder="BRL"
                maxLength={3}
                className="w-24"
              />
            )}
          </div>
        </Field>
        <Field label="Día de inicio del mes contable" hint="1 a 28">
          <Input
            type="number"
            min={1}
            max={28}
            value={form.month_start_day}
            onChange={(e) => set("month_start_day", Math.min(28, Math.max(1, Number(e.target.value) || 1)))}
          />
        </Field>
        <Toggle
          checked={form.budget_counts_pending_card}
          onChange={(v) => set("budget_counts_pending_card", v)}
          label="El presupuesto cuenta consumos de tarjeta por fecha de compra"
        />
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle className="mb-0">Asesor IA</CardTitle>
        <Field label="Modelo de IA (OpenRouter)">
          <div className="flex flex-col gap-2">
            <Select
              value={modelMode === "known" ? form.ai_model : "other"}
              onChange={(e) => {
                if (e.target.value === "other") {
                  setModelMode("other");
                } else {
                  setModelMode("known");
                  set("ai_model", e.target.value);
                }
              }}
            >
              {AI_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
              <option value="other">Otro modelo…</option>
            </Select>
            {modelMode === "other" && (
              <Input
                value={form.ai_model}
                onChange={(e) => set("ai_model", e.target.value)}
                placeholder="proveedor/modelo:free"
              />
            )}
          </div>
        </Field>
      </Card>

      {error && <p className="text-sm text-danger">{error}</p>}

      <Button onClick={() => void save()} disabled={saving} className="w-full">
        <Save size={16} /> {saving ? "Guardando…" : saved ? "Guardado" : "Guardar"}
      </Button>
    </div>
  );
}
