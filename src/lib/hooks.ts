"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "./api-client";

/**
 * Hook simple de fetch con revalidación manual.
 *   const { data, loading, error, reload } = useApi<Transaction[]>("/api/transactions?month=2026-09");
 * `url = null` desactiva el fetch.
 */
export function useApi<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(url));
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!url) return;
    const my = ++seq.current;
    await Promise.resolve(); // evita setState síncrono dentro del effect
    if (my !== seq.current) return;
    setLoading(true);
    try {
      const d = await api.get<T>(url);
      if (my === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (my === seq.current) setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      if (my === seq.current) setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    // La carga inicial se dispara fuera del cuerpo síncrono del effect.
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [reload]);

  return { data, loading, error, reload, setData };
}

/** Evento global para que cualquier pantalla se refresque tras una mutación. */
const EVENT = "gastos:data-changed";
export function notifyDataChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}
export function useDataChanged(cb: () => void): void {
  useEffect(() => {
    window.addEventListener(EVENT, cb);
    return () => window.removeEventListener(EVENT, cb);
  }, [cb]);
}
