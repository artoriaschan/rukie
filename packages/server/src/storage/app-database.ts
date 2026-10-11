import { openBunSqliteDatabase } from "@rukie/agent";
type Database = Awaited<ReturnType<typeof openBunSqliteDatabase>>;
type Executor = Pick<Database, "exec" | "run" | "get" | "all">;
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import {
  SettingsSchema,
  WirePreferencesSchema,
  ModelServiceSchema,
  ModelCompatSchemas,
  type Settings,
  type ModelService,
  type ModelServiceSummary,
  type WireSessionSummary,
} from "@rukie/shared";

const RegistrySchema = Type.Object({
  projects: Type.Array(
    Type.Object({ id: Type.String(), path: Type.String(), name: Type.String() }),
  ),
  pinned: Type.Array(Type.String()),
  preferences: WirePreferencesSchema,
});
const SessionIndexSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  titleSource: Type.Enum(["prompt", "model", "user"]),
  createdAt: Type.Number(),
  updatedAt: Type.Number(),
  messageCount: Type.Number(),
  model: Type.String(),
  cwd: Type.String(),
  running: Type.Optional(Type.Boolean()),
  waitingPermission: Type.Optional(Type.Boolean()),
});
export type ApplicationRegistry = Static<typeof RegistrySchema>;
export type CredentialChange =
  | { type: "keep" }
  | { type: "delete" }
  | { type: "replace"; ciphertext: string };

