import { setImmediate } from "node:timers/promises";
import { watch } from "node:fs";
import { dirname } from "node:path";

/** Observe a child process's published file, with a failure bound and no polling. */
export async function waitForFile(path: string): Promise<void> {
  const ready = Promise.withResolvers<void>();
  const observer = watch(dirname(path), () => void check());
  observer.on("error", ready.reject);
  const timeout = setTimeout(() => ready.reject(new Error(`Timed out waiting for ${path}`)), 2000);
  async function check() {
    try {
      if (await Bun.file(path).exists()) ready.resolve();
    } catch (error) {
      ready.reject(error);
    }
  }
  try {
    await check();
    await ready.promise;
  } finally {
    clearTimeout(timeout);
    observer.close();
  }
}

/**
 * Shell redirection opens the marker before writing. Directory events may be coalesced before
 * content is ready, so recheck the positive PID state across I/O turns within the same 2s bound.
 * The read boundary lets fixtures control incomplete publication without sending process signals.
 */
export async function waitForPidFile(
  path: string,
  readText = (path: string) => Bun.file(path).text(),
): Promise<number> {
  const deadline = process.hrtime.bigint() + 2_000_000_000n;
  do {
    if (await Bun.file(path).exists()) {
      const text = await readText(path);
      const pid = Number(text.trim());
      if (Number.isSafeInteger(pid) && pid > 0) return pid;
    }
    if (process.hrtime.bigint() >= deadline) break;
    await setImmediate();
  } while (process.hrtime.bigint() < deadline);
  throw new Error(`Timed out waiting for ${path}`);
}
