import { BUILD_BUN_VERSION } from "../release/platforms.ts";
import { compiledBunOptions } from "../compiled-bun.ts";
import { spawn, execFile } from "node:child_process";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
  open,
  unlink,
  readdir,
  readlink,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  flipFuses,
  FuseV1Options,
  FuseVersion,
  FuseState,
  getCurrentFuseWire,
} from "@electron/fuses";

export const developmentIdentity = {
  name: "rukie-desktop-development",
  product: "Rukie Development",
  appId: "dev.rukie.desktop.development",
} as const;

/** Fixed local state; reject symlinks rather than following developer state into another environment. */
export async function developmentPaths(checkout: string) {
  const root = await realpath(checkout);
  const local = join(root, ".desktop-dev");
  const paths = {
    root,
    local,
    build: join(local, "build"),
    renderer: join(local, "build/renderer"),
    data: join(local, "data"),
    userData: join(local, "electron"),
    sessionData: join(local, "session"),
    cache: join(local, "cache"),
  };
  for (const path of [
    local,
    paths.build,
    paths.data,
    paths.userData,
    paths.sessionData,
    paths.cache,
  ]) {
    try {
      const info = await lstat(path);
      if (info.isSymbolicLink())
        throw new Error("Desktop development state cannot be a symbolic link");
      if (!info.isDirectory()) throw new Error("Desktop development state must be a directory");
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT")
        throw error;
      await mkdir(path);
    }
    if ((await realpath(path)) !== path)
      throw new Error("Desktop development state escaped its checkout");
  }
  for (const path of [
    join(paths.build, "main.js"),
    join(paths.build, "preload.cjs"),
    join(paths.build, "rukie-server"),
    join(paths.build, "rg"),
    join(paths.cache, "electron-41.0.3.json"),
  ])
    await checkedFile(path);
  await checkedFile(paths.renderer, true);
  await checkedFile(join(paths.cache, "Rukie Development.app"), true);
  await checkPersistentData(paths.data);
  await checkPersistentData(paths.userData, true);
  await checkPersistentData(paths.sessionData, true);
  return paths;
}

async function checkPersistentData(directory: string, electronStorage = false): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      // Chromium owns these exact native IPC links; never follow their targets.
      if (
        electronStorage &&
        ["SingletonLock", "SingletonCookie", "SingletonSocket"].includes(entry.name)
      ) {
        if (entry.name === "SingletonLock") {
          const target = await readlink(path);
          const match = /-(\d+)$/.exec(target);
          if (!match)
            throw new Error(
              "Unrecognized native desktop lock; remove it only after confirming development processes exited",
            );
          try {
            process.kill(Number(match[1]), 0);
            throw new Error("A native development application is still active");
          } catch (error) {
            if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ESRCH")
              throw error;
          }
        }
        continue;
      }
      throw new Error("Development persistent data cannot contain a symbolic link");
    }
    if (info.isDirectory()) await checkPersistentData(path);
  }
}

/** A second launcher cannot rebuild files underneath a running development application. */
export async function acquireDevelopmentLock(local: string) {
  const path = join(local, "launcher.lock");
  let file;
  try {
    file = await open(path, "wx");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST")
      throw new Error(
        "Desktop development launcher is already active; if it crashed, remove .desktop-dev/launcher.lock only after confirming its processes have exited",
      );
    throw error;
  }
  try {
    await file.writeFile(String(process.pid));
  } catch (error) {
    await file.close();
    await unlink(path);
    throw error;
  }
  await file.close();
  let released: Promise<void> | undefined;
  return () => (released ??= unlink(path));
}

async function checkedFile(path: string, directory = false) {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink())
      throw new Error("Desktop development artifact cannot be a symbolic link");
    if (directory ? !info.isDirectory() : !info.isFile())
      throw new Error("Unexpected desktop development artifact type");
    if ((await realpath(path)) !== path)
      throw new Error("Desktop development artifact escaped its directory");
  } catch (error) {
    if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT")
      throw error;
  }
}

/** Preserve real tool HOME; external desktop launch controls cannot redirect development into production. */
export function developmentEnvironment(environment: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  for (const key of Object.keys(environment)) {
    if (
      key.startsWith("RUKIE_DESKTOP_") ||
      key.startsWith("ELECTRON_") ||
      key === "NODE_OPTIONS" ||
      key === "BUN_OPTIONS" ||
      key === "BUN_BE_BUN" ||
      key.startsWith("DYLD_")
    )
      throw new Error(`Remove ${key}: desktop development does not accept environment overrides`);
  }
  return { ...environment };
}

class DevelopmentCleanupError extends Error {}

async function processGroupMembers(group: number): Promise<number[]> {
  const output = await new Promise<string>((resolveOutput, reject) => {
    execFile(
      "/bin/ps",
      ["-axo", "pid=,pgid=,stat="],
      { timeout: 2_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolveOutput(stdout)),
    );
  });
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)/.exec(line);
    return match && Number(match[2]) === group && !match[3]?.startsWith("Z")
      ? [Number(match[1])]
      : [];
  });
}

