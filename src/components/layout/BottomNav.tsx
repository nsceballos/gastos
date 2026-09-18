"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CreditCard, Home, MoreHorizontal, PiggyBank } from "lucide-react";
import { cn } from "@/lib/cn";

const tabs = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/estadisticas", label: "Stats", icon: BarChart3 },
  { href: "/cuentas", label: "Cuentas", icon: CreditCard },
  { href: "/presupuesto", label: "Presupuesto", icon: PiggyBank },
  { href: "/mas", label: "Más", icon: MoreHorizontal },
];

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <ul className="mx-auto flex max-w-lg justify-around">
        {tabs.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                className={cn(
                  "flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium",
                  active ? "text-primary" : "text-muted",
                )}
              >
                <Icon size={22} strokeWidth={active ? 2.4 : 1.8} />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
