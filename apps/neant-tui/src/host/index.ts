import { createClipboard } from "./clipboard";

export type ClipboardContent =
  | { files: string[] }
  | { image: { path: string } }
  | { text: string }
  | { empty: true }
  | { unavailable: true };

export interface TuiHost {
  /** Probe clipboard offers without exporting or decoding image bytes. */
  hasClipboardImage(): Promise<boolean>;
  readClipboard(): Promise<ClipboardContent>;
  writeClipboard(text: string): Promise<boolean>;
  /** Open a URL or file path with the operating system's default application. */
  openExternal(target: string): Promise<void>;
}

/** Own one default host per main invocation and dispose it after Chat stops. */
export function createDefaultHost() {
  const clipboard = createClipboard();
  const host: TuiHost = {
    hasClipboardImage: clipboard.hasImage,
    readClipboard: clipboard.read,
    async writeClipboard(text) {
      for (const command of [
        ["pbcopy"],
        ["wl-copy"],
        ["xclip", "-selection", "clipboard"],
        ["xsel", "--clipboard", "--input"],
        ["clip.exe"],
      ]) {
        try {
          const child = Bun.spawn(command, { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
          child.stdin.write(text);
          await child.stdin.end();
          if ((await child.exited) === 0) return true;
        } catch {
          // Missing or unavailable clipboard helpers fall through to the next platform candidate.
        }
      }
      return false;
    },
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
