import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    env: { DATA_DRIVER: "memory" },
  },
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
});
