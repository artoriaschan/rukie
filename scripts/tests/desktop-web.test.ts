import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { expect, test, onTestFinished } from "bun:test";
import { mkdtemp, realpath, rm, readFile, writeFile, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { webDevelopmentPaths, launchWebDevelopment } from "../desktop/web.ts";

test("web launcher separates persistent data and shared cross-platform configuration", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie-web-")));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const paths = await webDevelopmentPaths(root, {
    home: root,
    platform: "darwin",
    environment: {},
  });
  expect(paths.data).toBe(join(root, ".desktop-dev/web/data"));
  expect(paths.configuration).toBe(
    join(root, "Library/Application Support/Rukie Web Development/configuration"),
  );
  expect(
    (await webDevelopmentPaths(root, { home: root, platform: "linux", environment: {} }))
      .configuration,
  ).toBe(join(root, ".local/share/Rukie Web Development/configuration"));
  expect(
    (
      await webDevelopmentPaths(root, {
        home: root,
        platform: "win32",
        environment: { APPDATA: root },
      })
    ).configuration,
  ).toBe(join(root, "Rukie Web Development/configuration"));
});

const sidecarSource = `if (process.env.RUKIE_DESKTOP_ENCRYPTION_BACKEND !== "system-keychain" || process.env.RUKIE_DESKTOP_SECRET_SERVICE !== "Rukie Web Development" || !process.env.RUKIE_DESKTOP_DATA_ROOT || !process.env.RUKIE_DESKTOP_CONFIGURATION_ROOT) process.exit(71); const fs = require("node:fs"); process.on("SIGTERM", () => { fs.appendFileSync("events", "sidecar stopped\\n"); process.exit(0); }); console.log(JSON.stringify({port: 43210, token: "test-token"})); setInterval(() => {}, 100000);`;
const viteSource = `const fs = require("node:fs"); process.on("SIGTERM", () => { fs.appendFileSync("events", "vite stopped\\n"); process.exit(0); }); console.log("Local: http://localhost:5173/"); setInterval(() => {}, 100000);`;

test("web launcher waits for both services, emits fragment URL, and stops Vite before sidecar", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie-web-process-")));
  const controller = new AbortController();
  let running: Promise<void> | undefined;
  onTestFinished(async () => {
    controller.abort();
    await running;
    await rm(root, { recursive: true, force: true });
  });
  const paths = await webDevelopmentPaths(root, { home: root });
  const ready = Promise.withResolvers<string>();
  running = launchWebDevelopment({
    paths,
    environment: {},
    signal: controller.signal,
    sidecarCommand: [process.execPath, "-e", sidecarSource],
    viteCommand: [process.execPath, "-e", viteSource],
    stdout: (line) => {
      if (line.startsWith("http://")) ready.resolve(line);
    },
    stderr: () => {},
  });
  expect(await ready.promise).toBe("http://localhost:5173/#port=43210&token=test-token\n");
  controller.abort();
  await running;
  expect(await readFile(join(root, "events"), "utf8")).toBe("vite stopped\nsidecar stopped\n");
  await expect(readFile(join(paths.local, "launcher.lock"))).rejects.toThrow("ENOENT");
});

test("web data and configuration refuse redirected directories and database trees", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie-web-links-")));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const outside = join(root, "outside");
  await mkdir(outside);
  await mkdir(join(root, ".desktop-dev"));
  await symlink(outside, join(root, ".desktop-dev/web"));
  await expect(webDevelopmentPaths(root, { home: root })).rejects.toThrow("symbolic link");
  await rm(join(root, ".desktop-dev/web"));
  const paths = await webDevelopmentPaths(root, { home: root });
  await symlink(outside, join(paths.configuration, "db"));
  await expect(webDevelopmentPaths(root, { home: root })).rejects.toThrow("persistent data");
  await rm(join(paths.configuration, "db"));
  await rm(paths.configuration, { recursive: true });
  await symlink(outside, paths.configuration);
  await expect(webDevelopmentPaths(root, { home: root })).rejects.toThrow("symbolic link");
});

