import { afterAll, beforeAll, beforeEach, expect, onTestFinished, test } from "bun:test";
import { chmod, mkdtemp, readFile, readdir, rename, rm, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { watch } from "node:fs";
import { once } from "node:events";
import { buildRelease, MAIN_PACKAGE, PLATFORM_PACKAGE } from "../build.ts";
import { configureProvider, installRelease } from "./installed-fixture.ts";
import { createInstalledCommandOwner } from "./installed-command-owner.ts";

// Reuse the existing local protocol fixture without adding a product test entrypoint.
const {
  fakeOpenAI,
}: {
  fakeOpenAI: (
    reply: string,
    options?: {
      holdOpen?: boolean;
      toolCalls?: { name: string; arguments: object }[];
      responses?: (string | { toolCalls: { name: string; arguments: object }[] })[];
      onRequest?: (facts: {
        kind: "title" | "model";
        ordinal: number;
        toolResults: number;
      }) => void;
    },
  ) => {
    baseUrl: string;
    requests: { body: unknown; authorization: string | null }[];
    received: Promise<void>;
    stop(): void | Promise<void>;
  };
} = await import(
  new URL("../../../packages/coding-agent/tests/headless/helpers/fake-openai.ts", import.meta.url)
    .href
);
let fixture: Awaited<ReturnType<typeof installRelease>>;
let ownedArtifacts: string | undefined;
let commandOwner: ReturnType<typeof createInstalledCommandOwner>;
beforeEach(() => {
  commandOwner = createInstalledCommandOwner(fixture);
});
beforeAll(async () => {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error("Installed release acceptance requires macOS arm64");
  let artifacts = process.env.RUKIE_RELEASE_ARTIFACTS;
  if (!artifacts) {
    ownedArtifacts = await mkdtemp(join(tmpdir(), "rukie-release-build-"));
    artifacts = ownedArtifacts;
    await buildRelease(artifacts);
  }
  fixture = await installRelease(resolve(artifacts));
  await Bun.write(join(fixture.cwd, ".env"), "FAKE_API_KEY=project-hijack\nLANG=zh\n");
  await Bun.write(
    join(fixture.cwd, "preload.ts"),
    'await Bun.write("preloaded", "unsafe"); throw new Error("project preload executed");',
  );
  await Bun.write(join(fixture.cwd, "bunfig.toml"), 'preload = ["./preload.ts"]\n');
}, 120_000);
afterAll(async () => {
  await fixture?.cleanup();
  if (ownedArtifacts) await rm(ownedArtifacts, { recursive: true, force: true });
});

test.each(["launcher version", "native version", "English help", "Chinese help", "invalid option"])(
  "installed %s reports without creating Sessions or consuming project runtime files",
  async (kind) => {
    const owner = commandOwner;
    if (kind === "launcher version" || kind === "native version") {
      expect(
        await owner.run(
          ["--version"],
          kind === "native version"
            ? { command: fixture.binary, env: { PATH: "/usr/bin:/bin" } }
            : undefined,
        ),
      ).toEqual({ code: 0, stdout: `${fixture.version}\n`, stderr: "" });
    } else if (kind === "invalid option") {
      const invalid = await owner.run(["--unknown"]);
      expect(invalid.code).toBe(2);
      expect(invalid.stderr).toContain("Unknown option");
    } else {
      const help = await owner.run(
        ["--help"],
        kind === "Chinese help" ? { env: { LC_ALL: "zh_CN.UTF-8" } } : undefined,
      );
      expect(help.code).toBe(0);
      expect(help.stdout).toContain(kind === "Chinese help" ? "用法：" : "Usage:");
      expect(help.stderr).toBe("");
    }
    expect(await readdir(join(fixture.homeDir, ".rukie"))).toEqual([]);
    expect(await Bun.file(join(fixture.cwd, "preloaded")).exists()).toBe(false);
  },
);

test("installed command preserves cwd/environment/stdin and performs shipped grep and bash through a real Session", async () => {
  const owner = commandOwner;
  const epoch = process.hrtime.bigint();
  const stages: { stage: string; ms: number; facts: Record<string, string | number> }[] = [];
  const mark = (stage: string, facts: Record<string, string | number> = {}) => {
    if (stages.length === 48) stages.shift();
    stages.push({ stage, ms: Number(process.hrtime.bigint() - epoch) / 1_000_000, facts });
  };
  let complete = false;
  mark("case-start", { runnerPid: process.pid });
  const server = fakeOpenAI("packaged done", {
    onRequest: (facts) => mark("request", facts),
    toolCalls: [
      { name: "grep", arguments: { pattern: "release-needle", path: "fixture.txt" } },
      {
        name: "bash",
        arguments: {
          command:
            'printf "cwd=%s env=%s\n" "$PWD" "$RUKIE_ACCEPTANCE_SENTINEL"; printf captured-stderr >&2',
          description: "Read process environment",
        },
      },
    ],
  });
  const closeServer = owner.ownCleanup(async () => {
    mark("provider-cleanup-start");
    await server.stop();
    mark("provider-cleanup-end");
  });
  // Bun abandons a timed-out body; its registered owner still settles the child first.
  onTestFinished(() => {
    mark("runner-cleanup-complete");
    if (!complete) console.error("[installed-command-failure]", JSON.stringify(stages));
  });
  try {
    mark("configure-start");
    await configureProvider(fixture.homeDir, server.baseUrl);
    mark("configure-end");
    await Bun.write(join(fixture.cwd, "fixture.txt"), "release-needle\n");
    mark("write-end");
    const link = join(fixture.root, "user command with spaces");
    await symlink(fixture.command, link);
    mark("symlink-end");
    const result = await owner.run(["-p", "--permission-mode", "full-access"], {
      stdin: "piped installed question\n",
      command: link,
      onStage: mark,
    });
    expect(result).toEqual({ code: 0, stdout: "packaged done\n", stderr: "" });
    expect(server.requests[0]!.authorization).toBe("Bearer packaged-key");
    expect(JSON.stringify(server.requests[0]!.body)).toContain("piped installed question");
    const nextRequest = JSON.stringify(server.requests[1]!.body);
    expect(nextRequest).toContain("fixture.txt:1:release-needle");
    expect(nextRequest).toContain(`cwd=${fixture.cwd} env=preserved`);
    expect(nextRequest).toContain("captured-stderr");
    expect(nextRequest).not.toContain("ripgrep-unavailable");
    expect(
      (await readdir(fixture.tempDir)).filter((name) => name.startsWith("rukie-jobs-")),
    ).toEqual([]);
  } finally {
    mark("case-cleanup-start");
    await closeServer();
    mark("case-cleanup-end");
  }
  complete = true;
});

test("stream-json output and persisted Session Resume use the installed executable", async () => {
  const owner = commandOwner;
  const server = fakeOpenAI("installed stream reply");
  const closeServer = owner.ownCleanup(() => server.stop());
  try {
    await configureProvider(fixture.homeDir, server.baseUrl);
    const first = await owner.run([
      "-p",
      "--output-format",
      "stream-json",
      "first installed prompt",
    ]);
    expect(first.code).toBe(0);
    expect(first.stderr).toBe("");
    const events: unknown[] = first.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const snapshot = events.find(
      (value) => value && typeof value === "object" && "type" in value && value.type === "snapshot",
    );
    if (
      !snapshot ||
      typeof snapshot !== "object" ||
      !("sessionId" in snapshot) ||
      typeof snapshot.sessionId !== "string"
    )
      throw new Error(`Missing Session identity: ${first.stdout}`);
    const resumed = await owner.run([
      "-p",
      "--resume",
      snapshot.sessionId,
      "second installed prompt",
    ]);
    expect(resumed.code).toBe(0);
    expect(resumed.stdout).toBe("installed stream reply\n");
    expect(JSON.stringify(server.requests.at(-1)!.body)).toContain("first installed prompt");
    expect(JSON.stringify(server.requests.at(-1)!.body)).toContain("second installed prompt");
    expect(
      events.some(
        (value) =>
          value && typeof value === "object" && "type" in value && value.type === "request_settled",
      ),
    ).toBe(true);
  } finally {
    await closeServer();
  }
});

test("missing or non-executable shipped ripgrep produces an actionable platform error", async () => {
  const owner = commandOwner;
  const rg = join(fixture.prefix, "node_modules", PLATFORM_PACKAGE, "bin/rg");
  for (const mode of ["missing", "permissions"]) {
    const server = fakeOpenAI("handled unavailable rg", {
      toolCalls: [{ name: "grep", arguments: { pattern: "needle" } }],
    });
    const closeServer = owner.ownCleanup(() => server.stop());
    let restoreRg: (() => Promise<void>) | undefined;
    try {
      await configureProvider(fixture.homeDir, server.baseUrl);
      restoreRg = await owner.ownMutation(
        () => (mode === "missing" ? rename(rg, `${rg}.hidden`) : chmod(rg, 0o644)),
        () => (mode === "missing" ? rename(`${rg}.hidden`, rg) : chmod(rg, 0o755)),
      );
      const result = await owner.run([
        "-p",
        "--output-format",
        "stream-json",
        "--permission-mode",
        "full-access",
        "grep files",
      ]);
      expect(result.code).toBe(0);
      const modelRequest = JSON.stringify(server.requests[1]!.body);
      expect(modelRequest).toContain("Bundled ripgrep is unavailable.");
      expect(modelRequest).toContain("Restore the complete Rukie installation");
      expect(modelRequest).toContain("execution permissions");
      expect(result.stdout).toContain("ripgrep-unavailable");
    } finally {
      await restoreRg?.();
      await closeServer();
    }
  }
});

test("launcher diagnoses missing platform dependency and unsupported operating system", async () => {
  const owner = commandOwner;
  const platform = join(fixture.prefix, "node_modules", PLATFORM_PACKAGE);
  const restorePlatform = await owner.ownMutation(
    () => rename(platform, `${platform}.hidden`),
    () => rename(`${platform}.hidden`, platform),
  );
  try {
    const missing = await owner.run(["--version"]);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("optional dependencies enabled");
  } finally {
    await restorePlatform();
  }
  for (const [platform, arch] of [
    ["linux", "arm64"],
    ["darwin", "x64"],
    ["win32", "x64"],
  ]) {
    for (const locale of ["en_US.UTF-8", "zh_CN.UTF-8"]) {
      const unsupported = await owner.run(
        [
          "-e",
          `Object.defineProperty(process,"platform",{value:${JSON.stringify(platform)}});Object.defineProperty(process,"arch",{value:${JSON.stringify(arch)}});require(${JSON.stringify(fixture.launcher)});`,
        ],
        { command: "node", env: { LC_ALL: locale } },
      );
      expect(unsupported.code).toBe(1);
      expect(unsupported.stderr).toContain(
        locale.startsWith("zh")
          ? `不支持的平台 ${platform}/${arch}`
          : `Unsupported platform ${platform}/${arch}`,
      );
    }
  }
  const oldNode = await owner.run(
    [
      "-e",
      `Object.defineProperty(process.versions,"node",{value:"24.14.9"});require(${JSON.stringify(fixture.launcher)});`,
    ],
    { command: "node" },
  );
  expect(oldNode.code).toBe(1);
  expect(oldNode.stderr).toContain("Node.js 24.15.0 or newer is required");
});

test("installation contains public manifests, MIT and third-party notices with native resources", async () => {
  for (const name of [MAIN_PACKAGE, PLATFORM_PACKAGE]) {
    const directory = join(fixture.prefix, "node_modules", name);
    const manifest: unknown = await Bun.file(join(directory, "package.json")).json();
    expect(JSON.stringify(manifest)).not.toContain("workspace:");
    expect(manifest).toHaveProperty("version", fixture.version);
    if (name === MAIN_PACKAGE)
      expect(manifest).toHaveProperty("optionalDependencies", {
        [PLATFORM_PACKAGE]: fixture.version,
      });
    else {
      expect(manifest).toHaveProperty("os", ["darwin"]);
      expect(manifest).toHaveProperty("cpu", ["arm64"]);
    }
    expect(manifest).not.toHaveProperty("private");
    expect(manifest).not.toHaveProperty("exports");
    expect(await readFile(join(directory, "LICENSE"), "utf8")).toContain("MIT License");
    expect(await readFile(join(directory, "THIRD_PARTY_NOTICES.md"), "utf8")).toContain("Bun");
    const files = await readdir(directory, { recursive: true, withFileTypes: true });
    const relativeFiles = files
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name).slice(directory.length + 1));
    expect(
      relativeFiles.every(
        (path) =>
          path === "package.json" ||
          path === "LICENSE" ||
          path === "THIRD_PARTY_NOTICES.md" ||
          (name === MAIN_PACKAGE ? path === "bin/rukie.cjs" : path.startsWith("bin/")),
      ),
    ).toBe(true);
    expect(
      relativeFiles.some(
        (path) => path.includes("settings") || path.includes("sessions") || path.includes("tests"),
      ),
    ).toBe(false);
  }
});

