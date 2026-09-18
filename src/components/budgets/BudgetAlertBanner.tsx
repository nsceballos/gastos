"use client";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AlertTriangle, X } from "lucide-react";
import Link from "next/link";
import { currentMonth } from "@/components/ui";
import { useDataChanged } from "@/lib/hooks";
import type { BudgetAlert } from "@/lib/domain/budgets";

const DISMISS_KEY_PREFIX = "gastos:budget-alerts-dismissed:";

function hashAlerts(list: BudgetAlert[]): string {
  const s = list.map((a) => `${a.level}:${a.message}`).join("|");
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return String(h);
}

function readDismissed(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeDismissed(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* noop: modo privado o storage bloqueado */
  }
}

/**
 * Banner sticky con la alerta de presupuesto más severa del mes actual.
 * Tolerante a errores: si la API falla o no hay alertas, no renderiza nada.
 */
export function BudgetAlertBanner() {
  const pathname = usePathname();
  const [alertsList, setAlertsList] = useState<BudgetAlert[]>([]);
  const [dismissed, setDismissed] = useState(false);

  const load = useCallback(async () => {
    try {
      const month = currentMonth();
      const res = await fetch(`/api/budgets/alerts?month=${month}`, { cache: "no-store" });
      if (!res.ok) {
        setAlertsList([]);
        return;
      }
      const data = (await res.json()) as { alerts?: BudgetAlert[] };
      const list = Array.isArray(data.alerts) ? data.alerts : [];
      setAlertsList(list);
      const key = `${DISMISS_KEY_PREFIX}${month}`;
      setDismissed(readDismissed(key) === hashAlerts(list));
    } catch {
      setAlertsList([]);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);
  useDataChanged(load);

  if (pathname?.startsWith("/login")) return null;
  if (dismissed || alertsList.length === 0) return null;

  const worst = alertsList[0];
  const extra = alertsList.length - 1;
  const isExceeded = worst.level === "exceeded";

  function close() {
    try {
      const key = `${DISMISS_KEY_PREFIX}${currentMonth()}`;
      writeDismissed(key, hashAlerts(alertsList));
    } catch {
      /* noop */
    }
    setDismissed(true);
  }

  const tint = isExceeded ? "var(--danger)" : "var(--warning)";

  return (
    <div
      className="sticky top-0 z-40 -mx-4 mb-3 flex items-start gap-2 border-b px-4 py-2.5 text-sm text-foreground"
      style={{ backgroundColor: `color-mix(in srgb, ${tint} 16%, var(--surface))`, borderColor: tint }}
      role="alert"
    >
      <AlertTriangle size={18} className="mt-0.5 shrink-0" style={{ color: tint }} />
      <Link href="/presupuesto" className="min-w-0 flex-1 leading-snug">
        <span className="font-medium">{worst.message}</span>
        {extra > 0 && <span className="text-muted"> +{extra} más</span>}
      </Link>
      <button
        type="button"
        onClick={close}
        aria-label="Cerrar aviso"
        className="shrink-0 rounded-full p-1 hover:bg-surface-3"
      >
        <X size={16} />
      </button>
    </div>
  );
}
