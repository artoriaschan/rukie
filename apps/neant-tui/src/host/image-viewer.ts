import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { PromptImage } from "@neant/agent";
import type { TuiHost } from "./index";

/** One TUI owns its private exports and waits for pending opens before cleanup. */
export function createImageViewer(host: TuiHost) {
  let directory: Promise<string> | undefined;
  let ownedDirectory: string | undefined;
  let closed = false;
  const pending = new Set<Promise<void>>();
  return {
    open(image: PromptImage) {
      if (closed) return Promise.resolve();
      const operation = (async () => {
        directory ??= mkdtemp(join(tmpdir(), "neant-images-")).then(async (path) => {
          ownedDirectory = path;
          await chmod(path, 0o700);
          return path;
        });
        const root = await directory;
        if (closed) return;
        const extension =
          { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[
            image.mimeType
          ] ?? "img";
        const path = join(root, `${randomUUID()}.${extension}`);
        await writeFile(path, Buffer.from(image.data, "base64"), { mode: 0o600 });
        if (!closed) await host.openExternal(path);
      })();
      pending.add(operation);
      void operation.then(
        () => pending.delete(operation),
        () => pending.delete(operation),
      );
      return operation;
    },
    async dispose() {
      closed = true;
      await Promise.allSettled(pending);
      // Creation errors were already shown at the open boundary; still reclaim a
      // directory created before a failed permission change.
      await directory?.catch(() => undefined);
      if (ownedDirectory) await rm(ownedDirectory, { recursive: true, force: true });
    },
  };
}
