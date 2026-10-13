import { onTestFinished } from "bun:test";
import { createSession, type Session } from "../../src/index.ts";
import { tempDirs } from "./temp-dirs.ts";

const finished = new Promise<never>(() => {});

/**
 * Own initialization and one sequential operation before the runner expires the body.
 * A step without a cancellation input must complete on its own; these fixtures use
 * finite filesystem I/O and immediately replying models for manual Compaction.
 */
export function ownSessionFixture() {
  const lifetime = new AbortController();
  const sessions: Session[] = [];
  let dirs: Awaited<ReturnType<typeof tempDirs>> | undefined;
  let pending: Promise<unknown> | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      lifetime.abort(new Error("Session fixture finished"));
      try {
        // Run cancellation settles admission before Harness/storage closure. Operations
        // without a cancellation input (such as compact) finish before closure as well.
        await pending?.catch(() => {});
      } finally {
        try {
          await Promise.all(sessions.map((session) => session.close()));
        } finally {
          await dirs?.cleanup();
        }
      }
    })());
  onTestFinished(cleanup);
  const step = <T>(work: () => Promise<T>): Promise<T> => {
    if (lifetime.signal.aborted) return finished;
    const result = work();
    pending = result;
    // The timeout is already reported by Bun. Keep its expired body from acquiring
    // another resource or throwing into the next case after its raw cleanup settles.
    return result.then(
      (value) => (lifetime.signal.aborted ? finished : value),
      (error: unknown) => (lifetime.signal.aborted ? finished : Promise.reject(error)),
    );
  };
  return {
    signal: lifetime.signal,
    cleanup,
    step,
    initialize: () => step(async () => (dirs = await tempDirs())),
    open: (options: Parameters<typeof createSession>[0]) =>
      step(async () => {
        const session = await createSession({
          ...options,
          initializationSignal: lifetime.signal,
        });
        sessions.push(session);
        return session;
      }),
    run: (session: Session, prompt: string, options?: Parameters<Session["run"]>[1]) =>
      step(() => session.run(prompt, { ...options, signal: lifetime.signal })),
  };
}
