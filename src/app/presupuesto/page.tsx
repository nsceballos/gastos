"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Info, Pencil, Plus, Trash2 } from "lucide-react";
import {
  PageHeader,
  MonthPicker,
  currentMonth,
  Card,
  CardTitle,
  Button,
  Spinner,
  EmptyState,
  ProgressBar,
  Badge,
} from "@/components/ui";
import { useApi, useDataChanged, notifyDataChanged } from "@/lib/hooks";
import { api, ApiError } from "@/lib/api-client";
import { formatMoney } from "@/lib/format";
import type { AppSettings, Budget, Category } from "@/lib/types";
import type { BudgetStatus } from "@/lib/domain/budgets";
import type { CategoryAmount } from "@/lib/domain/stats";
import { BudgetForm } from "@/components/budgets/BudgetForm";

interface BudgetsResponse {
  budgets: Budget[];
  status: BudgetStatus[];
  alerts: { level: string; message: string }[];
  month: string;
  range: { start: string; end: string };
}

interface StatsResponse {
  by_category: CategoryAmount[];
}

const LEVEL_COLOR: Record<string, string> = {
  ok: "var(--success)",
  warning: "var(--warning)",
  exceeded: "var(--danger)",
};

export default function PresupuestoPage() {
  const [month, setMonth] = useState(currentMonth());
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [presetCategoryId, setPresetCategoryId] = useState<string | null>(null);

  const budgetsApi = useApi<BudgetsResponse>(`/api/budgets?month=${month}`);
  const statsApi = useApi<StatsResponse>(`/api/stats?month=${month}`);
  const categoriesApi = useApi<Category[]>("/api/categories");
  const settingsApi = useApi<AppSettings>("/api/settings");

  useDataChanged(() => {
    void budgetsApi.reload();
    void statsApi.reload();
  });

  const currency = settingsApi.data?.currency ?? "ARS";
  const status = budgetsApi.data?.status ?? [];
  const totalStatus = status.find((s) => s.budget.category_id === null) ?? null;
  const categoryStatuses = status.filter((s) => s.budget.category_id !== null);
  const expenseCategories = useMemo(
    () => (categoriesApi.data ?? []).filter((c) => c.type === "expense" && !c.archived).sort((a, b) => a.sort_order - b.sort_order),
    [categoriesApi.data],
  );

  const budgetedCategoryIds = useMemo(() => {
    const ids = new Set<string>();
    for (const s of categoryStatuses) {
      if (s.budget.category_id) ids.add(s.budget.category_id);
    }
    // Las subcategorías de una categoría presupuestada ya están cubiertas.
    for (const c of categoriesApi.data ?? []) {
      if (c.parent_id && ids.has(c.parent_id)) ids.add(c.id);
    }
    return ids;
  }, [categoryStatuses, categoriesApi.data]);

  const unbudgeted = (statsApi.data?.by_category ?? []).filter(
    (c) => c.category && c.amount > 0 && !budgetedCategoryIds.has(c.category.id),
  );

  function openCreate(categoryId: string | null = null) {
    setEditing(null);
    setPresetCategoryId(categoryId);
    setFormOpen(true);
  }
  function openEdit(s: BudgetStatus) {
    setEditing(s.budget);
    setPresetCategoryId(null);
    setFormOpen(true);
  }
  async function remove(id: string) {
    if (!window.confirm("¿Borrar este presupuesto?")) return;
    try {
      await api.delete(`/api/budgets/${id}`);
      notifyDataChanged();
    } catch (e) {
      window.alert(e instanceof ApiError ? e.message : "No se pudo borrar");
    }
  }

  const loading = budgetsApi.loading && !budgetsApi.data;

  return (
    <>
      <PageHeader title="Presupuesto">
        <MonthPicker value={month} onChange={setMonth} />
      </PageHeader>

      {loading && <Spinner />}
      {budgetsApi.error && <p className="text-sm text-danger">{budgetsApi.error}</p>}

      {!loading && (
        <div className="flex flex-col gap-4">
          {totalStatus ? (
            <Card>
              <div className="flex items-center justify-between">
                <CardTitle className="mb-0">Total del mes</CardTitle>
                <button onClick={() => openEdit(totalStatus)} className="rounded-full p-1.5 text-muted hover:bg-surface-2" aria-label="Editar">
                  <Pencil size={16} />
                </button>
              </div>
              <p className="mt-1 text-2xl font-bold">{formatMoney(totalStatus.spent, currency)}</p>
              <p className="text-sm text-muted">de {formatMoney(totalStatus.limit, currency)}</p>
              <ProgressBar value={totalStatus.pct} color={LEVEL_COLOR[totalStatus.level]} className="my-3" />
              <div className="flex justify-between text-sm">
                <span className={totalStatus.remaining < 0 ? "text-danger" : "text-foreground"}>
                  {totalStatus.remaining < 0
                    ? `Superado por ${formatMoney(-totalStatus.remaining, currency)}`
                    : `Disponible: ${formatMoney(totalStatus.remaining, currency)}`}
                </span>
                {totalStatus.days_left > 0 && (
                  <span className="text-muted">
                    Te quedan {formatMoney(Math.max(0, totalStatus.daily_allowance), currency)}/día
                  </span>
                )}
              </div>
              {totalStatus.level !== "exceeded" && totalStatus.level_projected !== "ok" && (
                <p className="mt-2 text-xs text-warning">
                  A este ritmo vas a {totalStatus.level_projected === "exceeded" ? "superar" : "acercarte a"} el presupuesto (
                  proyectado {formatMoney(totalStatus.projected, currency)}).
                </p>
              )}
            </Card>
          ) : (
            <Card className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted">No configuraste un presupuesto total para este mes.</p>
              <Button size="sm" variant="secondary" onClick={() => openCreate(null)}>
                Crear
              </Button>
            </Card>
          )}

          <Card>
            <div className="flex items-start gap-2 text-sm text-muted">
              <Info size={16} className="mt-0.5 shrink-0" />
              <p>
                {settingsApi.data?.budget_counts_pending_card
                  ? "Se cuentan los gastos por fecha de compra, incluidos los consumos de tarjeta aún no pagados (comprometido)."
                  : "Se cuenta solo el gasto efectivo: cuando la plata realmente sale de la cuenta."}{" "}
                <Link href="/ajustes" className="text-primary underline underline-offset-2">
                  Cambiar en Ajustes
                </Link>
              </p>
            </div>
          </Card>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-muted">Por categoría</h2>
              <Button size="sm" variant="ghost" onClick={() => openCreate(null)} aria-label="Nuevo presupuesto">
                <Plus size={16} /> Nuevo
              </Button>
            </div>
            {categoryStatuses.length === 0 ? (
              <EmptyState title="Sin presupuestos por categoría" hint="Tocá “Nuevo” para crear uno." />
            ) : (
              <div className="flex flex-col gap-2">
                {categoryStatuses
                  .slice()
                  .sort((a, b) => b.pct - a.pct)
                  .map((s) => (
                    <Card key={s.budget.id}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.category?.color }} />
                          <span className="truncate font-medium">{s.category?.name ?? "Categoría"}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button onClick={() => openEdit(s)} className="rounded-full p-1.5 text-muted hover:bg-surface-2" aria-label="Editar">
                            <Pencil size={15} />
                          </button>
                          <button onClick={() => remove(s.budget.id)} className="rounded-full p-1.5 text-muted hover:bg-surface-2" aria-label="Borrar">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                      <ProgressBar value={s.pct} color={LEVEL_COLOR[s.level]} className="my-2" />
                      <div className="flex items-center justify-between text-sm text-muted">
                        <span>
                          {formatMoney(s.spent, currency)} de {formatMoney(s.limit, currency)}
                        </span>
                        <Badge color={LEVEL_COLOR[s.level]}>{Math.round(s.pct)}%</Badge>
                      </div>
                    </Card>
                  ))}
              </div>
            )}
          </div>

          {unbudgeted.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-muted">Sin presupuesto</h2>
              <div className="flex flex-col gap-2">
                {unbudgeted.map((c) => (
                  <Card key={c.category!.id} className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.category!.color }} />
                      <span className="truncate">{c.category!.name}</span>
                      <span className="text-sm text-muted">{formatMoney(c.amount, currency)}</span>
                    </div>
                    <Button size="sm" variant="secondary" onClick={() => openCreate(c.category!.id)}>
                      Crear presupuesto
                    </Button>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Button
        onClick={() => openCreate(null)}
        className="fixed bottom-24 right-4 z-30 h-14 w-14 rounded-full p-0 shadow-lg sm:right-[calc(50%-14rem)]"
        aria-label="Nuevo presupuesto"
      >
        <Plus size={24} />
      </Button>

      <BudgetForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        month={month}
        categories={expenseCategories}
        editing={editing}
        presetCategoryId={presetCategoryId}
      />
    </>
  );
}
