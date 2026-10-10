import { join, resolve } from "node:path";
import {
  createProvider,
  envApiKeyAuth,
  type Api,
  type Model,
  type Models,
} from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAIResponsesApi } from "@earendil-works/pi-ai/api/openai-responses.lazy";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import {
  createUserVisibleError,
  SettingsSchema,
  ModelCompatSchemas,
  type Settings,
  type CustomSessionEvent,
} from "@rukie/shared";
import { parsePermissionRules } from "../permissions/index.ts";
import { mergeHooks, validateHooks } from "../hooks/index.ts";
import { Value } from "typebox/value";
import { withToolCapabilityDetection } from "./tool-capabilities.ts";

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

function validate(
  path: string,
  data: Record<string, unknown>,
  warnings: string[],
  hookWarnings: Extract<CustomSessionEvent, { type: "hook_warning" }>[],
): Settings {
  if (Object.hasOwn(data, "allowTools")) {
    throw createUserVisibleError(
      `${path}: "allowTools" has been removed; migrate to "permissions.allow".`,
      {
        code: "allow-tools-retired",
        params: { source: path },
      },
    );
  }
  const [first] = Value.Errors(SettingsSchema, data);
  if (first) throw new Error(`${path}: ${first.instancePath || "/"} ${first.message}`);
  const settings = data as Settings;
  for (const [providerIndex, provider] of (settings.providers ?? []).entries()) {
    for (const [modelIndex, model] of provider.models.entries()) {
      if (model.compat === undefined) continue;
      const [error] = Value.Errors(ModelCompatSchemas[provider.api], model.compat);
      if (error)
        throw new Error(
          `${path}: /providers/${providerIndex}/models/${modelIndex}/compat${error.instancePath} ${error.message}`,
        );
    }
  }
  parsePermissionRules(settings.permissions, path);
  validateHooks(settings.hooks, path, (warning) => {
    warnings.push(warning.message);
    hookWarnings.push(warning);
  });
  return settings;
}

/**
 * Loads `~/.rukie/settings.json` merged with `<cwd>/.rukie/settings.json`.
 * The project file may override `model`, `reviewModel` and `subagentModel`.
 * Project deny/ask rules append to the user rules; allow rules append only for
 * the exact Trusted Project used by project MCP configuration.
 * Its `providers`, `permissionMode` and `locale` are dropped (unvalidated) with a warning:
 * a project must not redirect credentials or grant itself broader permissions.
 * Language preferences belong to the user, not the project.
 */
export async function loadSettings(options: { cwd: string; homeDir: string }) {
  const userFile = join(options.homeDir, ".rukie/settings.json");
  const projectFile = join(options.cwd, ".rukie/settings.json");
  const [userData, { providers, permissionMode, locale, ...projectData }] = await Promise.all([
    readJson(userFile),
    readJson(projectFile),
  ]);
  const warnings: string[] = [];
  const hookWarnings: Extract<CustomSessionEvent, { type: "hook_warning" }>[] = [];
  const user = validate(userFile, userData, warnings, hookWarnings);
  const project = validate(projectFile, projectData, warnings, hookWarnings);
  if (providers !== undefined) {
    warnings.push(`${projectFile}: ignoring "providers"; only user settings can define providers.`);
  }
  if (permissionMode !== undefined) {
    warnings.push(
      `${projectFile}: ignoring "permissionMode"; only user settings can define permissionMode.`,
    );
  }
  const settings: Settings = { ...user };
  if (locale !== undefined) {
    warnings.push(`${projectFile}: ignoring "locale"; only user settings can define locale.`);
  }
  if (project.model !== undefined) settings.model = project.model;
  if (project.titleModel !== undefined) settings.titleModel = project.titleModel;
  if (project.reviewModel !== undefined) settings.reviewModel = project.reviewModel;
  if (project.subagentModel !== undefined) settings.subagentModel = project.subagentModel;
  if (project.toolSearch !== undefined) settings.toolSearch = project.toolSearch;
  const trusted = isTrustedProject(options.cwd, user);
  if (project.hooks !== undefined && !trusted) {
    warnings.push(`${projectFile}: ignoring "hooks"; only trusted projects can define hooks.`);
  }
  if (user.hooks !== undefined || (trusted && project.hooks !== undefined))
    settings.hooks = mergeHooks(user.hooks, trusted ? project.hooks : undefined);
  if (project.permissions?.allow !== undefined && !trusted) {
    warnings.push(
      `${projectFile}: ignoring "permissions.allow"; only trusted projects can define allow rules.`,
    );
  }
  if (project.permissions !== undefined) {
    const permissions = { ...user.permissions };
    for (const decision of ["deny", "ask", "allow"] as const) {
      const rules = project.permissions[decision];
      if (rules !== undefined && (decision !== "allow" || trusted)) {
        permissions[decision] = [...(permissions[decision] ?? []), ...rules];
      }
    }
    settings.permissions = permissions;
  }
  return { settings, warnings, ...(hookWarnings.length > 0 && { hookWarnings }) };
}

