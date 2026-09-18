"use client";
import { useCallback, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Badge, Button, Card, CardTitle, EmptyState, Modal, PageHeader, Segmented, Spinner } from "@/components/ui";
import { useApi, useDataChanged } from "@/lib/hooks";
import type { Category, CategoryType } from "@/lib/types";
import { IconBubble } from "@/components/categories/icons";
import { CategoryForm } from "@/components/categories/CategoryForm";

/** ABM de categorías (las usa el formulario de transacciones). */
export default function CategoriasPage() {
  const { data, loading, error, reload } = useApi<Category[]>("/api/categories");
  const [type, setType] = useState<CategoryType>("expense");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);

  const cb = useCallback(() => void reload(), [reload]);
  useDataChanged(cb);

  const { activas, archivadas } = useMemo(() => {
    const list = (data ?? []).filter((c) => c.type === type);
    return {
      activas: list.filter((c) => !c.archived),
      archivadas: list.filter((c) => c.archived),
    };
  }, [data, type]);

  function openForm(category: Category | null) {
    setEditing(category);
    setOpen(true);
  }

  return (
    <>
      <PageHeader
        title="Categorías"
        right={
          <Button size="sm" onClick={() => openForm(null)}>
            <Plus size={16} /> Nueva
          </Button>
        }
      >
        <div className="mt-2">
          <Segmented<CategoryType>
            value={type}
            onChange={setType}
            options={[
              { value: "expense", label: "Gastos" },
              { value: "income", label: "Ingresos" },
            ]}
          />
        </div>
      </PageHeader>

      {error && <p className="mb-3 text-sm text-danger">{error}</p>}
      {loading && !data && <Spinner />}

      {!loading && !activas.length && !archivadas.length && (
        <EmptyState title="Sin categorías" hint="Creá la primera con el botón de arriba." />
      )}

      {Boolean(activas.length) && (
        <Card className="mb-4">
          <div className="grid grid-cols-1 divide-y divide-border/60">
            {activas.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => openForm(c)}
                className="flex items-center gap-3 rounded-xl px-1 py-2 text-left transition-colors hover:bg-surface-2"
              >
                <IconBubble icon={c.icon} color={c.color} />
                <span className="flex-1 truncate text-sm font-medium">{c.name}</span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {Boolean(archivadas.length) && (
        <Card>
          <CardTitle>Archivadas</CardTitle>
          <div className="grid grid-cols-1 divide-y divide-border/60">
            {archivadas.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => openForm(c)}
                className="flex items-center gap-3 rounded-xl px-1 py-2 text-left opacity-60 transition-colors hover:bg-surface-2"
              >
                <IconBubble icon={c.icon} color={c.color} />
                <span className="flex-1 truncate text-sm font-medium">{c.name}</span>
                <Badge className="bg-surface-3 text-muted">Archivada</Badge>
              </button>
            ))}
          </div>
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? "Editar categoría" : "Nueva categoría"}>
        <CategoryForm
          key={editing?.id ?? `new-${type}`}
          category={editing}
          defaultType={type}
          onDone={() => setOpen(false)}
        />
      </Modal>
    </>
  );
}
