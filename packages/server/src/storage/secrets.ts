import type { AppDatabase } from "./app-database.ts";

export interface SecretEncryption {
  encrypt(identity: string, value: string): Promise<string>;
  decrypt(identity: string, ciphertext: string): Promise<string>;
}
export class CredentialUnavailableError extends Error {
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

/** Sensitive OAuth state and configuration are encrypted as complete documents, including temporary secrets. */
export function secretVault(database: AppDatabase, encryption?: SecretEncryption) {
  const requireEncryption = () => {
    if (!encryption) throw new CredentialUnavailableError();
    return encryption;
  };
  const checkIdentity = (identity: string) => {
    if (
      identity.length > 256 ||
      !/^(provider:[A-Za-z0-9_-]+|oauth:.+|configuration:(mcp|hooks))$/.test(identity)
    )
      throw new Error("Invalid credential purpose");
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
