import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openBunSqliteDatabase } from "@rukie/agent";
import { AppDatabase } from "../../src/storage/app-database.ts";

test("application state survives restart and failed provider replacement preserves its credential", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-app-db-"));
  let app: AppDatabase | undefined;
  try {
    app = await AppDatabase.open(root);
    await app.saveRegistry({
      projects: [{ id: "p", name: "project", path: root }],
      pinned: ["s"],
      archived: ["archived"],
      preferences: { showPinned: true },
    });
    await app.saveProvider(
      {
        id: "local",
        name: "Local",
        api: "openai-completions",
        baseUrl: "http://localhost/v1",
        models: [{ id: "m" }],
      },
      { type: "replace", ciphertext: "cipher-one" },
    );
    await expect(
      app.saveProvider(
        {
          id: "local",
          name: "broken",
          api: "openai-completions",
          baseUrl: "http://localhost/v1",
          models: [{ id: "m" }, { id: "m" }],
        },
        { type: "replace", ciphertext: "cipher-two" },
      ),
    ).rejects.toThrow();
    await app.saveSettings({ trustedProjects: [root], permissions: { allow: ["write"] } });
    await app.saveCapability("fingerprint", { outcome: "supported", expiresAt: 100 });
    await app.close();
    app = await AppDatabase.open(root);
    expect(await app.registry()).toEqual({
      projects: [{ id: "p", name: "project", path: root }],
      pinned: ["s"],
      archived: ["archived"],
      preferences: { showPinned: true },
    });
    expect((await app.providers())[0]).toMatchObject({
      name: "Local",
      hasCredential: true,
      models: [{ id: "m" }],
    });
    expect(await app.credential("provider:local")).toBe("cipher-one");
    expect(await app.settings()).toEqual({
      trustedProjects: [root],
      permissions: { allow: ["write"] },
    });
    expect(await app.capability("fingerprint")).toEqual({ outcome: "supported", expiresAt: 100 });
    await app.saveProvider(
      {
        id: "local",
        name: "Renamed",
        api: "openai-completions",
        baseUrl: "http://localhost/v1",
        models: [{ id: "m" }],
      },
      { type: "keep" },
    );
    expect(await app.credential("provider:local")).toBe("cipher-one");
    await app.deleteProvider("local");
    expect(await app.providers()).toEqual([]);
    expect(await app.credential("provider:local")).toBeUndefined();
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop model defaults survive provider restart and reject unsupported levels", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-default-model-"));
  let app = await AppDatabase.open(root);
  const provider = {
    id: "local",
    name: "Local",
    api: "openai-completions" as const,
    baseUrl: "https://example.com/v1",
    models: [
      {
        id: "m",
        name: "Distinct",
        compressionThreshold: 80,
        temperature: 0.7,
        maxToolIterations: 3,
        inputPrice: 1.5,
        outputPrice: 2.5,
        cacheReadPrice: 0.5,
        cacheWritePrice: 0.75,
        priceSource: "https://prices.example.com",
        automaticReasoning: true,
        reasoning: true,
        defaultThinkingLevel: "high" as const,
        thinkingLevelMap: { high: "deep", max: null },
      },
    ],
  };
  try {
    await app.saveProvider(provider, { type: "keep" });
    for (const invalid of [
      { temperature: Infinity },
      { temperature: -1 },
      { compressionThreshold: 101 },
      { maxToolIterations: 1.5 },
      { inputPrice: -1 },
    ])
      await expect(
        app.saveProvider(
          { ...provider, models: [{ ...provider.models[0]!, ...invalid }] },
          { type: "keep" },
        ),
      ).rejects.toThrow("Invalid provider");
    await app.close();
    app = await AppDatabase.open(root);
    expect((await app.providers())[0]!.models[0]).toEqual(provider.models[0]);
    await expect(
      app.saveProvider(
        { ...provider, models: [{ ...provider.models[0]!, defaultThinkingLevel: "max" }] },
        { type: "keep" },
      ),
    ).rejects.toThrow("Unsupported default thinking level");
    expect((await app.providers())[0]!.models[0]!.defaultThinkingLevel).toBe("high");
    await app.saveProvider(
      { ...provider, models: [{ ...provider.models[0]!, defaultThinkingLevel: "automatic" }] },
      { type: "keep" },
    );
    await app.close();
    app = await AppDatabase.open(root);
    expect((await app.providers())[0]!.models[0]).toMatchObject({
      id: "m",
      name: "Distinct",
      defaultThinkingLevel: "automatic",
      automaticReasoning: true,
    });
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test.each([
  "",
  "not a url",
  "https://user:password@example.com/v1?key=value#fragment",
  "ftp://example.com",
])("provider storage preserves arbitrary Base URL %s while checking compat", async (baseUrl) => {
  const root = await mkdtemp(join(tmpdir(), "rukie-url-"));
  const app = await AppDatabase.open(root);
  const provider = {
    id: "local",
    name: "Local",
    api: "openai-completions" as const,
    baseUrl,
    models: [{ id: "m" }],
  };
  try {
    await app.saveProvider(provider, { type: "keep" });
    expect((await app.providers())[0]?.baseUrl).toBe(baseUrl);
    await expect(
      app.saveProvider(
        { ...provider, models: [{ id: "m", compat: { supportsToolSearch: true } }] },
        { type: "keep" },
      ),
    ).rejects.toThrow("Invalid model compatibility");
    expect((await app.providers())[0]?.models).toEqual([{ id: "m" }]);
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("registry adds archival to existing documents without discarding organization and rejects malformed ids", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-archive-registry-"));
  const app = await AppDatabase.open(root);
  const fixture = await openBunSqliteDatabase(join(root, "app.sqlite"));
  try {
    // Persist an application document from before archival existed; assertions use registry().
    const legacy = {
      projects: [{ id: "p", name: "Project", path: root }],
      pinned: ["s"],
      preferences: { showProjects: false },
    };
    await fixture.run(
      "INSERT OR REPLACE INTO documents VALUES (?, ?)",
      "registry",
      JSON.stringify(legacy),
    );
    expect(await app.registry()).toEqual({ ...legacy, archived: [] });
    for (const archived of [null, "s", [1]]) {
      await fixture.run(
        "INSERT OR REPLACE INTO documents VALUES (?, ?)",
        "registry",
        JSON.stringify({ ...legacy, archived }),
      );
      await expect(app.registry()).rejects.toThrow("Invalid application registry");
    }
  } finally {
    await fixture.close();
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
