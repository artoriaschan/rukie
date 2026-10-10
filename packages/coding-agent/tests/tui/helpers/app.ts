import { onTestFinished } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadSettings, listSessions, type SessionOptions } from "@rukie/agent";
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
  const lifetime = new AbortController();
  const root = await mkdtemp(join(tmpdir(), "rukie-tui-"));
  let terminal: ReturnType<typeof createTerminal> | undefined;
  let shutdown: (() => Promise<void>) | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      lifetime.abort();
      try {
        await shutdown?.();
      } finally {
        try {
          terminal?.dispose();
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    })());
  // The runner awaits this even when a timed-out test body is still suspended.
  onTestFinished(cleanup);
  try {
    await options.prepare?.(root);
    lifetime.signal.throwIfAborted();
    await mkdir(join(options.session?.homeDir ?? root, ".rukie", "file-history"), {
      recursive: true,
    });
    lifetime.signal.throwIfAborted();
    terminal = createTerminal(options.columns, options.rows, options.advanceTimers);
    const fake = controlledModel(options.controlReviews, options.controlTitles);
    const session: SessionOptions = { cwd: root, homeDir: root, ...fake, ...options.session };
    if (session.model && session.models === fake.models && session.model !== fake.model) {
      // Explicit fixture model metadata must agree with the native provider catalog.
      const fixtureModel = session.model;
      fake.models.setProvider({
        ...fake.provider,
        id: fixtureModel.provider,
        getModels: () => [fixtureModel],
        getAllModels: () => [fixtureModel],
      });
    }
    // Clearing only the model requests configured metadata with the controlled provider.
    // Clearing both native inputs deliberately retains the real SDK/configuration seam.
    if (!session.model && session.models === fake.models) {
      const loaded = await loadSettings({ cwd: session.cwd, homeDir: session.homeDir });
      const settings = { ...loaded.settings, ...session.settings };
      const resumeIndex = argv.indexOf("--resume");
      const resumeId = session.resumeId ?? (resumeIndex >= 0 ? argv[resumeIndex + 1] : undefined);
      const stored = resumeId
        ? (
            await listSessions({ cwd: session.cwd, homeDir: session.homeDir, store: session.store })
          ).find((entry) => entry.id === resumeId)
        : undefined;
      session.model = fake.configuredModel({
        ...settings,
        ...(stored ? { model: stored.model } : {}),
      });
    }
    let stderr = "";
    lifetime.signal.throwIfAborted();
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
    void exit.then(
      () => {
        exited = true;
      },
      () => {
        exited = true;
      },
    );
    const activeTerminal = terminal;
    shutdown = async () => {
      lifetime.abort();
      await activeTerminal.waitFor(() => exited, 5000);
      await exit;
    };
    return {
      root,
      ...terminal,
      ...fake,
      // A timed-out body's predicate loop must stop before another owner starts.
      waitFor: (predicate: () => boolean, timeoutMs?: number) =>
        activeTerminal.waitFor(predicate, timeoutMs, lifetime.signal),
      exit,
      shutdown,
      stderr: () => stderr,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
