import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionOptions } from "@neant/agent";
import { main } from "../../src/main";
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
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), "neant-tui-"));
  await options.prepare?.(root);
  const terminal = createTerminal(options.columns, options.rows);
  const fake = controlledModel(options.controlReviews);
  let stderr = "";
  const exit = main(argv, {
    ...terminal,
    stderr: (text) => (stderr += text),
    session: { cwd: root, homeDir: root, ...fake, ...options.session },
  });
  return {
    ...terminal,
    ...fake,
    exit,
    stderr: () => stderr,
    async cleanup() {
      terminal.stdin.write("\x03");
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
