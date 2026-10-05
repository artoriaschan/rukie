import { readFile } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { validateImageBytes, type PromptImage } from "@neant/agent";

/** Recognize only one whole local image path; ambiguous pastes stay text. */
export function pastedImagePath(text: string, homeDir: string): string | undefined {
  if (text.length > 4096) return;
  let path = text.trim();
  if (!path || path.includes("\r") || path.includes("\n") || path.includes("\0")) return;
  const quote = path[0];
  if (quote === "'" || quote === '"') {
    if (!path.endsWith(quote) || path.length < 3) return;
    path = path.slice(1, -1);
    if (quote === "'") {
      if (path.includes(quote)) return;
    } else {
      let decoded = "";
      for (let index = 0; index < path.length; index++) {
        const char = path[index]!;
        if (char === '"') return;
        if (char === "\\") {
          const escaped = path[++index];
          if (escaped !== "\\" && escaped !== '"') return;
          decoded += escaped;
        } else decoded += char;
      }
      path = decoded;
    }
  } else if (!path.startsWith("file://")) {
    let decoded = "";
    for (let index = 0; index < path.length; index++) {
      const char = path[index]!;
      if (char === "\\") {
        if (++index >= path.length) return;
        decoded += path[index];
      } else if (/\s|["']/.test(char)) return;
      else decoded += char;
    }
    path = decoded;
  }
  if (path.startsWith("file://")) {
    try {
      path = fileURLToPath(path);
    } catch {
      return;
    }
  }
  if (path.startsWith("~/")) path = homeDir + path.slice(1);
  if (!isAbsolute(path) || !/\.(png|jpe?g|gif|webp)$/i.test(path)) return;
  return path;
}

/** Draft-only image bindings. Visible token order determines model image order. */
export function createComposerImages() {
  const bound = new Map<string, PromptImage>();
  let next = 1;
  return {
    async read(path: string): Promise<PromptImage> {
      const bytes = await readFile(path);
      const info = validateImageBytes(bytes);
      return { data: bytes.toString("base64"), mimeType: info.mimeType, name: basename(path) };
    },
    bind(image: PromptImage, draft: string) {
      let token: string;
      do {
        token = `[Image #${next++}]`;
      } while (draft.includes(token));
      bound.set(token, image);
      return token;
    },
    ranges(text: string) {
      return [...text.matchAll(/\[Image #\d+\]/g)].flatMap((match) =>
        bound.has(match[0]) ? [{ start: match.index, end: match.index + match[0].length }] : [],
      );
    },
    ordered(text: string) {
      const images: PromptImage[] = [];
      const seen = new Set<string>();
      for (const match of text.matchAll(/\[Image #\d+\]/g)) {
        const image = bound.get(match[0]);
        if (image && !seen.has(match[0])) {
          images.push(image);
          seen.add(match[0]);
        }
      }
      return images;
    },
    clear() {
      bound.clear();
    },
  };
}
