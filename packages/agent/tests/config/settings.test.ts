import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createSession, loadSettings } from "../../src/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

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

test("project settings override model and allowTools only", async () => {
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
