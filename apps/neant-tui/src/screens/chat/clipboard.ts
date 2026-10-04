/** Read only text, trying the host's clipboard transports in order. */
export async function readClipboardText(): Promise<string | undefined> {
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
      if ((await child.exited) === 0) return text;
    } catch {
      // An unavailable transport can fall through to the next one.
    }
  }
  return undefined;
}
