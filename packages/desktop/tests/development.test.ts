import { expect, test, vi, afterEach } from "vitest";
const native = vi.hoisted(() => ({
  setName: vi.fn(),
  setPath: vi.fn((name: string) => {
    if (!["userData", "sessionData"].includes(name))
      throw new Error(`Unknown Electron special path: ${name}`);
  }),
  exit: vi.fn(),
  quit: vi.fn(),
  on: vi.fn(),
  openDevTools: vi.fn(),
}));
const start = vi.hoisted(() =>
  vi.fn(async (_options: unknown) => ({
    window: { webContents: { openDevTools: native.openDevTools } },
  })),
);
vi.mock("electron", () => ({ app: native }));
vi.mock("../src/main/desktop.ts", () => ({ startDesktop: start }));
afterEach(() => {
  for (const [name, callback] of native.on.mock.calls)
    if (name === "will-quit" && typeof callback === "function") callback();
  native.on.mockClear();
  vi.unstubAllGlobals();
});
test("development boot sets a distinct pre-ready identity, private native storage and current compiled sidecar", async () => {
  vi.stubGlobal("RUKIE_DESKTOP_DEVELOPMENT_ROOT", "/checkout");
  vi.stubGlobal("RUKIE_DESKTOP_DEVELOPMENT_CONFIGURATION_ROOT", "/shared/configuration");
  await import("../src/development.ts");
  expect(native.setName).toHaveBeenCalledWith("rukie-desktop-development");
  expect(native.setPath).toHaveBeenCalledWith("sessionData", "/checkout/.desktop-dev/session");
  expect(native.setName.mock.invocationCallOrder[0]).toBeLessThan(
    start.mock.invocationCallOrder[0]!,
  );
  expect(native.setPath.mock.invocationCallOrder.at(-1)).toBeLessThan(
    start.mock.invocationCallOrder[0]!,
  );
  expect(start).toHaveBeenCalledWith({
    rendererDirectory: "/checkout/.desktop-dev/build/renderer",
    preload: "/checkout/.desktop-dev/build/preload.cjs",
    userDataDirectory: "/checkout/.desktop-dev/electron",
    dataRoot: "/checkout/.desktop-dev/data",
    configurationRoot: "/shared/configuration",
    sidecar: { command: "/checkout/.desktop-dev/build/rukie-server", args: [], cwd: "/checkout" },
  });
  expect(native.openDevTools).toHaveBeenCalledWith({ mode: "detach" });
});

test("failed development boot exits with failure after the desktop owner has cleaned up", async () => {
  vi.resetModules();
  vi.stubGlobal("RUKIE_DESKTOP_DEVELOPMENT_ROOT", "/checkout");
  vi.stubGlobal("RUKIE_DESKTOP_DEVELOPMENT_CONFIGURATION_ROOT", "/shared/configuration");
  start.mockRejectedValueOnce(new Error("boot failed"));
  const output = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await import("../src/development.ts");
    await vi.waitFor(() => expect(native.exit).toHaveBeenCalledWith(1));
  } finally {
    output.mockRestore();
  }
});

test("development termination signals request graceful app quit before owned sidecar shutdown", async () => {
  vi.resetModules();
  vi.stubGlobal("RUKIE_DESKTOP_DEVELOPMENT_ROOT", "/checkout");
  vi.stubGlobal("RUKIE_DESKTOP_DEVELOPMENT_CONFIGURATION_ROOT", "/shared/configuration");
  await import("../src/development.ts");
  native.quit.mockClear();
  process.emit("SIGTERM");
  process.emit("SIGINT");
  expect(native.quit).toHaveBeenCalledTimes(2);
});
