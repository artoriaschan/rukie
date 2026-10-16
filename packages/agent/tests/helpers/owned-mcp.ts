import { jest, onTestFinished } from "bun:test";
import { createSession, type McpHost } from "../../src/index.ts";

/** Own MCP fixtures before acquisition, unblock protocol barriers before shutdown, restore clocks last. */
export function ownMcpFixture() {
  const lifetime = new AbortController();
  const releases: (() => unknown | Promise<unknown>)[] = [];
  const barriers: (() => void)[] = [];
  const pending = new Set<Promise<unknown>>();
  const expired = new Promise<never>(() => {});
  let closing = false;
  let clock = false;
  let cleanup: Promise<void> | undefined;
  const close = () =>
    (cleanup ??= (async () => {
      closing = true;
      lifetime.abort(new Error("MCP fixture finished"));
      for (const release of barriers) release();
      await Promise.allSettled(pending);
      const errors: unknown[] = [];
      try {
        for (const release of releases.reverse()) {
          try {
            await release();
          } catch (error) {
            errors.push(error);
          }
        }
      } finally {
        if (clock) jest.useRealTimers();
      }
      if (errors.length) throw new AggregateError(errors, "MCP fixture cleanup failed");
    })());
  onTestFinished(close);
  const acquire = <T>(
    create: () => Promise<T>,
    release: (value: T) => unknown | Promise<unknown>,
  ): Promise<T> => {
    if (closing) return expired;
    const task = create().then((value) => {
      releases.push(() => release(value));
      return value;
    });
    pending.add(task);
    return task.then(
      (value) => {
        pending.delete(task);
        return closing ? expired : value;
      },
      (error: unknown) => {
        pending.delete(task);
        return closing ? expired : Promise.reject(error);
      },
    );
  };
  return {
    close,
    acquire,
    own<T>(value: T, release: (value: T) => unknown | Promise<unknown>): T {
      if (closing) throw new Error("MCP fixture already closing");
      releases.push(() => release(value));
      return value;
    },
    unblock: (release: () => void) => barriers.push(release),
    fakeTimers() {
      clock = true;
      jest.useFakeTimers();
    },
    prepareRun: (view: ReturnType<McpHost["acquire"]>) =>
      acquire(
        () => view.prepareRun({ signal: lifetime.signal }),
        () => {},
      ),
    open: (options: Parameters<typeof createSession>[0]) =>
      acquire(
        () => createSession({ ...options, initializationSignal: lifetime.signal }),
        (session) => session.close(),
      ),
  };
}