for (const [signal, expectedCode] of [
  ["SIGINT", 130],
  ["SIGTERM", 143],
] as const) {
  test(`installed launcher preserves ${signal} cancellation and resumes accepted work`, async () => {
    const owner = commandOwner;
    const streaming = fakeOpenAI("pending partial", { holdOpen: true });
    const closeStreaming = owner.ownCleanup(() => streaming.stop());
    let active: ReturnType<typeof fixture.start> | undefined;
    try {
      await configureProvider(fixture.homeDir, streaming.baseUrl);
      active = await owner.start([
        "-p",
        "--output-format",
        "stream-json",
        `accepted ${signal} installed request`,
      ]);
      await streaming.received;
      active.child.kill(signal);
      const interrupted = await active.result;
      expect(interrupted.code).toBe(expectedCode);
      expect(interrupted.stderr).toContain("Interrupted");
      const events: unknown[] = interrupted.stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const snapshot = events.find(
        (value) =>
          value && typeof value === "object" && "type" in value && value.type === "snapshot",
      );
      if (
        !snapshot ||
        typeof snapshot !== "object" ||
        !("sessionId" in snapshot) ||
        typeof snapshot.sessionId !== "string"
      )
        throw new Error("Interrupted Session did not expose its identity");
      await closeStreaming();
      const resumedServer = fakeOpenAI("resumed installed cancellation");
      const closeResumed = owner.ownCleanup(() => resumedServer.stop());
      try {
        await configureProvider(fixture.homeDir, resumedServer.baseUrl);
        const resumed = await owner.run(["-p", "--resume", snapshot.sessionId, ""]);
        expect(resumed.code).toBe(0);
        expect(resumed.stdout).toBe("resumed installed cancellation\n");
        expect(JSON.stringify(resumedServer.requests[0]!.body)).toContain(
          `accepted ${signal} installed request`,
        );
      } finally {
        await closeResumed();
      }
    } finally {
      await closeStreaming();
    }
  }, 15_000);
}

