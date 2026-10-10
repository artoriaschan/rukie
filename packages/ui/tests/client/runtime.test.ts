import { expect, test } from "vitest";
import { WireCommandSchema } from "@rukie/shared";
import { Value } from "typebox/value";

test("wire schema validates a browser client's request in Node", () => {
  expect(process.versions.bun).toBeUndefined();
  expect(Value.Check(WireCommandSchema, { id: "request-1", type: "projects.list" })).toBe(true);
  expect(Value.Check(WireCommandSchema, { id: "request-1", type: "unknown" })).toBe(false);
});
