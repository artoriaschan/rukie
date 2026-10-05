import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createSession, listModels, loadSettings } from "../../src/index.ts";
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
  api: "openai-completions" as const,
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

test("project settings override model and reviewModel only", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.homeDir, ".neant/settings.json"),
    JSON.stringify({ model: "a/x", thinking: "low" }),
  );
  await Bun.write(
    join(dirs.cwd, ".neant/settings.json"),
    JSON.stringify({ model: "b/y", thinking: "high", trustedProjects: ["/"] }),
  );

  const { settings } = await loadSettings({ cwd: dirs.cwd, homeDir: dirs.homeDir });

  expect(settings).toEqual({ model: "b/y", thinking: "low" });
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

test("missing model exposes a locale-independent code and settings path", async () => {
  dirs = await tempDirs();
  await expect(createSession(dirs)).rejects.toMatchObject({
    code: "no-model",
    params: { settings: join(dirs.homeDir, ".neant/settings.json") },
    message: expect.stringContaining("No model configured."),
  });
});

test("unknown model exposes the selected model with its code", async () => {
  dirs = await tempDirs();
  await expect(
    createSession({ ...dirs, settings: { model: "missing/model" } }),
  ).rejects.toMatchObject({
    code: "unknown-model",
    params: { model: "missing/model" },
    message: 'Unknown model "missing/model".',
  });
});

test("missing API key exposes the provider and configured environment variable", async () => {
  dirs = await tempDirs();
  const env = "NEANT_I18N_TEST_MISSING_KEY";
  const previous = process.env[env];
  delete process.env[env];
  try {
    await expect(
      createSession({
        ...dirs,
        settings: {
          model: "local/m",
          providers: [{ ...provider("local"), apiKeyEnv: env }],
        },
      }),
    ).rejects.toMatchObject({
      code: "no-api-key",
      params: { provider: "local", env },
      message: 'No API key for provider "local": set NEANT_I18N_TEST_MISSING_KEY.',
    });
  } finally {
    if (previous !== undefined) process.env[env] = previous;
  }
});

test.each(["", "bash(echo", "unknown(pattern)"])(
  "invalid permission rule %j reports its settings file",
  async (rule) => {
    dirs = await tempDirs();
    const file = join(dirs.homeDir, ".neant/settings.json");
    await Bun.write(file, JSON.stringify({ permissions: { deny: [rule] } }));
    await expect(loadSettings(dirs)).rejects.toThrow(
      `${file}: invalid permission rule ${JSON.stringify(rule)}`,
    );
  },
);

test("invalid project permission rule reports its project settings source", async () => {
  dirs = await tempDirs();
  const file = join(dirs.cwd, ".neant/settings.json");
  await Bun.write(file, JSON.stringify({ permissions: { ask: ["mcp__x(pattern)"] } }));
  await expect(loadSettings(dirs)).rejects.toThrow(
    `${file}: invalid permission rule "mcp__x(pattern)"`,
  );
});

test("valid user permission rules survive settings loading", async () => {
  dirs = await tempDirs();
  const permissions = {
    allow: ["mcp__github__*", "bash(git status*)"],
    ask: ["bash(git push*)"],
    deny: ["read(~/.ssh/**)"],
  };
  await Bun.write(join(dirs.homeDir, ".neant/settings.json"), JSON.stringify({ permissions }));
  expect((await loadSettings(dirs)).settings.permissions).toEqual(permissions);
});

test("invalid permission rules carry a typed source and untouched rule", async () => {
  dirs = await tempDirs();
  const source = join(dirs.homeDir, ".neant/settings.json");
  const rule = "  unknown(pattern)  ";
  await Bun.write(source, JSON.stringify({ permissions: { deny: [rule] } }));
  await expect(loadSettings(dirs)).rejects.toMatchObject({
    code: "permission-rule-invalid",
    params: { source, rule },
    message: `${source}: invalid permission rule ${JSON.stringify(rule)}`,
  });
  await expect(
    createSession({ ...dirs, settings: { permissions: { ask: [rule] } } }),
  ).rejects.toMatchObject({
    code: "permission-rule-invalid",
    params: { source: "settings.permissions", rule },
  });
});

