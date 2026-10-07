import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings, type SessionOptions } from "@rukie/agent";
import { main, type TuiIo } from "../../../src/index.ts";
import { controlledModel } from "./model";
import { createTerminal } from "./terminal";

export async function start(
  argv: string[] = [],
  options: {
    session?: Partial<SessionOptions>;
    signal?: AbortSignal;
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
  const root = await mkdtemp(join(tmpdir(), "rukie-tui-"));
  await options.prepare?.(root);
  await mkdir(join(options.session?.homeDir ?? root, ".rukie", "file-history"), {
    recursive: true,
  });
  const terminal = createTerminal(options.columns, options.rows, options.advanceTimers);
  const fake = controlledModel(options.controlReviews, options.controlTitles);
  const session: SessionOptions = { cwd: root, homeDir: root, ...fake, ...options.session };
  // Clearing only the model requests configured metadata with the controlled provider.
  // Clearing both native inputs deliberately retains the real SDK/configuration seam.
  if (!session.model && session.models === fake.models) {
    const loaded = await loadSettings({ cwd: session.cwd, homeDir: session.homeDir });
    session.model = fake.configuredModel({ ...loaded.settings, ...session.settings });
  }
  let stderr = "";
  const lifetime = new AbortController();
  const exit = main(argv, {
    ...terminal,
    signal: options.signal ? AbortSignal.any([options.signal, lifetime.signal]) : lifetime.signal,
    env: options.env ?? { LANG: "zh_CN.UTF-8" },
    host: {
      hasClipboardImage: async () => false,
      readClipboard: async () => ({ unavailable: true }),
      writeClipboard: async () => false,
      openExternal: async () => {},
      reveal: async () => {},
      ...options.host,
    },
    stderr: (text) => (stderr += text),
    session,
  });
  let exited = false;
  void exit.then(() => {
    exited = true;
  });
  const shutdown = async () => {
    lifetime.abort();
    await terminal.waitFor(() => exited, 5000);
    await exit;
  };
  return {
    root,
    ...terminal,
    ...fake,
    exit,
    shutdown,
    stderr: () => stderr,
    async cleanup() {
      // Process shutdown closes the durable owner even after a failed storage invocation.
      await shutdown();
      terminal.dispose();
      await rm(root, { recursive: true, force: true });
    },
  };
}
