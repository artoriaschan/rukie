import { expect, test } from "vitest";
import { WireCommandSchema, type WireCommand } from "@rukie/shared";
import { Value } from "typebox/value";

test("wire schema validates a browser client's request in Node", () => {
  expect(process.versions.bun).toBeUndefined();
  expect(Value.Check(WireCommandSchema, { id: "request-1", type: "projects.list" })).toBe(true);
  expect(Value.Check(WireCommandSchema, { id: "request-1", type: "unknown" })).toBe(false);
});

test("wire selections remain typed literal commands and reject unknown permission modes", () => {
  const selection: WireCommand = {
    id: "choose",
    type: "session.create",
    project: null,
    text: "Hello",
    permissionMode: "ask",
    modelSelection: { provider: "test", modelId: "script", thinkingLevel: "high" },
  };
  expect(Value.Check(WireCommandSchema, selection)).toBe(true);
  expect(Value.Check(WireCommandSchema, { ...selection, permissionMode: "invalid" })).toBe(false);
});
