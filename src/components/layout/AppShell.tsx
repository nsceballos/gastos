"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { BottomNav } from "./BottomNav";
import { BudgetAlertBanner } from "@/components/budgets/BudgetAlertBanner";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const bare = pathname.startsWith("/login");
  if (bare) return <main className="mx-auto w-full max-w-lg px-4">{children}</main>;
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-lg flex-col">
      <main className="flex-1 px-4 pb-24">
        <BudgetAlertBanner />
        {children}
      </main>
      <BottomNav />
    </div>
  );
}
