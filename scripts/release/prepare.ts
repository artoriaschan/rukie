import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { GitHub, Manifest } from "release-please";
import { FilePullRequestOverflowHandler } from "release-please/build/src/util/pull-request-overflow-handler";
import { FileNotFoundError } from "release-please/build/src/errors";
import type { Commit } from "release-please/build/src/commit";

const historyLimit = 5000;
const quiet = { info() {}, warn() {}, debug() {}, error() {}, trace() {} };

async function formatReleaseMarkdown(path: string, content: string): Promise<string> {
  const formatter = Bun.spawn(["bunx", "--no", "--", "oxfmt", "--stdin-filepath", path], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)),
    stdin: new Blob([content]),
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(15_000),
  });
  const [output, error, code] = await Promise.all([
    new Response(formatter.stdout).text(),
    new Response(formatter.stderr).text(),
    formatter.exited,
  ]);
  if (code !== 0) throw new Error(`Release Markdown formatting failed for ${path}: ${error}`);
  return output;
}
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected GitHub object");
  return value as Record<string, unknown>;
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Expected GitHub string");
  return value;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new Error("Expected positive GitHub identifier");
  return value;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("Expected GitHub array");
  return value;
}
function sha(value: unknown): string {
  const result = string(value);
  if (!/^[a-f0-9]{40}$/.test(result)) throw new Error("Expected immutable commit SHA");
  return result;
}

/** All attempts are considered; a later failed or unfinished run blocks an older success. */
export function assertSuccessfulCI(values: unknown[], commit: string): number {
  const runs = values
    .map(record)
    .filter(
      (run) =>
        run.head_sha === commit &&
        run.event === "push" &&
        run.head_branch === "main" &&
        run.path === ".github/workflows/ci.yml",
    );
  runs.sort((a, b) => number(b.id) - number(a.id) || number(b.run_attempt) - number(a.run_attempt));
  const latest = runs[0];
  if (!latest || latest.status !== "completed" || latest.conclusion !== "success")
    throw new Error(`Exact commit CI has not succeeded: ${commit}`);
  return number(latest.id);
}

/** Validate the workflow_run payload before exposing the installation token to writes. */
export function passedWorkflow(
  value: unknown,
  repository: string,
): { commit: string; runId: number } {
  const event = record(value);
  const run = record(event.workflow_run);
  if (
    run.event !== "push" ||
    run.head_branch !== "main" ||
    run.conclusion !== "success" ||
    run.status !== "completed" ||
    run.path !== ".github/workflows/ci.yml" ||
    record(run.repository).full_name !== repository ||
    record(run.head_repository).full_name !== repository ||
    record(event.repository).full_name !== repository
  )
    throw new Error("Untrusted CI completion event");
  return { commit: sha(run.head_sha), runId: number(run.id) };
}

