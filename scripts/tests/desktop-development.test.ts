import { expect, test, onTestFinished } from "bun:test";
import {
  mkdtemp,
  mkdir,
  rm,
  symlink,
  realpath,
  writeFile,
  readlink,
  readdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watch } from "node:fs";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import {
  copyDevelopmentRuntime,
  writeDevelopmentEntry,
  validateDevelopmentEntry,
  developmentPaths,
  developmentEnvironment,
  runDevelopmentProcess,
  acquireDevelopmentLock,
} from "../desktop/development.ts";

test("desktop development paths stay inside the checkout and reject inherited production overrides", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie-dev-")));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const paths = await developmentPaths(root, root);
  expect(paths.data).toBe(join(root, ".desktop-dev/data"));
  expect(paths.userData).toBe(join(root, ".desktop-dev/electron"));
  expect(paths.sessionData).toBe(join(root, ".desktop-dev/session"));
  expect(developmentEnvironment({ HOME: "/real/tool/home", PATH: "/bin" })).toEqual({
    HOME: "/real/tool/home",
    PATH: "/bin",
  });
  expect(() => developmentEnvironment({ RUKIE_DESKTOP_DATA_ROOT: "/production" })).toThrow(
    "override",
  );
  await rm(paths.sessionData, { recursive: true });
  await mkdir(join(root, "outside"));
  await symlink(join(root, "outside"), paths.sessionData);
  await expect(developmentPaths(root, root)).rejects.toThrow("symbolic link");
});

test("developer launcher waits for cancellation cleanup and reports startup or process failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-dev-process-"));
  const controller = new AbortController();
  const watcher = watch(root);
  let running: Promise<void> | undefined;
  onTestFinished(async () => {
    controller.abort();
    await running;
    watcher.close();
    await rm(root, { recursive: true, force: true });
  });
  const ready = once(watcher, "change", { signal: AbortSignal.timeout(5_000) });
  const source = `const fs = require("node:fs"); process.on("SIGTERM", () => { fs.writeFileSync("stopped", "closed"); process.exit(0); }); fs.writeFileSync("ready", String(process.pid)); setInterval(() => {}, 100000);`;
  running = runDevelopmentProcess(process.execPath, ["-e", source], {
    cwd: root,
    env: developmentEnvironment({ ...process.env }),
    signal: controller.signal,
  });
  await ready;
  const pid = Number(await readFile(join(root, "ready"), "utf8"));
  controller.abort();
  await running;
  expect(await readFile(join(root, "stopped"), "utf8")).toBe("closed");
  expect(() => process.kill(pid, 0)).toThrow();
  await expect(
    runDevelopmentProcess(join(root, "missing-executable"), [], { cwd: root, env: {} }),
  ).rejects.toThrow("ENOENT");
  await expect(
    runDevelopmentProcess(process.execPath, ["-e", "process.exit(37)"], { cwd: root, env: {} }),
  ).rejects.toThrow("37");
});

test("developer artifacts reject redirected builds and cached apps, and an active launcher excludes another", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie-dev-artifacts-")));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const paths = await developmentPaths(root, root);
  const outside = join(root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "sentinel"), "production untouched");
  for (const name of ["main.js", "preload.cjs", "rukie-server", "rg"]) {
    const artifact = join(paths.build, name);
    await symlink(join(outside, "sentinel"), artifact);
    await expect(developmentPaths(root, root)).rejects.toThrow("symbolic link");
    await rm(artifact);
  }
  for (const artifact of [
    paths.renderer,
    join(paths.cache, "Rukie Development.app"),
    join(paths.cache, "electron-41.0.3.json"),
  ]) {
    await symlink(outside, artifact);
    await expect(developmentPaths(root, root)).rejects.toThrow("symbolic link");
    await rm(artifact);
  }
  expect(await readFile(join(outside, "sentinel"), "utf8")).toBe("production untouched");
  const release = await acquireDevelopmentLock(paths.local);
  try {
    await expect(acquireDevelopmentLock(paths.local)).rejects.toThrow("already active");
  } finally {
    await release();
  }
  const nextRelease = await acquireDevelopmentLock(paths.local);
  await nextRelease();
  for (const name of [
    "NODE_OPTIONS",
    "BUN_OPTIONS",
    "BUN_BE_BUN",
    "DYLD_INSERT_LIBRARIES",
    "ELECTRON_RUN_AS_NODE",
    "RUKIE_DESKTOP_USER_DATA",
  ]) {
    expect(() => developmentEnvironment({ [name]: "unsafe" })).toThrow("override");
  }
});

