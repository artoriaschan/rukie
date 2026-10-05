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

export const defaultHost: TuiHost = {
  async readClipboard() {
    const commands =
      process.platform === "darwin"
        ? [["pbpaste"]]
        : process.platform === "win32"
          ? [["powershell.exe", "-NoProfile", "-Command", "Get-Clipboard -Raw"]]
          : [
              ["wl-paste", "--no-newline"],
              ["xclip", "-selection", "clipboard", "-o"],
              ["xsel", "--clipboard", "--output"],
            ];
    for (const command of commands) {
      try {
        const child = Bun.spawn(command, {
          stdout: "pipe",
          stderr: "ignore",
          env: { ...process.env },
        });
        const text = await new Response(child.stdout).text();
        if ((await child.exited) === 0) return text ? { text } : { empty: true };
      } catch {
        // An unavailable transport can fall through to the next one.
      }
    }
    return { unavailable: true };
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
