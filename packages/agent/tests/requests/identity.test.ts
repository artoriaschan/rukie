import { expect, test } from "bun:test";
import { parseRequestId, requestIds } from "../../src/requests/index.ts";
test("persisted Request identities retain activation and native task causality", () => {
  expect(parseRequestId(requestIds.goalRound("goal:g:activation:a", 12, 3))).toEqual({
    kind: "goal-round",
    id: "goal:g:activation:a:round:12:3",
    activation: "goal:g:activation:a",
    taskId: 12,
    round: 3,
  });
  expect(parseRequestId("subagent-send:27")).toEqual({
    kind: "subagent-send",
    id: "subagent-send:27",
    toolTaskId: 27,
  });
  expect(parseRequestId("subagent:12:report")).toEqual({
    kind: "subagent-report",
    id: "subagent:12:report",
    taskId: 12,
  });
});
