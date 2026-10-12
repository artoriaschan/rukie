import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { realpath } from "node:fs/promises";
import {
  ensureDevelopmentDirectory,
  checkPersistentData,
  developmentEnvironment,
  acquireDevelopmentLock,
  stopRemainingGroup,
} from "./development.ts";

export async function webDevelopmentPaths(
  checkout: string,
  options: {
    home?: string;
    platform?: NodeJS.Platform;
    environment?: NodeJS.ProcessEnv;
  } = {},
) {
  const root = await realpath(checkout);
  const home = options.home ?? homedir();
  const platform = options.platform ?? process.platform;
  const environment = options.environment ?? process.env;
  const base =
    platform === "darwin"
      ? join(home, "Library/Application Support")
      : platform === "win32"
        ? environment.APPDATA
        : environment.XDG_DATA_HOME || join(home, ".local/share");
  if (!base || !isAbsolute(base))
    throw new Error("Web development application data directory must be absolute");
  const local = join(root, ".desktop-dev/web");
  const data = join(local, "data");
  const configuration = join(base, "Rukie Web Development/configuration");
  await ensureDevelopmentDirectory(data);
  await ensureDevelopmentDirectory(configuration);
  await checkPersistentData(data);
  await checkPersistentData(configuration);
  return { root, local, data, configuration };
}

type WebPaths = Awaited<ReturnType<typeof webDevelopmentPaths>>;
type Command = readonly [string, ...string[]];
type OwnedProcess = { child: ChildProcess; closed: Promise<void> };

type LaunchOptions = {
  paths: WebPaths;
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  reset?: boolean;
  open?: boolean;
  sidecarCommand?: Command;
  viteCommand?: Command;
  openCommand?: (url: string) => Command;
  handshakeTimeoutMs?: number;
  startupTimeoutMs?: number;
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
};

function openBrowserCommand(url: string): Command {
  if (process.platform === "darwin") return ["open", url];
  if (process.platform === "win32") return ["explorer.exe", url];
  return ["xdg-open", url];
}

