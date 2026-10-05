import { createClipboard } from "./clipboard";

export type ClipboardContent =
  | { files: string[] }
  | { image: { path: string } }
  | { text: string }
  | { empty: true }
  | { unavailable: true };

export interface TuiHost {
  readClipboard(): Promise<ClipboardContent>;
  openExternal(path: string): Promise<void>;
}

/** Own one default host per main invocation and dispose it after Chat stops. */
export function createDefaultHost() {
  const clipboard = createClipboard();
  const host: TuiHost = {
    readClipboard: clipboard.read,
    async openExternal(path) {
      const command =
        process.platform === "darwin"
          ? ["open", path]
          : process.platform === "win32"
            ? ["explorer.exe", path]
            : ["xdg-open", path];
      const child = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
      const exitCode = await child.exited;
      if (exitCode !== 0) throw new Error(`External viewer exited with code ${exitCode}`);
    },
  };
  return { host, dispose: clipboard.dispose };
}

export { createImageViewer } from "./image-viewer";