/** HTTP failures fail closed; only missing refs/releases are resumable absence. */
export function githubRequest(token: string, transport: typeof fetch = fetch) {
  return async (method: string, path: string, body?: unknown): Promise<unknown> => {
    const response = await transport(`https://api.github.com${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "content-type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 404 && method === "GET" && /\/(git\/ref\/|releases\/tags\/)/.test(path))
      return null;
    if (!response.ok) throw new Error(`GitHub ${method} ${path} failed (${response.status})`);
    return response.json();
  };
}

export interface PreparationInput {
  github: GitHub;
  commit: string;
  commits: Commit[];
  readFile: (path: string, commit: string) => Promise<string | undefined>;
  request: (method: string, path: string, body?: unknown) => Promise<unknown>;
  repository: string;
  triggeringRun: number;
}

/** Release Please owns all version/changelog parsing. Only its mutable GitHub boundary is frozen. */
export async function prepareRelease(input: PreparationInput): Promise<"stale" | "prepared"> {
  const { github, commit, commits, readFile, request, repository } = input;
  sha(commit);
  if (commits.length > historyLimit || commits[0]?.sha !== commit)
    throw new Error(
      "Incomplete or excessive frozen history; increase the explicit history bound after review",
    );
  const ancestry = new Set(commits.map((item) => item.sha));
  const overflowSources = new Map<string, string>();
  const prefix = `/repos/${repository}`;
  const main = async () =>
    sha(record(record(await request("GET", `${prefix}/git/ref/heads/main`)).object).sha);
  const ci = async (target: string) => {
    const response = record(
      await request(
        "GET",
        `${prefix}/actions/workflows/ci.yml/runs?head_sha=${target}&branch=main&event=push&per_page=100`,
      ),
    );
    if (number(response.total_count) > 100) throw new Error("CI run search exceeds bound");
    return assertSuccessfulCI(array(response.workflow_runs), target);
  };
  if ((await ci(commit)) !== input.triggeringRun)
    throw new Error("Trigger is not the latest successful exact-SHA CI run");
  if ((await main()) !== commit) return "stale";
  github.getFileContentsOnBranch = async (path, branch) => {
    // Official overflow metadata links immutable PR commits, never a mutable notes branch.
    const target = branch === "main" ? commit : (overflowSources.get(branch) ?? sha(branch));
    if (!ancestry.has(target) || (branch !== "main" && path !== "release-notes.md"))
      throw new Error("Release metadata read outside frozen history");
    const content = await readFile(path, target);
    if (content === undefined) throw new FileNotFoundError(path);
    return {
      content: Buffer.from(content).toString("base64"),
      parsedContent: content,
      mode: "100644" as const,
      sha: createHash("sha1")
        .update(`blob ${Buffer.byteLength(content)}\0`)
        .update(content)
        .digest("hex"),
    };
  };
  github.mergeCommitIterator = async function* () {
    // Root Manifest assigns all commits independently of file paths; excluded paths are rejected below.
    yield* commits.map((item) => ({ ...item, files: [] }));
  };
  const releases = github.releaseIterator.bind(github);
  github.releaseIterator = async function* () {
    let count = 0;
    for await (const release of releases({ maxResults: historyLimit + 1 })) {
      if (++count > historyLimit) throw new Error("Release search exceeds bound");
      if (ancestry.has(release.sha)) yield release;
    }
  };
  const tags = github.tagIterator.bind(github);
  github.tagIterator = async function* () {
    let count = 0;
    for await (const tag of tags({ maxResults: historyLimit + 1 })) {
      if (++count > historyLimit) throw new Error("Tag search exceeds bound");
      if (ancestry.has(tag.sha)) yield tag;
    }
  };
  const pulls = github.pullRequestIterator.bind(github);
  github.pullRequestIterator = async function* (branch, status) {
    let count = 0;
    for await (const pull of pulls(branch, status, historyLimit + 1, false)) {
      if (++count > historyLimit) throw new Error("Pull request search exceeds bound");
      if (status === "MERGED" && pull.sha && ancestry.has(pull.sha)) {
        const match = pull.body.match(
          /https:\/\/github\.com\/([^\s]+)\/blob\/([a-f0-9]{40})\/release-notes\.md/,
        );
        if (match?.[1] === repository && match[2]) overflowSources.set(match[2], pull.sha);
        yield pull;
      } else if (status !== "MERGED") yield pull;
    }
  };
  const manifest = await Manifest.fromManifest(github, "main", undefined, undefined, {
    logger: quiet,
    commitSearchDepth: historyLimit,
    releaseSearchDepth: historyLimit,
  });
  if (
    Object.keys(manifest.repositoryConfig).join() !== "." ||
    manifest.repositoryConfig["."]?.excludePaths?.length
  )
    throw new Error("Release planning requires the complete root product history");
  const tracking = manifest.releasedVersions["."]?.toString();
  const product = record(
    JSON.parse((await readFile("packages/coding-agent/package.json", commit)) ?? "null"),
  );
  const expectedProduct =
    tracking === "0.0.0" ? manifest.repositoryConfig["."]?.initialVersion : tracking;
  if (typeof expectedProduct !== "string" || product.version !== expectedProduct)
    throw new Error("Product version and automation tracking disagree");
  for (const candidate of await manifest.buildReleases()) {
    const target = sha(candidate.sha);
    if (!ancestry.has(target)) throw new Error("Release commit is outside frozen main history");
    await ci(target);
    const product = record(
      JSON.parse((await readFile("packages/coding-agent/package.json", target)) ?? "null"),
    );
    if (product.version !== candidate.tag.version.toString())
      throw new Error("Release tag disagrees with product manifest");
    if ((candidate.notes?.length ?? 0) > 125000)
      throw new Error(
        "Release notes exceed GitHub body bound; edit full notes in the Release PR before retrying",
      );
    const tagName = candidate.tag.toString();
    const existing = await request("GET", `${prefix}/git/ref/tags/${encodeURIComponent(tagName)}`);
    if (existing !== null) {
      let object = record(record(existing).object);
      let depth = 0;
      while (object.type === "tag") {
        if (++depth > 5) throw new Error("Annotated tag nesting exceeds bound");
        object = record(
          record(await request("GET", `${prefix}/git/tags/${sha(object.sha)}`)).object,
        );
      }
      if (object.type !== "commit" || sha(object.sha) !== target)
        throw new Error("Existing release tag points to a different commit");
    }
    const published = await request(
      "GET",
      `${prefix}/releases/tags/${encodeURIComponent(tagName)}`,
    );
    if (published !== null && existing === null)
      throw new Error("Existing GitHub Release has no resolvable tag");
    if (published === null)
      await github.createRelease(candidate, {
        forceTag: false,
        draft: candidate.draft,
        prerelease: candidate.prerelease,
      });
    await github.addIssueLabels(["autorelease: tagged"], candidate.pullRequest.number);
    await github.removeIssueLabels(["autorelease: pending"], candidate.pullRequest.number);
  }
  for (const proposal of await manifest.buildPullRequests()) {
    const changes = await github.buildChangeSet(proposal.updates, "main");
    if ((await main()) !== commit) return "stale";
    const tree = sha(
      record(record(await request("GET", `${prefix}/git/commits/${commit}`)).tree).sha,
    );
    const fullNotes = proposal.body.toString();
    const overflow = fullNotes.length > 65536;
    if (overflow)
      changes.set("release-notes.md", {
        mode: "100644",
        content: fullNotes,
        originalContent: null,
      });
    // Git API writes bypass local hooks; format generated Markdown before committing it.
    for (const [path, change] of changes)
      if (path.endsWith(".md") && change.content !== null)
        changes.set(path, {
          ...change,
          content: await formatReleaseMarkdown(path, change.content),
        });
    const entries = [...changes].map(([path, change]) => ({
      path,
      mode: change.mode,
      type: "blob",
      ...(change.content === null ? { sha: null } : { content: change.content }),
    }));
    const createdTree = sha(
      record(await request("POST", `${prefix}/git/trees`, { base_tree: tree, tree: entries })).sha,
    );
    const createdCommit = sha(
      record(
        await request("POST", `${prefix}/git/commits`, {
          message: proposal.title.toString(),
          tree: createdTree,
          parents: [commit],
        }),
      ).sha,
    );
    // Git data commits always parent the checked SHA, even if main advances during these writes.
    if ((await main()) !== commit) return "stale";
    const branch = proposal.headRefName;
    const ref = await request("GET", `${prefix}/git/ref/heads/${encodeURIComponent(branch)}`);
    if (ref === null)
      await request("POST", `${prefix}/git/refs`, {
        ref: `refs/heads/${branch}`,
        sha: createdCommit,
      });
    else
      await request("PATCH", `${prefix}/git/refs/heads/${encodeURIComponent(branch)}`, {
        sha: createdCommit,
        force: true,
      });
    const open = array(
      await request(
        "GET",
        `${prefix}/pulls?state=open&base=main&head=${encodeURIComponent(repository.split("/")[0] + ":" + branch)}`,
      ),
    );
    if (open.length > 1) throw new Error("Ambiguous release pull request");
    github.createFileOnNewBranch = async (path, content) => {
      if (!overflow || path !== "release-notes.md" || content !== fullNotes)
        throw new Error("Unexpected overflow storage");
      return `https://github.com/${repository}/blob/${createdCommit}/release-notes.md`;
    };
    const body = {
      title: proposal.title.toString(),
      body: await new FilePullRequestOverflowHandler(github, quiet).handleOverflow(proposal),
    };
    const pull = record(
      open.length
        ? await request("PATCH", `${prefix}/pulls/${number(record(open[0]).number)}`, body)
        : await request("POST", `${prefix}/pulls`, { ...body, head: branch, base: "main" }),
    );
    await github.addIssueLabels(["autorelease: pending"], number(pull.number));
  }
  return "prepared";
}

