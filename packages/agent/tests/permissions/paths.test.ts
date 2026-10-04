import { afterEach, expect, test } from "bun:test";
import { realpath, symlink } from "node:fs/promises";
import { join } from "node:path";
import {
  evaluatePermissionRules,
  parsePermissionRules,
  resolvePermissionPath,
} from "../../src/permissions/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test.each([
  ["read", "~/.ssh/**", { path: "~/.ssh/key" }, "deny"],
  ["read", "~/.ssh/**", { path: "/neant-test-home/user/.ssh/key" }, "deny"],
  ["edit", "src/**", { path: "src/module.ts" }, "allow"],
  ["write", "src/**", { path: "./src/new/deep/module.ts" }, "allow"],
  ["write", "src/**", { path: "/project/src/new.ts" }, "ask"],
  ["read", "/other/**", { path: "../other/file" }, "deny"],
  ["edit", "src/**", { path: "src/../outside/file" }, undefined],
  ["read", "src/*.ts", { path: "src/nested/file.ts" }, undefined],
  ["read", "src/**", { path: "src/.secret" }, "deny"],
  ["glob", ".", { pattern: "**/*.ts" }, "deny"],
  ["grep", ".", { pattern: "secret" }, "ask"],
  ["glob", "src/**", { path: "src/sub", pattern: "*" }, "allow"],
  ["grep", "src/**", { path: "src/file.ts", pattern: "text" }, "deny"],
  ["read", "src/**", { path: "/other/file" }, undefined],
] as const)("file rule %s(%s) matches %j with %s", (toolName, pattern, args, decision) => {
  const configuredDecision = decision ?? "deny";
  const raw = `${toolName}(${pattern})`;
  expect(
    evaluatePermissionRules({
      rules: parsePermissionRules({ [configuredDecision]: [raw] }),
      toolName,
      args,
      cwd: "/project",
      homeDir: "/neant-test-home/user",
    }),
  ).toEqual(decision ? { decision, rule: raw } : undefined);
});

test.each(["skill", "todo_write", "ask_user_question", "mcp__files__read"])(
  "%s cannot use a file path specifier",
  (tool) => {
    const raw = `${tool}(src/**)`;
    expect(() => parsePermissionRules({ deny: [raw] }, "/config/settings.json")).toThrow(
      `/config/settings.json: invalid permission rule ${JSON.stringify(raw)}`,
    );
  },
);

test("file rules only match their named tool and preserve deny > ask > allow", () => {
  const input = {
    toolName: "write",
    args: { path: "src/new.ts" },
    cwd: "/project",
    homeDir: "/home",
  };
  expect(
    evaluatePermissionRules({ ...input, rules: parsePermissionRules({ deny: ["read(src/**)"] }) }),
  ).toBeUndefined();
  expect(
    evaluatePermissionRules({
      ...input,
      rules: parsePermissionRules({
        allow: ["write(src/**)"],
        ask: ["write(src/**)"],
        deny: ["write(src/**)"],
      }),
    }),
  ).toEqual({ decision: "deny", rule: "write(src/**)" });
  expect(
    evaluatePermissionRules({
      ...input,
      rules: parsePermissionRules({
        allow: ["write(src/**)"],
        ask: ["write(src/**)"],
      }),
    }),
  ).toEqual({ decision: "ask", rule: "write(src/**)" });
});

test.each(["read", "edit", "write", "glob", "grep"])(
  "%s restrictions see both symlink paths; allow sees only realpath",
  async (toolName) => {
    dirs = await tempDirs();
    const cwd = await realpath(dirs.cwd);
    const homeDir = await realpath(dirs.homeDir);
    await Bun.write(join(homeDir, ".ssh/key"), "secret");
    await symlink(join(homeDir, ".ssh"), join(cwd, "linked"));
    for (const path of ["linked/key", "linked/missing/deep/key"]) {
      const input = { toolName, args: { path }, cwd, homeDir };
      expect(resolvePermissionPath(input)).toEqual({
        resolvedPath: join(cwd, path),
        realPath: join(homeDir, ".ssh", path === "linked/key" ? "key" : "missing/deep/key"),
      });
      for (const decision of ["deny", "ask"] as const) {
        for (const pattern of ["linked/**", "~/.ssh/**"]) {
          const rule = `${toolName}(${pattern})`;
          expect(
            evaluatePermissionRules({
              ...input,
              rules: parsePermissionRules({ [decision]: [rule] }),
            }),
          ).toEqual({ decision, rule });
        }
      }
      expect(
        evaluatePermissionRules({
          ...input,
          rules: parsePermissionRules({ allow: [`${toolName}(${cwd}/**)`] }),
        }),
      ).toBeUndefined();
      const rule = `${toolName}(~/.ssh/**)`;
      expect(
        evaluatePermissionRules({ ...input, rules: parsePermissionRules({ allow: [rule] }) }),
      ).toEqual({ decision: "allow", rule });
    }
  },
);

test.each(["glob", "grep"])("%s defaults to canonical cwd through a symlink", async (toolName) => {
  dirs = await tempDirs();
  const cwd = await realpath(dirs.cwd);
  const homeDir = await realpath(dirs.homeDir);
  await symlink(cwd, join(homeDir, "project-alias"));
  const input = { toolName, args: { pattern: "*" }, cwd: join(homeDir, "project-alias"), homeDir };
  expect(resolvePermissionPath(input)).toEqual({
    resolvedPath: join(homeDir, "project-alias"),
    realPath: cwd,
  });
  const rule = `${toolName}(${cwd})`;
  expect(
    evaluatePermissionRules({ ...input, rules: parsePermissionRules({ deny: [rule] }) }),
  ).toEqual({ decision: "deny", rule });
});

test("a dangling file symlink cannot borrow a project allow for a new outside file", async () => {
  dirs = await tempDirs();
  const cwd = await realpath(dirs.cwd);
  const homeDir = await realpath(dirs.homeDir);
  await symlink(join(homeDir, "new-secret"), join(cwd, "linked-file"));
  const input = { toolName: "write", args: { path: "linked-file" }, cwd, homeDir };
  expect(resolvePermissionPath(input)).toEqual({
    resolvedPath: join(cwd, "linked-file"),
    realPath: join(homeDir, "new-secret"),
  });
  expect(
    evaluatePermissionRules({ ...input, rules: parsePermissionRules({ allow: ["write(./**)"] }) }),
  ).toBeUndefined();
  const rule = "write(~/new-secret)";
  expect(
    evaluatePermissionRules({ ...input, rules: parsePermissionRules({ deny: [rule] }) }),
  ).toEqual({ decision: "deny", rule });
});
