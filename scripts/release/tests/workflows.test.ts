import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

test("contributors get CI for main PR changes, title edits, main pushes and manual runs without publishing credentials", async () => {
  const source = await readFile(resolve(root, ".github/workflows/ci.yml"), "utf8");
  const workflow: unknown = Bun.YAML.parse(source);
  expect(workflow).toMatchObject({
    on: {
      pull_request: { branches: ["main"], types: ["opened", "synchronize", "reopened", "edited"] },
      push: { branches: ["main"] },
      workflow_dispatch: null,
    },
    permissions: { contents: "read" },
    jobs: { verify: { "runs-on": "macos-15", env: { RUKIE_TEST_WORKERS: 1 } } },
  });
  expect(source).not.toMatch(
    /pull_request_target|paths:|paths-ignore:|id-token:|secrets\.|npm publish|npm dist-tag/,
  );
});

test("CI refuses to record acceptance for a different checkout commit", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "scripts/release/ci-audit.ts",
      "--artifact-dir",
      "/nonexistent-ci-artifacts",
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        GITHUB_SHA: "0".repeat(40),
        GITHUB_REPOSITORY: "example/rukie",
        GITHUB_RUN_ID: "123",
        GITHUB_RUN_ATTEMPT: "1",
        GITHUB_EVENT_NAME: "push",
      },
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(10_000),
    },
  );
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(code).not.toBe(0);
  expect(stderr).toContain("CI checkout commit differs from GITHUB_SHA");
});

// The YAML parser returns untrusted data; tests inspect the public workflow contract.
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected workflow mapping");
  return Object.fromEntries(Object.entries(value));
}

async function ciSteps() {
  const workflow = object(
    Bun.YAML.parse(await readFile(resolve(root, ".github/workflows/ci.yml"), "utf8")),
  );
  const steps = object(object(workflow.jobs).verify).steps;
  if (!Array.isArray(steps)) throw new Error("Expected CI steps");
  return steps.map(object);
}

test("a successful CI run uploads the exact once-built artifacts after the full installed gate, bound to its SHA", async () => {
  const steps = await ciSteps();
  const commands = steps.map((step) => (typeof step.run === "string" ? step.run : ""));
  expect(commands.filter((command) => command.includes("release:build"))).toHaveLength(1);
  const build = commands.findIndex((command) => command.includes("release:build"));
  const verify = commands.findIndex((command) => command.includes("release:verify"));
  const check = commands.findIndex((command) => command.includes("bun run check"));
  const audit = commands.findIndex((command) => command.includes("ci-audit.ts"));
  const upload = steps.findIndex(
    (step) => typeof step.uses === "string" && step.uses.startsWith("actions/upload-artifact@"),
  );
  expect(build).toBeGreaterThan(0);
  expect(verify).toBeGreaterThan(build);
  expect(check).toBeGreaterThan(verify);
  expect(audit).toBeGreaterThan(check);
  expect(upload).toBeGreaterThan(audit);
  expect(commands[verify]).toContain('--require-clean --commit "$GITHUB_SHA"');
  expect(commands[build]).toContain('--out "$RUKIE_RELEASE_ARTIFACTS" --platform darwin-arm64');
  expect(commands[check]).toContain(
    'env -u NO_COLOR bun run check > "$RUNNER_TEMP/rukie-check.log" 2>&1',
  );
  expect(
    commands.some((command) =>
      command.includes("RUKIE_RELEASE_ARTIFACTS=$RUNNER_TEMP/rukie-release"),
    ),
  ).toBe(true);
  expect(
    commands.some(
      (command) => command.includes("git rev-parse HEAD") && command.includes("$GITHUB_SHA"),
    ),
  ).toBe(true);
  expect(steps[upload]).toMatchObject({ with: { "if-no-files-found": "error" } });
  expect(object(steps[upload]!.with).path).toBe(
    "${{ env.RUKIE_RELEASE_ARTIFACTS }}/*.tgz\n${{ env.RUKIE_RELEASE_ARTIFACTS }}/release-build.json\n${{ env.RUKIE_RELEASE_ARTIFACTS }}/release-modules.json\n${{ env.RUKIE_RELEASE_ARTIFACTS }}/ci-acceptance.json\n",
  );
  for (const step of steps) {
    if (typeof step.uses === "string") expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
    expect(step.if).not.toBe("always()");
  }
});

test("both source gates keep full logs and fail closed while bounding Actions output", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "rukie-check-log-"));
  try {
    for (const name of ["ci.yml", "release-publish.yml"]) {
      const workflow = object(
        Bun.YAML.parse(await readFile(resolve(root, ".github/workflows", name), "utf8")),
      );
      const steps = object(object(workflow.jobs).verify).steps;
      if (!Array.isArray(steps)) throw new Error("Expected verification steps");
      const gate = steps.map(object).find((step) => step.id === "check");
      if (typeof gate?.run !== "string") throw new Error("Missing source check gate");
      const logUpload = steps
        .map(object)
        .find((step) => step.name === "Preserve complete check log");
      expect(logUpload).toMatchObject({
        if: "${{ !cancelled() && steps.check.outcome != 'skipped' }}",
        with: { path: "${{ runner.temp }}/rukie-check.log", "retention-days": 1 },
      });
      for (const code of [0, 7]) {
        // Exercise the workflow shell around a controlled check result, including stderr.
        const command = gate.run.replace(
          "env -u NO_COLOR bun run check",
          `(i=0; while [ "$i" -lt 200 ]; do echo "result-$i"; i=$((i+1)); done; echo check-stderr >&2; exit ${code})`,
        );
        const child = Bun.spawn(["sh", "-e", "-c", command], {
          env: { ...process.env, RUNNER_TEMP: directory },
          stdout: "pipe",
          stderr: "pipe",
          signal: AbortSignal.timeout(10_000),
        });
        const [exit, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ]);
        expect(exit).toBe(code === 0 ? 0 : 1);
        expect(stderr).toBe("");
        expect(stdout.trimEnd().split("\n")).toHaveLength(code === 0 ? 8 : 120);
        const log = await readFile(resolve(directory, "rukie-check.log"), "utf8");
        expect(log).toStartWith("result-0\n");
        expect(log).toEndWith("check-stderr\n");
        expect(log.trimEnd().split("\n")).toHaveLength(201);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("PR titles remain data when the actual workflow invokes commitlint", async () => {
  const step = (await ciSteps()).find(
    (value) => value.name === "Check Conventional Commit PR title",
  );
  if (!step || typeof step.run !== "string") throw new Error("Missing PR title gate");
  expect(step).toMatchObject({
    if: "github.event_name == 'pull_request'",
    env: { PR_TITLE: "${{ github.event.pull_request.title }}" },
  });
  expect(step.run).not.toContain("${{");
  const marker = resolve(root, "ci-title-must-not-execute");
  const child = Bun.spawn(["sh", "-c", step.run], {
    cwd: root,
    env: { ...process.env, PR_TITLE: `fix: literal $(touch ${marker})` },
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(10_000),
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({ code, stdout, stderr }).toEqual({ code: 0, stdout: "", stderr: "" });
  expect(await Bun.file(marker).exists()).toBe(false);
});
