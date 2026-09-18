"use client";
import { useState } from "react";
import { Database, RefreshCw } from "lucide-react";
import { PageHeader, Card, CardTitle, Button } from "@/components/ui";
import { SettingsForm } from "@/components/settings/SettingsForm";
import { api, ApiError } from "@/lib/api-client";
import { useApi } from "@/lib/hooks";

interface AiStatus {
  data_driver: string;
}
interface SetupResult {
  ok: boolean;
  seeded: { categories: number; accounts: number };
}

const DRIVER_LABEL: Record<string, string> = {
  sheets: "Google Sheets",
  file: "Archivo local (.data/db.json)",
  memory: "Memoria (solo tests)",
};

function DataSection() {
  const { data: status } = useApi<AiStatus>("/api/ai/status");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runSetup() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post<SetupResult>("/api/setup");
      setResult(
        `Listo. Categorías creadas: ${res.seeded.categories}. Cuentas creadas: ${res.seeded.accounts}.`,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo inicializar la base.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3">
      <CardTitle className="mb-0">Datos</CardTitle>
      {status && (
        <p className="text-sm text-muted">
          Base de datos activa: <span className="font-medium text-foreground">{DRIVER_LABEL[status.data_driver] ?? status.data_driver}</span>
        </p>
      )}
      <Button variant="secondary" onClick={() => void runSetup()} disabled={running}>
        <Database size={16} />
        {running ? "Inicializando…" : "Inicializar / reparar base (Google Sheet)"}
      </Button>
      {result && <p className="text-sm text-success">{result}</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
    </Card>
  );
}

export default function AjustesPage() {
  return (
    <>
      <PageHeader
        title="Ajustes"
        right={
          <Button variant="ghost" size="sm" onClick={() => window.location.reload()} aria-label="Recargar">
            <RefreshCw size={16} />
          </Button>
        }
      />
      <div className="flex flex-col gap-4">
        <SettingsForm />
        <DataSection />
      </div>
    </>
  );
}
