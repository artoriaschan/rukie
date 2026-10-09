import { expect, test } from "bun:test";
import { assertSuccessfulCI } from "../prepare";
test("newest failed exact-SHA CI masks old success", () => {
  expect(() =>
    assertSuccessfulCI(
      [
        {
          id: 2,
          run_attempt: 2,
          head_sha: "a".repeat(40),
          event: "push",
          head_branch: "main",
          path: ".github/workflows/ci.yml",
          status: "completed",
          conclusion: "failure",
        },
        {
          id: 1,
          run_attempt: 1,
          head_sha: "a".repeat(40),
          event: "push",
          head_branch: "main",
          path: ".github/workflows/ci.yml",
          status: "completed",
          conclusion: "success",
        },
      ],
      "a".repeat(40),
    ),
  ).toThrow();
});

import { GitHub, Manifest } from "release-please";
import { FileNotFoundError } from "release-please/build/src/errors";
import { githubRequest, passedWorkflow, prepareRelease } from "../prepare";
import type { ManifestConfig } from "release-please/build/src/manifest";
const A = "a".repeat(40),
  B = "b".repeat(40),
  C = "c".repeat(40);
const quiet = { info() {}, warn() {}, debug() {}, error() {}, trace() {} };
const stable: ManifestConfig = await Bun.file(
  new URL("../../../release-please-config.json", import.meta.url),
).json();
async function fixture(
  options: {
    message?: string;
    version?: string;
    config?: ManifestConfig;
    moving?: number;
    merged?: boolean;
    failure?: boolean;
    tag?: string;
  } = {},
) {
  const version = options.version;
  const files: Record<string, string> = {
    "release-please-config.json": JSON.stringify(options.config ?? stable),
    ".release-please-manifest.json": JSON.stringify({ ".": version ?? "0.0.0" }),
    "packages/coding-agent/package.json": JSON.stringify({
      name: "@rukie/coding-agent",
      version: version ?? "0.1.0",
    }),
  };
  const github = await GitHub.create({
    owner: "example",
    repo: "rukie",
    defaultBranch: "main",
    logger: quiet,
    fetch: async () => {
      throw new Error("Network forbidden");
    },
  });
  github.getFileContentsOnBranch = async (path) => {
    const content = files[path];
    if (content === undefined) throw new FileNotFoundError(path);
    return {
      content: Buffer.from(content).toString("base64"),
      parsedContent: content,
      mode: "100644" as const,
      sha: "",
    };
  };
  github.mergeCommitIterator = async function* () {
    yield {
      sha: A,
      message: options.message ?? "feat: initial CLI",
      files: ["packages/agent/src/session.ts", "bun.lock"],
    };
    yield { sha: B, message: "chore: baseline", files: [] };
  };
  github.releaseIterator = async function* () {
    if (version && !options.merged)
      yield {
        id: 1,
        tagName: "coding-agent-v" + version,
        sha: B,
        url: "https://example.invalid/release",
      };
  };
  github.tagIterator = async function* () {
    if (version && !options.merged) yield { name: "coding-agent-v" + version, sha: B };
  };
  github.pullRequestIterator = async function* () {};
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const labels: string[][] = [];
  github.addIssueLabels = async (value) => {
    labels.push(value);
  };
  github.removeIssueLabels = async () => {};
  let mainReads = 0;
  const request = async (method: string, path: string, body?: unknown): Promise<unknown> => {
    calls.push({ method, path, body });
    if (path.includes("actions/workflows"))
      return {
        total_count: 1,
        workflow_runs: [
          {
            id: 10,
            run_attempt: 1,
            head_sha: A,
            event: "push",
            head_branch: "main",
            path: ".github/workflows/ci.yml",
            status: "completed",
            conclusion: options.failure ? "failure" : "success",
          },
        ],
      };
    if (path.endsWith("ref/heads/main"))
      return { object: { sha: ++mainReads >= (options.moving ?? Infinity) ? B : A } };
    if (path.includes("git/ref/tags/"))
      return options.tag ? { object: { type: "commit", sha: options.tag } } : null;
    if (path.includes("releases/tags/")) return null;
    if (path.endsWith("git/commits/" + A)) return { tree: { sha: C } };
    if (path.includes("git/ref/heads/")) return null;
    if (path.includes("pulls?")) return [];
    if (path.endsWith("/pulls")) return { number: 42 };
    return { sha: C };
  };
  const input = {
    github,
    commit: A,
    commits: [
      {
        sha: A,
        message: options.message ?? "feat: initial CLI",
        files: ["packages/agent/src/session.ts", "bun.lock"],
      },
      { sha: B, message: "chore: baseline", files: [] },
    ],
    readFile: async (path: string, _target: string) => files[path],
    request,
    repository: "example/rukie",
    triggeringRun: 10,
  };
  return { github, files, input, calls, labels };
}
for (const [message, expected] of [
  ["feat: compatible", "0.1.1"],
  ["fix: correction", "0.1.1"],
  ["perf: faster", "0.1.1"],
  ["feat!: incompatible", "0.2.0"],
  ["chore!: incompatible build", "0.2.0"],
  ["test: tests\n\nBREAKING CHANGE: altered contract", "0.2.0"],
  ["docs: guide", null],
  ["test: coverage", null],
  ["chore: upkeep", null],
] as const) {
  test(`official root strategy: ${message}`, async () => {
    const { github } = await fixture({ message, version: "0.1.0" });
    const manifest = await Manifest.fromManifest(github, "main", undefined, undefined, {
      logger: quiet,
    });
    const proposals = await manifest.buildPullRequests();
    expect(proposals[0]?.version?.toString() ?? null).toBe(expected);
    if (expected) {
      const changes = await github.buildChangeSet(proposals[0]!.updates, "main");
      expect([...changes.keys()].sort()).toEqual(
        [
          ".release-please-manifest.json",
          "CHANGELOG.md",
          "packages/coding-agent/package.json",
        ].sort(),
      );
      expect(JSON.parse(changes.get("packages/coding-agent/package.json")!.content!).version).toBe(
        expected,
      );
      expect(changes.get("CHANGELOG.md")!.content).toContain(expected);
      if (message.includes("!") || message.includes("BREAKING CHANGE"))
        expect(changes.get("CHANGELOG.md")!.content).toContain("BREAKING CHANGES");
    }
  });
}
for (const [version, message, prerelease, expected] of [
  ["0.1.1", "feat: beta", true, "0.1.2-beta.1"],
  ["0.1.2-beta.1", "fix: beta", true, "0.1.2-beta.2"],
  ["0.1.2-beta.2", "feat!: breaking", true, "0.2.0-beta.2"],
  ["0.1.2-beta.2", "fix: stabilize", false, "0.1.2"],
] as const) {
  test(`official prerelease strategy ${version} -> ${expected}`, async () => {
    const config = structuredClone(stable);
    Object.assign(config.packages["."]!, {
      versioning: "prerelease",
      prerelease,
      "prerelease-type": "beta.1",
    });
    const { github } = await fixture({ version, message, config });
    const manifest = await Manifest.fromManifest(github, "main", undefined, undefined, {
      logger: quiet,
    });
    expect((await manifest.buildPullRequests())[0]?.version?.toString()).toBe(expected);
  });
}
test("bootstrap plans0.1.0 and writes checked-parent tree through production adapter", async () => {
  const { input, calls } = await fixture();
  expect(await prepareRelease(input)).toBe("prepared");
  const commit = calls.find((call) => call.method === "POST" && call.path.endsWith("git/commits"));
  expect(commit?.body).toMatchObject({ parents: [A], tree: C });
  const tree = calls.find((call) => call.method === "POST" && call.path.endsWith("git/trees"));
  expect(tree?.body).toMatchObject({ base_tree: C });
  expect(JSON.stringify(tree?.body)).toContain("0.1.0");
  expect(calls.some((call) => call.path.endsWith("/pulls") && call.method === "POST")).toBe(true);
});
for (const moving of [1, 2, 3])
  test(`moving main at read${moving} skips branch/PR writes`, async () => {
    const { input, calls } = await fixture({ moving });
    expect(await prepareRelease(input)).toBe("stale");
    expect(
      calls.some(
        (call) =>
          call.method !== "GET" && (call.path.endsWith("/pulls") || call.path.endsWith("git/refs")),
      ),
    ).toBe(false);
  });
