import type { ReactNode } from "react";

export function PageHeader({ title, right, children }: { title: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 -mx-4 mb-4 border-b border-border bg-background/90 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{title}</h1>
        {right}
      </div>
      {children}
    </header>
  );
}
