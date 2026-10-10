import { expect, test } from "bun:test";
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
  const command = {
    id: "image-1",
    type: "prompt",
    sessionId: "s",
    text: "describe",
    images: [{ data: "base64", mimeType: "image/png", name: "screenshot.png" }],
  };
  expect(parseWireCommand(command)).toEqual(command);
});
