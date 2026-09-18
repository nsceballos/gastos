"use client";
import { useState } from "react";
import { CheckCircle2, Sparkles } from "lucide-react";
import { Badge, Button, Card, CardTitle, Input, MonthPicker, shiftMonth, currentMonth } from "@/components/ui";
import { api, ApiError } from "@/lib/api-client";
import { notifyDataChanged } from "@/lib/hooks";
import { formatMonth } from "@/lib/format";

interface SuggestionItem {
  category_id: string | null;
  category_name: string;
  amount: number;
  reason: string;
}
interface SuggestionResponse {
  source: "ai" | "heuristic";
  month: string;
  total: number;
  items: SuggestionItem[];
  summary: string;
}

/**
 * "Sugerir presupuesto con IA": pide una sugerencia para un mes, permite
 * editar los montos propuestos y aplicarlos como presupuestos reales.
 */
export function BudgetSuggestion({ initialMonth }: { initialMonth?: string } = {}) {
  const [month, setMonth] = useState(initialMonth ?? shiftMonth(currentMonth(), 1));
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState<SuggestionResponse | null>(null);
  const [items, setItems] = useState<SuggestionItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  async function fetchSuggestion() {
    setLoading(true);
    setError(null);
    setApplied(false);
    try {
      const res = await api.post<SuggestionResponse>(`/api/ai/suggest-budget?month=${month}`);
      setSuggestion(res);
      setItems(res.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo obtener la sugerencia.");
    } finally {
      setLoading(false);
    }
  }

  function updateAmount(idx: number, amount: number) {
    setItems((cur) => cur.map((it, i) => (i === idx ? { ...it, amount } : it)));
  }

  async function apply() {
    setApplying(true);
    setError(null);
    try {
      await api.post("/api/ai/apply-budget", {
        month,
        items: items.map((it) => ({ category_id: it.category_id, amount: it.amount })),
      });
      setApplied(true);
      notifyDataChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo aplicar el presupuesto.");
    } finally {
      setApplying(false);
    }
  }

  const total = items.reduce((a, b) => a + (Number(b.amount) || 0), 0);

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <CardTitle className="mb-0">Sugerencia de presupuesto</CardTitle>
        {suggestion && (
          <Badge color={suggestion.source === "ai" ? "#4f46e5" : "#d97706"}>
            {suggestion.source === "ai" ? "IA" : "Estimación local"}
          </Badge>
        )}
      </div>

      <MonthPicker value={month} onChange={(m) => { setMonth(m); setSuggestion(null); setApplied(false); }} />

      {!suggestion && (
        <Button onClick={() => void fetchSuggestion()} disabled={loading}>
          <Sparkles size={16} /> {loading ? "Pensando…" : "Sugerir presupuesto con IA"}
        </Button>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}

      {suggestion && (
        <>
          {suggestion.summary && <p className="text-sm text-muted">{suggestion.summary}</p>}
          <div className="flex flex-col divide-y divide-border">
            {items.map((it, idx) => (
              <div key={`${it.category_id ?? "total"}-${idx}`} className="flex items-center justify-between gap-3 py-2">
                <span className="flex-1 text-sm">{it.category_name}</span>
                <Input
                  type="number"
                  inputMode="decimal"
                  className="h-9 w-28 text-right"
                  value={it.amount}
                  onChange={(e) => updateAmount(idx, Number(e.target.value))}
                />
              </div>
            ))}
            {items.length === 0 && <p className="py-2 text-sm text-muted">Sin categorías con historial de gasto.</p>}
          </div>
          <div className="flex items-center justify-between border-t border-border pt-2 text-sm font-semibold">
            <span>Total</span>
            <span>{total.toLocaleString("es-AR")}</span>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => void fetchSuggestion()} disabled={loading}>
              Volver a sugerir
            </Button>
            <Button onClick={() => void apply()} disabled={applying || items.length === 0} className="flex-1">
              {applied ? (
                <>
                  <CheckCircle2 size={16} /> Aplicado
                </>
              ) : (
                `Aplicar al mes ${formatMonth(month)}`
              )}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
