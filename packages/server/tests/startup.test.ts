import { expect, test } from "bun:test";
import { readSidecarStartup } from "../src/startup.ts";

test("sidecar requires an explicit encryption backend and complete parameters", () => {
  for (const extra of [
    {},
    { RUKIE_DESKTOP_ENCRYPTION_BACKEND: "invalid" },
    { RUKIE_DESKTOP_ENCRYPTION_BACKEND: "electron" },
    {
      RUKIE_DESKTOP_ENCRYPTION_BACKEND: "electron",
      RUKIE_DESKTOP_SECRET_URL: "http://127.0.0.1:1/secret",
    },
    { RUKIE_DESKTOP_ENCRYPTION_BACKEND: "system-keychain" },
    {
      RUKIE_DESKTOP_ENCRYPTION_BACKEND: "system-keychain",
      RUKIE_DESKTOP_SECRET_SERVICE: "private-service",
      RUKIE_DESKTOP_CONFIGURATION_ROOT: "relative/configuration",
    },
  ]) {
    expect(() => readSidecarStartup({ RUKIE_DESKTOP_DATA_ROOT: "/tmp/data", ...extra })).toThrow();
  }
});

test("startup captures private capabilities and strips them from the inherited tool environment", async () => {
  const env: NodeJS.ProcessEnv = {
    PATH: "/usr/bin",
    RUKIE_DESKTOP_DATA_ROOT: "/tmp/data",
    RUKIE_DESKTOP_CONFIGURATION_ROOT: "/tmp/config",
    RUKIE_DESKTOP_HOME_DIR: "/tmp/home",
    RUKIE_DESKTOP_ENCRYPTION_BACKEND: "memory",
    RUKIE_DESKTOP_SECRET_SERVICE: "private-service",
    RUKIE_DESKTOP_SECRET_URL: "http://127.0.0.1:1/secret",
    RUKIE_DESKTOP_SECRET_TOKEN: "private-token",
    RUKIE_DESKTOP_MANAGEMENT_TOKEN: "private-management-token",
  };
  const startup = readSidecarStartup(env);
  expect(startup).toMatchObject({
    dataRoot: "/tmp/data",
    configurationRoot: "/tmp/config",
    homeDir: "/tmp/home",
    encryptionBackend: "memory",
    managementToken: "private-management-token",
  });
  expect(env).toEqual({ PATH: "/usr/bin" });
  const tool = Bun.spawnSync(
    [
      process.execPath,
      "-e",
      'console.log(JSON.stringify(Object.keys(process.env).filter(name => name.startsWith("RUKIE_DESKTOP_"))))',
    ],
    { env },
  );
  expect(tool.exitCode).toBe(0);
  expect(JSON.parse(tool.stdout.toString())).toEqual([]);
  expect(
    await startup.encryption.decrypt(
      "provider:test",
      await startup.encryption.encrypt("provider:test", "secret"),
    ),
  ).toBe("secret");
});

test("sidecar process rejects a missing backend before emitting its handshake", async () => {
  // Real entry-process startup cannot be verified with a parent-process virtual clock.
  const child = Bun.spawn([process.execPath, new URL("../src/main.ts", import.meta.url).pathname], {
    env: {
      ...process.env,
      RUKIE_DESKTOP_DATA_ROOT: "/tmp/unused-rukie-startup",
      RUKIE_DESKTOP_ENCRYPTION_BACKEND: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, output, diagnostic] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code).not.toBe(0);
  expect(output).toBe("");
  expect(diagnostic).toContain("requires an explicit encryption backend");
});

test("system-keychain startup resolves the same configuration root as application storage", () => {
  for (const configurationRoot of [undefined, "/tmp/configuration"]) {
    const startup = readSidecarStartup({
      RUKIE_DESKTOP_DATA_ROOT: "/tmp/unused-rukie-data",
      RUKIE_DESKTOP_CONFIGURATION_ROOT: configurationRoot,
      RUKIE_DESKTOP_SECRET_SERVICE: "private-service",
      RUKIE_DESKTOP_ENCRYPTION_BACKEND: "system-keychain",
    });
    expect(startup.configurationRoot).toBe(configurationRoot);
    expect(startup.encryptionBackend).toBe("system-keychain");
  }
});
