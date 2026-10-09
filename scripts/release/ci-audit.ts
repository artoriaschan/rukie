import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { verifyReleaseArtifacts } from "./verify.ts";

const root = resolve(import.meta.dir, "../..");
const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { "artifact-dir": { type: "string" }, output: { type: "string" } },
});
const commit = process.env.GITHUB_SHA;
const repository = process.env.GITHUB_REPOSITORY;
const runId = process.env.GITHUB_RUN_ID;
const runAttempt = process.env.GITHUB_RUN_ATTEMPT;
const event = process.env.GITHUB_EVENT_NAME;
if (
  !commit ||
  !/^[a-f0-9]{40}$/.test(commit) ||
  !repository ||
  !/^[\w.-]+\/[\w.-]+$/.test(repository) ||
  !runId ||
  !/^[1-9]\d*$/.test(runId) ||
  !runAttempt ||
  !/^[1-9]\d*$/.test(runAttempt) ||
  !event ||
  !["pull_request", "push", "workflow_dispatch"].includes(event) ||
  !values["artifact-dir"]
)
  throw new Error("CI audit requires artifact directory and valid GitHub run identity");

async function git(args: string[]) {
  const child = Bun.spawn(["git", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(10_000),
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (code !== 0) throw new Error(`CI source identity check failed: ${stderr}`);
  return stdout.trim();
}
if ((await git(["rev-parse", "HEAD"])) !== commit)
  throw new Error("CI checkout commit differs from GITHUB_SHA");
if (await git(["status", "--porcelain", "--untracked-files=normal"]))
  throw new Error(
    "CI checks changed the source checkout; accepted artifacts require a clean commit",
  );

const directory = resolve(values["artifact-dir"]);
const metadata = await verifyReleaseArtifacts(directory, {
  root,
  expectedCommit: commit,
  requireClean: true,
});
// This records identity after the workflow's source/installed gate. It does not
// independently claim that invoking this script ran those checks.
await Bun.write(
  values.output ? resolve(values.output) : join(directory, "ci-acceptance.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      commit,
      platform: metadata.platform,
      repository,
      runId,
      runAttempt,
      event,
      releaseBuildSha256: createHash("sha256")
        .update(await readFile(join(directory, "release-build.json")))
        .digest("hex"),
      packages: metadata.packages,
    },
    null,
    2,
  ) + "\n",
);
