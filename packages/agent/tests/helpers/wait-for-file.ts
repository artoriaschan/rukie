import { watch } from "node:fs";
import { dirname } from "node:path";

async function observeFile<T>(
  path: string,
  read: () => Promise<{ value: T } | undefined>,
): Promise<T> {
  const ready = Promise.withResolvers<T>();
  const observer = watch(dirname(path), () => void check());
  observer.on("error", ready.reject);
  const timeout = setTimeout(() => ready.reject(new Error(`Timed out waiting for ${path}`)), 2000);
  async function check() {
    try {
      const result = await read();
      if (result) ready.resolve(result.value);
    } catch (error) {
      ready.reject(error);
    }
  }
  try {
    await check();
    return await ready.promise;
  } finally {
    clearTimeout(timeout);
    observer.close();
  }
}

/** Observe a child process's published file, with a failure bound and no polling. */
export async function waitForFile(path: string): Promise<void> {
  await observeFile(path, async () =>
    (await Bun.file(path).exists()) ? { value: true } : undefined,
  );
}

/**
 * Opening a PID marker precedes its write; only a positive safe integer authorizes process signaling.
 * The read boundary lets fixtures synchronize publication on an observed incomplete sample.
 */
export function waitForPidFile(
  path: string,
  readText = (path: string) => Bun.file(path).text(),
): Promise<number> {
  return observeFile(path, async () => {
    if (!(await Bun.file(path).exists())) return undefined;
    const text = await readText(path);
    const pid = Number(text.trim());
    return Number.isSafeInteger(pid) && pid > 0 ? { value: pid } : undefined;
  });
}