async function git(...args: string[]): Promise<string> {
  const process = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const [output, error, code] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (code) throw new Error(`Frozen Git read failed: ${error}`);
  return output;
}

if (import.meta.main) {
  const repository = string(process.env.GITHUB_REPOSITORY);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw new Error("Invalid repository");
  const { commit, runId } = passedWorkflow(
    await Bun.file(string(process.env.GITHUB_EVENT_PATH)).json(),
    repository,
  );
  if (
    (await git("rev-parse", "HEAD")).trim() !== commit ||
    (await git("status", "--porcelain")).trim()
  )
    throw new Error("Checkout must be the clean passed CI commit");
  if ((await git("rev-parse", "--is-shallow-repository")).trim() !== "false")
    throw new Error("Release preparation requires full Git history");
  const token = string(process.env.RELEASE_TOKEN);
  const request = githubRequest(token);
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) throw new Error("Missing repository");
  const github = await GitHub.create({ owner, repo, defaultBranch: "main", token, logger: quiet });
  const parts = (
    await git("log", `--max-count=${historyLimit + 1}`, "--format=%H%x00%B%x00", commit)
  ).split("\0");
  const commits: Commit[] = [];
  for (let index = 0; index + 1 < parts.length; index += 2)
    commits.push({ sha: sha(parts[index]?.trim()), message: string(parts[index + 1]) });
  const readFile = async (path: string, target: string) => {
    if (!/^[\w./-]+$/.test(path) || path.includes(".."))
      throw new Error("Unsafe release file path");
    try {
      return await git("show", `${sha(target)}:${path}`);
    } catch {
      return undefined;
    }
  };
  console.log(
    await prepareRelease({
      github,
      commit,
      commits,
      readFile,
      request,
      repository,
      triggeringRun: runId,
    }),
  );
}
