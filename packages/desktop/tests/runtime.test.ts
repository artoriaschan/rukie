import { expect, test } from "vitest";
import { WIRE_SUBPROTOCOL } from "@rukie/shared";

test("desktop test runner uses Node with shared workspace sources", () => {
  expect(process.versions.bun).toBeUndefined();
  expect(process.versions.node).toBeDefined();
  expect(WIRE_SUBPROTOCOL).toBe("rukie.v1");
});
