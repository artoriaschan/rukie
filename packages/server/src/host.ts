import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, sep } from "node:path";
import type { WireCommand } from "@rukie/shared";

export type HostExecutor = (
  argv: readonly string[],
) => Promise<{ exitCode: number; stdout: string }>;
export const executeHost: HostExecutor = async (argv) => {
  const child = Bun.spawn([...argv], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
  const [exitCode, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  return { exitCode, stdout };
};
export class HostError extends Error {
  constructor(readonly code: "unsupported" | "invalid_command") {
    super(code);
  }
}
const folderScript =
  'try\nset folders to choose folder with multiple selections allowed\nset paths to {}\nrepeat with folder in folders\nset end of paths to POSIX path of folder\nend repeat\nset AppleScript\'s text item delimiters to ASCII character 10\nreturn paths as text\non error number -128\nreturn ""\nend try';
/** Only canonical descendants may launch native applications; symlink escapes are rejected. */
export async function hostOperation(
  command: Extract<WireCommand, { type: `host.${string}` }>,
  options: { platform: NodeJS.Platform; execute: HostExecutor; roots: string[] },
) {
  if (command.type === "host.pickFolder") {
    if (options.platform !== "darwin") throw new HostError("unsupported");
    const result = await options.execute(["/usr/bin/osascript", "-e", folderScript]);
    if (result.exitCode !== 0) throw new Error("Host operation failed");
    const path = result.stdout.replace(/\r?\n$/, "");
    if (!path) return null;
    const paths = path.split(/\r?\n/);
    for (const selected of paths)
      if (!isAbsolute(selected) || selected.includes("\0") || !(await stat(selected)).isDirectory())
        throw new HostError("invalid_command");
    return Promise.all(paths.map((selected) => realpath(selected)));
  }
  if (!isAbsolute(command.path) || command.path.includes("\0"))
    throw new HostError("invalid_command");
  const path = await realpath(command.path).catch(() => undefined);
  if (!path) throw new HostError("invalid_command");
  const roots = await Promise.all(
    options.roots.map((root) => realpath(root).catch(() => undefined)),
  );
  if (
    !roots.some((root) => {
      if (!root) return false;
      const child = relative(root, path);
      return (
        child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`))
      );
    })
  )
    throw new HostError("invalid_command");
  const directory = (await stat(path)).isDirectory();
  if (command.type === "host.openInTerminal" && !directory) throw new HostError("invalid_command");
  let argv: string[];
  switch (options.platform) {
    case "darwin":
      argv =
        command.type === "host.revealPath"
          ? ["/usr/bin/open", "-R", path]
          : ["/usr/bin/open", "-a", "Terminal", path];
      break;
    case "linux":
      argv =
        command.type === "host.revealPath"
          ? ["xdg-open", directory ? path : dirname(path)]
          : ["x-terminal-emulator", "--working-directory", path];
      break;
    case "win32":
      argv =
        command.type === "host.revealPath"
          ? ["explorer.exe", "/select,", path]
          : ["wt.exe", "-d", path];
      break;
    default:
      throw new HostError("unsupported");
  }
  if ((await options.execute(argv)).exitCode !== 0) throw new Error("Host operation failed");
  return null;
}
