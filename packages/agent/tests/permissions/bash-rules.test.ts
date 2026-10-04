import { expect, test } from "bun:test";
import { evaluatePermissionRules, parsePermissionRules } from "../../src/permissions/index.ts";

function evaluate(command: string, permissions: Parameters<typeof parsePermissionRules>[0]) {
  return evaluatePermissionRules({
    rules: parsePermissionRules(permissions),
    toolName: "bash",
    args: { command },
    cwd: "/project",
    homeDir: "/home",
  });
}

test.each(["&&", "||", ";", "|", "&", "\n"])(
  "bash allow requires every segment separated by %j",
  (separator) => {
    const command = `git status ${separator} head`;
    expect(evaluate(command, { allow: ["bash(git status*)"] })).toBeUndefined();
    expect(evaluate(command, { allow: ["bash(git status*)", "bash(head)"] })).toEqual({
      decision: "allow",
      rule: "bash(git status*)",
    });
    expect(evaluate(command, { allow: ["bash"] })).toEqual({ decision: "allow", rule: "bash" });
  },
);

test("whole compound allow does not cover otherwise unallowed segments", () => {
  expect(evaluate("git status | head", { allow: ["bash(git status | head)"] })).toBeUndefined();
});

test.each([
  "echo $(pwd)",
  "echo `pwd`",
  "cat <(printf ok)",
  "cat >(printf ok)",
  "cat <<EOF\nhello\nEOF",
  'echo "unclosed',
  "echo 'unclosed",
  "echo '$(pwd)'",
  String.raw`echo \$(pwd)`,
])("uncertain bash syntax %j skips even bare tool allow rules", (command) => {
  expect(evaluate(command, { allow: ["bash(*)", "bash", "*"] })).toBeUndefined();
});

test.each([
  'echo "a && b; c | d & e"',
  "echo 'a && b; c | d & e'",
  'echo "a\nb"',
  String.raw`echo a\;b\|c\&d`,
  String.raw`echo "quoted\""`,
])("quoted or escaped separators in %j stay in one allowed segment", (command) => {
  expect(evaluate(command, { allow: ["bash(echo*)"] })).toEqual({
    decision: "allow",
    rule: "bash(echo*)",
  });
  expect(
    evaluate(command, { deny: ["bash(b*)", "bash(c*)", "bash(d*)", "bash(e *)"] }),
  ).toBeUndefined();
});

test.each([
  'echo "safe; rm -rf x"',
  "echo 'safe; rm -rf x'",
  String.raw`echo safe\; rm -rf x`,
  String.raw`echo "safe\"; rm -rf x"`,
  "echo safe\\\nrm -rf x",
])("deny does not split protected separators in %j", (command) => {
  expect(evaluate(command, { deny: ["bash(rm -rf *)"] })).toBeUndefined();
});

test.each([String.raw`echo 'safe\'; rm -rf x`, String.raw`echo safe\\; rm -rf x`])(
  "literal backslashes do not hide the next real separator in %j",
  (command) => {
    expect(evaluate(command, { deny: ["bash(rm -rf *)"] })).toEqual({
      decision: "deny",
      rule: "bash(rm -rf *)",
    });
  },
);

test.each([
  "echo $(pwd); git push origin",
  "echo `pwd`; git push origin",
  "cat <(pwd); git push origin",
  "cat >(pwd); git push origin",
  "cat <<EOF\nEOF\ngit push origin",
  'echo ok; git push "unclosed',
])("uncertain syntax still matches deny and ask against segments: %j", (command) => {
  expect(evaluate(command, { allow: ["bash"], ask: ["bash(git push*)"] })).toEqual({
    decision: "ask",
    rule: "bash(git push*)",
  });
  expect(evaluate(command, { ask: ["bash"], deny: ["bash(git push*)"] })).toEqual({
    decision: "deny",
    rule: "bash(git push*)",
  });
});

test.each(["deny", "ask"] as const)("%s also matches the whole command", (decision) => {
  expect(evaluate("git status | head", { [decision]: ["bash(git status | head)"] })).toEqual({
    decision,
    rule: "bash(git status | head)",
  });
});

test("most restrictive match wins across different segments and rule order", () => {
  expect(
    evaluate("git push origin && rm -rf /tmp/cache", {
      allow: ["bash"],
      ask: ["bash(git push*)"],
      deny: ["bash(rm -rf *)"],
    }),
  ).toEqual({ decision: "deny", rule: "bash(rm -rf *)" });
});

test("empty separator fragments never satisfy allow by themselves", () => {
  expect(evaluate(" ; | && \n", { allow: ["bash"] })).toBeUndefined();
  expect(evaluate("git status;\n", { allow: ["bash(git status)"] })).toEqual({
    decision: "allow",
    rule: "bash(git status)",
  });
});
