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
