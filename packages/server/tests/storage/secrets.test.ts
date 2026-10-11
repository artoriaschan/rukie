import { expect, test } from "bun:test";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AppDatabase } from "../../src/storage/app-database.ts";
import { secretVault } from "../../src/storage/secrets.ts";
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
