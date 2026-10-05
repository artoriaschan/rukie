import { expect, test } from "bun:test";
import { evaluatePermissionRules, parsePermissionRules } from "../../src/permissions/index.ts";

test.each([
  [
    { allow: ["mcp__github__*"] },
    "mcp__github__list",
    {},
    { decision: "allow", rule: "mcp__github__*" },
  ],
  [{ deny: ["read"] }, "read", { path: "file" }, { decision: "deny", rule: "read" }],
  [
    { allow: ["bash(git status*)"] },
    "bash",
    { command: "  git status --short  " },
    { decision: "allow", rule: "bash(git status*)" },
  ],
  [
    { deny: ["bash(rm -rf *)"] },
    "bash",
    { command: "rm -rf a b" },
    { decision: "deny", rule: "bash(rm -rf *)" },
  ],
  [{ allow: ["bash(git status*)"] }, "bash", { command: "echo ok && git status" }, undefined],
  [
    { allow: ["bash"], ask: ["bash(git*)"], deny: ["bash(git push*)"] },
    "bash",
    { command: "git push origin" },
    { decision: "deny", rule: "bash(git push*)" },
  ],
  [
    { allow: ["bash"], ask: ["bash(git*)"] },
    "bash",
    { command: "git status" },
    { decision: "ask", rule: "bash(git*)" },
  ],
  [
    { allow: ["read(src/**)"] },
    "read",
    { path: "src/index.ts" },
    { decision: "allow", rule: "read(src/**)" },
  ],
  [
    { deny: ["bash(rm -rf *)"] },
    "bash",
    { command: "rm -rf /tmp/cache" },
    { decision: "deny", rule: "bash(rm -rf *)" },
  ],
  [
    { deny: ["bash(rm -rf *)"] },
    "bash",
    { command: "echo ok; rm -rf x" },
    { decision: "deny", rule: "bash(rm -rf *)" },
  ],
] as const)("permission rule %j matches %s %j", (rules, toolName, args, expected) => {
  expect(
    evaluatePermissionRules({
      rules: parsePermissionRules(rules),
      toolName,
      args,
      cwd: "/project",
      homeDir: "/home",
    }),
  ).toEqual(expected);
});

test.each(["&&", "||", ";", "|", "&", "\n"])(
  "bash deny sees a dangerous segment after %j",
  (separator) => {
    expect(
      evaluatePermissionRules({
        rules: parsePermissionRules({ deny: ["bash(rm -rf *)"], allow: ["bash"] }),
        toolName: "bash",
        args: { command: `git status ${separator} rm -rf /tmp/cache` },
        cwd: "/project",
        homeDir: "/home",
      }),
    ).toEqual({ decision: "deny", rule: "bash(rm -rf *)" });
  },
);

test.each([
  "",
  "  ",
  "bash(",
  "bash(echo",
  "bash()",
  "unknown(pattern)",
  "mcp__x(pattern)",
  "read(x))",
  "bash)foo",
])("invalid rule %j names its source and original text", (rule) => {
  expect(() => parsePermissionRules({ allow: [rule] }, "/home/.neant/settings.json")).toThrow(
    `/home/.neant/settings.json: invalid permission rule ${JSON.stringify(rule)}`,
  );
});

test("file specifiers retain their original text for denial feedback", () => {
  expect(parsePermissionRules({ deny: ["read(~/.ssh/**)"] })).toEqual([
    { decision: "deny", kind: "path", tool: "read", pattern: "~/.ssh/**", raw: "read(~/.ssh/**)" },
  ]);
});

test.each([
  ["web_fetch(domain:docs.python.org)", "https://docs.python.org/3/", true],
  ["web_fetch(domain:DOCS.PYTHON.ORG.)", "https://Docs.Python.Org./3/", true],
  ["web_fetch(domain:docs.python.org)", "https://sub.docs.python.org/", false],
  ["web_fetch(domain:*.b)", "https://a.b/page", true],
  ["web_fetch(domain:*.B.)", "https://A.C.B./page", true],
  ["web_fetch(domain:*.b)", "https://b/page", false],
  ["web_fetch(domain:*.b)", "https://notb/page", false],
  ["web_fetch(domain:*.b)", "https://a.b.evil/page", false],
  ["web_fetch(domain:[2606:4700:4700:0000::1111])", "https://[2606:4700:4700::1111]/", true],
  ["web_fetch", "https://any.test/page", true],
] as const)("web rule %s matches %s: %s", (rule, url, matches) => {
  expect(
    evaluatePermissionRules({
      rules: parsePermissionRules({ allow: [rule] }),
      toolName: "web_fetch",
      args: { url },
      cwd: "/project",
      homeDir: "/home",
    }),
  ).toEqual(matches ? { decision: "allow", rule } : undefined);
});

test.each([
  "web_fetch(https://site.test)",
  "web_fetch(site.test)",
  "web_fetch(domain:)",
  "web_fetch(domain:*)",
  "web_fetch(domain:foo*.test)",
  "web_fetch(domain:site.test/path)",
  "web_fetch(domain:site.test:80)",
  "web_fetch(domain:user@site.test)",
  "web_fetch(domain:site..test)",
  "web_fetch(domain: site.test)",
])("invalid web specifier %s fails at startup", (rule) => {
  expect(() => parsePermissionRules({ allow: [rule] })).toThrow("invalid permission rule");
});
