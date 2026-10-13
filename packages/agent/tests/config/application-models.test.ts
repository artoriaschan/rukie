import { expect, test } from "bun:test";
import { createApplicationModels, listModelCatalog } from "../../src/index.ts";
import type { ModelService } from "@rukie/shared";

function registry(providers: ModelService[]) {
  return createApplicationModels({
    providers,
    homeDir: "/unused-home",
    hasCredential: async () => false,
    credential: async () => undefined,
    capabilityStore: { read: async () => undefined, save: async () => {} },
  });
}
const service: ModelService = {
  id: "deepseek",
  name: "DeepSeek",
  api: "anthropic-messages",
  baseUrl: "https://api.deepseek.com/anthropic",
  models: [{ id: "flash" }, { id: "disabled", enabled: false }],
  icon: "deepseek",
};

test("disabled services disappear without changing individual model enablement", async () => {
  expect(await listModelCatalog({}, registry([{ ...service, enabled: false }]))).toEqual([]);
  expect((await listModelCatalog({}, registry([service]))).map((entry) => entry.spec)).toEqual([
    "deepseek/flash",
  ]);
  expect(service.models[1]?.enabled).toBe(false);
});

test.each(["", "not a url"])("invalid Base URL %s skips only that service", async (baseUrl) => {
  const providers = [{ ...service, id: "invalid", baseUrl }, service];
  expect((await listModelCatalog({}, registry(providers))).map((entry) => entry.spec)).toEqual([
    "deepseek/flash",
  ]);
});

test("desktop catalogs carry the saved provider icon while terminal catalogs omit it", async () => {
  const models = registry([service]);
  expect((await listModelCatalog({}, models, { providers: [service] }))[0]?.providerIcon).toBe(
    "deepseek",
  );
  expect((await listModelCatalog({}, models))[0]).not.toHaveProperty("providerIcon");
});
