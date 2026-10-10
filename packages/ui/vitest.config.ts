import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

const resolve = { alias: { "@": new URL("./src", import.meta.url).pathname } };

export default defineConfig({
  resolve,
  test: {
    projects: [
      {
        plugins: [react(), tailwindcss()],
        resolve,
        test: {
          name: "ui-browser",
          include: ["tests/**/*.browser.test.{ts,tsx}"],
          browser: {
            enabled: true,
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
