"use client";
import type { ReactNode } from "react";

/**
 * Render mínimo de markdown (sin dependencias) para las respuestas del asesor:
 * soporta **negrita**, listas ("- " / "* " / "1. ") y saltos de línea.
 */
export function renderMarkdownLite(text: string): ReactNode {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let key = 0;

  function renderInline(line: string): ReactNode {
    const parts = line.split(/(\*\*[^*]+\*\*)/g).filter((p) => p !== "");
    return parts.map((part, idx) => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return <strong key={idx}>{part.slice(2, -2)}</strong>;
      }
      return <span key={idx}>{part}</span>;
    });
  }

  while (i < lines.length) {
    const line = lines[i];
    const isBullet = /^\s*[-*]\s+/.test(line);
    const isNumbered = /^\s*\d+\.\s+/.test(line);

    if (isBullet || isNumbered) {
      const items: string[] = [];
      const ordered = isNumbered;
      while (
        i < lines.length &&
        (ordered ? /^\s*\d+\.\s+/.test(lines[i]) : /^\s*[-*]\s+/.test(lines[i]))
      ) {
        items.push(lines[i].replace(ordered ? /^\s*\d+\.\s+/ : /^\s*[-*]\s+/, ""));
        i++;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag key={key++} className={ordered ? "list-decimal space-y-0.5 pl-5" : "list-disc space-y-0.5 pl-5"}>
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it)}</li>
          ))}
        </ListTag>,
      );
      continue;
    }

    if (line.trim() === "") {
      i++;
      continue;
    }

    // Párrafo: junta líneas seguidas que no son ni vacías ni listas, separadas por <br/>.
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push(
      <p key={key++} className="whitespace-pre-wrap">
        {paraLines.map((l, idx) => (
          <span key={idx}>
            {renderInline(l)}
            {idx < paraLines.length - 1 && <br />}
          </span>
        ))}
      </p>,
    );
  }

  return <div className="space-y-2 text-sm leading-relaxed">{blocks}</div>;
}
