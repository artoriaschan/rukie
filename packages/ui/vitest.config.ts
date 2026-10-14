import { startWireFixture } from "./tests/helpers/wire.ts";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const resolve = { alias: { "@": new URL("./src", import.meta.url).pathname } };

const fixtures = new Map<number, Awaited<ReturnType<typeof startWireFixture>>>();

export default defineConfig({
  resolve,
  test: {
    projects: [
      {
        plugins: [react(), tailwindcss()],
        resolve,
        optimizeDeps: {
          include: [
            "@floating-ui/dom",
            "zustand/vanilla",
            "@lobehub/icons/es/DeepSeek/components/Mono",
            "@lobehub/icons/es/DeepSeek/components/Color",
          ],
        },
        test: {
          name: "ui-browser",
          include: ["tests/**/*.browser.test.{ts,tsx}"],
          browser: {
            enabled: true,
            commands: {
              reducedMotion: async ({ page }, reduced: boolean) => {
                await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
              },
              startWire: async () => {
                const fixture = await startWireFixture();
                fixtures.set(fixture.connection.port, fixture);
                return fixture.connection;
              },
              stopWire: async (_context, port: number) => {
                try {
                  await fixtures.get(port)?.close();
                } finally {
                  fixtures.delete(port);
                }
              },
            },
            provider: playwright(),
            headless: true,
            instances: [{ browser: "chromium" }],
          },
        },
      },
      {
        test: {
          name: "ui-node",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/**/*.browser.test.ts"],
        },
      },
    ],
  },
});
