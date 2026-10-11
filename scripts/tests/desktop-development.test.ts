import { expect, test, onTestFinished } from "bun:test";
import { mkdtemp, mkdir, rm, symlink, realpath, writeFile, readlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { watch } from "node:fs";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import {
  copyDevelopmentRuntime,
  developmentPaths,
  developmentEnvironment,
  runDevelopmentProcess,
  acquireDevelopmentLock,
} from "../desktop/development.ts";

test("desktop development paths stay inside the checkout and reject inherited production overrides", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie-dev-")));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const paths = await developmentPaths(root);
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
  await expect(developmentPaths(root)).rejects.toThrow("symbolic link");
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
  const paths = await developmentPaths(root);
  const outside = join(root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "sentinel"), "production untouched");
  for (const name of ["main.js", "preload.cjs", "rukie-server", "rg"]) {
    const artifact = join(paths.build, name);
    await symlink(join(outside, "sentinel"), artifact);
    await expect(developmentPaths(root)).rejects.toThrow("symbolic link");
    await rm(artifact);
  }
  for (const artifact of [
    paths.renderer,
    join(paths.cache, "Rukie Development.app"),
    join(paths.cache, "electron-41.0.3.json"),
  ]) {
    await symlink(outside, artifact);
    await expect(developmentPaths(root)).rejects.toThrow("symbolic link");
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
  const paths = await developmentPaths(root);
  const outside = join(root, "formal");
  await mkdir(outside);
  await writeFile(join(outside, "app.sqlite"), "formal database untouched");
  await symlink(join(outside, "app.sqlite"), join(paths.data, "app.sqlite"));
  await expect(developmentPaths(root)).rejects.toThrow("persistent data");
  await rm(join(paths.data, "app.sqlite"));
  await mkdir(join(paths.data, "sessions"));
  await symlink(outside, join(paths.data, "sessions/nested"));
  await expect(developmentPaths(root)).rejects.toThrow("persistent data");
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
  const paths = await developmentPaths(root);
  const outside = join(root, "formal");
  await mkdir(outside);
  for (const directory of [paths.userData, paths.sessionData]) {
    await symlink(outside, join(directory, "Cache"));
    await expect(developmentPaths(root)).rejects.toThrow("persistent data");
    await rm(join(directory, "Cache"));
    for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"])
      await symlink(
        name === "SingletonLock" ? "hostname-2147483647" : "/unresolved/native-ipc",
        join(directory, name),
      );
  }
  expect((await developmentPaths(root)).sessionData).toBe(paths.sessionData);
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
