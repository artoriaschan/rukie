import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInputHistory } from "../../../src/tui/input-history";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "neant-history-"));
  roots.push(root);
  return root;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("history is scoped to a normalized project and stores multiline text privately", async () => {
  const root = await fixture();
  const history = await createInputHistory(join(root, "project"), root);
  history.remember("  中文👩‍💻\nnext line  ");
  await history.flush();
  expect((await createInputHistory(join(root, "project/../project/"), root)).entries).toEqual([
    "中文👩‍💻\nnext line",
  ]);
  expect((await createInputHistory(join(root, "other"), root)).entries).toEqual([]);
  const directory = join(root, ".neant/input-history");
  const files = await readdir(directory);
  expect(files).toHaveLength(1);
  expect((await stat(join(directory, files[0]!))).mode & 0o777).toBe(0o600);
  expect((await stat(directory)).mode & 0o777).toBe(0o700);
});

test("only the latest 200 distinct consecutive submissions survive in memory and on disk", async () => {
  const root = await fixture();
  const history = await createInputHistory(root, root);
  history.remember(" ");
  for (let index = 0; index < 205; index++) {
    history.remember(`input ${index}`);
    history.remember(`input ${index}`);
  }
  history.remember("input 203");
  await history.flush();
  const stored = (await createInputHistory(root, root)).entries;
  expect(stored).toEqual(history.entries);
  expect(stored).toHaveLength(200);
  expect(stored[0]).toBe("input 6");
  expect(stored.slice(-3)).toEqual(["input 203", "input 204", "input 203"]);
});

test("independent writers preserve both histories and each writer's submission order", async () => {
  const root = await fixture();
  const left = await createInputHistory(root, root);
  const right = await createInputHistory(root, root);
  for (let index = 0; index < 10; index++) {
    left.remember(`left ${index}`);
    right.remember(`right ${index}`);
  }
  await Promise.all([left.flush(), right.flush()]);
  const stored = (await createInputHistory(root, root)).entries;
  expect(stored).toHaveLength(20);
  expect(stored.filter((text) => text.startsWith("left"))).toEqual(
    Array.from({ length: 10 }, (_, index) => `left ${index}`),
  );
  expect(stored.filter((text) => text.startsWith("right"))).toEqual(
    Array.from({ length: 10 }, (_, index) => `right ${index}`),
  );
});

test("corrupt records are ignored and the next save keeps valid history", async () => {
  const root = await fixture();
  const history = await createInputHistory(root, root);
  history.remember("first");
  await history.flush();
  const directory = join(root, ".neant/input-history");
  const file = join(directory, (await readdir(directory))[0]!);
  await writeFile(file, '"first"\n{broken\nnull\n42\n""\n"   "\n"second"\n');
  const restored = await createInputHistory(root, root);
  expect(restored.entries).toEqual(["first", "second"]);
  restored.remember("third");
  await restored.flush();
  expect(await readFile(file, "utf8")).toBe('"first"\n"second"\n"third"\n');
});

test("an unavailable history directory leaves session recall usable and flush resolves", async () => {
  const root = await fixture();
  await writeFile(join(root, ".neant"), "blocked");
  const history = await createInputHistory(root, root);
  history.remember("session only");
  await expect(history.flush()).resolves.toBeUndefined();
  expect(history.entries).toEqual(["session only"]);
});