test("development never follows existing business database or session links into production data", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie-dev-business-")));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const paths = await developmentPaths(root, root);
  const outside = join(root, "formal");
  await mkdir(outside);
  await writeFile(join(outside, "app.sqlite"), "formal database untouched");
  await symlink(join(outside, "app.sqlite"), join(paths.data, "app.sqlite"));
  await expect(developmentPaths(root, root)).rejects.toThrow("persistent data");
  await rm(join(paths.data, "app.sqlite"));
  await mkdir(join(paths.data, "sessions"));
  await symlink(outside, join(paths.data, "sessions/nested"));
  await expect(developmentPaths(root, root)).rejects.toThrow("persistent data");
  expect(await readFile(join(outside, "app.sqlite"), "utf8")).toBe("formal database untouched");
});

test("developer launcher waits for a descendant after its direct parent has exited", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-dev-descendant-"));
  const controller = new AbortController();
  let running: Promise<void> | undefined;
  onTestFinished(async () => {
    controller.abort();
    await running;
    await rm(root, { recursive: true, force: true });
  });
  const grandchild = `const fs = require("node:fs"); process.on("SIGTERM", () => { fs.writeFileSync("descendant-stopped", "exited"); process.exit(0); }); process.send("ready"); setInterval(() => {}, 100000);`;
  const parent = `const child = require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(grandchild)}], { stdio: ["ignore", "ignore", "ignore", "ipc"] }); child.once("message", () => { child.disconnect(); child.unref(); process.exit(0); });`;
  running = runDevelopmentProcess(process.execPath, ["-e", parent], {
    cwd: root,
    env: {},
    signal: controller.signal,
  });
  await running;
  expect(await readFile(join(root, "descendant-stopped"), "utf8")).toBe("exited");
});

test("developer native persistent storage rejects redirected cache while allowing only Chromium IPC links", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie-dev-native-data-")));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const paths = await developmentPaths(root, root);
  const outside = join(root, "formal");
  await mkdir(outside);
  for (const directory of [paths.userData, paths.sessionData]) {
    await symlink(outside, join(directory, "Cache"));
    await expect(developmentPaths(root, root)).rejects.toThrow("persistent data");
    await rm(join(directory, "Cache"));
    for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"])
      await symlink(
        name === "SingletonLock" ? "hostname-2147483647" : "/unresolved/native-ipc",
        join(directory, name),
      );
  }
  expect((await developmentPaths(root, root)).sessionData).toBe(paths.sessionData);
});

test("development runtime keeps framework links inside its independent app copy", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie-dev-framework-")));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source.app");
  const copy = join(root, "development.app");
  const framework = "Contents/Frameworks/Electron Framework.framework";
  await mkdir(join(source, framework, "Versions/A/Resources"), { recursive: true });
  await writeFile(join(source, framework, "Versions/A/Electron Framework"), "source runtime");
  await writeFile(join(source, framework, "Versions/A/Resources/sentinel"), "source resources");
  for (const [name, target] of [
    ["Versions/Current", "A"],
    ["Electron Framework", "Versions/Current/Electron Framework"],
    ["Resources", "Versions/Current/Resources"],
  ] as const)
    await symlink(target, join(source, framework, name));
  await copyDevelopmentRuntime(source, copy);
  expect(await readlink(join(copy, framework, "Versions/Current"))).toBe("A");
  expect(await readlink(join(copy, framework, "Electron Framework"))).toBe(
    "Versions/Current/Electron Framework",
  );
  expect(await readlink(join(copy, framework, "Resources"))).toBe("Versions/Current/Resources");
  await writeFile(join(copy, framework, "Resources/sentinel"), "independent copy");
  expect(await readFile(join(source, framework, "Resources/sentinel"), "utf8")).toBe(
    "source resources",
  );
  await rm(source, { recursive: true });
  expect(await readFile(join(copy, framework, "Electron Framework"), "utf8")).toBe(
    "source runtime",
  );
});

