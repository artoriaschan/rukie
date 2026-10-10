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
        optimizeDeps: { include: ["@floating-ui/dom", "zustand/vanilla"] },
        test: {
          name: "ui-browser",
          include: ["tests/**/*.browser.test.{ts,tsx}"],
          browser: {
            enabled: true,
            commands: {
              startWire: async () => {
                const fixture = await startWireFixture();
                fixtures.set(fixture.connection.port, fixture);
                return fixture.connection;
              },
              stopWire: async (_context, port: number) => {
                await fixtures.get(port)?.close();
                fixtures.delete(port);
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
