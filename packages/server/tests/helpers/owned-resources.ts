import { onTestFinished } from "bun:test";

/** Owns acquisitions before they settle, including setup that completes after a timeout. */
export function ownResources() {
  const releases: (() => Promise<unknown> | unknown)[] = [];
  const pending = new Set<Promise<unknown>>();
  let closing = false;
  let closed: Promise<void> | undefined;
  const close = () =>
    (closed ??= (async () => {
      closing = true;
      await Promise.allSettled(pending);
      const errors: unknown[] = [];
      for (const release of releases.reverse()) {
        try {
          await release();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length) throw new AggregateError(errors, "Fixture cleanup failed");
    })());
  onTestFinished(close);
  return {
    close,
    add(release: () => Promise<unknown> | unknown) {
      if (closing) throw new Error("Fixture already closing");
      releases.push(release);
    },
    async acquire<T>(
      create: () => Promise<T>,
      release: (resource: T) => Promise<unknown> | unknown,
    ): Promise<T> {
      if (closing) throw new Error("Fixture already closing");
      const task = create().then((resource) => {
        releases.push(() => release(resource));
        if (closing) throw new Error("Fixture closed during initialization");
        return resource;
      });
      pending.add(task);
      try {
        return await task;
      } finally {
        pending.delete(task);
      }
    },
  };
}
