"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Bot, RotateCcw, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, Card, Spinner, currentMonth } from "@/components/ui";
import { useApi } from "@/lib/hooks";
import { SUGGESTED_QUESTIONS } from "@/lib/ai/prompts";
import { renderMarkdownLite } from "./markdownLite";

type Role = "user" | "assistant";
interface ChatMsg {
  role: Role;
  content: string;
}

const STORAGE_KEY = "gastos:asesor:history";
const MAX_HISTORY_SENT = 30;

function loadHistory(): ChatMsg[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m): m is ChatMsg => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string",
    );
  } catch {
    return [];
  }
}

function saveHistory(messages: ChatMsg[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
  } catch {
    // localStorage no disponible (modo privado, cuota, etc): se ignora.
  }
}

interface AiStatus {
  configured: boolean;
  model: string;
}

export function Chat() {
  const { data: status } = useApi<AiStatus>("/api/ai/status");
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Carga única desde localStorage: no puede leerse durante el render (SSR/hidratación),
    // así que se hace una sola vez al montar en el cliente.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMessages(loadHistory());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) saveHistory(messages);
  }, [messages, hydrated]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  async function send(text: string) {
    const content = text.trim();
    if (!content || sending) return;
    setError(null);
    const next: ChatMsg[] = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.slice(-MAX_HISTORY_SENT).map((m) => ({ role: m.role, content: m.content })),
          month: currentMonth(),
        }),
      });

      if (!res.ok || !res.body) {
        let msg = `Error ${res.status}`;
        try {
          const json = await res.json();
          if (json?.error) msg = json.error;
        } catch {
          // sin body JSON
        }
        setError(msg);
        setSending(false);
        return;
      }

      setMessages((cur) => [...cur, { role: "assistant", content: "" }]);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) continue;
        setMessages((cur) => {
          const copy = [...cur];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") copy[copy.length - 1] = { ...last, content: last.content + chunk };
          return copy;
        });
      }
    } catch {
      setError("No se pudo conectar con el asesor IA. Probá de nuevo en un momento.");
    } finally {
      setSending(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function newConversation() {
    setMessages([]);
    setError(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignorar
    }
  }

  const notConfigured = status && !status.configured;

  return (
    <div className="flex flex-col gap-3 pb-32">
      {notConfigured && (
        <Card className="flex items-start gap-2 border-warning/40 bg-warning/10 text-sm">
          <TriangleAlert size={18} className="mt-0.5 shrink-0 text-warning" />
          <div>
            <p className="font-medium">El asesor IA no está configurado</p>
            <p className="text-muted">
              Definí la variable de entorno <code className="rounded bg-surface-3 px-1">OPENROUTER_API_KEY</code> (conseguila
              gratis en openrouter.ai) para poder chatear.
            </p>
          </div>
        </Card>
      )}

      {messages.length > 0 && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={newConversation}>
            <RotateCcw size={14} /> Nueva conversación
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {messages.length === 0 && (
          <Card className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted">
            <Bot size={28} className="text-primary" />
            <p>Preguntame lo que quieras sobre tus finanzas: gastos, presupuesto, tarjeta o tu pareja.</p>
          </Card>
        )}
        {messages.map((m, idx) => (
          <div key={idx} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            <div
              className={cn(
                "max-w-[85%] rounded-2xl px-3.5 py-2.5",
                m.role === "user" ? "bg-primary text-white" : "bg-surface-2 text-foreground",
              )}
            >
              {m.role === "assistant" && m.content === "" && sending && idx === messages.length - 1 ? (
                <span className="flex items-center gap-1 text-sm text-muted">
                  <Spinner className="py-0" />
                  pensando…
                </span>
              ) : m.role === "assistant" ? (
                renderMarkdownLite(m.content)
              ) : (
                <p className="whitespace-pre-wrap text-sm">{m.content}</p>
              )}
            </div>
          </div>
        ))}
        {error && (
          <Card className="border-danger/40 bg-danger/10 text-sm text-danger">{error}</Card>
        )}
        <div ref={scrollRef} />
      </div>

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_QUESTIONS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => void send(q)}
              className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-2"
            >
              {q}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={onSubmit}
        className="fixed inset-x-0 z-20 mx-auto flex w-full max-w-lg items-end gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur"
        style={{ bottom: "calc(4rem + env(safe-area-inset-bottom))" }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder="Escribí tu consulta…"
          rows={1}
          className="min-h-11 flex-1 resize-none rounded-xl border border-border bg-surface px-3 py-2.5 text-base focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <Button type="submit" size="md" disabled={sending || !input.trim()} aria-label="Enviar">
          <ArrowUp size={18} />
        </Button>
      </form>
    </div>
  );
}
