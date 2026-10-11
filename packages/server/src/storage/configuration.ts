import type { SessionOptions } from "@rukie/agent";
import type { secretVault } from "./secrets.ts";
import type { AppDatabase } from "./app-database.ts";
import type { SecretEncryption } from "./secrets.ts";
import { SettingsSchema, HooksSchema, type Settings } from "@rukie/shared";
import { Value } from "typebox/value";
type Vault = ReturnType<typeof secretVault>;

export function applicationConfiguration(
  database: AppDatabase,
  vault: Vault,
  encryption?: SecretEncryption,
) {
  return {
    async settings(): Promise<Settings> {
      const settings = await database.settings();
      const text = await vault.read("configuration:hooks");
      if (text === undefined) return settings;
      const hooks: unknown = JSON.parse(text);
      if (!Value.Check(HooksSchema, hooks)) throw new Error("Invalid encrypted hooks");
      return { ...settings, hooks };
    },
    async saveSettings(settings: Settings): Promise<void> {
      if (!Value.Check(SettingsSchema, settings)) throw new Error("Invalid settings");
      const { hooks, ...plain } = settings;
      if (hooks === undefined) {
        await database.saveConfiguration(plain, { type: "delete" });
        return;
      }
      if (!encryption) throw new Error("Desktop system encryption is unavailable");
      const ciphertext = await encryption.encrypt("configuration:hooks", JSON.stringify(hooks));
      await database.saveConfiguration(plain, { type: "replace", ciphertext });
    },
    async saveMcp(configuration: Record<string, unknown>): Promise<void> {
      await vault.save("configuration:mcp", JSON.stringify(configuration));
    },
  };
}

/** Core validates MCP server configurations and retains its existing identity/trust and OAuth lifecycle. */
export function applicationMcpPersistence(
  vault: Vault,
): NonNullable<SessionOptions["mcpPersistence"]> {
  return {
    async configuration() {
      const text = await vault.read("configuration:mcp");
      if (text === undefined) return {};
      const value: unknown = JSON.parse(text);
      if (typeof value !== "object" || value === null || Array.isArray(value))
        throw new Error("Invalid encrypted MCP configuration");
      return value as Record<string, unknown>;
    },
    credentials(identity) {
      const key = `oauth:${identity}`;
      return {
        async load() {
          const text = await vault.read(key);
          if (text === undefined) return undefined;
          // The encrypted envelope is identity-bound; validate the full state through Core's shared parser.
          return parseOAuthState(JSON.parse(text));
        },
        async save(state) {
          await vault.save(key, JSON.stringify(state));
        },
        async clear() {
          await vault.delete(key);
        },
      };
    },
  };
}
import { parseOAuthState } from "@rukie/agent";
