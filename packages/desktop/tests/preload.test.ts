import { expect, test, vi } from "vitest";
const electron = vi.hoisted(() => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: { invoke: vi.fn().mockResolvedValue(null), on: vi.fn() },
}));
vi.mock("electron", () => electron);

import type { DesktopHost } from "@rukie/ui";
test("preload exposes precisely four native methods with fixed IPC channels", async () => {
  await import("../src/preload.ts");
  expect(electron.contextBridge.exposeInMainWorld).toHaveBeenCalledTimes(1);
  const call = electron.contextBridge.exposeInMainWorld.mock.calls[0]!;
  expect(call[0]).toBe("rukieHost");
  const host: DesktopHost = call[1];
  expect(Object.keys(host).sort()).toEqual([
    "getConnection",
    "openInTerminal",
    "pickProjectFolder",
    "revealPath",
  ]);
  await host.getConnection();
  await host.pickProjectFolder();
  await host.revealPath("/tmp");
  await host.openInTerminal("/tmp");
  expect(electron.ipcRenderer.invoke.mock.calls).toEqual([
    ["rukie:getConnection"],
    ["rukie:pickProjectFolder"],
    ["rukie:revealPath", "/tmp"],
    ["rukie:openInTerminal", "/tmp"],
  ]);
});
