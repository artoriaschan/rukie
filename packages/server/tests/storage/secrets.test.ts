import { expect, test, onTestFinished } from "bun:test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
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
  const root = await mkdtemp(join(tmpdir(), "rukie-master-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const values = new Map<string, string>();
  const store = {
    async get({ service, name }: { service: string; name: string }) {
      return values.get(`${service}/${name}`) ?? null;
    },
    async set({ service, name, value }: { service: string; name: string; value: string }) {
      values.set(`${service}/${name}`, value);
    },
  };
  const first = systemKeychainSecretEncryption("isolated-test", root, store);
  const ciphertext = await first.encrypt("provider:local", "private-key");
  expect(ciphertext).not.toContain("private-key");
  expect(values.size).toBe(1);
  const master = [...values.values()][0];
  const second = systemKeychainSecretEncryption("isolated-test", root, store);
  expect(await second.decrypt("provider:local", ciphertext)).toBe("private-key");
  expect(
    await first.decrypt("provider:local", await second.encrypt("provider:local", "replacement")),
  ).toBe("replacement");
  expect([...values.values()][0]).toBe(master);
});

test("unavailable or invalid system keys never replace an existing master key; retry preserves ciphertext", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-master-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
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
  const ciphertext = await systemKeychainSecretEncryption("test", root, store).encrypt(
    "provider:local",
    "original",
  );
  const originalMaster = master;
  unavailable = true;
  const retried = systemKeychainSecretEncryption("test", root, store);
  await expect(retried.encrypt("provider:local", "replacement")).rejects.toThrow(
    "Retry or reconfigure",
  );
  expect(master).toBe(originalMaster);
  unavailable = false;
  expect(await retried.decrypt("provider:local", ciphertext)).toBe("original");
  master = "invalid-existing-key";
  await expect(
    systemKeychainSecretEncryption("test", root, store).encrypt("provider:local", "replacement"),
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
  const root = await mkdtemp(join(tmpdir(), "rukie-master-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
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
    systemKeychainSecretEncryption("test", root, store).decrypt(
      "provider:local",
      await memorySecretEncryption().encrypt("provider:local", "secret"),
    ),
  ).rejects.toThrow("Retry or reconfigure");
  expect(saved).toBe(false);
});

test("concurrent first encryptions produce ciphertext readable with the one persisted master key", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-master-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  let master: string | null = null;
  const store = {
    async get() {
      return master;
    },
    async set({ value }: { value: string }) {
      master = value;
    },
  };
  const encryption = systemKeychainSecretEncryption("test", root, store);
  const ciphertexts = await Promise.all([
    encryption.encrypt("provider:a", "first"),
    encryption.encrypt("provider:b", "second"),
  ]);
  const reopened = systemKeychainSecretEncryption("test", root, store);
  expect(await reopened.decrypt("provider:a", ciphertexts[0] ?? "")).toBe("first");
  expect(await reopened.decrypt("provider:b", ciphertexts[1] ?? "")).toBe("second");
});

