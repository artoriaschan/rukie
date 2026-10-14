import { mkdir, realpath, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import type { WireProjectGit, WireWorktree } from "@rukie/shared";

/** Git is always invoked with argument vectors, with no shell or credential/network operation. */
async function git(cwd: string, args: string[]) {
  const child = Bun.spawn(["git", "-C", cwd, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 30_000,
    env: { ...process.env, LC_ALL: "C" },
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}
export class WorktreeFailure extends Error {}

export async function projectGit(primary: string): Promise<WireProjectGit> {
  const unavailable = { repository: false, branch: null, head: "" };
  try {
    const root = await git(primary, ["rev-parse", "--show-toplevel"]);
    if (root.exitCode !== 0 || (await realpath(root.stdout)) !== (await realpath(primary)))
      return unavailable;
    const head = await git(primary, ["rev-parse", "HEAD"]);
    if (head.exitCode !== 0) return unavailable;
    const branch = await git(primary, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
    return {
      repository: true,
      branch: branch.exitCode === 0 ? branch.stdout : null,
      head: head.stdout,
    };
  } catch {
    return unavailable;
  }
}

/** A fresh directory and a separately generated branch id prevent unrelated allocations colliding. */
export async function createWorktree(
  dataRoot: string,
  projectId: string,
  repository: string,
): Promise<WireWorktree> {
  const source = await projectGit(repository);
  if (!source.repository)
    throw new WorktreeFailure(
      "The project primary folder is not a Git repository root with a commit.",
    );
  const id = crypto.randomUUID().replaceAll("-", "").slice(0, 8);
  const parent = join(dataRoot, "worktrees", id);
  const path = join(parent, basename(repository));
  let branch: string | undefined;
  let added = false;
  let allocated = false;
  try {
    await mkdir(join(dataRoot, "worktrees"), { recursive: true });
    await mkdir(parent); // Never reuse another allocation's directory.
    allocated = true;
    for (let attempt = 0; attempt < 16; attempt++) {
      const candidate = `rukie/worktree-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
      const exists = await git(repository, [
        "show-ref",
        "--verify",
        "--quiet",
        `refs/heads/${candidate}`,
      ]);
      if (exists.exitCode === 0) continue;
      const result = await git(repository, [
        "worktree",
        "add",
        "-b",
        candidate,
        path,
        source.branch ?? source.head,
      ]);
      if (result.exitCode === 0) {
        branch = candidate;
        added = true;
        break;
      }
      // A competing writer may create the branch after the initial check.
      if (result.stderr.includes(`a branch named '${candidate}' already exists`)) continue;
      // Git can allocate the branch before failing to populate its directory.
      await git(repository, ["worktree", "remove", "--force", path]).catch(() => {});
      await rm(path, { recursive: true, force: true });
      await git(repository, ["worktree", "prune"]).catch(() => {});
      await git(repository, ["branch", "-D", candidate]).catch(() => {});
      throw new WorktreeFailure(
        (result.stderr || result.stdout || "Git worktree creation failed.").slice(-2000),
      );
    }
    if (!added || !branch)
      throw new WorktreeFailure("Could not allocate an unused worktree branch.");
    return { id, projectId, repository, branch, path, createdAt: Date.now() };
  } catch (error) {
    // parent exists only if this operation acquired it; EEXIST must preserve its contents.
    if (allocated) {
      await rm(parent, { recursive: true, force: true });
      await git(repository, ["worktree", "prune"]).catch(() => {});
    }
    throw new WorktreeFailure(error instanceof Error ? error.message : String(error));
  }
}

/** Roll back only a newly created, unopened allocation; user-owned worktrees never use this path. */
export async function discardUnopenedWorktree(worktree: WireWorktree): Promise<void> {
  const result = await git(worktree.repository, ["worktree", "remove", "--force", worktree.path]);
  if (result.exitCode !== 0)
    throw new WorktreeFailure(result.stderr || "Could not remove unopened worktree.");
  const removed = await git(worktree.repository, ["branch", "-D", worktree.branch]);
  if (removed.exitCode !== 0)
    throw new WorktreeFailure(removed.stderr || "Could not remove unopened branch.");
  await rm(join(worktree.path, ".."), { recursive: true, force: true });
}