test("failedCI rejects before any mutation", async () => {
  const { input, calls } = await fixture({ failure: true });
  await expect(prepareRelease(input)).rejects.toThrow("CI");
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});
test("transport failure leaves pending release untagged", async () => {
  const { input, labels } = await fixture();
  input.request = async () => {
    throw new Error("API offline");
  };
  await expect(prepareRelease(input)).rejects.toThrow("API offline");
  expect(labels).toEqual([]);
});

for (const collision of [false, true])
  test(`merged release tag ${collision ? "rejects collision" : "targets exact passed merge"}`, async () => {
    const f = await fixture();
    const manifest = await Manifest.fromManifest(f.github, "main", undefined, undefined, {
      logger: quiet,
    });
    const proposal = (await manifest.buildPullRequests())[0]!;
    f.files[".release-please-manifest.json"] = JSON.stringify({ ".": "0.1.0" });
    f.github.pullRequestIterator = async function* (_branch, status) {
      if (status === "MERGED")
        yield {
          number: 42,
          sha: A,
          mergeCommitOid: A,
          title: proposal.title.toString(),
          body: proposal.body.toString(),
          labels: ["autorelease: pending"],
          files: [],
          baseBranchName: "main",
          headBranchName: proposal.headRefName,
        };
    };
    const writes: unknown[] = [];
    const writer = await GitHub.create({
      owner: "example",
      repo: "rukie",
      defaultBranch: "main",
      logger: quiet,
      fetch: async (url: string | URL | Request, init?: RequestInit) => {
        const request =
          url instanceof Request ? new Request(url, init) : new Request(url.toString(), init);
        expect(request.method).toBe("POST");
        expect(new URL(request.url).pathname).toBe("/repos/example/rukie/releases");
        const body: unknown = await request.json();
        writes.push(body);
        return Response.json(
          {
            ...(body as Record<string, unknown>),
            id: 1,
            html_url: "https://example.invalid/release",
            upload_url: "https://example.invalid/upload",
          },
          { status: 201 },
        );
      },
    });
    f.github.createRelease = writer.createRelease;
    const original = f.input.request;
    f.input.request = async (method, path, body) =>
      path.includes("git/ref/tags/") && collision
        ? { object: { type: "commit", sha: B } }
        : original(method, path, body);
    if (collision) {
      await expect(prepareRelease(f.input)).rejects.toThrow("different commit");
      expect(writes).toEqual([]);
      expect(f.labels).toEqual([]);
    } else {
      expect(await prepareRelease(f.input)).toBe("prepared");
      expect(writes).toEqual([
        expect.objectContaining({ tag_name: "coding-agent-v0.1.0", target_commitish: A }),
      ]);
      expect(f.labels).toContainEqual(["autorelease: tagged"]);
    }
  });

