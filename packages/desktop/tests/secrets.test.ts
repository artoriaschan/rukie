import { expect, test, vi } from "vitest";
import { createSecretService } from "../src/main/secrets.ts";

test("private crypto service rejects renderer origins, binds identity and conceals cancelled encryption errors", async () => {
  const encryptString = vi.fn((value: string) => Buffer.from(value).reverse());
  const decryptString = vi.fn((value: Buffer) => Buffer.from(value).reverse().toString());
  const available = vi.fn(() => true);
  const service = await createSecretService({
    isEncryptionAvailable: available,
    encryptString,
    decryptString,
  });
  const request = (body: unknown, origin?: string, token = service.token) =>
    fetch(service.url, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, ...(origin ? { origin } : {}) },
      body: JSON.stringify(body),
    });
  try {
    expect(
      (
        await request(
          { type: "encrypt", identity: "provider:local", value: "test-secret" },
          "app://rukie",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          { type: "encrypt", identity: "provider:local", value: "test-secret" },
          undefined,
          "ws-token",
        )
      ).status,
    ).toBe(403);
    const encrypted = await request({
      type: "encrypt",
      identity: "provider:local",
      value: "test-secret",
    });
    const { value } = await encrypted.json();
    expect((await request({ type: "decrypt", identity: "provider:other", value })).status).toBe(
      409,
    );
    expect(
      await (await request({ type: "decrypt", identity: "provider:local", value })).json(),
    ).toEqual({ value: "test-secret" });
    encryptString.mockImplementationOnce(() => {
      throw new Error("cancelled secret test-secret");
    });
    expect(
      await (
        await request({ type: "encrypt", identity: "provider:local", value: "replacement" })
      ).json(),
    ).toEqual({ error: "secret-operation-failed" });
    available.mockReturnValue(false);
    expect(
      (await request({ type: "encrypt", identity: "provider:local", value: "replacement" })).status,
    ).toBe(409);
  } finally {
    await service.close();
  }
});
