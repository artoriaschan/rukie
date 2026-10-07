import { writeFile } from "node:fs/promises";
import type { PromptImage } from "@rukie/agent";
import type { TuiHost } from "./index";
import { createPrivateExports } from "./private-exports";

/** One TUI owns its private exports and waits for pending opens before cleanup. */
export function createImageViewer(host: Pick<TuiHost, "openExternal">) {
  const exports = createPrivateExports("rukie-images-");
  return {
    open(image: PromptImage) {
      if (exports.closed) return Promise.resolve();
      return exports.track(
        (async () => {
          const extension =
            { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" }[
              image.mimeType
            ] ?? "img";
          const path = await exports.write(extension, (path) =>
            writeFile(path, Buffer.from(image.data, "base64")),
          );
          if (path && !exports.closed) await host.openExternal(path);
        })(),
      );
    },
    dispose: exports.dispose,
  };
}
