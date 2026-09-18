import { handler, query } from "@/lib/api";
import { getDb } from "@/lib/db";
import { statsForMonth, trend, type StatsMode } from "@/lib/domain/stats";
import { monthKey, todayISO } from "@/lib/domain/core";

export const dynamic = "force-dynamic";

const TREND_MONTHS = 6;

export const GET = handler(async (req) => {
  const params = query(req);
  const month = params.get("month") ?? monthKey(todayISO());
  const modeParam = params.get("mode");
  const mode: StatsMode | undefined = modeParam === "committed" || modeParam === "effective" ? modeParam : undefined;

  const db = getDb();
  const [txs, categories, accounts, settings] = await Promise.all([
    db.transactions.list(),
    db.categories.list(),
    db.accounts.list(),
    db.settings.get(),
  ]);

  const stats = statsForMonth(txs, categories, accounts, month, settings, mode);
  const trendData = trend(txs, TREND_MONTHS, month, settings);

  return { ...stats, trend: trendData, month, mode: mode ?? (settings.budget_counts_pending_card ? "committed" : "effective") };
});
