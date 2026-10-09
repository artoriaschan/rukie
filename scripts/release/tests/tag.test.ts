import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyReleaseTag } from "../tag.ts";

test("only an existing version tag whose commit belongs to main can enter publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie publication tag "));
  async function git(...args: string[]) {
    const p = Bun.spawn(["git", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
    const [code, out, err] = await Promise.all([
      p.exited,
      new Response(p.stdout).text(),
      new Response(p.stderr).text(),
    ]);
    if (code) throw new Error(err);
    return out.trim();
  }
  try {
    await mkdir(join(root, "packages/coding-agent"), { recursive: true });
    await Bun.write(
      join(root, "packages/coding-agent/package.json"),
      JSON.stringify({ version: "0.1.0" }),
    );
    await git("init", "-b", "main");
    await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "add", ".");
    await git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "commit",
      "-m",
      "feat: fixture",
    );
    const commit = await git("rev-parse", "HEAD");
    await git("tag", "coding-agent-v0.1.0");
    expect(await verifyReleaseTag(root, "coding-agent-v0.1.0", "main")).toEqual({
      tag: "coding-agent-v0.1.0",
      version: "0.1.0",
      commit,
    });
    await expect(verifyReleaseTag(root, "main", "main")).rejects.toThrow("product version tag");
    await expect(verifyReleaseTag(root, "coding-agent-v0.2.0", "main")).rejects.toThrow();
    await git("tag", "coding-agent-v0.2.0");
    await expect(verifyReleaseTag(root, "coding-agent-v0.2.0", "main")).rejects.toThrow("version");
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
    await expect(verifyReleaseTag(root, "coding-agent-v0.1.0-beta.1", "main")).rejects.toThrow(
      "reachable",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
