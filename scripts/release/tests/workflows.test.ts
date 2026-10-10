import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

test("contributors get full CI for main PR changes, main pushes and manual runs without publishing credentials", async () => {
  const source = await readFile(resolve(root, ".github/workflows/ci.yml"), "utf8");
  const workflow: unknown = Bun.YAML.parse(source);
  expect(workflow).toMatchObject({
    on: {
      pull_request: { branches: ["main"], types: ["opened", "synchronize", "reopened"] },
      push: { branches: ["main"] },
      workflow_dispatch: null,
    },
    permissions: { contents: "read" },
    jobs: {
      build: { "runs-on": "macos-15" },
      verify: { needs: ["build", "tests"], "runs-on": "macos-15" },
    },
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
  const steps = object(object(workflow.jobs).build).steps;
  if (!Array.isArray(steps)) throw new Error("Expected CI steps");
  return steps.map(object);
}

test("CI accepts the once-built packages only after every full-suite shard succeeds", async () => {
  const workflow = object(
    Bun.YAML.parse(await readFile(resolve(root, ".github/workflows/ci.yml"), "utf8")),
  );
  const jobs = object(workflow.jobs);
  const steps = await ciSteps();
  const commands = steps.map((step) => (typeof step.run === "string" ? step.run : ""));
  expect(commands.filter((command) => command.includes("release:build"))).toHaveLength(1);
  expect(commands.join("\n")).toContain("env -u NO_COLOR bun run check:dev");
  expect(commands.join("\n")).toContain('--require-clean --commit "$GITHUB_SHA"');
  expect(commands.join("\n")).not.toContain("ci-audit.ts");
  const candidate = steps.find(
    (step) => typeof step.uses === "string" && step.uses.startsWith("actions/upload-artifact@"),
  );
  expect(candidate).toMatchObject({ with: { "retention-days": 1, "if-no-files-found": "error" } });
  expect(object(candidate?.with).path).not.toContain("ci-acceptance.json");
  expect(jobs.tests).toMatchObject({
    needs: "build",
    uses: "./.github/workflows/release-tests.yml",
    permissions: { contents: "read", actions: "read" },
    with: { commit: "${{ github.sha }}", artifact: object(candidate?.with).name },
  });
  expect(jobs.verify).toMatchObject({
    needs: ["build", "tests"],
    name: "Source and installed darwin-arm64",
  });
  expect(object(jobs.verify).if).toBeUndefined();
  const accepted = object(jobs.verify).steps;
  if (!Array.isArray(accepted)) throw new Error("Missing acceptance steps");
  const audit = accepted
    .map(object)
    .findIndex((step) => typeof step.run === "string" && step.run.includes("ci-audit.ts"));
  const upload = accepted
    .map(object)
    .findIndex(
      (step) => typeof step.uses === "string" && step.uses.startsWith("actions/upload-artifact@"),
    );
  expect(audit).toBeGreaterThan(0);
  expect(upload).toBeGreaterThan(audit);
  expect(accepted[upload]).toMatchObject({
    with: { "retention-days": 14, "if-no-files-found": "error" },
  });
  expect(object(object(accepted[upload]).with).path).toContain("/ci-acceptance.json");
});

test("all four shards test the same exact packages with one worker and no acceptance authority", async () => {
  const source = await readFile(resolve(root, ".github/workflows/release-tests.yml"), "utf8");
  const workflow = object(Bun.YAML.parse(source));
  const job = object(object(workflow.jobs).test);
  expect(workflow.permissions).toEqual({ contents: "read", actions: "read" });
  expect(job).toMatchObject({
    strategy: { "fail-fast": false, matrix: { shard: [1, 2, 3, 4] } },
    env: { RUKIE_TEST_WORKERS: 1, RELEASE_COMMIT: "${{ inputs.commit }}" },
  });
  if (!Array.isArray(job.steps)) throw new Error("Missing shard steps");
  const steps = job.steps.map(object);
  expect(steps[0]).toMatchObject({
    with: { ref: "${{ inputs.commit }}", "persist-credentials": false },
  });
  const commands = steps.map((step) => (typeof step.run === "string" ? step.run : ""));
  expect(commands.join("\n")).toContain('--require-clean --commit "$RELEASE_COMMIT"');
  expect(commands.join("\n")).toContain(
    'bun run test --shard="$TEST_SHARD/4" --timings=scripts/test-timings.json',
  );
  const timings = object(
    JSON.parse(await readFile(resolve(root, "scripts/test-timings.json"), "utf8")),
  );
  expect(timings.version).toBe(1);
  for (const [path, duration] of Object.entries(object(timings.files))) {
    expect(path).toMatch(/^(packages|scripts)\/.+\.test\.tsx?$/);
    expect(typeof duration).toBe("number");
    expect(Number.isFinite(duration)).toBe(true);
    expect(duration).toBeGreaterThan(0);
    expect(await Bun.file(resolve(root, path)).exists()).toBe(true);
  }
  const check = steps.findIndex((step) => step.id === "check");
  const after = steps.findIndex(
    (step) => step.name === "Verify tests preserved clean source and original packages",
  );
  expect(after).toBeGreaterThan(check);
  expect(commands[after]).toContain("git status --porcelain --untracked-files=normal");
  expect(commands[after]).toContain('--require-clean --commit "$RELEASE_COMMIT"');
  expect(source).not.toMatch(
    /ci-audit|release:build|id-token|secrets\.|continue-on-error|test-name-pattern/,
  );
  for (const step of steps)
    if (typeof step.uses === "string") expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
});

test("both source gates keep full logs and fail closed while bounding Actions output", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "rukie-check-log-"));
  try {
    for (const name of ["ci.yml", "release-publish.yml", "release-tests.yml"]) {
      const workflow = object(
        Bun.YAML.parse(await readFile(resolve(root, ".github/workflows", name), "utf8")),
      );
      const steps = object(
        object(workflow.jobs)[name === "release-tests.yml" ? "test" : "build"],
      ).steps;
      if (!Array.isArray(steps)) throw new Error("Expected verification steps");
      const gate = steps.map(object).find((step) => step.id === "check");
      if (typeof gate?.run !== "string") throw new Error("Missing source check gate");
      const logUpload = steps
        .map(object)
        .find(
          (step) =>
            step.name ===
            (name === "release-tests.yml"
              ? "Preserve complete shard log"
              : "Preserve complete check log"),
        );
      expect(logUpload).toMatchObject({
        if: "${{ !cancelled() && steps.check.outcome != 'skipped' }}",
        with: { path: "${{ runner.temp }}/rukie-check.log", "retention-days": 1 },
      });
      for (const code of [0, 7]) {
        // Exercise the workflow shell around a controlled check result, including stderr.
        const command = gate.run.replace(
          name === "release-tests.yml"
            ? 'env -u NO_COLOR bun run test --shard="$TEST_SHARD/4" --timings=scripts/test-timings.json'
            : "env -u NO_COLOR bun run check:dev",
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
  const source = await readFile(resolve(root, ".github/workflows/pr-title.yml"), "utf8");
  const workflow = object(Bun.YAML.parse(source));
  expect(workflow).toMatchObject({
    on: {
      pull_request: { branches: ["main"], types: ["opened", "synchronize", "reopened", "edited"] },
    },
    permissions: { contents: "read" },
    concurrency: {
      group: "pr-title-${{ github.event.pull_request.number }}",
      "cancel-in-progress": true,
    },
  });
  expect(source).not.toMatch(/pull_request_target|secrets\.|id-token:|release:build|bun run check/);
  const job = object(object(workflow.jobs).title);
  expect(job.name).toBe("Conventional Commit PR title");
  if (!Array.isArray(job.steps)) throw new Error("Missing title steps");
  const steps = job.steps.map(object);
  expect(steps[0]).toMatchObject({ with: { "persist-credentials": false } });
  for (const value of steps)
    if (typeof value.uses === "string") expect(value.uses).toMatch(/@[a-f0-9]{40}$/);
  expect(
    (await ciSteps()).some((value) => value.name === "Check Conventional Commit PR title"),
  ).toBe(false);
  const step = steps.find((value) => value.name === "Check Conventional Commit PR title");
  if (!step || typeof step.run !== "string") throw new Error("Missing PR title gate");
  expect(step).toMatchObject({
    env: { PR_TITLE: "${{ github.event.pull_request.title }}" },
  });
  expect(step.run).not.toContain("${{");
  const marker = resolve(root, "ci-title-must-not-execute");
  const child = Bun.spawn(["sh", "-c", step.run], {
    cwd: root,
    env: { ...process.env, PR_TITLE: "fix: literal $(touch ci-title-must-not-execute)" },
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
  const invalid = Bun.spawn(["sh", "-c", step.run], {
    cwd: root,
    env: { ...process.env, PR_TITLE: "invalid title" },
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(10_000),
  });
  const [invalidCode, invalidOutput] = await Promise.all([
    invalid.exited,
    new Response(invalid.stdout).text(),
    new Response(invalid.stderr).text(),
  ]);
  expect(invalidCode).not.toBe(0);
  expect(invalidOutput).toContain("type-empty");
});
