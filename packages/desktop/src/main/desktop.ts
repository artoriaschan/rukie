import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  safeStorage,
  type IpcMainInvokeEvent,
} from "electron";
import { userInfo } from "node:os";
import { isAbsolute, join } from "node:path";
import { Sidecar, type SidecarOptions } from "./sidecar.ts";
import { serveAppFile } from "./protocol.ts";
import { createSecretService, systemEncryptionAvailable } from "./secrets.ts";
import { randomBytes } from "node:crypto";
import { parseModelPriceRequest, parseModelServiceSave } from "@rukie/shared";

export interface DesktopOptions {
  rendererDirectory: string;
  preload: string;
  sidecar: SidecarOptions;
  sidecarEnvironment?: Promise<NodeJS.ProcessEnv>;
  userDataDirectory?: string;
  /** Required for development and tests; production defaults to userData/data. */
  dataRoot?: string;
  configurationRoot?: string;
}

/** Electron owns native operations and child lifetime; Agent Core stays in the sidecar. */
export async function startDesktop(options: DesktopOptions) {
  if (options.userDataDirectory) app.setPath("userData", options.userDataDirectory);
  if (!app.isPackaged && options.dataRoot === undefined)
    throw new Error("Development desktop requires an explicit isolated dataRoot.");
  const dataRoot = options.dataRoot ?? join(app.getPath("userData"), "data");
  if (!isAbsolute(dataRoot)) throw new Error("Desktop dataRoot must be absolute.");
  if (options.configurationRoot && !isAbsolute(options.configurationRoot))
    throw new Error("Desktop configurationRoot must be absolute.");
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return { window: null, async stop() {} };
  }
  protocol.registerSchemesAsPrivileged([
    { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
  await app.whenReady();
  const secrets = await createSecretService(safeStorage);
  const managementToken = randomBytes(32).toString("hex");
  let acquiredSidecar: Sidecar | undefined;
  let acquiredWindow: BrowserWindow | undefined;
  try {
    const window = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 420,
      minHeight: 400,
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 16 },
      webPreferences: {
        preload: options.preload,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    acquiredWindow = window;
    app.on("second-instance", () => {
      if (window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.focus();
    });
    await window.webContents.session.protocol.handle("app", (request) =>
      serveAppFile(request.url, options.rendererDirectory),
    );
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, address) => {
      if (!trustedAddress(address)) event.preventDefault();
    });
    const sidecar = new Sidecar({
      ...options.sidecar,
      env: {
        ...(options.sidecarEnvironment ? await options.sidecarEnvironment : process.env),
        ...options.sidecar.env,
        RUKIE_DESKTOP_DATA_ROOT: dataRoot,
        RUKIE_DESKTOP_CONFIGURATION_ROOT: options.configurationRoot,
        RUKIE_DESKTOP_HOME_DIR: userInfo().homedir,
        RUKIE_DESKTOP_SECRET_URL: secrets.url,
        RUKIE_DESKTOP_SECRET_TOKEN: secrets.token,
        RUKIE_DESKTOP_MANAGEMENT_TOKEN: managementToken,
      },
      onChange: (state) => {
        options.sidecar.onChange?.(state);
        if (!window.isDestroyed()) window.webContents.send("rukie:connection-change", state);
      },
    });
    acquiredSidecar = sidecar;
    let closing = false;
    let quitReady = false;
    const authorize = (event: IpcMainInvokeEvent) => {
      if (closing) throw new Error("Desktop is closing");
      if (
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        !trustedAddress(event.senderFrame.url)
      )
        throw new Error("Untrusted desktop sender");
    };
    ipcMain.handle("rukie:getConnection", async (event) => {
      authorize(event);
      return sidecar.getConnection();
    });
    const manage = async (operation: unknown) => {
      const connection = await sidecar.getConnection();
      const response = await fetch(`http://127.0.0.1:${connection.port}/private/model-services`, {
        method: "POST",
        headers: { authorization: `Bearer ${managementToken}` },
        body: JSON.stringify(operation),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok)
        throw new Error("Model service operation failed. Retry or reconfigure credentials.");
      return response.json();
    };
    ipcMain.handle("rukie:modelServices:prices", async (event, input: unknown) => {
      authorize(event);
      const request = parseModelPriceRequest(input);
      if (!request) throw new Error("Invalid model price identity");
      return manage({ type: "prices", ...request });
    });
    ipcMain.handle("rukie:modelServices:templates", async (event) => {
      authorize(event);
      return manage({ type: "templates" });
    });
    ipcMain.handle("rukie:modelServices:test", async (event, id: unknown, modelId: unknown) => {
      authorize(event);
      if (
        typeof id !== "string" ||
        !/^[A-Za-z0-9_-]{1,128}$/.test(id) ||
        typeof modelId !== "string" ||
        !modelId ||
        modelId.length > 256
      )
        throw new Error("Invalid model service");
      await manage({ type: "test", id, modelId });
    });
    ipcMain.handle("rukie:modelServices:revealKey", async (event, id: unknown) => {
      authorize(event);
      if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
        throw new Error("Invalid provider identity");
      const result: unknown = await manage({ type: "revealKey", id });
      if (
        typeof result !== "object" ||
        result === null ||
        !("value" in result) ||
        (result.value !== null && typeof result.value !== "string")
      )
        throw new Error("Invalid credential response");
      authorize(event);
      return result.value ?? undefined;
    });
    ipcMain.handle("rukie:modelServices:list", async (event) => {
      authorize(event);
      return manage({ type: "list" });
    });
    ipcMain.handle("rukie:modelServices:save", async (event, raw: unknown) => {
      authorize(event);
      const input = parseModelServiceSave(raw);
      if (!input) throw new Error("Invalid model service");
      let credential: { type: "keep" | "delete" } | { type: "replace"; ciphertext: string } = {
        type: input.credential.type === "replace" ? "keep" : input.credential.type,
      };
      if (input.credential.type === "replace") {
        if (!systemEncryptionAvailable(safeStorage))
          throw new Error("Desktop system encryption is unavailable");
        try {
          credential = {
            type: "replace",
            ciphertext: safeStorage
              .encryptString(
                JSON.stringify({
                  identity: `provider:${input.provider.id}`,
                  value: input.credential.value,
                }),
              )
              .toString("base64"),
          };
        } catch {
          throw new Error("Desktop credential operation failed. Retry or reconfigure credentials.");
        }
      }
      await manage({ type: "save", provider: input.provider, credential });
    });
    ipcMain.handle("rukie:modelServices:delete", async (event, id: unknown) => {
      authorize(event);
      if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
        throw new Error("Invalid provider identity");
      await manage({ type: "delete", id });
    });
    ipcMain.handle("rukie:pickProjectFolder", async (event) => {
      authorize(event);
      const result = await dialog.showOpenDialog(window, {
        properties: ["openDirectory", "createDirectory"],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    });
    let stopped: Promise<void> | undefined;
    const stop = () => {
      closing = true;
      return (stopped ??= (async () => {
        try {
          await sidecar.stop();
        } finally {
          await secrets.close();
        }
      })());
    };
    window.on("close", (event) => {
      if (closing) return;
      event.preventDefault();
      closing = true;
      // SIGTERM is the server internal shutdown hook: abort active Runs, then close Sessions.
      void stop().finally(() => window.destroy());
    });
    app.on("before-quit", (event) => {
      if (quitReady) return;
      event.preventDefault();
      closing = true;
      void stop().finally(() => {
        quitReady = true;
        app.quit();
      });
    });
    app.on("window-all-closed", () => app.quit());
    await window.loadURL("app://rukie/");
    // Renderer connection acquisition owns retries; initial failure leaves the window usable.
    if (!closing) void sidecar.getConnection().catch(() => {});
    return { window, stop };
  } catch (error) {
    await acquiredSidecar?.stop();
    await secrets.close();
    acquiredWindow?.destroy();
    throw error;
  }
}
function trustedAddress(address: string): boolean {
  try {
    const url = new URL(address);
    return url.protocol === "app:" && url.host === "rukie" && !url.username && !url.password;
  } catch {
    return false;
  }
}