test.each([false, true])(
  "project restrictions append while allow requires trust: %s",
  async (trusted) => {
    dirs = await tempDirs();
    await Bun.write(
      join(dirs.homeDir, ".neant/settings.json"),
      JSON.stringify({
        trustedProjects: trusted ? [dirs.cwd] : [],
        permissions: {
          allow: ["bash(git status*)"],
          ask: ["bash(git push*)"],
          deny: ["read(~/.ssh/**)"],
        },
      }),
    );
    const projectFile = join(dirs.cwd, ".neant/settings.json");
    await Bun.write(
      projectFile,
      JSON.stringify({
        trustedProjects: [dirs.cwd],
        permissions: { allow: ["write"], ask: ["edit"], deny: ["bash(rm *)"] },
      }),
    );
    const { settings, warnings } = await loadSettings(dirs);
    expect(settings.permissions).toEqual({
      allow: trusted ? ["bash(git status*)", "write"] : ["bash(git status*)"],
      ask: ["bash(git push*)", "edit"],
      deny: ["read(~/.ssh/**)", "bash(rm *)"],
    });
    expect(warnings).toEqual(
      trusted ? [] : [expect.stringContaining(`${projectFile}: ignoring "permissions.allow"`)],
    );
  },
);

test("trust in a parent directory does not activate a child project's allow rules", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.homeDir, ".neant/settings.json"),
    JSON.stringify({ trustedProjects: [join(dirs.cwd, "..")] }),
  );
  await Bun.write(
    join(dirs.cwd, ".neant/settings.json"),
    JSON.stringify({ permissions: { allow: ["bash"] } }),
  );
  const { settings, warnings } = await loadSettings(dirs);
  expect(settings.permissions?.allow ?? []).toEqual([]);
  expect(warnings).toHaveLength(1);
});

test.each(["user", "project"])(
  "legacy allowTools in the %s layer fails with a typed migration error",
  async (layer) => {
    dirs = await tempDirs();
    const source = join(layer === "user" ? dirs.homeDir : dirs.cwd, ".neant/settings.json");
    await Bun.write(source, JSON.stringify({ allowTools: null }));
    await expect(loadSettings(dirs)).rejects.toMatchObject({
      code: "allow-tools-retired",
      params: { source },
      message: `${source}: "allowTools" has been removed; migrate to "permissions.allow".`,
    });
  },
);

test("project subagentModel overrides the user value", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.homeDir, ".neant/settings.json"),
    JSON.stringify({ subagentModel: "user/worker" }),
  );
  await Bun.write(
    join(dirs.cwd, ".neant/settings.json"),
    JSON.stringify({ subagentModel: "project/worker" }),
  );
  expect(await loadSettings(dirs)).toEqual({
    settings: { subagentModel: "project/worker" },
    warnings: [],
  });
});

test.each(["user", "project"])(
  "invalid %s subagentModel names its source and field",
  async (layer) => {
    dirs = await tempDirs();
    const source = join(layer === "user" ? dirs.homeDir : dirs.cwd, ".neant/settings.json");
    await Bun.write(source, JSON.stringify({ subagentModel: 42 }));
    await expect(loadSettings(dirs)).rejects.toThrow(`${source}: /subagentModel`);
  },
);

test("a custom model input without text reports its settings field", async () => {
  dirs = await tempDirs();
  const file = join(dirs.homeDir, ".neant/settings.json");
  await Bun.write(
    file,
    JSON.stringify({
      providers: [{ ...provider("vision"), models: [{ id: "m", input: ["image"] }] }],
    }),
  );
  await expect(loadSettings(dirs)).rejects.toThrow(`${file}: /providers/0/models/0/input`);
});

test.each([[], ["audio"], ["text", "video"], "text", null].map((input) => [input]))(
  "invalid custom model input %j names its settings field",
  async (input) => {
    dirs = await tempDirs();
    const file = join(dirs.homeDir, ".neant/settings.json");
    await Bun.write(
      file,
      JSON.stringify({
        providers: [{ ...provider("vision"), models: [{ id: "m", input }] }],
      }),
    );
    await expect(loadSettings(dirs)).rejects.toThrow(`${file}: /providers/0/models/0/input`);
  },
);

test.each(
  ([["text"], ["text", "image"], ["image", "text"]] satisfies ("text" | "image")[][]).map(
    (input) => [input],
  ),
)("custom model input %j is retained and exposed to frontends", async (input) => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.homeDir, ".neant/settings.json"),
    JSON.stringify({
      providers: [{ ...provider("vision"), models: [{ id: "m", input }] }],
    }),
  );
  const { settings } = await loadSettings(dirs);
  expect(settings.providers?.[0]?.models[0]).toEqual({ id: "m", input });
  expect(listModels(settings)).toContainEqual({ spec: "vision/m", name: "m", input });
});

test("custom models without input default to text while built-in vision models keep their modalities", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.homeDir, ".neant/settings.json"),
    JSON.stringify({
      providers: [provider("legacy")],
    }),
  );
  const { settings } = await loadSettings(dirs);
  const choices = listModels(settings);
  expect(choices).toContainEqual({ spec: "legacy/m", name: "m", input: ["text"] });
  expect(choices).toContainEqual({
    spec: "anthropic/claude-sonnet-4-5-20250929",
    name: "Claude Sonnet 4.5",
    input: ["text", "image"],
  });
});
