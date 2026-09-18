import { cn } from "@/lib/cn";
import { formatMoney } from "@/lib/format";

/**
 * El número que importa: quién le debe a quién.
 *  balance > 0 -> la pareja me debe (verde)
 *  balance < 0 -> yo le debo (rojo)
 *  balance = 0 -> están a mano
 */
export function BalanceLine({
  balance,
  partnerName,
  currency,
  size = "lg",
}: {
  balance: number;
  partnerName: string;
  currency: string;
  size?: "lg" | "sm";
}) {
  const even = Math.abs(balance) < 0.005;
  const theyOwe = balance > 0;
  const text = even
    ? "Están a mano"
    : theyOwe
      ? `${partnerName} te debe`
      : `Le debés a ${partnerName}`;
  return (
    <div className="flex flex-col gap-0.5">
      <span className={cn("text-muted", size === "lg" ? "text-sm" : "text-xs")}>{text}</span>
      {!even && (
        <span
          className={cn(
            "font-bold tabular-nums",
            size === "lg" ? "text-3xl" : "text-lg",
            theyOwe ? "text-success" : "text-danger",
          )}
        >
          {formatMoney(Math.abs(balance), currency)}
        </span>
      )}
    </div>
  );
}

export function balanceLabel(balance: number, partnerName: string, currency: string): string {
  if (Math.abs(balance) < 0.005) return "Están a mano";
  return balance > 0
    ? `${partnerName} te debe ${formatMoney(balance, currency)}`
    : `Le debés ${formatMoney(-balance, currency)} a ${partnerName}`;
}
