"use client";
import {
  Baby, Banknote, Bike, BookOpen, Briefcase, Bus, Car, Coffee, Coins, CreditCard, Dumbbell,
  Film, Fuel, Gamepad2, Gift, GraduationCap, Heart, HeartPulse, Home, Landmark, Laptop, Music,
  PawPrint, PiggyBank, Pill, Plane, Receipt, Repeat, Shirt, ShoppingCart, Smartphone, Sparkles,
  Stethoscope, Tag, TrendingUp, Utensils, Wallet, Wrench, Zap,
  type LucideIcon, type LucideProps,
} from "lucide-react";

/**
 * Set fijo de íconos disponibles para categorías y cuentas.
 * La clave es el nombre kebab-case que se guarda en la base (igual que en lucide.dev).
 */
export const ICONS: Record<string, LucideIcon> = {
  tag: Tag,
  utensils: Utensils,
  "shopping-cart": ShoppingCart,
  bus: Bus,
  car: Car,
  fuel: Fuel,
  home: Home,
  zap: Zap,
  "heart-pulse": HeartPulse,
  stethoscope: Stethoscope,
  pill: Pill,
  "gamepad-2": Gamepad2,
  shirt: Shirt,
  "graduation-cap": GraduationCap,
  "book-open": BookOpen,
  gift: Gift,
  repeat: Repeat,
  briefcase: Briefcase,
  laptop: Laptop,
  "trending-up": TrendingUp,
  coins: Coins,
  banknote: Banknote,
  "credit-card": CreditCard,
  wallet: Wallet,
  landmark: Landmark,
  "piggy-bank": PiggyBank,
  heart: Heart,
  receipt: Receipt,
  plane: Plane,
  bike: Bike,
  dumbbell: Dumbbell,
  coffee: Coffee,
  smartphone: Smartphone,
  music: Music,
  film: Film,
  baby: Baby,
  "paw-print": PawPrint,
  wrench: Wrench,
  sparkles: Sparkles,
};

/** Nombres ofrecidos en el selector de íconos. */
export const ICON_NAMES = Object.keys(ICONS);

/** Ícono por nombre, con fallback a `tag`. */
export function DynIcon({ icon, ...props }: { icon: string | null | undefined } & LucideProps) {
  const Cmp = (icon && ICONS[icon]) || Tag;
  return <Cmp {...props} />;
}

/** Ícono de categoría/cuenta dentro de un círculo del color correspondiente. */
export function IconBubble({
  icon,
  color,
  size = 40,
}: {
  icon: string | null | undefined;
  color: string;
  size?: number;
}) {
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, backgroundColor: `${color}22`, color }}
    >
      <DynIcon icon={icon} size={Math.round(size * 0.5)} />
    </span>
  );
}