async function stopRemainingGroup(group: number) {
  const started = performance.now();
  let killed = false;
  for (let probe = 0; probe < 128; probe++) {
    // Each asynchronous process snapshot observes actual exit; no sleep or readiness timer.
    const members = await processGroupMembers(group);
    if (members.length === 0) return;
    if (probe === 0 || (!killed && (probe >= 64 || performance.now() - started >= 10_000))) {
      killed = probe !== 0;
      try {
        process.kill(-group, killed ? "SIGKILL" : "SIGTERM");
      } catch (error) {
        if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ESRCH")
          throw error;
      }
    }
    if (performance.now() - started >= 12_000) break;
  }
  throw new DevelopmentCleanupError(
    "Desktop development process group did not exit; launcher lock retained",
  );
}

/** Own one child, relay cancellation and await close; escalation is a failure bound, never readiness. */
export function runDevelopmentProcess(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; signal?: AbortSignal },
): Promise<void> {
  options.signal?.throwIfAborted();
  return new Promise((resolveProcess, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: "inherit",
      detached: process.platform !== "win32",
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let spawnError: Error | undefined;
    const cancel = () => {
      child.kill("SIGTERM");
      timer ??= setTimeout(() => {
        // The process group includes Electron helpers and its sidecar if graceful shutdown fails.
        try {
          if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
          else child.kill("SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }, 10_000);
    };
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", cancel);
      const finish = async () => {
        if (child.pid && process.platform !== "win32") {
          try {
            await stopRemainingGroup(child.pid);
          } catch (error) {
            throw error instanceof DevelopmentCleanupError
              ? error
              : new DevelopmentCleanupError(
                  `Could not verify desktop process cleanup: ${String(error)}`,
                );
          }
        }
        if (spawnError) throw spawnError;
        if (options.signal?.aborted || code === 0) return;
        throw new Error(`${command} exited with ${code ?? signal}`);
      };
      void finish().then(resolveProcess, reject);
    });
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();
  });
}

async function developmentBundle(
  paths: Awaited<ReturnType<typeof developmentPaths>>,
  env: NodeJS.ProcessEnv,
  signal: AbortSignal,
) {
  const app = join(paths.cache, "Rukie Development.app");
  const marker = join(paths.cache, "electron-41.0.3.json");
  const identity = JSON.stringify({
    electron: "41.0.3",
    ...developmentIdentity,
    main: join(paths.build, "main.js"),
    cookieEncryption: false,
  });
  await checkedFile(app, true);
  await checkedFile(marker);
  let cached = false;
  try {
    cached = (await readFile(marker, "utf8")) === identity;
  } catch {
    /* First launch has no cache. */
  }
  if (!cached) {
    await rm(app, { recursive: true, force: true });
    const electronPackage = dirname(
      Bun.resolveSync("electron/package.json", join(paths.root, "packages/desktop")),
    );
    const manifest: unknown = JSON.parse(
      await readFile(join(electronPackage, "package.json"), "utf8"),
    );
    if (
      !manifest ||
      typeof manifest !== "object" ||
      !("version" in manifest) ||
      manifest.version !== "41.0.3"
    )
      throw new Error("Desktop development requires locked Electron 41.0.3");
    const sourceApp = join(electronPackage, "dist/Electron.app");
    try {
      await lstat(sourceApp);
    } catch (error) {
      if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT")
        throw error;
      await runDevelopmentProcess("node", [join(electronPackage, "install.js")], {
        cwd: paths.root,
        env,
        signal,
      });
    }
    signal.throwIfAborted();
    await cp(sourceApp, app, { recursive: true });
    const contents = join(app, "Contents");
    const packageDirectory = join(contents, "Resources/app");
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(
      join(packageDirectory, "package.json"),
      JSON.stringify({
        name: developmentIdentity.name,
        productName: developmentIdentity.product,
        version: "0.0.0",
        type: "module",
        main: join(paths.build, "main.js"),
      }),
    );
    const plist = join(contents, "Info.plist");
    for (const [key, value] of [
      ["CFBundleIdentifier", developmentIdentity.appId],
      ["CFBundleName", developmentIdentity.product],
      ["CFBundleDisplayName", developmentIdentity.product],
    ] as const) {
      await runDevelopmentProcess(
        "/usr/libexec/PlistBuddy",
        ["-c", `Set :${key} ${value}`, plist],
        { cwd: paths.root, env, signal },
      );
    }
    await flipFuses(app, {
      version: FuseVersion.V1,
      [FuseV1Options.EnableCookieEncryption]: false,
    });
    await runDevelopmentProcess("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", app], {
      cwd: paths.root,
      env,
      signal,
    });
    signal.throwIfAborted();
    await writeFile(marker, identity);
  }
  const packagePath = join(app, "Contents/Resources/app/package.json");
  const plistPath = join(app, "Contents/Info.plist");
  await checkedFile(packagePath);
  await checkedFile(plistPath);
  const packageManifest: unknown = JSON.parse(await readFile(packagePath, "utf8"));
  if (
    !packageManifest ||
    typeof packageManifest !== "object" ||
    !("name" in packageManifest) ||
    packageManifest.name !== developmentIdentity.name ||
    !("productName" in packageManifest) ||
    packageManifest.productName !== developmentIdentity.product ||
    !("main" in packageManifest) ||
    packageManifest.main !== join(paths.build, "main.js")
  )
    throw new Error("Unexpected development package identity");
  const plistContent = await readFile(plistPath, "utf8");
  for (const [key, value] of [
    ["CFBundleIdentifier", developmentIdentity.appId],
    ["CFBundleName", developmentIdentity.product],
    ["CFBundleDisplayName", developmentIdentity.product],
  ] as const) {
    if (
      !new RegExp(`<key>${key}</key>\\s*<string>${value.replaceAll(".", "\\.")}</string>`).test(
        plistContent,
      )
    )
      throw new Error("Unexpected development bundle identity");
  }
  if ((await getCurrentFuseWire(app))[FuseV1Options.EnableCookieEncryption] !== FuseState.DISABLE)
    throw new Error("Development Cookie Encryption must remain disabled");
  await runDevelopmentProcess("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], {
    cwd: paths.root,
    env,
    signal,
  });
  return join(app, "Contents/MacOS/Electron");
}

