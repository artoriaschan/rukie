import { readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self' data:; connect-src ws://127.0.0.1:*; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".json": "application/json",
  ".wasm": "application/wasm",
};
const inside = (root: string, target: string) => {
  const path = relative(root, target);
  return path !== ".." && !path.startsWith("../") && !isAbsolute(path);
};
/** Files are contained after decoding and resolving symlinks, including the SPA fallback. */
export async function serveAppFile(address: string, directory: string): Promise<Response> {
  try {
    const url = new URL(address);
    if (url.protocol !== "app:" || url.host !== "rukie" || url.username || url.password)
      return new Response("Not found", { status: 404 });
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const root = resolve(directory);
    const file = resolve(root, `.${pathname}`);
    if (!inside(root, file)) return new Response("Forbidden", { status: 403 });
    const target = extname(file) ? file : resolve(root, "index.html");
    const [actualRoot, actualTarget] = await Promise.all([realpath(root), realpath(target)]);
    if (!inside(actualRoot, actualTarget)) return new Response("Forbidden", { status: 403 });
    const body = await readFile(actualTarget);
    const headers = new Headers({
      "content-type": MIME[extname(target)] ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
    });
    if (extname(target) === ".html") headers.set("content-security-policy", CSP);
    return new Response(body, { headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
