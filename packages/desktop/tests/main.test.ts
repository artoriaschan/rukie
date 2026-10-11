import { beforeEach, expect, test, vi } from "vitest";
const electron = vi.hoisted(() => {
  const handlers = new Map<string, (event: unknown, path?: unknown) => unknown>();
  const events = new Map<string, (...args: unknown[]) => void>();
  const protocol = { handle: vi.fn(), registerSchemesAsPrivileged: vi.fn() };
  const mainFrame = { url: "app://rukie/" };
  const webContents = {
    mainFrame,
    session: { protocol },
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
  };
  const window = {
    webContents,
    loadURL: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((name: string, fn: (...args: unknown[]) => void) => events.set(name, fn)),
    destroy: vi.fn(),
    isDestroyed: vi.fn(() => false),
  };
  return {
    handlers,
    events,
    protocol,
    window,
    app: {
      isPackaged: false,
      whenReady: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
      quit: vi.fn(),
      getAppPath: vi.fn(() => "/tmp"),
      setPath: vi.fn(),
    },
    BrowserWindow: vi.fn(function () {
      return window;
    }),
    ipcMain: {
      handle: vi.fn((name: string, fn: (event: unknown, path?: unknown) => unknown) =>
        handlers.set(name, fn),
      ),
    },
    dialog: { showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }) },
    shell: { showItemInFolder: vi.fn(), openPath: vi.fn().mockResolvedValue("") },
  };
});
vi.mock("electron", () => electron);
import { startDesktop } from "../src/main/desktop.ts";
import { fileURLToPath } from "node:url";
beforeEach(() => {
  electron.handlers.clear();
  electron.events.clear();
  vi.clearAllMocks();
});
test("Electron installs app scheme before load and authenticates every native IPC sender", async () => {
  const owner = await startDesktop({
    rendererDirectory: "/tmp",
    preload: "/tmp/preload.cjs",
    sidecar: {
      command: process.execPath,
      args: [fileURLToPath(new URL("./helpers/sidecar.mjs", import.meta.url))],
    },
  });
  try {
    expect(electron.protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
    ]);
    expect(electron.protocol.handle.mock.invocationCallOrder[0]).toBeLessThan(
      electron.window.loadURL.mock.invocationCallOrder[0]!,
    );
    expect(electron.BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        webPreferences: expect.objectContaining({
          contextIsolation: true,
          sandbox: true,
          nodeIntegration: false,
        }),
      }),
    );
    for (const handler of electron.handlers.values())
      await expect(handler({ senderFrame: { url: "https://evil.test" } }, "/tmp")).rejects.toThrow(
        "Untrusted",
      );
    const event = {
      sender: electron.window.webContents,
      senderFrame: electron.window.webContents.mainFrame,
    };
    expect(await electron.handlers.get("rukie:getConnection")!(event)).toEqual({
      port: 32123,
      token: "test-token",
    });
    expect(await electron.handlers.get("rukie:pickProjectFolder")!(event)).toBeNull();
    await expect(electron.handlers.get("rukie:revealPath")!(event, "relative")).rejects.toThrow(
      "absolute",
    );
    await electron.handlers.get("rukie:revealPath")!(event, "/tmp");
    expect(electron.shell.showItemInFolder).toHaveBeenCalledWith("/tmp");
  } finally {
    await owner.stop();
  }
});

test("closing the window waits for real sidecar exit and rejects further host calls", async () => {
  const owner = await startDesktop({
    rendererDirectory: "/tmp",
    preload: "/tmp/preload.cjs",
    sidecar: {
      command: process.execPath,
      args: [fileURLToPath(new URL("./helpers/sidecar.mjs", import.meta.url))],
    },
  });
  try {
    const event = {
      sender: electron.window.webContents,
      senderFrame: electron.window.webContents.mainFrame,
    };
    await electron.handlers.get("rukie:getConnection")!(event);
    const preventDefault = vi.fn();
    electron.events.get("close")!({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    await expect(electron.handlers.get("rukie:getConnection")!(event)).rejects.toThrow("closing");
    await owner.stop();
    expect(electron.window.destroy).toHaveBeenCalledOnce();
  } finally {
    await owner.stop();
  }
});

test("desktop waits for acquired environment before starting the sidecar", async () => {
  const environment = Promise.withResolvers<NodeJS.ProcessEnv>();
  const starting = startDesktop({
    rendererDirectory: "/tmp",
    preload: "/tmp/preload.cjs",
    sidecarEnvironment: environment.promise,
    sidecar: {
      command: process.execPath,
      args: [fileURLToPath(new URL("./helpers/sidecar.mjs", import.meta.url)), "--env-token"],
    },
  });
  expect(electron.protocol.registerSchemesAsPrivileged).toHaveBeenCalledOnce();
  expect(electron.handlers.has("rukie:getConnection")).toBe(false);
  environment.resolve({ ...process.env, RUKIE_TEST_PROVIDER_KEY: "local-test-value" });
  const owner = await starting;
  try {
    expect(
      await electron.handlers.get("rukie:getConnection")!({
        sender: electron.window.webContents,
        senderFrame: electron.window.webContents.mainFrame,
      }),
    ).toEqual({ port: 32123, token: "local-test-value" });
  } finally {
    await owner.stop();
  }
});
