"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatMonth } from "@/lib/format";

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function MonthPicker({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  return (
    <div className="flex items-center justify-between">
      <button className="rounded-full p-2 hover:bg-surface-2" onClick={() => onChange(shiftMonth(value, -1))} aria-label="Mes anterior">
        <ChevronLeft size={20} />
      </button>
      <span className="text-base font-semibold capitalize">{formatMonth(value)}</span>
      <button className="rounded-full p-2 hover:bg-surface-2" onClick={() => onChange(shiftMonth(value, 1))} aria-label="Mes siguiente">
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
