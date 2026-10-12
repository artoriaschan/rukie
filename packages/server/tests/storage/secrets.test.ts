import { expect, test } from "bun:test";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDatabase } from "../../src/storage/app-database.ts";
import {
  secretVault,
  systemKeychainSecretEncryption,
  memorySecretEncryption,
} from "../../src/storage/secrets.ts";
import { applicationMcpPersistence } from "../../src/storage/configuration.ts";

test("OAuth temporary secrets and MCP headers survive restart only as ciphertext; failed encryption preserves state", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-app-secret-"));
  const memory = new Map<string, string>();
  let failed = false;
  const encryption = {
    async encrypt(_identity: string, value: string) {
      if (failed) throw new Error("cancelled");
      const id = `cipher-${memory.size}`;
      memory.set(id, value);
      return id;
    },
    async decrypt(_identity: string, ciphertext: string) {
      const value = memory.get(ciphertext);
      if (value === undefined) throw new Error("cannot decrypt");
      return value;
    },
  };
  let app: AppDatabase | undefined;
  try {
    app = await AppDatabase.open(root);
    const vault = secretVault(app, encryption);
    await vault.save(
      "configuration:mcp",
      JSON.stringify({
        local: {
          url: "https://example.test/mcp",
          headers: { Authorization: "Bearer header-secret" },
          oauth: { clientSecret: "client-secret" },
        },
      }),
    );
    const oauth = applicationMcpPersistence(vault).credentials("local|server-identity");
    await oauth.save({
      serverUrl: "https://example.test/mcp",
      codeVerifier: "verifier-secret",
      clientInformation: { client_id: "test", client_secret: "oauth-client-secret" },
      tokens: { access_token: "access-secret", token_type: "Bearer" },
    });
    failed = true;
    await expect(
      oauth.save({ serverUrl: "https://example.test/mcp", codeVerifier: "replacement" }),
    ).rejects.toThrow("cancelled");
    await app.close();
    app = await AppDatabase.open(root);
    const reopened = applicationMcpPersistence(secretVault(app, encryption));
    expect(await reopened.credentials("local|server-identity").load()).toMatchObject({
      codeVerifier: "verifier-secret",
      tokens: { access_token: "access-secret" },
    });
    expect(await reopened.configuration()).toMatchObject({
      local: { headers: { Authorization: "Bearer header-secret" } },
    });
    for (const file of await readdir(root)) {
      const bytes = await readFile(join(root, file));
      for (const secret of ["header-secret", "client-secret", "verifier-secret", "access-secret"])
        expect(bytes.includes(Buffer.from(secret))).toBe(false);
    }
    await reopened.credentials("local|server-identity").clear();
    expect(await reopened.credentials("local|server-identity").load()).toBeUndefined();
  } finally {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("system keychain encryption creates a master key on first encrypt and reuses it across instances", async () => {
  const values = new Map<string, string>();
  const store = {
    async get({ service, name }: { service: string; name: string }) {
      return values.get(`${service}/${name}`) ?? null;
    },
    async set({ service, name, value }: { service: string; name: string; value: string }) {
      values.set(`${service}/${name}`, value);
    },
  };
  const first = systemKeychainSecretEncryption("isolated-test", store);
  const ciphertext = await first.encrypt("provider:local", "private-key");
  expect(ciphertext).not.toContain("private-key");
  expect(values.size).toBe(1);
  const master = [...values.values()][0];
  const second = systemKeychainSecretEncryption("isolated-test", store);
  expect(await second.decrypt("provider:local", ciphertext)).toBe("private-key");
  expect(
    await first.decrypt("provider:local", await second.encrypt("provider:local", "replacement")),
  ).toBe("replacement");
  expect([...values.values()][0]).toBe(master);
});

test("unavailable or invalid system keys never replace an existing master key; retry preserves ciphertext", async () => {
  let master: string | null = null;
  let unavailable = false;
  const store = {
    async get() {
      if (unavailable) throw new Error("authorization cancelled with sensitive diagnostic");
      return master;
    },
    async set({ value }: { value: string }) {
      master = value;
    },
  };
  const ciphertext = await systemKeychainSecretEncryption("test", store).encrypt(
    "provider:local",
    "original",
  );
  const originalMaster = master;
  unavailable = true;
  const retried = systemKeychainSecretEncryption("test", store);
  await expect(retried.encrypt("provider:local", "replacement")).rejects.toThrow(
    "Retry or reconfigure",
  );
  expect(master).toBe(originalMaster);
  unavailable = false;
  expect(await retried.decrypt("provider:local", ciphertext)).toBe("original");
  master = "invalid-existing-key";
  await expect(
    systemKeychainSecretEncryption("test", store).encrypt("provider:local", "replacement"),
  ).rejects.toThrow("Retry or reconfigure");
  expect(master).toBe("invalid-existing-key");
});

test("ciphertext is bound to credential identity and the in-memory process key", async () => {
  const encryption = memorySecretEncryption();
  const ciphertext = await encryption.encrypt("provider:local", "secret");
  expect(await encryption.decrypt("provider:local", ciphertext)).toBe("secret");
  await expect(encryption.decrypt("provider:another", ciphertext)).rejects.toThrow(
    "Retry or reconfigure",
  );
  await expect(memorySecretEncryption().decrypt("provider:local", ciphertext)).rejects.toThrow(
    "Retry or reconfigure",
  );
  await expect(encryption.encrypt("arbitrary", "secret")).rejects.toThrow(
    "Invalid credential purpose",
  );
  await expect(
    encryption.decrypt("provider:local", `${ciphertext.slice(0, -8)}AAAAAAAA`),
  ).rejects.toThrow("Retry or reconfigure");
});

test("decrypt with a missing system master key never creates one", async () => {
  let saved = false;
  const store = {
    async get() {
      return null;
    },
    async set() {
      saved = true;
    },
  };
  await expect(
    systemKeychainSecretEncryption("test", store).decrypt(
      "provider:local",
      await memorySecretEncryption().encrypt("provider:local", "secret"),
    ),
  ).rejects.toThrow("Retry or reconfigure");
  expect(saved).toBe(false);
});

test("concurrent first encryptions produce ciphertext readable with the one persisted master key", async () => {
  let master: string | null = null;
  const store = {
    async get() {
      return master;
    },
    async set({ value }: { value: string }) {
      master = value;
    },
  };
  const encryption = systemKeychainSecretEncryption("test", store);
  const ciphertexts = await Promise.all([
    encryption.encrypt("provider:a", "first"),
    encryption.encrypt("provider:b", "second"),
  ]);
  const reopened = systemKeychainSecretEncryption("test", store);
  expect(await reopened.decrypt("provider:a", ciphertexts[0] ?? "")).toBe("first");
  expect(await reopened.decrypt("provider:b", ciphertexts[1] ?? "")).toBe("second");
});
