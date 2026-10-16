import { afterAll, beforeAll, expect, onTestFinished, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRelease } from "../build.ts";

let artifacts = process.env.RUKIE_RELEASE_ARTIFACTS;
let ownedArtifacts: string | undefined;
beforeAll(async () => {
  if (artifacts) return;
  artifacts = ownedArtifacts = await mkdtemp(join(tmpdir(), "rukie-owner-release-"));
  await buildRelease(artifacts);
}, 120_000);
afterAll(async () => {
  if (ownedArtifacts) await rm(ownedArtifacts, { recursive: true, force: true });
});

test("expired installed-command owner restores resources before the next real command", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-installed-owner-"));
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let cleanupPromise: Promise<void> | undefined;
  let finished = false;
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      child?.kill();
      if (child) await child.exited;
      await rm(root, { recursive: true, force: true });
    })());
  onTestFinished(() => {
    finished = true;
    return cleanup();
  });
  const source = join(root, "owner.test.ts");
  const helper = new URL("./installed-command-owner.ts", import.meta.url).href;
  const fixture = new URL("./installed-fixture.ts", import.meta.url).href;
  const build = new URL("../build.ts", import.meta.url).href;
  const fake = new URL(
    "../../../packages/coding-agent/tests/headless/helpers/fake-openai.ts",
    import.meta.url,
  ).href;
  await Bun.write(
    source,
    `import { afterAll, beforeAll, beforeEach, expect, onTestFinished, test } from "bun:test";
import { rename, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInstalledCommandOwner } from ${JSON.stringify(helper)};
import { installRelease, configureProvider } from ${JSON.stringify(fixture)};
import { PLATFORM_PACKAGE } from ${JSON.stringify(build)};
import { fakeOpenAI } from ${JSON.stringify(fake)};
let fixture, owner, active, server, platform, rg, closeServer, restoreFiles;
let prepared = false;
beforeAll(async () => {
  fixture = await installRelease(process.env.RUKIE_RELEASE_ARTIFACTS);
  platform = join(fixture.prefix, "node_modules", PLATFORM_PACKAGE);
  rg = join(platform, "bin/rg");
}, 120000);
afterAll(async () => { await fixture?.cleanup(); });
beforeEach(async () => {
  owner = createInstalledCommandOwner(fixture);
  if (prepared) return;
  prepared = true;
  const epoch = process.hrtime.bigint();
  const stages = [];
  const mark = (stage, facts = {}) => {
    if (stages.length === 48) stages.shift();
    stages.push({ stage, ms: Number(process.hrtime.bigint() - epoch) / 1_000_000, facts });
  };
  onTestFinished(() => console.error("[installed-owner-failure]", JSON.stringify(stages)));
  let rgMoved = false, platformMoved = false;
  restoreFiles = owner.ownCleanup(async () => {
    // Restore the containing directory before its owned native executable.
    if (platformMoved) await rename(platform + ".hidden", platform);
    if (rgMoved) await rename(rg + ".hidden", rg);
  });
  await rename(rg, rg + ".hidden");
  rgMoved = true;
  server = fakeOpenAI("held expired owner", { holdOpen: true, onRequest: (facts) => mark("request", facts) });
  closeServer = owner.ownCleanup(() => server.stop());
  await configureProvider(fixture.homeDir, server.baseUrl);
  active = await owner.start(["-p", "held installed owner"], { onStage: mark });
  // Prepare the real process/transport before applying the test-body deadline.
  await server.received;
  await rename(platform, platform + ".hidden");
  platformMoved = true;
});
test("deliberately expired owner", async () => {
  try { await active.result; }
  finally { await restoreFiles(); await closeServer(); }
}, 50);
test("next owner observes restored resources and executes installed grep", async () => {
  expect((await stat(platform)).isDirectory()).toBe(true);
  expect((await stat(rg)).mode & 0o111).not.toBe(0);
  expect(() => process.kill(active.child.pid, 0)).toThrow();
  await expect(fetch(server.baseUrl, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
  expect(await owner.run(["--version"])).toEqual({ code: 0, stdout: fixture.version + "\\n", stderr: "" });
  const next = fakeOpenAI("next owner grep completed", { toolCalls: [{ name: "grep", arguments: { pattern: "needle", path: "fixture.txt" } }] });
  const closeNext = owner.ownCleanup(() => next.stop());
  try {
    await configureProvider(fixture.homeDir, next.baseUrl);
    await Bun.write(join(fixture.cwd, "fixture.txt"), "needle\\n");
    expect(await owner.run(["-p", "--permission-mode", "full-access", "grep fixture"])).toEqual({ code: 0, stdout: "next owner grep completed\\n", stderr: "" });
    expect(JSON.stringify(next.requests[1].body)).toContain("fixture.txt:1:needle");
  } finally { await closeNext(); }
}, 10000);
`,
  );
  try {
    const runner = (child = Bun.spawn([process.execPath, "test", source], {
      env: { ...process.env, RUKIE_RELEASE_ARTIFACTS: artifacts, FORCE_COLOR: "0" },
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(120_000),
    }));
    const [code, stdout, stderr] = await Promise.all([
      runner.exited,
      new Response(runner.stdout).text(),
      new Response(runner.stderr).text(),
    ]);
    if (finished) return new Promise<void>(() => {});
    const output = stdout + stderr;
    expect(code).toBe(1);
    expect(output).toContain("this test timed out after 50ms");
    expect(output).toContain(
      "(pass) next owner observes restored resources and executes installed grep",
    );
    expect(output).toMatch(/^\s*1 pass\s*$/m);
    expect(output).toMatch(/^\s*1 fail\s*$/m);
    const diagnostic = output
      .split("\n")
      .find((line) => line.startsWith("[installed-owner-failure] "));
    expect(diagnostic).toBeDefined();
    const parsed: unknown = JSON.parse(diagnostic!.slice("[installed-owner-failure] ".length));
    if (!Array.isArray(parsed)) throw new Error("Installed-owner stages must be an array");
    const stages = parsed.filter(
      (entry: unknown): entry is { stage: string; facts: Record<string, unknown> } =>
        typeof entry === "object" &&
        entry !== null &&
        "stage" in entry &&
        typeof entry.stage === "string" &&
        "facts" in entry &&
        typeof entry.facts === "object" &&
        entry.facts !== null &&
        !Array.isArray(entry.facts),
    );
    expect(stages).toHaveLength(parsed.length);
    expect(stages.find((entry) => entry.stage === "spawn")?.facts.pid).toBeGreaterThan(0);
    expect(
      stages.find((entry) => entry.stage === "request" && entry.facts.kind === "model")?.facts,
    ).toEqual({
      kind: "model",
      ordinal: 1,
      toolResults: 0,
    });
    expect(stages.some((entry) => entry.stage === "kill")).toBe(true);
    expect(stages.some((entry) => entry.stage === "stdout-eof")).toBe(true);
    expect(stages.some((entry) => entry.stage === "stderr-eof")).toBe(true);
    expect(stages.some((entry) => entry.stage === "exit")).toBe(true);
    expect(diagnostic).not.toContain("held installed owner");
    expect(diagnostic).not.toContain("Bearer");
    expect(diagnostic).not.toContain("packaged-key");
    expect(output).not.toContain("Unhandled error");
    expect(output).not.toContain("error between tests");
  } finally {
    await cleanup();
  }
}, 120_000);
