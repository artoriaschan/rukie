import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";

export interface SystemEncryption {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}
export function systemEncryptionAvailable(encryption: SystemEncryption): boolean {
  return (
    encryption.isEncryptionAvailable() && encryption.getSelectedStorageBackend?.() !== "basic_text"
  );
}
function validIdentity(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 256 &&
    /^(provider:[A-Za-z0-9_-]+|oauth:.+|configuration:(mcp|hooks))$/.test(value)
  );
}

/** Main owns system encryption. This independently authenticated listener is never a renderer capability. */
export async function createSecretService(encryption: SystemEncryption) {
  const token = randomBytes(32).toString("hex");
  const server = createServer(async (request, response) => {
    const supplied = request.headers.authorization?.replace(/^Bearer /, "") ?? "";
    if (
      request.method !== "POST" ||
      request.url !== "/secret" ||
      request.headers.origin ||
      Buffer.byteLength(supplied) !== Buffer.byteLength(token) ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
    ) {
      response.writeHead(403).end();
      return;
    }
    const reply = (status: number, value: unknown) =>
      response.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) {
          reply(413, { error: "invalid-secret-operation" });
          return;
        }
        chunks.push(chunk);
      }
      const input: unknown = JSON.parse(Buffer.concat(chunks).toString());
      if (
        typeof input !== "object" ||
        input === null ||
        !("type" in input) ||
        !("identity" in input) ||
        !("value" in input) ||
        !validIdentity(input.identity) ||
        typeof input.value !== "string" ||
        !["encrypt", "decrypt"].includes(String(input.type))
      ) {
        reply(400, { error: "invalid-secret-operation" });
        return;
      }
      if (!systemEncryptionAvailable(encryption)) throw new Error("unavailable");
      if (input.type === "encrypt") {
        reply(200, {
          value: encryption
            .encryptString(JSON.stringify({ identity: input.identity, value: input.value }))
            .toString("base64"),
        });
      } else {
        const decrypted: unknown = JSON.parse(
          encryption.decryptString(Buffer.from(input.value, "base64")),
        );
        if (
          typeof decrypted !== "object" ||
          decrypted === null ||
          !("identity" in decrypted) ||
          !("value" in decrypted) ||
          decrypted.identity !== input.identity ||
          typeof decrypted.value !== "string"
        )
          throw new Error("identity mismatch");
        reply(200, { value: decrypted.value });
      }
    } catch {
      reply(409, { error: "secret-operation-failed" });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing secret service address");
  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${address.port}/secret`,
    token,
    close: () =>
      (closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      })),
  };
}
