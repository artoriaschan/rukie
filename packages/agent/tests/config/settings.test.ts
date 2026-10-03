import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createSession, loadSettings } from "../../src/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test("user permission mode is retained while the project can override the review model", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.homeDir, ".neant/settings.json"),
    JSON.stringify({ permissionMode: "auto-review", reviewModel: "user/reviewer" }),
  );
  const projectFile = join(dirs.cwd, ".neant/settings.json");
  await Bun.write(
    projectFile,
    JSON.stringify({ permissionMode: "full-access", reviewModel: "project/reviewer" }),
  );
  const { settings, warnings } = await loadSettings(dirs);
  expect(settings).toEqual({ permissionMode: "auto-review", reviewModel: "project/reviewer" });
  expect(warnings).toEqual([
    `${projectFile}: ignoring "permissionMode"; only user settings can define permissionMode.`,
  ]);
});

const provider = (id: string) => ({
  id,
  api: "openai-completions",
  baseUrl: "http://127.0.0.1:1/v1",
  apiKeyEnv: "NEANT_TEST_KEY",
  models: [{ id: "m" }],
});

test("project settings cannot define providers", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.homeDir, ".neant/settings.json"),
    JSON.stringify({ model: "mine/m", providers: [provider("mine")] }),
  );
  const projectFile = join(dirs.cwd, ".neant/settings.json");
  await Bun.write(projectFile, JSON.stringify({ model: "evil/m", providers: [provider("evil")] }));

  const { settings, warnings } = await loadSettings({ cwd: dirs.cwd, homeDir: dirs.homeDir });

  expect(warnings).toEqual([expect.stringContaining(projectFile)]);
  expect(warnings[0]).toContain("providers");
  expect(settings.providers?.map((p) => p.id)).toEqual(["mine"]);
  // The project may still pick the model, but only among user-defined providers.
  await expect(createSession({ cwd: dirs.cwd, homeDir: dirs.homeDir, settings })).rejects.toThrow(
    'Unknown model "evil/m"',
  );
});

test("malformed project providers are ignored, not fatal", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.homeDir, ".neant/settings.json"), JSON.stringify({ model: "a/x" }));
  await Bun.write(join(dirs.cwd, ".neant/settings.json"), JSON.stringify({ providers: "evil" }));

  const { settings, warnings } = await loadSettings({ cwd: dirs.cwd, homeDir: dirs.homeDir });

  expect(settings).toEqual({ model: "a/x" });
  expect(warnings).toHaveLength(1);
});

test("project settings override model, reviewModel and allowTools only", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.homeDir, ".neant/settings.json"),
    JSON.stringify({ model: "a/x", thinking: "low", allowTools: ["bash"] }),
  );
  await Bun.write(
    join(dirs.cwd, ".neant/settings.json"),
    JSON.stringify({ model: "b/y", thinking: "high", allowTools: [], trustedProjects: ["/"] }),
  );

  const { settings } = await loadSettings({ cwd: dirs.cwd, homeDir: dirs.homeDir });

  expect(settings).toEqual({ model: "b/y", thinking: "low", allowTools: [] });
});

test.each(["ask", "auto-review", "full-access"])("user settings accept mode %s", async (mode) => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.homeDir, ".neant/settings.json"),
    JSON.stringify({ permissionMode: mode, reviewModel: "user/reviewer" }),
  );
  expect(await loadSettings(dirs)).toEqual({
    settings: { permissionMode: mode, reviewModel: "user/reviewer" },
    warnings: [],
  });
});

test("malformed project permission mode is ignored without granting permissions", async () => {
  dirs = await tempDirs();
  const projectFile = join(dirs.cwd, ".neant/settings.json");
  await Bun.write(projectFile, JSON.stringify({ permissionMode: { mode: "full-access" } }));
  const { settings, warnings } = await loadSettings(dirs);
  expect(settings).toEqual({});
  expect(warnings).toEqual([
    `${projectFile}: ignoring "permissionMode"; only user settings can define permissionMode.`,
  ]);
});

test.each([
  ["permissionMode", "invalid"],
  ["permissionMode", true],
  ["reviewModel", 42],
  ["locale", 42],
])("invalid user setting %s=%s names the file and field", async (field, value) => {
  dirs = await tempDirs();
  const userFile = join(dirs.homeDir, ".neant/settings.json");
  await Bun.write(userFile, JSON.stringify({ [field!]: value }));
  await expect(loadSettings(dirs)).rejects.toThrow(`${userFile}: /${field}`);
});

test("invalid settings name the file and the field", async () => {
  dirs = await tempDirs();
  const file = join(dirs.homeDir, ".neant/settings.json");
  await Bun.write(file, JSON.stringify({ providers: [{ ...provider("p"), api: "grpc" }] }));

  await expect(loadSettings({ cwd: dirs.cwd, homeDir: dirs.homeDir })).rejects.toThrow(
    `${file}: /providers/0/api`,
  );
});

test("missing settings files mean empty settings", async () => {
  dirs = await tempDirs();
  expect(await loadSettings({ cwd: dirs.cwd, homeDir: dirs.homeDir })).toEqual({
    settings: {},
    warnings: [],
  });
});

test.each(["zh-CN", "fr", ""])(
  "user locale %j is preserved without enum validation",
  async (locale) => {
    dirs = await tempDirs();
    await Bun.write(join(dirs.homeDir, ".neant/settings.json"), JSON.stringify({ locale }));
    expect(await loadSettings(dirs)).toEqual({ settings: { locale }, warnings: [] });
  },
);

test.each(["en", { invalid: true }, null])(
  "project locale %j is ignored with a warning",
  async (locale) => {
    dirs = await tempDirs();
    await Bun.write(join(dirs.homeDir, ".neant/settings.json"), JSON.stringify({ locale: "zh" }));
    const projectFile = join(dirs.cwd, ".neant/settings.json");
    await Bun.write(projectFile, JSON.stringify({ locale }));
    expect(await loadSettings(dirs)).toEqual({
      settings: { locale: "zh" },
      warnings: [`${projectFile}: ignoring "locale"; only user settings can define locale.`],
    });
  },
);
