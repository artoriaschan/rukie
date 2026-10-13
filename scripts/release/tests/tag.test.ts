import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyReleaseTag } from "../tag.ts";

let root: string;
let commit: string;
const active = new Set<{ kill(): void; settled: Promise<void> }>();
async function git(...args: string[]) {
  const child = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const result = Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const owned = {
    kill: () => child.kill(),
    settled: result.then(
      () => {},
      () => {},
    ),
  };
  active.add(owned);
  try {
    const [code, out, err] = await result;
    if (code) throw new Error(err);
    return out.trim();
  } finally {
    active.delete(owned);
  }
}
async function cleanup() {
  for (const child of active) child.kill();
  await Promise.all([...active].map((child) => child.settled));
  if (root) await rm(root, { recursive: true, force: true });
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "rukie publication tag "));
  try {
    await mkdir(join(root, "packages/coding-agent"), { recursive: true });
    await Bun.write(
      join(root, "packages/coding-agent/package.json"),
      JSON.stringify({ version: "0.1.0" }),
    );
    await git("init", "-b", "main");
    await git("add", ".");
    await git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "feat: fixture",
    );
    commit = await git("rev-parse", "HEAD");
    await git("tag", "coding-agent-v0.1.0");
    await git("tag", "coding-agent-v0.2.0");
    await git("checkout", "--orphan", "unrelated");
    await git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "--allow-empty",
      "-m",
      "feat: unrelated",
    );
    await git("tag", "coding-agent-v0.1.0-beta.1");
  } catch (error) {
    await cleanup();
    throw error;
  }
});
afterAll(cleanup);

test("only an existing version tag whose commit belongs to main can enter publication", async () => {
  expect(await verifyReleaseTag(root, "coding-agent-v0.1.0", "main")).toEqual({
    tag: "coding-agent-v0.1.0",
    version: "0.1.0",
    commit,
  });
});
test("publication rejects a branch name instead of a product version tag", async () => {
  await expect(verifyReleaseTag(root, "main", "main")).rejects.toThrow("product version tag");
});
test("publication rejects a version tag that does not exist", async () => {
  await expect(verifyReleaseTag(root, "coding-agent-v0.3.0", "main")).rejects.toThrow();
});
test("publication rejects a version tag that differs from its committed product version", async () => {
  await expect(verifyReleaseTag(root, "coding-agent-v0.2.0", "main")).rejects.toThrow("version");
});
test("publication rejects a version tag whose commit is unreachable from main", async () => {
  await expect(verifyReleaseTag(root, "coding-agent-v0.1.0-beta.1", "main")).rejects.toThrow(
    "reachable",
  );
});

test("rollback shares exact-tag read-only gates and publication concurrency while refusing a first build", async () => {
  const source = await Bun.file(
    new URL("../../../.github/workflows/release-publish.yml", import.meta.url),
  ).text();
  const parsed: unknown = Bun.YAML.parse(source);
  expect(parsed).toMatchObject({
    on: {
      workflow_dispatch: {
        inputs: {
          operation: { type: "choice", default: "publish", options: ["publish", "rollback"] },
        },
      },
    },
    concurrency: { group: "npm-publication", "cancel-in-progress": false },
    jobs: {
      verify: { permissions: { contents: "read", actions: "read" } },
      publish: {
        needs: ["resolve", "verify", "preserve"],
        permissions: { contents: "read", actions: "read", "id-token": "write" },
      },
    },
  });
  expect(source).toContain('test "$GITHUB_REF" = "refs/tags/$RELEASE_TAG"');
  const refuse = source.indexOf('if [ "$RELEASE_OPERATION" = rollback ]');
  expect(refuse).toBeGreaterThan(0);
  expect(source.indexOf("bun run release:build")).toBeGreaterThan(refuse);
  expect(source).toContain('--operation "$RELEASE_OPERATION"');
});