/** Trust applies to the exact project directory, never to a child or project-supplied list. */
export function isTrustedProject(cwd: string, settings: Settings): boolean {
  return settings.trustedProjects?.some((project) => resolve(project) === resolve(cwd)) ?? false;
}

/** Pasteable example settings; kept valid against `SettingsSchema` by the CLI e2e test. */
const EXAMPLE_SETTINGS: Settings = {
  model: "local/my-model",
  providers: [
    {
      id: "local",
      api: "openai-completions",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiKeyEnv: "LOCAL_API_KEY",
      models: [{ id: "my-model" }],
    },
  ],
};

function noModelMessage(userFile: string) {
  return [
    `No model configured. Set "model" in ${userFile} or pass --model provider/id.`,
    'Built-in providers read their standard env var, e.g. "model": "anthropic/<id>" with ANTHROPIC_API_KEY.',
    "Example with a custom OpenAI-compatible provider:",
    JSON.stringify(EXAMPLE_SETTINGS, null, 2),
  ].join("\n");
}

const customApis = {
  "openai-completions": openAICompletionsApi,
  "openai-responses": openAIResponsesApi,
  "anthropic-messages": anthropicMessagesApi,
};

/** Resolves `settings.model` against pi-ai's built-in providers plus the user's custom ones. */
export async function resolveModel(
  settings: Settings,
  homeDir: string,
  onWarning: (message: string) => void = console.warn,
): Promise<{ model: Model<Api>; models: Models }> {
  if (!settings.model) {
    const settingsPath = join(homeDir, ".rukie/settings.json");
    throw createUserVisibleError(noModelMessage(settingsPath), {
      code: "no-model",
      params: { settings: settingsPath },
    });
  }
  const models = modelRegistry(settings);
  for (const provider of models.getProviders())
    models.setProvider(withToolCapabilityDetection(provider, homeDir, onWarning));
  const slash = settings.model.indexOf("/");
  const providerId = settings.model.slice(0, slash);
  const model =
    slash > 0 ? models.getModel(providerId, settings.model.slice(slash + 1)) : undefined;
  if (!model)
    throw createUserVisibleError(`Unknown model "${settings.model}".`, {
      code: "unknown-model",
      params: { model: settings.model },
    });
  if (!(await models.checkAuth(providerId))) {
    const env = settings.providers?.find((p) => p.id === providerId)?.apiKeyEnv;
    throw createUserVisibleError(
      `No API key for provider "${providerId}"${env ? `: set ${env}` : ""}.`,
      { code: "no-api-key", params: { provider: providerId, env: env ?? "" } },
    );
  }
  return { model, models };
}

function modelRegistry(settings: Settings) {
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
          input: m.input ?? ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          reasoning: m.reasoning ?? false,
          // ponytail: generic defaults; per-model limits come from settings when they matter
          contextWindow: m.contextWindow ?? 128_000,
          maxTokens: m.maxTokens ?? 16_384,
          ...(m.compat === undefined ? {} : { compat: m.compat }),
        })),
      }),
    );
  }
  return models;
}

export { modelState } from "./model-state.ts";

/**
 * Lists models with their accepted input modalities without requiring credentials.
 * Uses resolution's registry and precedence; custom models default to text input.
 */
export function listModels(
  settings: Settings = {},
): { spec: string; name: string; input: ("text" | "image")[] }[] {
  return modelRegistry(settings)
    .getModels()
    .map((model) => ({
      spec: `${model.provider}/${model.id}`,
      name: model.name,
      input: [...model.input],
    }))
    .sort((a, b) => a.spec.localeCompare(b.spec));
}

export { supportedThinkingLevel } from "./model-selection.ts";