test("independent first-use encryption instances retain one restart-readable master key", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-master-race-"));
  let master: string | null = null;
  let reads = 0;
  let writes = 0;
  const observedMissing = Promise.withResolvers<void>();
  const store = {
    async get() {
      const value = master;
      if (++reads <= 2) {
        if (reads === 2) observedMissing.resolve();
        await observedMissing.promise;
      }
      return value;
    },
    async set({ value }: { value: string }) {
      writes++;
      master = value;
    },
  };
  try {
    const first = systemKeychainSecretEncryption("race", root, store);
    const second = systemKeychainSecretEncryption("race", root, store);
    const ciphertexts = await Promise.all([
      first.encrypt("provider:a", "first"),
      second.encrypt("provider:b", "second"),
    ]);
    expect(writes).toBe(1);
    const reopened = systemKeychainSecretEncryption("race", root, store);
    expect(await reopened.decrypt("provider:a", ciphertexts[0] ?? "")).toBe("first");
    expect(await reopened.decrypt("provider:b", ciphertexts[1] ?? "")).toBe("second");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

for (const outcome of ["commit", "crash"] as const) {
  test(`master-key exclusion survives another process ${outcome} and releases without stale ownership`, async () => {
    const root = await mkdtemp(join(tmpdir(), "rukie-master-process-"));
    const moduleUrl = pathToFileURL(join(import.meta.dir, "../../src/storage/secrets.ts")).href;
    const masterPath = join(root, "fake-master");
    const source = `import { systemKeychainSecretEncryption } from ${JSON.stringify(moduleUrl)};
      import { readFile, writeFile } from "node:fs/promises";
      const store = {
        async get() { try { return await readFile(${JSON.stringify(masterPath)}, "utf8"); } catch (error) { if(error.code === "ENOENT") return null; throw error; } },
        async set({value}) {
          console.log("owns-key-guard");
          await new Promise(resolve => process.stdin.once("data", resolve));
          await writeFile(${JSON.stringify(masterPath)}, value);
        }
      };
      const encryption = systemKeychainSecretEncryption("shared", ${JSON.stringify(root)}, store);
      console.log(await encryption.encrypt("provider:child", "child-secret"));`;
    const child = spawn(process.execPath, ["-e", source], { stdio: ["pipe", "pipe", "pipe"] });
    const closed = new Promise<number | null>((resolve) => child.once("close", resolve));
    const acquired = Promise.withResolvers<void>();
    let childCiphertext = "";
    let diagnostic = "";
    child.stderr.on("data", (chunk) => {
      diagnostic += String(chunk);
    });
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (line === "owns-key-guard") acquired.resolve();
      else childCiphertext = line;
    });
    child.once("close", () =>
      acquired.reject(new Error(diagnostic || "child exited before key creation")),
    );
    let pending: Promise<string> | undefined;
    onTestFinished(async () => {
      child.kill("SIGKILL");
      await closed;
      await pending?.catch(() => {});
      lines.close();
      await rm(root, { recursive: true, force: true });
    });
    // A real child owns the OS lock; a parent virtual clock cannot release or advance it.
    await acquired.promise;
    const readMissing = Promise.withResolvers<void>();
    let writes = 0;
    const store = {
      async get() {
        try {
          return await readFile(masterPath, "utf8");
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT")
            throw error;
          readMissing.resolve();
          return null;
        }
      },
      async set({ value }: { value: string }) {
        writes++;
        await writeFile(masterPath, value);
      },
    };
    pending = systemKeychainSecretEncryption("shared", root, store).encrypt(
      "provider:parent",
      "parent-secret",
    );
    await readMissing.promise;
    if (outcome === "crash") child.kill("SIGKILL");
    else child.stdin.end("continue\n");
    const ciphertext = await pending;
    expect(await closed).toBe(outcome === "commit" ? 0 : null);
    expect(writes).toBe(outcome === "commit" ? 0 : 1);
    const reopened = systemKeychainSecretEncryption("shared", root, store);
    expect(await reopened.decrypt("provider:parent", ciphertext)).toBe("parent-secret");
    if (outcome === "commit")
      expect(await reopened.decrypt("provider:child", childCiphertext)).toBe("child-secret");
    for (const name of await readdir(root)) {
      const bytes = await readFile(join(root, name));
      expect(bytes.includes(Buffer.from(await readFile(masterPath, "utf8")))).toBe(
        name === "fake-master",
      );
    }
  });
}

test("failed guarded keychain reads and writes release exclusion and retry without replacing a saved key", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-master-failure-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  let master: string | null = null;
  let reads = 0;
  let writes = 0;
  const store = {
    async get() {
      if (++reads === 2) throw new Error("guarded authorization cancelled");
      return master;
    },
    async set({ value }: { value: string }) {
      writes++;
      master = value;
      throw new Error("write acknowledgement unavailable");
    },
  };
  const encryption = systemKeychainSecretEncryption("failure", root, store);
  await expect(encryption.encrypt("provider:a", "secret")).rejects.toThrow("Retry or reconfigure");
  expect(writes).toBe(0);
  await expect(encryption.encrypt("provider:a", "secret")).rejects.toThrow("Retry or reconfigure");
  expect(writes).toBe(1);
  const original = master;
  const ciphertext = await encryption.encrypt("provider:a", "secret");
  expect(writes).toBe(1);
  expect(master).toBe(original);
  expect(
    await systemKeychainSecretEncryption("failure", root, store).decrypt("provider:a", ciphertext),
  ).toBe("secret");
});
