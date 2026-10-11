import { expect, test } from "bun:test";
import { checkTestSource } from "../check-test-policy";

test.each([
  "await Bun.sleep(30);",
  "await new Promise(resolve => setTimeout(resolve, 30));",
  "await new Promise(resolve => setTimeout(() => resolve(), 30));",
  'import { setTimeout as delay } from "node:timers/promises"; await delay(30);',
  'test.only("hidden suite", () => {});',
  'test.only.each([1])("hidden suite", () => {});',
  'import "./other.test.ts";',
])("policy rejects executable violation %s", (source) => {
  expect(checkTestSource("fixture.ts", source)).not.toHaveLength(0);
});

test("policy permits completion, rejecting deadlines, virtual timers and inert example text", () => {
  expect(
    checkTestSource(
      "fixture.ts",
      `
    await completed;
    new Promise((resolve, reject) => setTimeout(() => reject(new Error("missing result")), 2000));
    clock.tick(1000);
    const example = "await Bun.sleep(30)";
    // Bun.sleep(30);
  `,
    ),
  ).toEqual([]);
});

test("transport delay exemption requires an adjacent reason", () => {
  expect(
    checkTestSource(
      "fixture.ts",
      `
    // test-policy: transport-delay Child server intentionally delays its response.
    await Bun.sleep(delayMs);
  `,
    ),
  ).toEqual([]);
  expect(
    checkTestSource(
      "fixture.ts",
      `// test-policy: transport-delay
await Bun.sleep(30);`,
    ),
  ).not.toHaveLength(0);
});

test.each([
  ["packages/ui/tests/app.test.tsx", "bun:test"],
  ["packages/desktop/tests/main.test.ts", "bun:test"],
  ["packages/server/tests/server.test.ts", "vitest"],
  ["packages/agent/tests/session.test.ts", "vitest/browser"],
])("runner boundary rejects %s importing %s", (file, runner) => {
  expect(checkTestSource(file, `import { test } from "${runner}";`)).not.toHaveLength(0);
});
test.each([
  ["packages/ui/tests/store.test.ts", "vitest"],
  ["packages/desktop/tests/main.test.ts", "vitest"],
  ["packages/server/tests/server.test.ts", "bun:test"],
])("runner boundary permits %s importing %s", (file, runner) => {
  expect(checkTestSource(file, `import { test } from "${runner}";`)).toEqual([]);
});

test.each([
  'export { test } from "vitest";',
  'await import("vitest");',
  'const runner = require("vitest/browser");',
])("runner boundary catches alternate imports %s", (source) => {
  expect(checkTestSource("packages/server/tests/wire.test.ts", source)).not.toHaveLength(0);
});
