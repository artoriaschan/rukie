import { onTestFinished } from "bun:test";
import type { installRelease } from "./installed-fixture.ts";

type Fixture = Awaited<ReturnType<typeof installRelease>>;
type Command = ReturnType<Fixture["start"]>;

/** The runner owns commands even when it abandons an awaiting test body. */
export function createInstalledCommandOwner(fixture: Fixture) {
  let finished = false;
  let cleanupPromise: Promise<void> | undefined;
  const parked = <T>() => new Promise<T>(() => {});
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      finished = true;
      await fixture.cancelCommands();
    })());
  onTestFinished(cleanup);

  function guard<T>(result: Promise<T>): Promise<T> {
    return result.then(
      (value) => (finished ? parked<T>() : value),
      (error: unknown) => {
        if (finished) return parked<T>();
        throw error;
      },
    );
  }

  async function start(argv: string[], options?: Parameters<Fixture["start"]>[1]) {
    if (finished) return parked<Command>();
    const command = fixture.start(argv, options);
    return { child: command.child, result: guard(command.result) };
  }

  function ownCleanup(dispose: () => void | Promise<void>) {
    let resourceCleanup: Promise<void> | undefined;
    const close = () =>
      (resourceCleanup ??= (async () => {
        await fixture.cancelCommands();
        await dispose();
      })());
    onTestFinished(close);
    // Runner hooks must settle; a timed-out caller must not resume acquisition
    // after awaiting cleanup and interfere with the next owner.
    return () => guard(close());
  }

  async function ownMutation(change: () => Promise<void>, restore: () => Promise<void>) {
    let acquired = false;
    const pending = Promise.resolve()
      .then(change)
      .then(() => {
        acquired = true;
      });
    const close = ownCleanup(async () => {
      await pending.catch(() => {});
      if (acquired) await restore();
    });
    await guard(pending);
    return close;
  }

  return {
    start,
    run: async (argv: string[], options?: Parameters<Fixture["start"]>[1]) =>
      (await start(argv, options)).result,
    ownCleanup,
    ownMutation,
    cleanup,
  };
}
