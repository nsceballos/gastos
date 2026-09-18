"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, ChevronRight, Heart, LogOut, Settings, Tags } from "lucide-react";
import { PageHeader, Card } from "@/components/ui";
import { api } from "@/lib/api-client";

const items = [
  { href: "/pareja", label: "Gastos compartidos con tu pareja", icon: Heart },
  { href: "/asesor", label: "Asesor financiero IA", icon: Bot },
  { href: "/categorias", label: "Categorías", icon: Tags },
  { href: "/ajustes", label: "Ajustes", icon: Settings },
];

export default function MasPage() {
  const router = useRouter();
  async function logout() {
    await api.post("/api/auth/logout");
    router.replace("/login");
  }
  return (
    <>
      <PageHeader title="Más" />
      <Card className="divide-y divide-border p-0">
        {items.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href} className="flex items-center gap-3 px-4 py-3.5 hover:bg-surface-2">
            <Icon size={20} className="text-primary" />
            <span className="flex-1 text-sm font-medium">{label}</span>
            <ChevronRight size={18} className="text-muted" />
          </Link>
        ))}
        <button onClick={logout} className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-surface-2">
          <LogOut size={20} className="text-danger" />
          <span className="flex-1 text-sm font-medium">Cerrar sesión</span>
        </button>
      </Card>
    </>
  );
}
