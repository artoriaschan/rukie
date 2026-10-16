import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MAIN_PACKAGE, PLATFORM_PACKAGE } from "../build.ts";
import { verifyReleaseArtifacts } from "../verify.ts";

export async function installRelease(
  artifactDirectory: string,
  options: {
    registry?: string;
    npm?: string;
    npmEnv?: Record<string, string | undefined>;
    sourceRoot?: string;
  } = {},
) {
  const metadata = await verifyReleaseArtifacts(artifactDirectory, { root: options.sourceRoot });
  const version = metadata.version;
  const packages = metadata.packages.map((value) => join(artifactDirectory, value.tarball));
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie installed release ")));
  const active = new Set<{ kill(): void; settled: Promise<void> }>();
  let closing = false;
  let cleanupPromise: Promise<void> | undefined;
  function own<T>(kill: () => void, result: Promise<T>) {
    const owned = {
      kill,
      settled: result.then(
        () => {},
        () => {},
      ),
    };
    active.add(owned);
    void owned.settled.then(() => active.delete(owned));
    return result;
  }
  async function cancelCommands() {
    const pending = [...active];
    for (const owned of pending) owned.kill();
    await Promise.all(pending.map((owned) => owned.settled));
  }
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      closing = true;
      await cancelCommands();
      await rm(root, { recursive: true, force: true });
    })());
  try {
    const prefix = join(root, "npm prefix with spaces");
    const homeDir = join(root, "isolated home");
    const cwd = join(root, "project with spaces");
    const pathDir = join(root, "runtime path");
    const tempDir = join(root, "temporary runtime files");
    await Promise.all([
      mkdir(prefix),
      mkdir(join(homeDir, ".rukie"), { recursive: true }),
      mkdir(cwd),
      mkdir(pathDir),
      mkdir(tempDir),
    ]);
    const node = Bun.which("node");
    if (!node)
      throw new Error(
        "Installation acceptance needs Node/npm (the installed product does not need Bun)",
      );
    await symlink(await realpath(node), join(pathDir, "node"));
    const installer = Bun.spawn(
      [
        options.npm ?? "npm",
        "install",
        "--prefix",
        prefix,
        ...(options.registry
          ? ["--registry", options.registry, "--cache", join(root, "registry cache")]
          : ["--offline"]),
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        ...(options.registry ? [`${MAIN_PACKAGE}@${version}`] : packages),
      ],
      {
        env: { ...process.env, ...options.npmEnv, HOME: homeDir },
        stdout: "pipe",
        stderr: "pipe",
        signal: AbortSignal.timeout(30_000),
      },
    );
    const [installCode, stdout, stderr] = await own(
      () => installer.kill(),
      Promise.all([
        installer.exited,
        new Response(installer.stdout).text(),
        new Response(installer.stderr).text(),
      ]),
    );
    if (installCode !== 0) throw new Error(`Tarball installation failed: ${stdout}\n${stderr}`);
    const command = join(prefix, "node_modules/.bin/rukie");
    const binary = join(prefix, "node_modules", PLATFORM_PACKAGE, "bin/rukie");
    const launcher = join(prefix, "node_modules", MAIN_PACKAGE, "bin/rukie.cjs");
    const env = {
      HOME: homeDir,
      TMPDIR: tempDir,
      PATH: `${pathDir}:/usr/bin:/bin`,
      LANG: "en",
      LC_ALL: "en",
      FAKE_API_KEY: "packaged-key",
      RUKIE_ACCEPTANCE_SENTINEL: "preserved",
      NO_PROXY: "127.0.0.1,localhost",
    };
    function start(
      argv: string[],
      options: {
        stdin?: string;
        command?: string;
        env?: Record<string, string>;
        timeoutMs?: number;
        /** Bounded, content-free lifecycle facts for a failing installed-command case. */
        onStage?: (
          stage:
            | "spawn-start"
            | "spawn"
            | "kill"
            | "exit"
            | "stdout-eof"
            | "stderr-eof"
            | "exit-error"
            | "stdout-error"
            | "stderr-error"
            | "settled",
          facts: { pid?: number; code?: number; chars?: number },
        ) => void;
      } = {},
    ) {
      if (closing) throw new Error("Installed release fixture is closing");
      options.onStage?.("spawn-start", {});
      const child = Bun.spawn([options.command ?? command, ...argv], {
        cwd,
        env: { ...env, ...options.env },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
      });
      options.onStage?.("spawn", { pid: child.pid });
      const exited = child.exited;
      const stdout = new Response(child.stdout).text();
      const stderr = new Response(child.stderr).text();
      // Observe the original promises without adding a hop to the command's completion path.
      const onStage = options.onStage;
      if (onStage) {
        void exited.then(
          (code) => onStage("exit", { pid: child.pid, code }),
          () => onStage("exit-error", { pid: child.pid }),
        );
        void stdout.then(
          (value) => onStage("stdout-eof", { pid: child.pid, chars: value.length }),
          () => onStage("stdout-error", { pid: child.pid }),
        );
        void stderr.then(
          (value) => onStage("stderr-eof", { pid: child.pid, chars: value.length }),
          () => onStage("stderr-error", { pid: child.pid }),
        );
      }
      const result = own(
        () => {
          options.onStage?.("kill", { pid: child.pid });
          child.kill();
        },
        Promise.all([exited, stdout, stderr]).then(([code, stdout, stderr]) => {
          options.onStage?.("settled", { pid: child.pid, code });
          return { code, stdout, stderr };
        }),
      );
      child.stdin.write(options.stdin ?? "");
      child.stdin.end();
      return { child, result };
    }
    return {
      root,
      version,
      prefix,
      cwd,
      homeDir,
      tempDir,
      command,
      binary,
      launcher,
      env,
      start,
      run: (argv: string[], options?: Parameters<typeof start>[1]) => start(argv, options).result,
      cancelCommands,
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}

export async function configureProvider(homeDir: string, baseUrl: string) {
  await Bun.write(
    join(homeDir, ".rukie/settings.json"),
    JSON.stringify({
      model: "local/m",
      providers: [
        {
          id: "local",
          api: "openai-completions",
          baseUrl,
          apiKeyEnv: "FAKE_API_KEY",
          models: [{ id: "m", reasoning: true }],
        },
      ],
    }),
  );
}
