import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { projects: ["packages/ui/vitest.config.ts", "packages/desktop/vitest.config.ts"] },
});
