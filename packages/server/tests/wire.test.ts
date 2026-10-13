import { expect, test } from "bun:test";
import type { WireCommand } from "@rukie/shared";
import { parseWireCommand } from "../src/index.ts";

test("wire validates an input request and rejects unknown commands and excess fields", () => {
  expect(parseWireCommand({ id: "1", type: "projects.list" })).toEqual({
    id: "1",
    type: "projects.list",
  });
  expect(
    parseWireCommand({ id: "1", type: "prompt", sessionId: "s", text: "hello" }),
  ).toBeDefined();
  expect(parseWireCommand({ id: "1", type: "prompt", sessionId: "s" })).toBeUndefined();
  expect(parseWireCommand({ id: "1", type: "projects.list", token: "secret" })).toBeUndefined();
  expect(parseWireCommand({ id: "1", type: "unknown" })).toBeUndefined();
});

test("wire preserves an optional image name in prompt input", () => {
  const command: WireCommand = {
    id: "image-1",
    type: "prompt",
    sessionId: "s",
    text: "describe",
    images: [{ data: "base64", mimeType: "image/png", name: "screenshot.png" }],
  };
  expect(parseWireCommand(command)).toEqual(command);
});

test("model service wire accepts bounded plaintext replacement and rejects private ciphertext and extra fields", () => {
  const provider = {
    id: "fixture",
    name: "Fixture",
    api: "openai-completions",
    baseUrl: "",
    models: [],
  };
  for (const credential of [
    { type: "keep" },
    { type: "delete" },
    { type: "replace", value: "fixture-key" },
  ])
    expect(
      parseWireCommand({ id: "1", type: "modelServices.save", provider, credential }),
    ).toBeDefined();
  for (const credential of [
    { type: "replace", ciphertext: "encrypted" },
    { type: "replace", value: "" },
    { type: "replace", value: "x".repeat(65537) },
    { type: "keep", value: "secret" },
  ])
    expect(
      parseWireCommand({ id: "1", type: "modelServices.save", provider, credential }),
    ).toBeUndefined();
  expect(parseWireCommand({ id: "1", type: "modelServices.list" })).toBeDefined();
  expect(parseWireCommand({ id: "1", type: "modelServices.templates" })).toBeUndefined();
  expect(
    parseWireCommand({ id: "1", type: "modelServices.revealKey", providerId: "../../secret" }),
  ).toBeUndefined();
});

test("model service schema validates optional enablement and a closed provider icon", () => {
  const provider = {
    id: "deepseek",
    name: "DeepSeek",
    api: "anthropic-messages",
    baseUrl: "",
    models: [],
    enabled: false,
    icon: "deepseek",
  };
  const save = (provider: unknown) =>
    parseWireCommand({
      id: "1",
      type: "modelServices.save",
      provider,
      credential: { type: "keep" },
    });
  expect(save(provider)).toBeDefined();
  expect(save({ ...provider, enabled: "false" })).toBeUndefined();
  expect(save({ ...provider, icon: "unknown" })).toBeUndefined();
});
