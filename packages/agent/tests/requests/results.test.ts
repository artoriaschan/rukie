import { expect, test } from "bun:test";
import { readGoalReceipt } from "../../src/tools/goal/index.ts";
import { readSubagentReceipt } from "../../src/tools/subagents/index.ts";
import { assembleRequestResult } from "../../src/requests/index.ts";

const usage = { input: 3, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 8 };
const result = { requestId: "human:h", text: "parent", success: true, durationMs: 7, usage };
test("Goal and Subagent receipt rules preserve separate provider spend and parent answer", () => {
  expect(readGoalReceipt({ ...result, text: "goal" }, "goal:g")).toEqual({
    ...result,
    requestId: "goal:g",
    text: "goal",
  });
  expect(readGoalReceipt(undefined, "goal:g")).toBeUndefined();
  expect(readSubagentReceipt({ parentAnswer: 12, usage })).toEqual({ parentAnswer: 12, usage });
  expect(readSubagentReceipt(null)).toEqual({
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
  });
  expect(() => readGoalReceipt({ ...result, usage: { ...usage, input: -1 } }, "goal:g")).toThrow(
    "Invalid persisted request usage",
  );
});
test("pure Request assembly takes final Goal outcome while keeping deduplicated spend", () => {
  expect(
    assembleRequestResult({
      result,
      text: "parent report",
      usage,
      goals: [{ ...result, text: "goal", durationMs: 11 }],
      entries: [],
    }),
  ).toEqual({ ...result, text: "goal", durationMs: 18 });
  expect(
    assembleRequestResult({
      result,
      text: "parent report",
      usage,
      goals: [undefined],
      entries: [],
    }),
  ).toMatchObject({ text: "parent report", success: false, error: "Goal continuation cancelled" });
});
