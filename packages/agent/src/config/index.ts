import { join } from "node:path";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { createProvider, envApiKeyAuth, type Api, type Model } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { SettingsSchema, type Settings } from "@neant/shared";
import { Value } from "typebox/value";

/** Parses one settings file; a missing file is `{}`. */
async function readJson(path: string): Promise<Record<string, unknown>> {
  const file = Bun.file(path);
  if (!(await file.exists())) return {};
  let data: unknown;
  try {
    data = JSON.parse(await file.text());
  } catch (error) {
    throw new Error(`${path}: invalid JSON: ${(error as Error).message}`);
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new Error(`${path}: / must be object`);
  }
  return data as Record<string, unknown>;
}

function validate(path: string, data: unknown): Settings {
  const [first] = Value.Errors(SettingsSchema, data);
  if (first) throw new Error(`${path}: ${first.instancePath || "/"} ${first.message}`);
  return data as Settings;
}

/**
 * Loads `~/.neant/settings.json` merged with `<cwd>/.neant/settings.json`.
 * The project file may only override `model` and `allowTools`: it must not be able to
 * send requests or keys elsewhere, so its `providers` are dropped (unvalidated) with a warning.
 */
export async function loadSettings(options: { cwd: string; homeDir: string }) {
  const userFile = join(options.homeDir, ".neant/settings.json");
  const projectFile = join(options.cwd, ".neant/settings.json");
  const [userData, { providers, ...projectData }] = await Promise.all([
    readJson(userFile),
    readJson(projectFile),
  ]);
  const user = validate(userFile, userData);
  const project = validate(projectFile, projectData);
  const warnings: string[] = [];
  if (providers !== undefined) {
    warnings.push(`${projectFile}: ignoring "providers"; only user settings can define providers.`);
  }
  const settings: Settings = { ...user };
  if (project.model !== undefined) settings.model = project.model;
  if (project.allowTools !== undefined) settings.allowTools = project.allowTools;
  return { settings, warnings };
}

const customApis = {
  "openai-completions": openAICompletionsApi,
  "openai-responses": openAIResponsesApi,
  "anthropic-messages": anthropicMessagesApi,
};

/** Resolves `settings.model` against pi-ai's built-in providers plus the user's custom ones. */
export async function resolveModel(
  settings: Settings,
): Promise<{ model: Model<Api>; streamFn: StreamFn }> {
  if (!settings.model) {
    throw new Error(
      'No model configured. Set "model" in ~/.neant/settings.json or pass --model provider/id.',
    );
  }
  const models = builtinModels();
  for (const p of settings.providers ?? []) {
    models.setProvider(
      createProvider({
        id: p.id,
        baseUrl: p.baseUrl,
        auth: { apiKey: envApiKeyAuth(`${p.id} API key`, [p.apiKeyEnv]) },
        api: customApis[p.api](),
        models: p.models.map((m) => ({
          id: m.id,
          name: m.id,
          api: p.api,
          provider: p.id,
          baseUrl: p.baseUrl,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          reasoning: m.reasoning ?? false,
          // ponytail: generic defaults; per-model limits come from settings when they matter
          contextWindow: m.contextWindow ?? 128_000,
          maxTokens: m.maxTokens ?? 16_384,
        })),
      }),
    );
  }
  const slash = settings.model.indexOf("/");
  const providerId = settings.model.slice(0, slash);
  const model =
    slash > 0 ? models.getModel(providerId, settings.model.slice(slash + 1)) : undefined;
  if (!model) throw new Error(`Unknown model "${settings.model}".`);
  if (!(await models.checkAuth(providerId))) {
    const env = settings.providers?.find((p) => p.id === providerId)?.apiKeyEnv;
    throw new Error(`No API key for provider "${providerId}"${env ? `: set ${env}` : ""}.`);
  }
  return { model, streamFn: (m, context, options) => models.streamSimple(m, context, options) };
}