test("installed interruption closes a live bash process and owned capture resources", async () => {
  const owner = commandOwner;
  const pidPath = join(fixture.cwd, "packaged-bash.pid");
  const observed = Promise.withResolvers<number>();
  const watcher = watch(fixture.cwd, (_event, filename) => {
    if (filename === "packaged-bash.pid")
      void readFile(pidPath, "utf8")
        .then((value) => {
          if (/^\d+$/.test(value) && Number(value) > 0) observed.resolve(Number(value));
        })
        .catch(() => {});
  });
  const closeWatcher = owner.ownCleanup(async () => {
    const closed = once(watcher, "close");
    watcher.close();
    await closed;
  });
  const server = fakeOpenAI("unused", {
    toolCalls: [
      {
        name: "bash",
        arguments: {
          command: 'printf "%s" $$ > packaged-bash.pid; mkfifo packaged-wait; cat packaged-wait',
          description: "Controlled blocking process",
        },
      },
    ],
  });
  const closeServer = owner.ownCleanup(() => server.stop());
  let active: ReturnType<typeof fixture.start> | undefined;
  try {
    await configureProvider(fixture.homeDir, server.baseUrl);
    active = await owner.start(["-p", "--permission-mode", "full-access", "run controlled bash"]);
    // Observe a real subprocess file event; parent clocks cannot drive process/transport startup.
    const pid = await observed.promise;
    expect(pid).toBeGreaterThan(0);
    active.child.kill("SIGTERM");
    expect((await active.result).code).toBe(143);
    expect(() => process.kill(pid, 0)).toThrow();
    expect(
      (await readdir(fixture.tempDir)).filter((name) => name.startsWith("rukie-jobs-")),
    ).toEqual([]);
  } finally {
    await closeWatcher();
    await closeServer();
  }
}, 15_000);

