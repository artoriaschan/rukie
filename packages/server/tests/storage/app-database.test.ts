import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDatabase } from "../../src/storage/app-database.ts";

test("application state survives restart and failed provider replacement preserves its credential", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-app-db-"));
  let app: AppDatabase | undefined;
  try {
    app = await AppDatabase.open(root);
    await app.saveRegistry({
      projects: [{ id: "p", name: "project", path: root }],
      pinned: ["s"],
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
        reasoning: true,
        defaultThinkingLevel: "high" as const,
        thinkingLevelMap: { high: "deep", max: null },
      },
    ],
  };
  try {
    await app.saveProvider(provider, { type: "keep" });
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
  } finally {
    await app.close();
    await rm(root, { recursive: true, force: true });
  }
});
