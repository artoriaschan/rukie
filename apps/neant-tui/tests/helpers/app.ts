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
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "neant-tui-"));
  await options.prepare?.(root);
  await mkdir(join(options.session?.homeDir ?? root, ".neant", "file-history"), {
    recursive: true,
  });
  const terminal = createTerminal(options.columns, options.rows);
  const fake = controlledModel(options.controlReviews, options.controlTitles);
  let stderr = "";
  const exit = main(argv, {
    ...terminal,
    env: options.env ?? { LANG: "zh_CN.UTF-8" },
    host: {
      hasClipboardImage: async () => false,
      readClipboard: async () => ({ unavailable: true }),
      openExternal: async () => {},
      ...options.host,
    },
    stderr: (text) => (stderr += text),
    session: { cwd: root, homeDir: root, ...fake, ...options.session },
  });
  return {
    root,
    ...terminal,
    ...fake,
    exit,
    stderr: () => stderr,
    async cleanup() {
      // Folded questions expand, then decline; the final key interrupts the Run.
      terminal.stdin.write("\x03\x03\x03");
      await terminal.waitFor(
        () => !fake.calls.at(-1) || fake.calls.at(-1)!.signal!.aborted || !terminal.isWorking(),
      );
      await Bun.sleep(40);
      terminal.stdin.write("\x03\x03\x03");
      await exit;
      terminal.dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
}
