import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";
import type { AppDatabase } from "./app-database.ts";

export type EncryptionBackend = "electron" | "system-keychain" | "memory";

export interface SecretEncryption {
  encrypt(identity: string, value: string): Promise<string>;
  decrypt(identity: string, ciphertext: string): Promise<string>;
}
class CredentialUnavailableError extends Error {
  constructor() {
    super("Desktop credential operation failed. Retry or reconfigure credentials.");
  }
}
export function privateSecretEncryption(url: string, token: string): SecretEncryption {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.pathname !== "/secret" ||
    !token
  )
    throw new Error("Invalid private secret service");
  const request = async (type: "encrypt" | "decrypt", identity: string, value: string) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ type, identity, value }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new CredentialUnavailableError();
    const result: unknown = await response.json();
    if (
      typeof result !== "object" ||
      result === null ||
      !("value" in result) ||
      typeof result.value !== "string"
    )
      throw new Error("Invalid private credential response");
    return result.value;
  };
  return {
    encrypt: (identity, value) => request("encrypt", identity, value),
    decrypt: (identity, value) => request("decrypt", identity, value),
  };
}

/** System credential store boundary; only a missing entry permits first-use creation. */
interface SecretsStore {
  get(options: { service: string; name: string }): Promise<string | null>;
  set(options: { service: string; name: string; value: string }): Promise<unknown>;
}

function checkIdentity(identity: string) {
  if (
    identity.length > 256 ||
    !/^(provider:[A-Za-z0-9_-]+|oauth:.+|configuration:(mcp|hooks))$/.test(identity)
  )
    throw new Error("Invalid credential purpose");
}

function aesSecretEncryption(key: (create: boolean) => Promise<Buffer>): SecretEncryption {
  return {
    async encrypt(identity, value) {
      checkIdentity(identity);
      try {
        const nonce = randomBytes(12);
        const cipher = createCipheriv("aes-256-gcm", await key(true), nonce);
        cipher.setAAD(Buffer.from(identity));
        const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
        // Version, nonce, authentication tag, ciphertext. The credential purpose is authenticated AAD.
        return `aes256gcm:1:${Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64")}`;
      } catch {
        throw new CredentialUnavailableError();
      }
    },
    async decrypt(identity, ciphertext) {
      checkIdentity(identity);
      try {
        const prefix = "aes256gcm:1:";
        if (!ciphertext.startsWith(prefix)) throw new Error("Invalid ciphertext");
        const bytes = Buffer.from(ciphertext.slice(prefix.length), "base64");
        if (bytes.length < 28) throw new Error("Invalid ciphertext");
        const decipher = createDecipheriv("aes-256-gcm", await key(false), bytes.subarray(0, 12));
        decipher.setAAD(Buffer.from(identity));
        decipher.setAuthTag(bytes.subarray(12, 28));
        return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString(
          "utf8",
        );
      } catch {
        throw new CredentialUnavailableError();
      }
    },
  };
}

/** The master key lives only as long as this process; ciphertext cannot be reused in a later run. */
export function memorySecretEncryption(): SecretEncryption {
  const master = randomBytes(32);
  return aesSecretEncryption(async () => master);
}

/** All consumers of a service must share its configuration root. SQLite owns crash-safe exclusion;
 * the guard contains no key material and is closed after every creation attempt. */
async function initializeMasterKey<T>(
  root: string,
  service: string,
  initialize: () => Promise<T>,
): Promise<T> {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const name = createHash("sha256").update(service).digest("hex");
  const guard = new Database(join(root, `master-key-${name}.sqlite`), { create: true });
  try {
    guard.exec("PRAGMA busy_timeout=0");
    const deadline = performance.now() + 15_000;
    for (;;) {
      try {
        guard.exec("BEGIN IMMEDIATE");
        break;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "SQLITE_BUSY" ||
          performance.now() >= deadline
        )
          throw error;
        // SQLite exclusion is a cross-process runtime contract; yield while its owner awaits keychain I/O.
        await delay(10);
      }
    }
    try {
      return await initialize();
    } finally {
      guard.exec("ROLLBACK");
    }
  } finally {
    guard.close();
  }
}

/** Failed reads never replace a key. Missing keys are reread under shared cross-process exclusion. */
export function systemKeychainSecretEncryption(
  service: string,
  configurationRoot: string,
  store: SecretsStore = Bun.secrets,
): SecretEncryption {
  if (!service.trim()) throw new Error("System keychain requires an explicit service name");
  if (!isAbsolute(configurationRoot))
    throw new Error("System keychain requires an absolute configuration root");
  let loading: Promise<Buffer> | undefined;
  const load = async (create: boolean): Promise<Buffer> => {
    const options = { service, name: "credential-master-key-v1" };
    const value = await store.get(options);
    if (value !== null) {
      if (!/^[a-f0-9]{64}$/.test(value)) throw new Error("Invalid master key");
      return Buffer.from(value, "hex");
    }
    if (!create) throw new Error("Missing master key");
    return initializeMasterKey(configurationRoot, service, async () => {
      const existing = await store.get(options);
      if (existing !== null) {
        if (!/^[a-f0-9]{64}$/.test(existing)) throw new Error("Invalid master key");
        return Buffer.from(existing, "hex");
      }
      const master = randomBytes(32);
      await store.set({ ...options, value: master.toString("hex") });
      return master;
    });
  };
  return aesSecretEncryption((create) => {
    if (!loading) {
      const attempt = load(create);
      loading = attempt;
      void attempt.catch(() => {
        if (loading === attempt) loading = undefined;
      });
    }
    return loading;
  });
}

/** Sensitive OAuth state and configuration are encrypted as complete documents, including temporary secrets. */
export function secretVault(database: AppDatabase, encryption?: SecretEncryption) {
  const requireEncryption = () => {
    if (!encryption) throw new CredentialUnavailableError();
    return encryption;
  };
  return {
    async read(identity: string): Promise<string | undefined> {
      checkIdentity(identity);
      const ciphertext = await database.credential(identity);
      if (ciphertext === undefined) return undefined;
      try {
        return await requireEncryption().decrypt(identity, ciphertext);
      } catch {
        throw new CredentialUnavailableError();
      }
    },
    async save(identity: string, value: string): Promise<void> {
      checkIdentity(identity);
      const ciphertext = await requireEncryption().encrypt(identity, value);
      await database.saveCredential(identity, { type: "replace", ciphertext });
    },
    async delete(identity: string): Promise<void> {
      checkIdentity(identity);
      await database.saveCredential(identity, { type: "delete" });
    },
  };
}
