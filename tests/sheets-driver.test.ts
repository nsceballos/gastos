import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SheetsDriver } from "@/lib/db/sheets";

/**
 * Simula la API de Google Sheets en memoria para validar el mapeo header/filas,
 * append, update (PUT por índice de fila) y delete (deleteDimension).
 */
type Sheet = { sheetId: number; title: string; values: unknown[][] };

function fakeSheetsApi(sheets: Sheet[]) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  const find = (title: string) => sheets.find((s) => s.title === title.replace(/^'|'$/g, "").replace(/''/g, "'"));
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname.split("/spreadsheets/SHEET")[1] ?? "");

    if (path === "" && u.search.includes("fields=sheets")) {
      return json({ sheets: sheets.map((s) => ({ properties: { sheetId: s.sheetId, title: s.title } })) });
    }
    if (path === ":batchUpdate") {
      for (const r of body.requests) {
        if (r.addSheet) sheets.push({ sheetId: sheets.length + 1, title: r.addSheet.properties.title, values: [] });
        if (r.deleteDimension) {
          const s = sheets.find((x) => x.sheetId === r.deleteDimension.range.sheetId)!;
          s.values.splice(r.deleteDimension.range.startIndex, r.deleteDimension.range.endIndex - r.deleteDimension.range.startIndex);
        }
      }
      return json({});
    }
    if (path === ":values:batchUpdate") {
      for (const d of body.data) {
        const [title] = d.range.split("!");
        const s = find(title)!;
        s.values[0] = d.values[0];
      }
      return json({});
    }
    const m = path.match(/^\/values\/(.+?)(:append|:clear)?$/);
    if (m) {
      const [title, a1] = m[1].split("!");
      const s = find(title)!;
      if (m[2] === ":append") {
        s.values.push(...body.values);
        return json({});
      }
      if (m[2] === ":clear") {
        s.values.splice(1);
        return json({});
      }
      if (method === "GET") return json({ values: s.values });
      if (method === "PUT") {
        const row = Number(a1.replace(/^A/, "")) - 1;
        body.values.forEach((v: unknown[], i: number) => (s.values[row + i] = v));
        return json({});
      }
    }
    return json({ error: `unhandled ${method} ${url}` }, 500);
  });
  return { fetchMock, calls };
}

describe("SheetsDriver", () => {
  const sheets: Sheet[] = [];
  let driver: SheetsDriver;
  let api: ReturnType<typeof fakeSheetsApi>;

  beforeEach(() => {
    sheets.length = 0;
    sheets.push({ sheetId: 0, title: "Hoja 1", values: [] });
    api = fakeSheetsApi(sheets);
    vi.stubGlobal("fetch", api.fetchMock);
    driver = new SheetsDriver("SHEET", "sa@example.com", "-----BEGIN PRIVATE KEY-----\\nX\\n-----END PRIVATE KEY-----", { cacheMs: 0 });
    // Evita firmar JWT reales
    vi.spyOn(driver as unknown as { token: () => Promise<string> }, "token").mockResolvedValue("tok");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("ensureSchema crea tabs y headers; append/update/remove funcionan", async () => {
    await driver.ensureSchema();
    const titles = sheets.map((s) => s.title);
    expect(titles).toContain("transactions");
    expect(sheets.find((s) => s.title === "budgets")!.values[0]).toContain("alert_threshold_pct");

    await driver.append("budgets", [
      { id: "b1", month: "2026-09", category_id: null, amount: 100, alert_threshold_pct: 80, recurring: true, created_at: "x", updated_at: "x" },
      { id: "b2", month: "2026-09", category_id: "c", amount: 50.5, alert_threshold_pct: 90, recurring: false, created_at: "x", updated_at: "x" },
    ]);
    let rows = await driver.readAll("budgets");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "b1", category_id: null, amount: 100, recurring: true });
    expect(rows[1]).toMatchObject({ id: "b2", amount: 50.5, recurring: false });

    const ok = await driver.update("budgets", "id", "b2", { ...rows[1], amount: 75 });
    expect(ok).toBe(true);
    rows = await driver.readAll("budgets");
    expect(rows[1].amount).toBe(75);
    expect(await driver.update("budgets", "id", "nope", rows[1])).toBe(false);

    expect(await driver.remove("budgets", "id", "b1")).toBe(true);
    rows = await driver.readAll("budgets");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("b2");

    await driver.replaceAll("budgets", []);
    expect(await driver.readAll("budgets")).toHaveLength(0);
    // header intacto
    expect(sheets.find((s) => s.title === "budgets")!.values[0][0]).toBe("id");
  });
});
