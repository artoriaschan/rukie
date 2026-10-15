import { expect, test } from "vitest";
import type { WireProject, WireSessionSummary } from "@rukie/shared";
import { sessionGroups } from "../../src/lib/session-groups";

const project = (id: string): WireProject => ({
  id,
  name: id,
  directories: [`/${id}`],
  primary: `/${id}`,
  trusted: true,
});
const session = (id: string, projectId: string | null): WireSessionSummary => ({
  id,
  title: id,
  titleSource: "prompt",
  cwd: "/",
  projectId,
  worktree: null,
  createdAt: 1,
  updatedAt: 1,
  messageCount: 1,
  model: "test/script",
});

test("pinned Projects move to Pinned in pin order with their unpinned Sessions", () => {
  const projects = [project("a"), project("b"), project("c")];
  const sessions = [
    session("a1", "a"),
    session("a2", "a"),
    session("b1", "b"),
    session("c1", "c"),
    session("loose", null),
  ];
  const groups = sessionGroups(sessions, projects, ["a2"], ["c1"], ["c", "removed", "a"]);
  expect(groups.pinnedProjects.map(({ project, sessions }) => [project.id, sessions])).toEqual([
    ["c", []],
    ["a", [sessions[0]]],
  ]);
  expect(groups.projects.map(({ project }) => project.id)).toEqual(["b"]);
  expect(groups.pinned).toEqual([sessions[1]]);
  expect(groups.conversations).toEqual([sessions[4]]);
});

test("without pinned Projects every Project stays in Projects", () => {
  const groups = sessionGroups([], [project("a")], []);
  expect(groups.pinnedProjects).toEqual([]);
  expect(groups.projects.map(({ project }) => project.id)).toEqual(["a"]);
});
