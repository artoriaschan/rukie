import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { loadSettings, resolveModel } from "../../src/config/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const key = "RUKIE_CONFIG_COMPAT_TEST_KEY";
const previousKey = process.env[key];
afterEach(async () => {
  if (previousKey === undefined) delete process.env[key];
  else process.env[key] = previousKey;
  await dirs?.cleanup();
});

async function writeSettings(api: string, compat?: unknown) {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.homeDir, ".rukie/settings.json"),
    JSON.stringify({
      model: "custom/m",
      providers: [
        {
          id: "custom",
          api,
          baseUrl: "http://localhost:1",
          apiKeyEnv: key,
          models: [{ id: "m", ...(compat === undefined ? {} : { compat }) }],
        },
      ],
    }),
  );
}

test.each([
  {
    api: "openai-completions",
    compat: {
      supportsStore: false,
      maxTokensField: "max_tokens",
      chatTemplateKwargs: { enable_thinking: { $var: "thinking.enabled", omitWhenOff: true } },
      openRouterRouting: {
        only: ["local"],
        max_price: { prompt: "1" },
        preferred_max_latency: { p99: 2 },
      },
    },
  },
  { api: "openai-responses", compat: { supportsToolSearch: true, supportsMaxOutputTokens: false } },
  {
    api: "anthropic-messages",
    compat: {
      supportsMidConvoSystemMessages: true,
      supportsMidConvoToolChanges: true,
      supportsTemperature: false,
      allowedFallbackModels: [
        {
          provider: "custom",
          model: "backup",
          cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    },
  },
])("custom $api compatibility overrides reach the resolved model", async ({ api, compat }) => {
  await writeSettings(api, compat);
  process.env[key] = "test-key";
  const { settings } = await loadSettings(dirs);
  expect(settings.providers?.[0]?.models[0]?.compat).toEqual(compat);
  const { model } = await resolveModel(settings, dirs.homeDir);
  expect(model.compat).toEqual(compat);
});

test("omitted compat leaves adapter defaults intact", async () => {
  await writeSettings("openai-completions");
  process.env[key] = "test-key";
  const { settings } = await loadSettings(dirs);
  const { model } = await resolveModel(settings, dirs.homeDir);
  expect(model.compat).toBeUndefined();
});

test.each([
  { api: "openai-completions", compat: { supportsToolSearch: true } },
  { api: "openai-responses", compat: { supportsMidConvoToolChanges: true } },
  { api: "anthropic-messages", compat: { supportsStore: false } },
  { api: "openai-responses", compat: { supportsToolSearch: "true" } },
  { api: "openai-completions", compat: { maxTokensField: "tokens" } },
  { api: "anthropic-messages", compat: { typo: true } },
  { api: "openai-completions", compat: { openRouterRouting: { only: "local" } } },
  { api: "anthropic-messages", compat: null },
])("invalid $api compat reports its settings location: $compat", async ({ api, compat }) => {
  await writeSettings(api, compat);
  await expect(loadSettings(dirs)).rejects.toThrow(
    `${join(dirs.homeDir, ".rukie/settings.json")}: /providers/0/models/0/compat`,
  );
});

test("project settings cannot override user model compat", async () => {
  await writeSettings("openai-responses", { supportsToolSearch: false });
  await Bun.write(
    join(dirs.cwd, ".rukie/settings.json"),
    JSON.stringify({ providers: [{ models: [{ compat: { supportsToolSearch: true } }] }] }),
  );
  const { settings, warnings } = await loadSettings(dirs);
  expect(settings.providers?.[0]?.models[0]?.compat).toEqual({ supportsToolSearch: false });
  expect(warnings).toContain(
    `${join(dirs.cwd, ".rukie/settings.json")}: ignoring "providers"; only user settings can define providers.`,
  );
});
