import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  shell,
  type IpcMainInvokeEvent,
} from "electron";
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { Sidecar, type SidecarOptions } from "./sidecar.ts";
import { serveAppFile } from "./protocol.ts";

export interface DesktopOptions {
  rendererDirectory: string;
  preload: string;
  sidecar: SidecarOptions;
  sidecarEnvironment?: Promise<NodeJS.ProcessEnv>;
  userDataDirectory?: string;
}

/** Electron owns native operations and child lifetime; Agent Core stays in the sidecar. */
export async function startDesktop(options: DesktopOptions) {
  protocol.registerSchemesAsPrivileged([
    { scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
  if (options.userDataDirectory) app.setPath("userData", options.userDataDirectory);
  await app.whenReady();
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 420,
    minHeight: 400,
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: options.preload,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
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
    ...(options.sidecarEnvironment && {
      env: { ...(await options.sidecarEnvironment), ...options.sidecar.env },
    }),
    onChange: (state) => {
      options.sidecar.onChange?.(state);
      if (!window.isDestroyed()) window.webContents.send("rukie:connection-change", state);
    },
  });
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
  ipcMain.handle("rukie:pickProjectFolder", async (event) => {
    authorize(event);
    const result = await dialog.showOpenDialog(window, {
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("rukie:revealPath", async (event, input: unknown) => {
    authorize(event);
    shell.showItemInFolder(pathArgument(input));
  });
  ipcMain.handle("rukie:openInTerminal", async (event, input: unknown) => {
    authorize(event);
    const path = pathArgument(input);
    if (!(await stat(path)).isDirectory()) throw new Error("Terminal path must be a directory");
    await new Promise<void>((resolve, reject) => {
      // Argument-vector execution keeps project paths out of shell/AppleScript source.
      const child = spawn("/usr/bin/open", ["-a", "Terminal", path], { stdio: "ignore" });
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(new Error("Terminal could not be opened")),
      );
    });
  });
  const stop = () => sidecar.stop();
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
}
function trustedAddress(address: string): boolean {
  try {
    const url = new URL(address);
    return url.protocol === "app:" && url.host === "rukie" && !url.username && !url.password;
  } catch {
    return false;
  }
}
function pathArgument(input: unknown): string {
  if (typeof input !== "string" || !isAbsolute(input) || input.includes("\0"))
    throw new Error("Expected an absolute path");
  return input;
}
