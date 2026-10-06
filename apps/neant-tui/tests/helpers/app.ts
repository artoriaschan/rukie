import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionOptions } from "@neant/agent";
import { main, type TuiIo } from "../../src/main";
import { controlledModel } from "./model";
import { createTerminal } from "./terminal";

export async function start(
  argv: string[] = [],
  options: {
    session?: Partial<SessionOptions>;
    prepare?(root: string): Promise<void>;
    columns?: number;
    rows?: number;
    controlReviews?: boolean;
    controlTitles?: boolean;
    env?: Record<string, string | undefined>;
    host?: Partial<NonNullable<TuiIo["host"]>>;
    /** Drive timer-based UI scenarios without waiting for wall-clock deadlines. */
    advanceTimers?: (ms: number) => void;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "neant-tui-"));
  await options.prepare?.(root);
  await mkdir(join(options.session?.homeDir ?? root, ".neant", "file-history"), {
    recursive: true,
  });
  const terminal = createTerminal(options.columns, options.rows, options.advanceTimers);
  const fake = controlledModel(options.controlReviews, options.controlTitles);
  let stderr = "";
  const exit = main(argv, {
    ...terminal,
    env: options.env ?? { LANG: "zh_CN.UTF-8" },
    host: {
      hasClipboardImage: async () => false,
      readClipboard: async () => ({ unavailable: true }),
      writeClipboard: async () => false,
      openExternal: async () => {},
      ...options.host,
    },
    stderr: (text) => (stderr += text),
    session: { cwd: root, homeDir: root, ...fake, ...options.session },
  });
  let exited = false;
  void exit.then(() => {
    exited = true;
  });
  return {
    root,
    ...terminal,
    ...fake,
    exit,
    stderr: () => stderr,
    async cleanup() {
      await terminal.waitFor(() => exited || terminal.stdin.isRaw);
      // Close views, decline interactions and interrupt Runs through terminal input.
      // Wait for each painted response: views can hide activity while children settle.
      while (!exited && terminal.stdin.isRaw) {
        const beforeInterrupt = terminal.output();
        terminal.stdin.write("\x03\x03\x03");
        await terminal.waitFor(
          () => exited || !terminal.stdin.isRaw || terminal.output() !== beforeInterrupt,
        );
      }
      // Terminal restoration can precede Session disposal and process escalation.
      // Keep driving virtual timers until main's completion signal settles.
      await terminal.waitFor(() => exited, 5000);
      await exit;
      terminal.dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
}