/** The sidecar owns this database. Every public mutation commits before it reports success. */
export class AppDatabase {
  private constructor(private readonly db: Database) {}
  static async open(root: string): Promise<AppDatabase> {
    await mkdir(root, { recursive: true, mode: 0o700 });
    const db = await openBunSqliteDatabase(join(root, "app.sqlite"));
    try {
      await db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;");
      await db.exec(`CREATE TABLE IF NOT EXISTS documents (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS models (provider TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE, id TEXT NOT NULL, PRIMARY KEY(provider,id));
        CREATE TABLE IF NOT EXISTS credentials (id TEXT PRIMARY KEY, ciphertext TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS session_index (id TEXT PRIMARY KEY, value TEXT NOT NULL);`);
      return new AppDatabase(db);
    } catch (error) {
      await db.close();
      throw error;
    }
  }
  private async document(key: string): Promise<unknown> {
    const row = await this.db.get<{ value: string }>(
      "SELECT value FROM documents WHERE key = ?",
      key,
    );
    return row ? JSON.parse(row.value) : undefined;
  }
  private putDocument(tx: Executor, key: string, value: unknown) {
    return tx.run("INSERT OR REPLACE INTO documents VALUES (?, ?)", key, JSON.stringify(value));
  }
  async registry(): Promise<ApplicationRegistry> {
    const value = (await this.document("registry")) ?? {
      projects: [],
      pinned: [],
      preferences: {},
    };
    if (!Value.Check(RegistrySchema, value)) throw new Error("Invalid application registry");
    return value;
  }
  async saveRegistry(value: ApplicationRegistry): Promise<void> {
    if (!Value.Check(RegistrySchema, value)) throw new Error("Invalid application registry");
    await this.db.transaction((tx) => this.putDocument(tx, "registry", value));
  }
  async settings(): Promise<Settings> {
    const value = (await this.document("settings")) ?? {};
    if (!Value.Check(SettingsSchema, value)) throw new Error("Invalid application settings");
    return value;
  }
  async saveSettings(value: Settings): Promise<void> {
    if (!Value.Check(SettingsSchema, value) || value.providers !== undefined)
      throw new Error("Providers require the credential-aware provider operation");
    // Hook HTTP headers may contain secrets, so hooks are stored by the encrypted configuration operation.
    if (value.hooks !== undefined) throw new Error("Hooks require encrypted configuration storage");
    if (
      JSON.stringify(Value.Clean(SettingsSchema, structuredClone(value))) !== JSON.stringify(value)
    )
      throw new Error("Unknown application settings");
    await this.db.transaction((tx) => this.putDocument(tx, "settings", value));
  }
  /** Caller encrypts hooks before this atomic configuration/credential commit. */
  async saveConfiguration(settings: Settings, hooks: CredentialChange): Promise<void> {
    if (
      !Value.Check(SettingsSchema, settings) ||
      settings.providers !== undefined ||
      settings.hooks !== undefined ||
      JSON.stringify(Value.Clean(SettingsSchema, structuredClone(settings))) !==
        JSON.stringify(settings)
    )
      throw new Error("Invalid application configuration");
    await this.db.transaction(async (tx) => {
      await this.putDocument(tx, "settings", settings);
      await this.changeCredential(tx, "configuration:hooks", hooks);
    });
  }
  async providers(): Promise<ModelServiceSummary[]> {
    return (
      await this.db.all<{ value: string; hasCredential: number }>(
        "SELECT p.value, EXISTS(SELECT 1 FROM credentials c WHERE c.id = 'provider:' || p.id) AS hasCredential FROM providers p ORDER BY p.id",
      )
    ).map((row) => {
      const value: unknown = JSON.parse(row.value);
      if (!Value.Check(ModelServiceSchema, value)) throw new Error("Invalid stored provider");
      return { ...value, hasCredential: Boolean(row.hasCredential) };
    });
  }
  async saveProvider(provider: ModelService, credential: CredentialChange): Promise<void> {
    if (!Value.Check(ModelServiceSchema, provider)) throw new Error("Invalid provider");
    for (const model of provider.models) {
      if (
        model.compat !== undefined &&
        !Value.Check(ModelCompatSchemas[provider.api], model.compat)
      )
        throw new Error("Invalid model compatibility");
    }
    if (provider.models.length && !provider.baseUrl)
      throw new Error("Configured models require a provider URL");
    if (provider.baseUrl) {
      const url = new URL(provider.baseUrl);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error("Invalid provider URL");
    }
    await this.db.transaction(async (tx) => {
      await tx.run(
        "INSERT OR REPLACE INTO providers VALUES (?, ?)",
        provider.id,
        JSON.stringify(provider),
      );
      await tx.run("DELETE FROM models WHERE provider = ?", provider.id);
      for (const model of provider.models)
        await tx.run("INSERT INTO models VALUES (?, ?)", provider.id, model.id);
      await this.changeCredential(tx, `provider:${provider.id}`, credential);
    });
  }
  private async changeCredential(tx: Executor, id: string, change: CredentialChange) {
    if (change.type === "replace") {
      if (!change.ciphertext) throw new Error("Empty credential ciphertext");
      await tx.run("INSERT OR REPLACE INTO credentials VALUES (?, ?)", id, change.ciphertext);
    } else if (change.type === "delete") await tx.run("DELETE FROM credentials WHERE id = ?", id);
  }
  async deleteProvider(id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run("DELETE FROM providers WHERE id = ?", id);
      await this.changeCredential(tx, `provider:${id}`, { type: "delete" });
    });
  }
  /** Private execution boundary only; never expose ciphertext or decryption through session WS. */
  async credential(id: string): Promise<string | undefined> {
    return (
      await this.db.get<{ ciphertext: string }>(
        "SELECT ciphertext FROM credentials WHERE id = ?",
        id,
      )
    )?.ciphertext;
  }
  async saveCredential(
    id: string,
    change: Exclude<CredentialChange, { type: "keep" }>,
  ): Promise<void> {
    await this.db.transaction((tx) => this.changeCredential(tx, id, change));
  }
  async capability(key: string): Promise<unknown> {
    return this.document(`capability:${key}`);
  }
  async saveCapability(key: string, value: unknown): Promise<void> {
    await this.db.transaction((tx) => this.putDocument(tx, `capability:${key}`, value));
  }
  /** Reconcile only committed metadata supplied by read-only Session discovery. Never resumes a Session. */
  async reconcileSessions(summaries: WireSessionSummary[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.run("DELETE FROM session_index");
      for (const summary of summaries)
        await tx.run(
          "INSERT INTO session_index VALUES (?, ?)",
          summary.id,
          JSON.stringify(summary),
        );
    });
  }
  async sessions(): Promise<WireSessionSummary[]> {
    return (
      await this.db.all<{ value: string }>("SELECT value FROM session_index ORDER BY id")
    ).map((row) => {
      const value: unknown = JSON.parse(row.value);
      if (!Value.Check(SessionIndexSchema, value))
        throw new Error("Invalid application Session index");
      return value;
    });
  }
  close(): Promise<void> {
    return this.db.close();
  }
}