test("packaged bash capture bounds output and releases its actual spill files at command exit", async () => {
  const owner = commandOwner;
  const server = fakeOpenAI("large capture complete", {
    toolCalls: [
      {
        name: "bash",
        arguments: {
          command: `awk 'BEGIN { for (i=0; i<6000; i++) print "capture-line-" i; }'`,
          description: "Generate bounded output",
        },
      },
    ],
  });
  const closeServer = owner.ownCleanup(() => server.stop());
  try {
    await configureProvider(fixture.homeDir, server.baseUrl);
    const result = await owner.run([
      "-p",
      "--permission-mode",
      "full-access",
      "capture large output",
    ]);
    expect(result.code).toBe(0);
    const request = JSON.stringify(server.requests[1]!.body);
    expect(request).toContain("capture-line-5999");
    expect(request).toContain("Full output:");
    expect(request).toContain("rukie-jobs-");
    expect(
      (await readdir(fixture.tempDir)).filter((name) => name.startsWith("rukie-jobs-")),
    ).toEqual([]);
  } finally {
    await closeServer();
  }
});

test("installed fixture cancellation waits for active commands and permits the next owner", async () => {
  const owner = commandOwner;
  const server = fakeOpenAI("held cancellation reply", { holdOpen: true });
  const closeServer = owner.ownCleanup(() => server.stop());
  let active: ReturnType<typeof fixture.start> | undefined;
  try {
    await configureProvider(fixture.homeDir, server.baseUrl);
    active = await owner.start(["-p", "owned installed request"]);
    await server.received;
    await fixture.cancelCommands();
    expect((await active.result).code).toBe(143);
    expect(() => process.kill(active!.child.pid, 0)).toThrow();
    expect(await owner.run(["--version"])).toEqual({
      code: 0,
      stdout: `${fixture.version}\n`,
      stderr: "",
    });
  } finally {
    await closeServer();
  }
});