/** Rebuild current sources without producing or modifying the release bundle. */
export async function buildDevelopmentSources(checkout: string, signal: AbortSignal) {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error("Desktop development requires macOS arm64");
  if (Bun.version !== BUILD_BUN_VERSION)
    throw new Error(`Desktop development requires Bun ${BUILD_BUN_VERSION}`);
  const env = developmentEnvironment(process.env);
  const paths = await developmentPaths(checkout);
  // Remove owned build directory without following symlinks left inside it.
  await rm(paths.build, { recursive: true, force: true });
  await mkdir(paths.build);
  for (const [entry, format, name] of [
    ["development", "esm", "main.js"],
    ["preload", "cjs", "preload.cjs"],
  ] as const) {
    signal.throwIfAborted();
    const result = await Bun.build({
      entrypoints: [join(paths.root, `packages/desktop/src/${entry}.ts`)],
      target: "node",
      format,
      external: ["electron"],
      outdir: paths.build,
      naming: name,
      sourcemap: "linked",
      define: { RUKIE_DESKTOP_DEVELOPMENT_ROOT: JSON.stringify(paths.root) },
    });
    if (!result.success) throw new AggregateError(result.logs, `${entry} compilation failed`);
  }
  const sidecar = await Bun.build({
    entrypoints: [join(paths.root, "packages/server/src/main.ts")],
    ...compiledBunOptions("bun-darwin-arm64", join(paths.build, "rukie-server")),
  });
  if (!sidecar.success)
    throw new AggregateError(sidecar.logs, "Development sidecar compilation failed");
  const rgModule = dirname(
    Bun.resolveSync("@vscode/ripgrep/package.json", join(paths.root, "packages/agent")),
  );
  const rg = dirname(Bun.resolveSync("@vscode/ripgrep-darwin-arm64/package.json", rgModule));
  await cp(join(rg, "bin/rg"), join(paths.build, "rg"));
  await runDevelopmentProcess(
    "node",
    [
      join(paths.root, "node_modules/vite/bin/vite.js"),
      "build",
      "packages/ui",
      "--config",
      "packages/ui/vite.config.ts",
      "--outDir",
      paths.renderer,
      "--emptyOutDir",
      "--sourcemap",
    ],
    { cwd: paths.root, env, signal },
  );
  return paths;
}

export async function developDesktop(checkout: string, signal: AbortSignal) {
  const env = developmentEnvironment(process.env);
  const paths = await developmentPaths(checkout);
  const release = await acquireDevelopmentLock(paths.local);
  let cleanupFailed = false;
  try {
    // Launcher exclusion and the verified dead native lock precede unlinking only Chromium IPC links.
    for (const directory of [paths.userData, paths.sessionData]) {
      for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
        const path = join(directory, name);
        try {
          if ((await lstat(path)).isSymbolicLink()) await unlink(path);
        } catch (error) {
          if (!error || typeof error !== "object" || !("code" in error) || error.code !== "ENOENT")
            throw error;
        }
      }
    }
    await buildDevelopmentSources(checkout, signal);
    const executable = await developmentBundle(paths, env, signal);
    signal.throwIfAborted();
    console.log(`Rukie Development: ${paths.local} (sources rebuilt; Ctrl+C closes the owned app)`);
    await runDevelopmentProcess(executable, [], { cwd: paths.root, env, signal });
  } catch (error) {
    cleanupFailed = error instanceof DevelopmentCleanupError;
    throw error;
  } finally {
    if (!cleanupFailed) await release();
  }
}

if (import.meta.main) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  try {
    await developDesktop(resolve(import.meta.dir, "../.."), controller.signal);
  } catch (error) {
    if (!controller.signal.aborted || error instanceof DevelopmentCleanupError) {
      console.error(error);
      process.exitCode = 1;
    }
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}
