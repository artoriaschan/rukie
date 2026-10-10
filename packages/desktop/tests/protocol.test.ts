import { afterEach, expect, test } from "vitest";
import { mkdtemp, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveAppFile } from "../src/main/protocol.ts";
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.map((path) => rm(path, { recursive: true, force: true })));
  directories.length = 0;
});
test("app files serve routes with CSP and reject decoded traversal and symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-app-"));
  directories.push(root);
  await writeFile(join(root, "index.html"), "<main>rukie</main>");
  await writeFile(join(root, "main.js"), "export {};");
  const route = await serveAppFile("app://rukie/sessions/id", root);
  expect(await route.text()).toBe("<main>rukie</main>");
  expect(route.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(route.headers.get("content-security-policy")).toContain("connect-src ws://127.0.0.1:*");
  expect((await serveAppFile("app://rukie/main.js", root)).headers.get("content-type")).toBe(
    "text/javascript; charset=utf-8",
  );
  expect((await serveAppFile("app://other/", root)).status).toBe(404);
  expect((await serveAppFile("app://rukie/assets/..%2f..%2fsecret", root)).status).toBe(403);
  await symlink(tmpdir(), join(root, "escape"));
  expect((await serveAppFile("app://rukie/escape/leak.js", root)).status).toBe(404);
  await symlink(join(root, ".."), join(root, "outside.js"));
  expect((await serveAppFile("app://rukie/outside.js", root)).status).toBe(403);
  expect((await serveAppFile("app://rukie/%ZZ", root)).status).toBe(400);
});
