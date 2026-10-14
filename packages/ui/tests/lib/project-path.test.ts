import { expect, test } from "vitest";
import { projectPath } from "../../src/lib/project-path";

test.each([
  ["/actual/home", "/actual/home", "~"],
  ["/actual/home/repo", "/actual/home/", "~/repo"],
  ["/actual/home-other/repo", "/actual/home", "/actual/home-other/repo"],
  ["/custom/home/repo", "/actual/home", "/custom/home/repo"],
  ["/repo", "/", "~/repo"],
  ["/", "/", "~"],
  ["/repo", null, "/repo"],
  ["/home/name\\suffix/repo", "/home", "~/name\\suffix/repo"],
  ["C:\\", "C:\\", "~"],
  ["C:\\repo", "C:\\", "~/repo"],
  ["C:\\Users\\Ada", "c:\\users\\ada\\", "~"],
  ["C:\\Users\\Ada\\repo", "c:\\users\\ada", "~/repo"],
  ["C:/Users/Ada/repo", "C:\\Users\\Ada", "~/repo"],
  ["C:\\Users\\Ada-other\\repo", "C:\\Users\\Ada", "C:\\Users\\Ada-other\\repo"],
])("Project path %s abbreviates against the supplied home identity", (path, home, expected) => {
  expect(projectPath(path, home)).toBe(expected);
});
