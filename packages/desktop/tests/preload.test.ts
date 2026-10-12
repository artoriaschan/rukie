import { expect, test, vi } from "vitest";
const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn().mockResolvedValue(null), on: vi.fn() },
}));
vi.mock("electron", () => electron);

import type { DesktopHost } from "@rukie/ui";
test("preload exposes fixed native methods and explicit credential reveal with fixed IPC channels", async () => {
  await import("../src/preload.ts");
  expect(electron.contextBridge.exposeInMainWorld).toHaveBeenCalledTimes(1);
  const call = electron.contextBridge.exposeInMainWorld.mock.calls[0]!;
  expect(call[0]).toBe("rukieHost");
  const host: DesktopHost = call[1];
  expect(Object.keys(host).sort()).toEqual(["getConnection", "modelServices", "pickProjectFolder"]);
  await host.getConnection();
  await host.pickProjectFolder();
  expect(Object.keys(host.modelServices!).sort()).toEqual([
    "delete",
    "list",
    "prices",
    "revealKey",
    "save",
    "test",
  ]);
  await host.modelServices!.prices!({
    baseUrl: "https://api.deepseek.com",
    modelId: "deepseek-chat",
  });
  await host.modelServices!.test!("local", "m");
  await host.modelServices!.list();
  await host.modelServices!.revealKey!("local");
  await host.modelServices!.delete("local");
  expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
    ["rukie:getConnection"],
    ["rukie:pickProjectFolder"],
    [
      "rukie:modelServices:prices",
      { baseUrl: "https://api.deepseek.com", modelId: "deepseek-chat" },
    ],
    ["rukie:modelServices:test", "local", "m"],
    ["rukie:modelServices:list"],
    ["rukie:modelServices:revealKey", "local"],
    ["rukie:modelServices:delete", "local"],
  ]);
});