test("same run later attempt failure masks earlier success and unrelated success", () => {
  const common = {
    id: 10,
    head_sha: A,
    event: "push",
    head_branch: "main",
    path: ".github/workflows/ci.yml",
    status: "completed",
  };
  expect(() =>
    assertSuccessfulCI(
      [
        { ...common, run_attempt: 1, conclusion: "success" },
        { ...common, run_attempt: 2, conclusion: "failure" },
        { ...common, id: 11, head_sha: B, run_attempt: 1, conclusion: "success" },
      ],
      A,
    ),
  ).toThrow("CI");
});
test("workflow trigger validates repository and exact production CI event", () => {
  const repository = { full_name: "example/rukie" };
  const workflow_run = {
    id: 10,
    head_sha: A,
    event: "push",
    head_branch: "main",
    path: ".github/workflows/ci.yml",
    status: "completed",
    conclusion: "success",
    repository,
    head_repository: repository,
  };
  expect(passedWorkflow({ repository, workflow_run }, repository.full_name)).toEqual({
    commit: A,
    runId: 10,
  });
  for (const alteration of [
    { event: "pull_request" },
    { conclusion: "failure" },
    { head_sha: "main" },
    { path: ".github/workflows/other.yml" },
    { head_repository: { full_name: "fork/rukie" } },
  ])
    expect(() =>
      passedWorkflow(
        { repository, workflow_run: { ...workflow_run, ...alteration } },
        repository.full_name,
      ),
    ).toThrow();
});
test("product version drift rejects before writes", async () => {
  const { input, files, calls } = await fixture({ version: "0.1.0" });
  files["packages/coding-agent/package.json"] = JSON.stringify({ version: "0.9.0" });
  await expect(prepareRelease(input)).rejects.toThrow("tracking disagree");
  expect(calls.every((call) => call.method === "GET")).toBe(true);
});
test("REST production adapter authenticates, preserves JSON and hides token in failures", async () => {
  const seen: Request[] = [];
  const transport: typeof fetch = Object.assign(
    async (input: string | URL | Request, init?: RequestInit) => {
      const request =
        input instanceof Request ? new Request(input, init) : new Request(input.toString(), init);
      seen.push(request);
      return request.url.endsWith("/missing")
        ? new Response(null, { status: 404 })
        : request.url.endsWith("/failure")
          ? new Response(null, { status: 403 })
          : Response.json({ sha: A });
    },
    { preconnect() {} },
  );
  const request = githubRequest("fabricated", transport);
  expect(await request("POST", "/repos/example/rukie/git/commits", { parents: [A] })).toEqual({
    sha: A,
  });
  expect(seen[0]?.headers.get("authorization")).toBe("Bearer fabricated");
  expect(await seen[0]?.json()).toEqual({ parents: [A] });
  expect(await request("GET", "/repos/example/rukie/git/ref/heads/missing")).toBeNull();
  await expect(request("GET", "/repos/example/rukie/actions/failure")).rejects.toThrow("403");
  await expect(request("GET", "/repos/example/rukie/actions/missing")).rejects.toThrow("404");
});