/** Own the services until cancellation; on any failure drain both children before releasing the lock. */
export async function launchWebDevelopment(options: LaunchOptions): Promise<void> {
  const environment = developmentEnvironment(options.environment ?? process.env);
  const output = options.stdout ?? ((text) => process.stdout.write(text));
  const errors = options.stderr ?? ((text) => process.stderr.write(text));
  options.signal?.throwIfAborted();
  const release = await acquireDevelopmentLock(options.paths.local);
  const cancelled = Promise.withResolvers<void>();
  const failed = Promise.withResolvers<never>();
  // A child can fail before its startup output, so observe failure immediately.
  void failed.promise.catch(() => {});
  const abort = () => cancelled.resolve();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  let stopping = false;
  const children: OwnedProcess[] = [];
  function start(
    command: Command,
    env: NodeJS.ProcessEnv,
    line: (text: string) => void,
    expectedExit = false,
  ): OwnedProcess {
    const child = spawn(command[0], command.slice(1), {
      cwd: options.paths.root,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let spawnError: Error | undefined;
    const closed = new Promise<void>((resolveClosed) => {
      child.once("error", (error) => {
        spawnError = error;
      });
      child.once("close", (code, signal) => {
        if (!stopping && (!expectedExit || code !== 0))
          failed.reject(
            spawnError ?? new Error(`${command[0]} exited unexpectedly (${code ?? signal})`),
          );
        resolveClosed();
      });
    });
    createInterface({ input: child.stdout }).on("line", line);
    child.stderr.on("data", (chunk: Buffer) => errors(chunk.toString()));
    const owned = { child, closed };
    children.push(owned);
    return owned;
  }
  async function stop(owned: OwnedProcess) {
    const { child, closed } = owned;
    child.kill("SIGTERM");
    // Escalation bounds failed graceful shutdown; actual close remains the completion signal.
    const timer = setTimeout(() => {
      try {
        if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, 5_000);
    try {
      await closed;
      if (child.pid && process.platform !== "win32") await stopRemainingGroup(child.pid);
    } finally {
      clearTimeout(timer);
    }
  }
  async function waitFor<T>(
    ready: Promise<T>,
    timeoutMs: number,
    label: string,
  ): Promise<T | undefined> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        ready,
        failed.promise,
        cancelled.promise.then(() => undefined),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(`${label} timed out after ${timeoutMs}ms; see sidecar stderr above`),
              ),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async function shutdown() {
    stopping = true;
    options.signal?.removeEventListener("abort", abort);
    let cleanupError: unknown;
    for (const child of children.toReversed()) {
      try {
        await stop(child);
      } catch (error) {
        cleanupError ??= error;
      }
    }
    if (cleanupError) throw cleanupError; // Preserve the lock when cleanup cannot be verified.
    await release();
  }
  try {
    if (options.reset) {
      await rm(options.paths.data, { recursive: true, force: true });
      await ensureDevelopmentDirectory(options.paths.data);
    }
    const handshake = Promise.withResolvers<{ port: number; token: string }>();
    let received = false;
    start(
      options.sidecarCommand ?? [process.execPath, "packages/server/src/main.ts", "--dev"],
      {
        ...environment,
        RUKIE_DESKTOP_DATA_ROOT: options.paths.data,
        RUKIE_DESKTOP_CONFIGURATION_ROOT: options.paths.configuration,
        RUKIE_DESKTOP_ENCRYPTION_BACKEND: "system-keychain",
        RUKIE_DESKTOP_SECRET_SERVICE: "Rukie Web Development",
      },
      (line) => {
        if (received) return;
        received = true;
        try {
          const value: unknown = JSON.parse(line);
          if (
            !value ||
            typeof value !== "object" ||
            !("port" in value) ||
            !("token" in value) ||
            typeof value.port !== "number" ||
            !Number.isInteger(value.port) ||
            value.port < 1 ||
            value.port > 65535 ||
            typeof value.token !== "string" ||
            value.token.length === 0
          )
            throw new Error("Invalid sidecar handshake");
          handshake.resolve({ port: value.port, token: value.token });
        } catch {
          failed.reject(new Error("Invalid sidecar handshake"));
        }
      },
    );
    const connection = await waitFor(
      handshake.promise,
      options.handshakeTimeoutMs ?? 15_000,
      "Sidecar handshake",
    );
    if (!connection) return;
    const viteReady = Promise.withResolvers<true>();
    start(
      options.viteCommand ?? [
        process.execPath,
        "node_modules/vite/bin/vite.js",
        "--config",
        "packages/ui/vite.config.ts",
        "--host",
        "localhost",
        "--port",
        "5173",
        "--strictPort",
        "packages/ui",
      ],
      environment,
      (line) => {
        output(`${line}\n`);
        if (line.includes("http://localhost:5173/")) viteReady.resolve(true);
      },
    );
    if (!(await waitFor(viteReady.promise, options.startupTimeoutMs ?? 15_000, "Vite startup")))
      return;
    const url = `http://localhost:5173/#${new URLSearchParams({ port: String(connection.port), token: connection.token })}`;
    output(`${url}\n`);
    if (options.open) {
      const opener = start(
        (options.openCommand ?? openBrowserCommand)(url),
        environment,
        () => {},
        true,
      );
      if (
        !(await waitFor(
          opener.closed.then(() => true),
          options.startupTimeoutMs ?? 15_000,
          "Browser dispatch",
        ))
      )
        return;
      if (opener.child.exitCode !== 0) throw new Error("Could not open the default browser");
    }
    await Promise.race([failed.promise, cancelled.promise]);
  } finally {
    await shutdown();
  }
}

/** CLI lifecycle boundary; remove process listeners after all owned services have exited. */
export async function runWebDevelopment(options: Omit<LaunchOptions, "signal">): Promise<void> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    await launchWebDevelopment({ ...options, signal: controller.signal });
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (args.some((argument) => !["--reset", "--open"].includes(argument)))
      throw new Error("Usage: dev:desktop:web [--reset] [--open]");
    developmentEnvironment(process.env);
    await runWebDevelopment({
      paths: await webDevelopmentPaths(process.cwd()),
      reset: args.includes("--reset"),
      open: args.includes("--open"),
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Web development startup failed");
    process.exitCode = 1;
  }
}
