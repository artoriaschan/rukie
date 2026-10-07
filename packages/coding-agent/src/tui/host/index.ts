import { dirname } from "node:path";
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
  /** true confirms a native helper/tmux buffer; sent means unacknowledged terminal OSC submission. */
  writeClipboard(text: string): Promise<boolean | "sent">;
  /** Open a URL or file path with the operating system's default application. */
  openExternal(target: string): Promise<void>;
  /** Show a file in the operating system file manager. */
  reveal(path: string): Promise<void>;
}

/** Own one default host per main invocation and dispose it after Chat stops. */
export function createDefaultHost(
  options: {
    env?: Record<string, string | undefined>;
    /** Write a clipboard control sequence through the calling terminal's transport. */
    writeTerminal?(text: string): void;
  } = {},
) {
  const env = options.env ?? process.env;
  let disposed = false;
  let nativeWinner: string[] | undefined;
  const helpers = new Set<() => void>();
  async function run(command: string[], text: string) {
    try {
      const child = Bun.spawn(command, { env, stdin: "pipe", stdout: "ignore", stderr: "ignore" });
      const stop = () => {
        child.kill("SIGKILL");
      };
      helpers.add(stop);
      const timeout = setTimeout(stop, 2000);
      try {
        child.stdin.write(text);
        await child.stdin.end();
        return (await child.exited) === 0;
      } finally {
        clearTimeout(timeout);
        helpers.delete(stop);
      }
    } catch {
      return false;
    }
  }
  const clipboard = createClipboard();
  const host: TuiHost = {
    hasClipboardImage: clipboard.hasImage,
    readClipboard: clipboard.read,
    async writeClipboard(text) {
      if (disposed) return false;
      let native = false;
      if (!env.SSH_CONNECTION) {
        const commands =
          process.platform === "darwin"
            ? [["pbcopy"]]
            : process.platform === "win32"
              ? [["clip.exe"]]
              : [
                  ["wl-copy"],
                  ["xclip", "-selection", "clipboard"],
                  ["xsel", "--clipboard", "--input"],
                ];
        const winner = nativeWinner;
        const ordered = winner
          ? [winner, ...commands.filter((command) => command[0] !== winner[0])]
          : commands;
        for (const command of ordered)
          if (await run(command, text)) {
            nativeWinner = command;
            native = true;
            break;
          }
      }
      const payload = `\x1b]52;c;${Buffer.from(text).toString("base64")}`;
      let tmux = false;
      if (env.TMUX)
        tmux = await run(
          ["tmux", "load-buffer", ...(env.LC_TERMINAL === "iTerm2" ? [] : ["-w"]), "-"],
          text,
        );
      if (disposed) return false;
      if (options.writeTerminal) {
        const osc = payload + (tmux || !env.TERM?.includes("kitty") ? "\x07" : "\x1b\\");
        const sequence = tmux
          ? `\x1bPtmux;${osc.replaceAll("\x1b", "\x1b\x1b")}\x1b\\`
          : env.STY
            ? `\x1bP${osc}\x1b\\`
            : osc;
        try {
          options.writeTerminal(sequence);
          return native || tmux ? true : "sent";
        } catch {
          return native || tmux;
        }
      }
      return native || tmux;
    },
    async reveal(path) {
      const command =
        process.platform === "darwin"
          ? ["open", "-R", path]
          : process.platform === "win32"
            ? ["explorer.exe", `/select,${path}`]
            : ["xdg-open", dirname(path)];
      const child = Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
      const exitCode = await child.exited;
      if (exitCode !== 0) throw new Error(`File manager exited with code ${exitCode}`);
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
  return {
    host,
    async dispose() {
      disposed = true;
      for (const stop of helpers) stop();
      await clipboard.dispose();
    },
  };
}

export { createImageViewer } from "./image-viewer";