test("a running web launcher refuses another instance and inherited startup overrides", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie-web-lock-")));
  const paths = await webDevelopmentPaths(root, { home: root });
  const controller = new AbortController();
  let running: Promise<void> | undefined;
  onTestFinished(async () => {
    controller.abort();
    await running;
    await rm(root, { recursive: true, force: true });
  });
  const ready = Promise.withResolvers<void>();
  const options = {
    paths,
    environment: {},
    signal: controller.signal,
    sidecarCommand: [process.execPath, "-e", sidecarSource] as const,
    viteCommand: [process.execPath, "-e", viteSource] as const,
    stdout: (line: string) => {
      if (line.startsWith("http://")) ready.resolve();
    },
    stderr: () => {},
  };
  running = launchWebDevelopment(options);
  await ready.promise;
  await expect(launchWebDevelopment(options)).rejects.toThrow("already active");
  for (const name of [
    "RUKIE_DESKTOP_DATA_ROOT",
    "NODE_OPTIONS",
    "BUN_OPTIONS",
    "DYLD_LIBRARY_PATH",
    "ELECTRON_RUN_AS_NODE",
    "BUN_BE_BUN",
  ]) {
    await expect(
      launchWebDevelopment({ ...options, environment: { [name]: "bad" } }),
    ).rejects.toThrow("override");
  }
});

test("reset deletes only web data and preserves shared credentials and Electron data", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie-web-reset-")));
  const paths = await webDevelopmentPaths(root, { home: root });
  await writeFile(join(paths.data, "old-session"), "session");
  await writeFile(join(paths.configuration, "app.sqlite"), "encrypted configuration");
  await mkdir(join(root, ".desktop-dev/data"));
  await writeFile(join(root, ".desktop-dev/data/keep"), "electron");
  const controller = new AbortController();
  let running: Promise<void> | undefined;
  onTestFinished(async () => {
    controller.abort();
    await running;
    await rm(root, { recursive: true, force: true });
  });
  const ready = Promise.withResolvers<void>();
  running = launchWebDevelopment({
    paths,
    environment: {},
    reset: true,
    signal: controller.signal,
    sidecarCommand: [process.execPath, "-e", sidecarSource],
    viteCommand: [process.execPath, "-e", viteSource],
    stdout: (line) => {
      if (line.startsWith("http://")) ready.resolve();
    },
    stderr: () => {},
  });
  await ready.promise;
  await expect(readFile(join(paths.data, "old-session"))).rejects.toThrow("ENOENT");
  expect(await readFile(join(paths.configuration, "app.sqlite"), "utf8")).toBe(
    "encrypted configuration",
  );
  expect(await readFile(join(root, ".desktop-dev/data/keep"), "utf8")).toBe("electron");
});

test("SIGINT waits for both real child exits and releases the web lock", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie-web-signal-")));
  const moduleUrl = pathToFileURL(join(import.meta.dir, "../desktop/web.ts")).href;
  const source = `import { webDevelopmentPaths, runWebDevelopment } from ${JSON.stringify(moduleUrl)};
    await runWebDevelopment({ paths: await webDevelopmentPaths(${JSON.stringify(root)}, {home: ${JSON.stringify(root)}}), environment: {}, sidecarCommand: [process.execPath, "-e", ${JSON.stringify(sidecarSource)}], viteCommand: [process.execPath, "-e", ${JSON.stringify(viteSource)}] });`;
  const child = spawn(process.execPath, ["-e", source], { stdio: ["ignore", "pipe", "pipe"] });
  const closed = new Promise<number | null>((resolve) => child.once("close", resolve));
  const ready = Promise.withResolvers<void>();
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  child.once("close", () => ready.reject(new Error(stderr || "Launcher exited before ready")));
  createInterface({ input: child.stdout }).on("line", (line) => {
    if (line.startsWith("http://")) ready.resolve();
  });
  onTestFinished(async () => {
    child.kill("SIGTERM");
    await closed;
    await rm(root, { recursive: true, force: true });
  });
  await ready.promise;
  child.kill("SIGINT");
  expect(await closed).toBe(0);
  expect(await readFile(join(root, "events"), "utf8")).toBe("vite stopped\nsidecar stopped\n");
  await expect(readFile(join(root, ".desktop-dev/web/launcher.lock"))).rejects.toThrow("ENOENT");
});

