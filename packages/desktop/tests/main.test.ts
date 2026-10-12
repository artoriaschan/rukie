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
    setWindowOpenHandler:
      vi.fn<
        (
          handler: (details: { url: string; referrer: { url: string } }) => { action: string },
        ) => void
      >(),
    on: vi.fn(),
  };
  const window = {
    webContents,
    loadURL: vi.fn().mockResolvedValue(undefined),
    on: vi.fn((name: string, fn: (...args: unknown[]) => void) => events.set(name, fn)),
    destroy: vi.fn(),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
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
      requestSingleInstanceLock: vi.fn(() => true),
      getAppPath: vi.fn(() => "/tmp"),
      getPath: vi.fn(() => "/tmp/electron-user-data"),
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
    safeStorage: {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((value: string) => Buffer.from(value)),
      decryptString: vi.fn((value: Buffer) => value.toString()),
    },
    shell: {
      showItemInFolder: vi.fn(),
      openPath: vi.fn().mockResolvedValue(""),
      openExternal: vi.fn().mockResolvedValue(undefined),
    },
  };
});
vi.mock("electron", () => electron);
import { startDesktop } from "../src/main/desktop.ts";
import { userInfo } from "node:os";
import { fileURLToPath } from "node:url";
beforeEach(() => {
  electron.app.isPackaged = false;
  electron.app.requestSingleInstanceLock.mockReturnValue(true);
  electron.handlers.clear();
  electron.events.clear();
  vi.clearAllMocks();
  electron.safeStorage.isEncryptionAvailable.mockReturnValue(true);
});
test("trusted credential save passes only ciphertext privately and cancellation never reports a save", async () => {
  const owner = await startDesktop({
    dataRoot: "/tmp/rukie-desktop-test-data",
    rendererDirectory: "/tmp",
    preload: "/tmp/preload.cjs",
    sidecar: {
      command: process.execPath,
      args: [fileURLToPath(new URL("./helpers/sidecar.mjs", import.meta.url))],
    },
  });
  const fetching = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response("{}", { status: 200 }));
  const event = {
    sender: electron.window.webContents,
    senderFrame: electron.window.webContents.mainFrame,
  };
  const input = {
    provider: {
      id: "local",
      name: "Local",
      api: "openai-completions",
      baseUrl: "http://localhost/v1",
      models: [],
    },
    credential: { type: "replace", value: "new-test-key" },
  };
  try {
    await electron.handlers.get("rukie:modelServices:save")!(event, input);
    const [, options] = fetching.mock.calls[0]!;
    expect(options?.body).not.toContain("new-test-key");
    expect(JSON.parse(String(options?.body))).toMatchObject({
      type: "save",
      credential: { type: "replace", ciphertext: expect.any(String) },
    });
    fetching.mockClear();
    electron.safeStorage.encryptString.mockImplementationOnce(() => {
      throw new Error("user cancelled new-test-key");
    });
    await expect(electron.handlers.get("rukie:modelServices:save")!(event, input)).rejects.toThrow(
      "Retry or reconfigure",
    );
    expect(fetching).not.toHaveBeenCalled();
    electron.safeStorage.isEncryptionAvailable.mockReturnValue(false);
    await expect(electron.handlers.get("rukie:modelServices:save")!(event, input)).rejects.toThrow(
      "unavailable",
    );
    expect(fetching).not.toHaveBeenCalled();
  } finally {
    fetching.mockRestore();
    await owner.stop();
  }
});

test("credential reveal authorizes exact provider and rejects untrusted frames before transport", async () => {
  const owner = await startDesktop({
    dataRoot: "/tmp/rukie-desktop-test-data",
    rendererDirectory: "/tmp",
    preload: "/tmp/preload.cjs",
    sidecar: {
      command: process.execPath,
      args: [fileURLToPath(new URL("./helpers/sidecar.mjs", import.meta.url))],
    },
  });
  const fetching = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify({ value: "fixture-only" }), { status: 200 }));
  const event = {
    sender: electron.window.webContents,
    senderFrame: electron.window.webContents.mainFrame,
  };
  try {
    const reveal = electron.handlers.get("rukie:modelServices:revealKey")!;
    await expect(
      reveal({ ...event, senderFrame: { url: "app://rukie/" } }, "local"),
    ).rejects.toThrow("Untrusted");
    await expect(reveal(event, "oauth:other")).rejects.toThrow("Invalid provider");
    expect(fetching).not.toHaveBeenCalled();
    expect(await reveal(event, "local")).toBe("fixture-only");
    expect(JSON.parse(String(fetching.mock.calls[0]![1]?.body))).toEqual({
      type: "revealKey",
      id: "local",
    });
    fetching.mockResolvedValueOnce(new Response("sensitive backend body", { status: 409 }));
    await expect(reveal(event, "local")).rejects.toThrow("Retry or reconfigure");
  } finally {
    fetching.mockRestore();
    await owner.stop();
  }
});

