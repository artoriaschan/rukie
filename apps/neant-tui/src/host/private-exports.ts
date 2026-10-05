import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Instance-owned 0700/0600 exports; disposal closes admission and waits for users. */
export function createPrivateExports(prefix: string) {
  let closed = false;
  let directory: Promise<string> | undefined;
  let ownedDirectory: string | undefined;
  const pending = new Set<Promise<unknown>>();
  function track<T>(operation: Promise<T>): Promise<T> {
    pending.add(operation);
    void operation.then(
      () => pending.delete(operation),
      () => pending.delete(operation),
    );
    return operation;
  }
  return {
    get closed() {
      return closed;
    },
    /** Track the complete read/open operation, including external use of its file. */
    track,
    write(extension: string, write: (path: string) => Promise<void>) {
      return track(
        (async () => {
          if (closed) return;
          directory ??= mkdtemp(join(tmpdir(), prefix))
            .then(async (path) => {
              try {
                await chmod(path, 0o700);
              } catch (error) {
                await rm(path, { recursive: true, force: true });
                throw error;
              }
              ownedDirectory = path;
              return path;
            })
            .catch((error: unknown) => {
              directory = undefined;
              throw error;
            });
          const root = await directory;
          if (closed) return;
          const path = join(root, `${randomUUID()}.${extension}`);
          await writeFile(path, new Uint8Array(), { flag: "wx", mode: 0o600 });
          try {
            await write(path);
            await chmod(path, 0o600);
            return path;
          } catch (error) {
            await rm(path, { force: true });
            throw error;
          }
        })(),
      );
    },
    async dispose() {
      closed = true;
      await Promise.allSettled(pending);
      await directory?.catch(() => undefined);
      if (ownedDirectory) await rm(ownedDirectory, { recursive: true, force: true });
    },
  };
}
