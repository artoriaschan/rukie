import { expect, test } from "vitest";
import { readGoal } from "../../src/lib/goal";
const goal = {
  id: "goal",
  objective: "target",
  attachments: 0,
  elapsedMs: 2000,
  activeSince: 1000,
  phase: "active",
  armed: true,
  roundsStarted: 1,
  maxRounds: 10,
};
test("Goal presentation reader accepts current published shape and rejects invalid or unsupported Tool State", () => {
  expect(readGoal(goal)).toEqual(goal);
  expect(readGoal({ ...goal, objective: "", attachments: 2 })).toMatchObject({ attachments: 2 });
  for (const invalid of [
    null,
    [],
    "goal",
    { ...goal, version: 1 },
    { ...goal, id: "" },
    { ...goal, objective: "", attachments: 0 },
    { ...goal, attachments: 1.5 },
    { ...goal, elapsedMs: NaN },
    { ...goal, elapsedMs: -1 },
    { ...goal, activeSince: Infinity },
    { ...goal, activeSince: -1 },
    { ...goal, armed: false },
    { ...goal, phase: "paused" },
    { ...goal, phase: "blocked", armed: false, activeSince: undefined },
    { ...goal, roundsStarted: 11 },
    { ...goal, maxRounds: 0 },
    { ...goal, armed: "yes" },
    { ...goal, blockedReason: "unexpected" },
  ])
    expect(readGoal(invalid)).toBeUndefined();
  expect(
    readGoal({
      ...goal,
      phase: "blocked",
      armed: false,
      activeSince: undefined,
      blockedReason: "Need input",
    }),
  ).toMatchObject({ phase: "blocked" });
});
