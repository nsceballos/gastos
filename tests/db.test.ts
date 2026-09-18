import { describe, expect, it } from "vitest";
import { createMemoryDb } from "@/lib/db";
import { seedDefaults } from "@/lib/seed";

describe("db (memory driver)", () => {
  it("crea, lee, actualiza y borra", async () => {
    const db = createMemoryDb();
    await db.driver.ensureSchema();
    const acc = await db.accounts.create({
      name: "Banco", type: "bank", currency: "ARS", initial_balance: 1000, closing_day: null,
      due_day: null, credit_limit: null, color: "#000", icon: "bank", archived: false, sort_order: 0,
    });
    expect(acc.id).toBeTruthy();
    expect((await db.accounts.list()).length).toBe(1);
    const upd = await db.accounts.update(acc.id, { name: "Banco 2" });
    expect(upd.name).toBe("Banco 2");
    expect((await db.accounts.get(acc.id))?.initial_balance).toBe(1000);
    await db.accounts.remove(acc.id);
    expect(await db.accounts.get(acc.id)).toBeNull();
  });

  it("settings con defaults y override", async () => {
    const db = createMemoryDb();
    const s = await db.settings.get();
    expect(s.default_my_share_pct).toBe(50);
    await db.settings.set({ partner_name: "Ana", default_my_share_pct: 60, budget_counts_pending_card: false });
    const s2 = await db.settings.get();
    expect(s2.partner_name).toBe("Ana");
    expect(s2.default_my_share_pct).toBe(60);
    expect(s2.budget_counts_pending_card).toBe(false);
  });

  it("seed es idempotente", async () => {
    const db = createMemoryDb();
    const a = await seedDefaults(db);
    const b = await seedDefaults(db);
    expect(a.categories).toBeGreaterThan(0);
    expect(b.categories).toBe(0);
    expect(b.accounts).toBe(0);
  });
});