test("handshake timeout preserves stderr diagnostics, stops sidecar and frees the lock", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie-web-timeout-")));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const paths = await webDevelopmentPaths(root, { home: root });
  let stderr = "";
  // A real subprocess emits stderr and withholds the handshake; the real deadline bounds that transport contract.
  await expect(
    launchWebDevelopment({
      paths,
      environment: {},
      handshakeTimeoutMs: 250,
      sidecarCommand: [
        process.execPath,
        "-e",
        `process.on("SIGTERM", () => process.exit(0)); console.error("fixture startup stalled"); setInterval(() => {}, 100000);`,
      ],
      stderr: (text) => {
        stderr += text;
      },
      stdout: () => {},
    }),
  ).rejects.toThrow("Sidecar handshake timed out");
  expect(stderr).toContain("fixture startup stalled");
  await expect(readFile(join(paths.local, "launcher.lock"))).rejects.toThrow("ENOENT");
});

test("invalid sidecar handshake does not start Vite or print a credential URL", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie-web-invalid-")));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const paths = await webDevelopmentPaths(root, { home: root });
  let output = "";
  await expect(
    launchWebDevelopment({
      paths,
      environment: {},
      sidecarCommand: [
        process.execPath,
        "-e",
        `console.log(JSON.stringify({port: 0, token: "secret"})); setInterval(() => {}, 100000);`,
      ],
      viteCommand: [
        process.execPath,
        "-e",
        `require("node:fs").writeFileSync("vite-started", "bad");`,
      ],
      stdout: (text) => {
        output += text;
      },
      stderr: () => {},
    }),
  ).rejects.toThrow("Invalid sidecar handshake");
  expect(output).not.toContain("secret");
  await expect(readFile(join(root, "vite-started"))).rejects.toThrow("ENOENT");
});

test("Vite port/startup failure stops sidecar and reports nonzero failure", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie-web-vite-fail-")));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const paths = await webDevelopmentPaths(root, { home: root });
  await expect(
    launchWebDevelopment({
      paths,
      environment: {},
      sidecarCommand: [process.execPath, "-e", sidecarSource],
      viteCommand: [process.execPath, "-e", "process.exit(37)"],
      stdout: () => {},
      stderr: () => {},
    }),
  ).rejects.toThrow("37");
  expect(await readFile(join(root, "events"), "utf8")).toBe("sidecar stopped\n");
  await expect(readFile(join(paths.local, "launcher.lock"))).rejects.toThrow("ENOENT");
});

test("sidecar crash after readiness stops Vite and --open dispatches only the fragment URL", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie-web-crash-")));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const paths = await webDevelopmentPaths(root, { home: root });
  let sidecarPid = 0;
  const running = launchWebDevelopment({
    paths,
    environment: {},
    open: true,
    sidecarCommand: [
      process.execPath,
      "-e",
      `require("node:fs").writeFileSync("sidecar-pid", String(process.pid)); ${sidecarSource}`,
    ],
    viteCommand: [process.execPath, "-e", viteSource],
    stdout: () => {},
    stderr: () => {},
    openCommand: (url) => [
      process.execPath,
      "-e",
      `const fs = require("node:fs"); fs.writeFileSync("opened", ${JSON.stringify(url)}); process.kill(Number(fs.readFileSync("sidecar-pid", "utf8")), "SIGKILL");`,
    ],
  });
  await expect(running).rejects.toThrow("exited unexpectedly");
  sidecarPid = Number(await readFile(join(root, "sidecar-pid"), "utf8"));
  expect(() => process.kill(sidecarPid, 0)).toThrow();
  expect(await readFile(join(root, "opened"), "utf8")).toBe(
    "http://localhost:5173/#port=43210&token=test-token",
  );
  expect(await readFile(join(root, "events"), "utf8")).toBe("vite stopped\n");
});

test("Vite crash after readiness stops the surviving sidecar", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "rukie-web-vite-crash-")));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const paths = await webDevelopmentPaths(root, { home: root });
  const ready = Promise.withResolvers<void>();
  const running = launchWebDevelopment({
    paths,
    environment: {},
    sidecarCommand: [process.execPath, "-e", sidecarSource],
    viteCommand: [
      process.execPath,
      "-e",
      `require("node:fs").writeFileSync("vite-pid", String(process.pid)); ${viteSource}`,
    ],
    stdout: (line) => {
      if (line.startsWith("http://")) ready.resolve();
    },
    stderr: () => {},
  });
  // Observe service output before terminating it; no elapsed-time readiness guess.
  await ready.promise;
  process.kill(Number(await readFile(join(root, "vite-pid"), "utf8")), "SIGKILL");
  await expect(running).rejects.toThrow("exited unexpectedly");
  expect(await readFile(join(root, "events"), "utf8")).toBe("sidecar stopped\n");
});