test("development entry loads the current external ESM main before bootstrap completes", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie-entry 空格#%-")));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const app = join(root, "Rukie Development.app/Contents/Resources/app");
  const build = join(root, ".desktop-dev/build");
  const cwd = join(root, "unrelated");
  await mkdir(app, { recursive: true });
  await mkdir(build, { recursive: true });
  await mkdir(cwd);
  await writeFile(join(build, "package.json"), JSON.stringify({ type: "module" }));
  await writeFile(
    join(build, "main.js"),
    `await Promise.resolve(); globalThis.loadedMain = "current-source";`,
  );
  await writeDevelopmentEntry(app, build);
  await validateDevelopmentEntry(app, build);
  const loader = `import { readFileSync } from "node:fs"; import { join } from "node:path"; import { pathToFileURL } from "node:url"; const app = process.argv[1]; const manifest = JSON.parse(readFileSync(join(app, "package.json"))); await import(pathToFileURL(join(app, manifest.main)).href); if (globalThis.loadedMain !== process.argv[2]) throw new Error("main was not awaited");`;
  // Node exercises Electron 41 init.ts package-path joining and awaited ESM loading, without native launch.
  await runDevelopmentProcess(
    "node",
    ["--input-type=module", "-e", loader, app, "current-source"],
    { cwd, env: developmentEnvironment({ ...process.env }) },
  );
  const manifest = JSON.parse(await readFile(join(app, "package.json"), "utf8"));
  expect(manifest.main).toBe("bootstrap.mjs");
  const bootstrap = await readFile(join(app, "bootstrap.mjs"), "utf8");
  await writeFile(join(build, "main.js"), `globalThis.loadedMain = "next-build";`);
  await runDevelopmentProcess("node", ["--input-type=module", "-e", loader, app, "next-build"], {
    cwd,
    env: developmentEnvironment({ ...process.env }),
  });
  expect(await readFile(join(app, "bootstrap.mjs"), "utf8")).toBe(bootstrap);
  await writeFile(
    join(app, "package.json"),
    JSON.stringify({ ...manifest, main: join(build, "main.js") }),
  );
  await expect(validateDevelopmentEntry(app, build)).rejects.toThrow("entry");
  await writeDevelopmentEntry(app, build);
  await writeFile(join(app, "bootstrap.mjs"), 'await import("file:///unexpected/main.js");');
  await expect(validateDevelopmentEntry(app, build)).rejects.toThrow("entry");
  await rm(join(app, "bootstrap.mjs"));
  await symlink(join(build, "main.js"), join(app, "bootstrap.mjs"));
  await expect(validateDevelopmentEntry(app, build)).rejects.toThrow("symbolic link");
});

test("development configuration has one home-owned path across checkouts", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie-shared-path-")));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "a"));
  await mkdir(join(root, "b"));
  const a = await developmentPaths(join(root, "a"), root);
  const b = await developmentPaths(join(root, "b"), root);
  expect(a.configuration).toBe(
    join(root, "Library/Application Support/Rukie Development/configuration"),
  );
  expect(b.configuration).toBe(a.configuration);
  expect(b.data).not.toBe(a.data);
  await rm(a.configuration, { recursive: true });
  await symlink(a.data, a.configuration);
  await expect(developmentPaths(join(root, "b"), root)).rejects.toThrow("symbolic link");
});

test("redirected configuration parent is rejected before creating anything in its target", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie-shared-parent-")));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "checkout"));
  await mkdir(join(root, "Library"));
  await mkdir(join(root, "Library/Application Support"));
  const target = join(root, "production");
  await mkdir(target);
  await writeFile(join(target, "sentinel"), "unchanged");
  await symlink(target, join(root, "Library/Application Support/Rukie Development"));
  await expect(developmentPaths(join(root, "checkout"), root)).rejects.toThrow("symbolic link");
  expect(await readdir(target)).toEqual(["sentinel"]);
  expect(await readFile(join(target, "sentinel"), "utf8")).toBe("unchanged");
});