test("startup failure closes native resources", async () => {
  electron.window.loadURL.mockRejectedValueOnce(new Error("cannot load renderer"));
  await expect(
    startDesktop({
      dataRoot: "/tmp/rukie-desktop-test-data",
      rendererDirectory: "/tmp",
      preload: "/tmp/preload.cjs",
      sidecar: {
        command: process.execPath,
        args: [fileURLToPath(new URL("./helpers/sidecar.mjs", import.meta.url))],
      },
    }),
  ).rejects.toThrow("cannot load renderer");
  expect(electron.window.destroy).toHaveBeenCalledOnce();
});
test("Electron installs app scheme before load and authenticates every native IPC sender", async () => {
  const owner = await startDesktop({
    dataRoot: "/tmp/rukie-desktop-test-data",
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
        titleBarStyle: "hiddenInset",
        trafficLightPosition: { x: 16, y: 16 },
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
    expect(electron.handlers.has("rukie:revealPath")).toBe(false);
    expect(electron.handlers.has("rukie:openInTerminal")).toBe(false);
  } finally {
    await owner.stop();
  }
});

test("closing the window waits for real sidecar exit and rejects further host calls", async () => {
  const owner = await startDesktop({
    dataRoot: "/tmp/rukie-desktop-test-data",
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
    dataRoot: "/tmp/rukie-desktop-test-data",
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

test("development startup requires an explicit isolated application data root", async () => {
  await expect(
    startDesktop({
      rendererDirectory: "/tmp",
      preload: "/tmp/preload.cjs",
      sidecar: { command: process.execPath, args: [] },
    }),
  ).rejects.toThrow("explicit");
});

test("packaged startup privately sends userData/data and real home to its sidecar", async () => {
  electron.app.isPackaged = true;
  const owner = await startDesktop({
    rendererDirectory: "/tmp",
    preload: "/tmp/preload.cjs",
    sidecar: {
      command: process.execPath,
      args: [fileURLToPath(new URL("./helpers/sidecar.mjs", import.meta.url)), "--data-root-token"],
      env: {
        ...process.env,
        RUKIE_DESKTOP_DATA_ROOT: "/untrusted-override",
        RUKIE_DESKTOP_HOME_DIR: "/fake-home",
      },
    },
  });
  try {
    const connection = await electron.handlers.get("rukie:getConnection")!({
      sender: electron.window.webContents,
      senderFrame: electron.window.webContents.mainFrame,
    });
    if (
      typeof connection !== "object" ||
      connection === null ||
      !("token" in connection) ||
      typeof connection.token !== "string"
    )
      throw new Error("Invalid connection");
    expect(JSON.parse(connection.token)).toEqual({
      dataRoot: "/tmp/electron-user-data/data",
      homeDir: userInfo().homedir,
      encryptionBackend: "electron",
    });
  } finally {
    await owner.stop();
  }
});

test("a second desktop instance quits before opening a window or starting a sidecar", async () => {
  electron.app.requestSingleInstanceLock.mockReturnValue(false);
  const owner = await startDesktop({
    dataRoot: "/tmp/isolated-second",
    rendererDirectory: "/tmp",
    preload: "/tmp/preload.cjs",
    sidecar: { command: process.execPath, args: [] },
  });
  expect(electron.app.quit).toHaveBeenCalledOnce();
  expect(electron.BrowserWindow).not.toHaveBeenCalled();
  expect(electron.protocol.registerSchemesAsPrivileged).not.toHaveBeenCalled();
  await owner.stop();
});

test("model prices authorize the main frame and reject arbitrary lookup inputs before private transport", async () => {
  const owner = await startDesktop({
    dataRoot: "/tmp/rukie-desktop-test-data",
    rendererDirectory: "/tmp",
    preload: "/tmp/preload.cjs",
    sidecar: {
      command: process.execPath,
      args: [fileURLToPath(new URL("./helpers/sidecar.mjs", import.meta.url))],
    },
  });
  const fetching = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ status: "unmatched" }));
  const event = {
    sender: electron.window.webContents,
    senderFrame: electron.window.webContents.mainFrame,
  };
  try {
    const prices = electron.handlers.get("rukie:modelServices:prices")!;
    await expect(
      prices(
        { ...event, senderFrame: { url: "app://rukie/" } },
        { baseUrl: "https://api.openai.com", modelId: "m" },
      ),
    ).rejects.toThrow("Untrusted");
    await expect(
      prices(event, {
        baseUrl: "https://api.openai.com",
        modelId: "m",
        url: "https://other.example",
      }),
    ).rejects.toThrow("Invalid");
    expect(fetching).not.toHaveBeenCalled();
    expect(await prices(event, { baseUrl: "https://api.openai.com", modelId: "m" })).toEqual({
      status: "unmatched",
    });
    expect(JSON.parse(String(fetching.mock.calls[0]![1]?.body))).toEqual({
      type: "prices",
      baseUrl: "https://api.openai.com",
      modelId: "m",
    });
  } finally {
    fetching.mockRestore();
    await owner.stop();
  }
});

test("development main forwards shared configuration separately from workspace data", async () => {
  const owner = await startDesktop({
    rendererDirectory: "/tmp",
    preload: "/tmp/preload.cjs",
    dataRoot: "/tmp/workspace-data",
    configurationRoot: "/tmp/shared-configuration",
    sidecar: {
      command: process.execPath,
      args: [fileURLToPath(new URL("./helpers/sidecar.mjs", import.meta.url)), "--data-root-token"],
    },
  });
  try {
    const connection = await electron.handlers.get("rukie:getConnection")!({
      sender: electron.window.webContents,
      senderFrame: electron.window.webContents.mainFrame,
    });
    if (
      typeof connection !== "object" ||
      connection === null ||
      !("token" in connection) ||
      typeof connection.token !== "string"
    )
      throw new Error("Invalid connection");
    expect(JSON.parse(connection.token)).toEqual({
      dataRoot: "/tmp/workspace-data",
      configurationRoot: "/tmp/shared-configuration",
      homeDir: userInfo().homedir,
      encryptionBackend: "electron",
    });
  } finally {
    await owner.stop();
  }
});

test("API Key acquisition opens only the fixed trusted destination and denies popups", async () => {
  const owner = await startDesktop({
    dataRoot: "/tmp/rukie-desktop-test-data",
    rendererDirectory: "/tmp",
    preload: "/tmp/preload.cjs",
    sidecar: {
      command: process.execPath,
      args: [fileURLToPath(new URL("./helpers/sidecar.mjs", import.meta.url))],
    },
  });
  try {
    const open = electron.window.webContents.setWindowOpenHandler.mock.calls[0]![0];
    const referrer = { url: "app://rukie/" };
    for (const url of [
      "https://evil.test",
      "https://platform.deepseek.com/api_keys?other=1",
      "http://platform.deepseek.com/api_keys",
      "https://platform.deepseek.com/api_keys#other",
    ]) {
      expect(open({ url, referrer })).toEqual({ action: "deny" });
      expect(open({ url, referrer: { url: "" } })).toEqual({ action: "deny" });
    }
    expect(
      open({
        url: "https://platform.deepseek.com/api_keys",
        referrer: { url: "https://evil.test" },
      }),
    ).toEqual({ action: "deny" });
    electron.window.webContents.mainFrame.url = "https://evil.test";
    expect(open({ url: "https://platform.deepseek.com/api_keys", referrer })).toEqual({
      action: "deny",
    });
    expect(open({ url: "https://platform.deepseek.com/api_keys", referrer: { url: "" } })).toEqual({
      action: "deny",
    });
    expect(electron.shell.openExternal).not.toHaveBeenCalled();
    electron.window.webContents.mainFrame.url = "app://rukie/";
    expect(open({ url: "https://platform.deepseek.com/api_keys", referrer })).toEqual({
      action: "deny",
    });
    expect(electron.shell.openExternal).toHaveBeenCalledWith(
      "https://platform.deepseek.com/api_keys",
    );
    electron.shell.openExternal.mockClear();
    // rel=noreferrer on the rendered acquisition anchor emits an empty referrer.
    expect(open({ url: "https://platform.deepseek.com/api_keys", referrer: { url: "" } })).toEqual({
      action: "deny",
    });
    expect(electron.shell.openExternal).toHaveBeenCalledExactlyOnceWith(
      "https://platform.deepseek.com/api_keys",
    );
    electron.shell.openExternal.mockRejectedValueOnce(Error("OS browser unavailable"));
    expect(open({ url: "https://platform.deepseek.com/api_keys", referrer })).toEqual({
      action: "deny",
    });
    // Settle the mocked OS rejection; Vitest reports any unhandled rejection as a failure.
    await Promise.resolve();
  } finally {
    electron.window.webContents.mainFrame.url = "app://rukie/";
    await owner.stop();
  }
});
