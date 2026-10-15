import { expect, test } from "bun:test";
import { createRunCorrections } from "../../src/session/run-corrections.ts";

test("canonical identical calls warn at 3, 5 and 8; changed arguments break the sequence", () => {
  const state = createRunCorrections();
  state.enter("run:0", 0);
  const counts: number[] = [];
  for (let i = 1; i <= 9; i++) {
    const args = i % 2 ? { a: 1, b: { z: 2, y: 3 } } : { b: { y: 3, z: 2 }, a: 1 };
    if (state.tool("read", args, true).length) counts.push(i);
  }
  expect(counts).toEqual([3, 5, 8]);
  expect(state.tool("read", { a: 2 }, true)).toEqual([]);
});

test("no progress warns at 15, 25 and 40 and successful progress alone resets it", () => {
  const state = createRunCorrections();
  state.enter("run:0", 0);
  const warnings: { count: number; text: string }[] = [];
  for (let i = 1; i <= 40; i++)
    for (const text of state.tool("read", { path: i }, true)) warnings.push({ count: i, text });
  expect(warnings.map((item) => item.count)).toEqual([15, 25, 40]);
  expect(warnings[2]!.text).toContain("Do not modify files or change Todo merely to reset");
  state.enter("new:0", 0);
  for (let i = 0; i < 14; i++) state.tool("read", { path: i }, true);
  expect(state.tool("write", {}, false).join()).toContain("15 consecutive");
  state.tool("write", {}, true);
  for (let i = 0; i < 14; i++) expect(state.tool("read", { path: i }, true)).toEqual([]);
  expect(state.tool("read", { path: 15 }, true).join()).toContain("15 consecutive");
});

test.each(["write", "edit", "subagent", "subagent_fork", "exit_plan_mode", "ask_user_question"])(
  "successful %s resets stalled calls",
  (name) => {
    const state = createRunCorrections();
    state.enter("run:0", 0);
    for (let i = 0; i < 14; i++) state.tool("read", i, true);
    expect(state.tool(name, {}, true)).toEqual([]);
    expect(state.tool("read", 99, true)).toEqual([]);
  },
);

test("Todo only counts an increase in completed items as progress; scope changes reset every counter", () => {
  const state = createRunCorrections();
  state.enter("run:0", 1);
  for (let i = 0; i < 14; i++) state.tool("read", i, true);
  expect(state.tool("todo_write", { todos: [{ status: "completed" }] }, true).join()).toContain(
    "15 consecutive",
  );
  state.tool("todo_write", { todos: [{ status: "completed" }, { status: "completed" }] }, true);
  for (let i = 0; i < 14; i++) expect(state.tool("read", i, true)).toEqual([]);
  for (let i = 0; i < 3; i++) expect(state.length(false)).toContain("Shorten your reasoning");
  expect(state.length(true)).toBeUndefined();
  expect(state.limit(true)).toContain("summarize");
  expect(state.limit(true)).toBeUndefined();
  state.enter("run:compacted", 2);
  expect(state.tool("read", 13, true)).toEqual([]);
  expect(state.length(true)).toContain("Continue from the cutoff");
  expect(state.limit(true)).toContain("summarize");
});
