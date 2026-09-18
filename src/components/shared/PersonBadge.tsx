import { cn } from "@/lib/cn";

const COLORS = {
  me: { bg: "#6366f1", label: "text-[#6366f1]" },
  partner: { bg: "#ec4899", label: "text-[#ec4899]" },
} as const;

export type Who = "me" | "partner";

/** Inicial con color: violeta = yo, rosa = la pareja. */
export function PersonAvatar({ who, name, size = 28 }: { who: Who; name: string; size?: number }) {
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ backgroundColor: COLORS[who].bg, width: size, height: size, fontSize: size * 0.45 }}
      aria-hidden
    >
      {initial}
    </span>
  );
}

export function PersonName({ who, name, className }: { who: Who; name: string; className?: string }) {
  return <span className={cn("font-medium", COLORS[who].label, className)}>{name}</span>;
}