test("large first release roundtrips official overflow metadata and maintainer notes at merge SHA", async () => {
  const f = await fixture({ message: "feat: " + "initial feature ".repeat(6000) });
  expect(await prepareRelease(f.input)).toBe("prepared");
  const treeCall = f.calls.find(
    (call) => call.method === "POST" && call.path.endsWith("git/trees"),
  )!;
  const tree = treeCall.body as { tree: { path: string; content: string }[] };
  const notes = tree.tree.find((entry) => entry.path === "release-notes.md")!.content;
  expect(notes.length).toBeGreaterThan(65536);
  const prCall = f.calls.find((call) => call.method === "POST" && call.path.endsWith("/pulls"))!;
  const pr = prCall.body as { title: string; body: string; head: string };
  expect(pr.body.length).toBeLessThan(65536);
  expect(pr.body).toContain(`/blob/${C}/release-notes.md`);
  // The linked creation commit remains immutable, but release parsing reads the merged file,
  // including the maintainer's last edit rather than stale generated branch content.
  const merged = await fixture({
    message: "chore: release coding-agent",
    version: "0.1.0",
    merged: true,
  });
  merged.files["release-notes.md"] = notes.replace(
    "initial feature ",
    "Maintainer edited feature ",
  );
  merged.github.pullRequestIterator = async function* (_branch, status) {
    if (status === "MERGED")
      yield {
        number: 42,
        sha: A,
        mergeCommitOid: A,
        title: pr.title,
        body: pr.body,
        labels: ["autorelease: pending"],
        files: [],
        baseBranchName: "main",
        headBranchName: pr.head,
      };
  };
  merged.input.commits.push({ sha: C, message: "chore: prepared version", files: [] });
  const reads: string[] = [];
  merged.input.readFile = async (path, target) => {
    if (path === "release-notes.md") reads.push(target);
    return merged.files[path];
  };
  let releaseNotes = "";
  merged.github.createRelease = async (candidate) => {
    releaseNotes = candidate.notes ?? "";
    expect(candidate.sha).toBe(A);
    return {
      id: 1,
      tagName: candidate.tag.toString(),
      sha: A,
      url: "https://example.invalid/release",
    };
  };
  expect(await prepareRelease(merged.input)).toBe("prepared");
  expect(reads).toEqual([A]);
  expect(releaseNotes.length).toBeGreaterThan(65536);
  expect(releaseNotes).toContain("Maintainer edited feature");
  expect(releaseNotes).toContain("initial feature ".repeat(5900));
});

test("explicit official 1.0.0 transition is a temporary configuration override", async () => {
  const config = structuredClone(stable);
  config.packages["."]!["release-as"] = "1.0.0";
  const { github } = await fixture({ version: "0.1.9", message: "feat: stable API", config });
  const manifest = await Manifest.fromManifest(github, "main", undefined, undefined, {
    logger: quiet,
  });
  expect((await manifest.buildPullRequests())[0]?.version?.toString()).toBe("1.0.0");
});
test("unfinished latest CI and different workflow cannot release", () => {
  const common = {
    id: 10,
    run_attempt: 1,
    head_sha: A,
    event: "push",
    head_branch: "main",
    path: ".github/workflows/ci.yml",
    status: "completed",
    conclusion: "success",
  };
  expect(() =>
    assertSuccessfulCI([{ ...common, status: "in_progress", conclusion: null }], A),
  ).toThrow("CI");
  expect(() =>
    assertSuccessfulCI([{ ...common, path: ".github/workflows/unrelated.yml" }], A),
  ).toThrow("CI");
});

for (const failedMerge of [true, false])
  test(`merged PR own CI ${failedMerge ? "blocks tagging" : "resumes existing annotated tag"}`, async () => {
    const seed = await fixture();
    const manifest = await Manifest.fromManifest(seed.github, "main", undefined, undefined, {
      logger: quiet,
    });
    const proposal = (await manifest.buildPullRequests())[0]!;
    const f = await fixture({ version: "0.1.0", message: "docs: after release", merged: true });
    f.github.pullRequestIterator = async function* (_branch, status) {
      if (status === "MERGED")
        yield {
          number: 42,
          sha: B,
          mergeCommitOid: B,
          title: proposal.title.toString(),
          body: proposal.body.toString(),
          labels: ["autorelease: pending"],
          files: [],
          baseBranchName: "main",
          headBranchName: proposal.headRefName,
        };
    };
    const original = f.input.request;
    f.input.request = async (method, path, body) => {
      if (path.includes("actions/workflows") && path.includes(`head_sha=${B}`))
        return {
          total_count: 1,
          workflow_runs: [
            {
              id: 9,
              run_attempt: 1,
              head_sha: B,
              event: "push",
              head_branch: "main",
              path: ".github/workflows/ci.yml",
              status: "completed",
              conclusion: failedMerge ? "failure" : "success",
            },
          ],
        };
      if (path.includes("git/ref/tags/")) return { object: { type: "tag", sha: C } };
      if (path.endsWith(`/git/tags/${C}`)) return { object: { type: "commit", sha: B } };
      if (path.includes("releases/tags/")) return { id: 1, tag_name: "coding-agent-v0.1.0" };
      return original(method, path, body);
    };
    f.github.createRelease = async () => {
      throw new Error("Must not recreate a published Release");
    };
    if (failedMerge) {
      await expect(prepareRelease(f.input)).rejects.toThrow("CI");
      expect(f.labels).toEqual([]);
    } else {
      expect(await prepareRelease(f.input)).toBe("prepared");
      expect(f.labels).toContainEqual(["autorelease: tagged"]);
    }
  });
