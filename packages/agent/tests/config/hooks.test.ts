import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { loadSettings } from "../../src/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import type { HooksSettings } from "@rukie/shared";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test("loading a non-tool event with if warns and preserves distinct filtered handlers", async () => {
  dirs = await tempDirs();
  const command = "echo ran";
  await Bun.write(
    join(dirs.homeDir, ".rukie/settings.json"),
    JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: "command", command, if: "bash" }] }],
        PreToolUse: [
          {
            hooks: [
              { type: "command", command, if: "bash(one *)" },
              { type: "command", command, if: "bash(two *)" },
              { type: "command", command, if: "bash(one *)" },
            ],
          },
        ],
      },
    }),
  );
  const { settings, warnings, hookWarnings } = await loadSettings(dirs);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain("/hooks/SessionStart/0/hooks/0/if");
  expect(warnings[0]).toContain("never run");
  expect(hookWarnings).toMatchObject([
    {
      type: "hook_warning",
      event: "SessionStart",
      hook: command,
      message: warnings[0],
      error: {
        code: "hook-if-nontool",
        params: {
          source: `${join(dirs.homeDir, ".rukie/settings.json")}: /hooks/SessionStart/0/hooks/0/if`,
          event: "SessionStart",
        },
      },
    },
  ]);
  expect(settings.hooks?.PreToolUse?.[0]?.hooks).toHaveLength(2);
});

test.each([false, true])(
  "project hooks require trust and identical handlers run once: %s",
  async (trusted) => {
    dirs = await tempDirs();
    const repeated = { type: "command", command: "echo user" };
    await Bun.write(
      join(dirs.homeDir, ".rukie/settings.json"),
      JSON.stringify({
        trustedProjects: trusted ? [dirs.cwd] : [],
        hooks: { PreToolUse: [{ matcher: "bash", hooks: [repeated] }] },
      }),
    );
    await Bun.write(
      join(dirs.cwd, ".rukie/settings.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: "bash", hooks: [repeated, { type: "command", command: "echo project" }] },
          ],
        },
      }),
    );
    const { settings, warnings } = await loadSettings(dirs);
    expect(settings).toMatchObject({
      hooks: {
        PreToolUse: trusted
          ? [
              { matcher: "bash", hooks: [repeated] },
              { matcher: "bash", hooks: [{ type: "command", command: "echo project" }] },
            ]
          : [{ matcher: "bash", hooks: [repeated] }],
      },
    });
    expect(warnings.length).toBe(trusted ? 0 : 1);
    if (!trusted) expect(warnings[0]).toContain('ignoring "hooks"');
  },
);

test.each([
  ["Unknown", [{ hooks: [] }]],
  ["PreToolUse", [{ matcher: "[", hooks: [] }]],
  ["PreToolUse", [{ extra: true, hooks: [] }]],
  ["PreToolUse", [{ hooks: [{ type: "command", command: "echo", typo: true }] }]],
  ["PreToolUse", [{ hooks: [{ type: "command", command: "echo", timeout: 0 }] }]],
  ["PreToolUse", [{ hooks: [{ type: "command", command: "echo", if: "bash(" }] }]],
])("invalid hooks report their settings source and location: %s", async (event, groups) => {
  dirs = await tempDirs();
  const source = join(dirs.homeDir, ".rukie/settings.json");
  await Bun.write(source, JSON.stringify({ hooks: { [event as string]: groups } }));
  await expect(loadSettings(dirs)).rejects.toThrow(`${source}: /hooks`);
});

test("the complete hook schema accepts all events and handler types", async () => {
  dirs = await tempDirs();
  const hooks: HooksSettings = {
    PreToolUse: [
      {
        matcher: "bash|write,edit",
        hooks: [
          {
            type: "command",
            command: "echo",
            args: [],
            shell: "bash",
            async: true,
            asyncRewake: true,
            timeout: 0.1,
            if: "bash(git push *)",
            statusMessage: "checking",
          },
        ],
      },
    ],
    PermissionRequest: [
      {
        hooks: [
          {
            type: "http",
            url: "https://example.com",
            headers: { Authorization: "$TOKEN" },
            allowedEnvVars: ["TOKEN"],
          },
        ],
      },
    ],
    PermissionDenied: [
      {
        hooks: [
          {
            type: "mcp_tool",
            server: "local",
            tool: "check",
            input: { text: "${tool_input.command}" },
          },
        ],
      },
    ],
    PostToolUse: [{ hooks: [{ type: "prompt", prompt: "$ARGUMENTS", model: "test/review" }] }],
    PostToolUseFailure: [{ hooks: [{ type: "agent", prompt: "verify" }] }],
    UserPromptSubmit: [],
    SessionStart: [],
    Stop: [],
    SubagentStart: [],
    SubagentStop: [],
    PreCompact: [],
    PostCompact: [],
    SessionEnd: [],
    Notification: [],
  };
  await Bun.write(join(dirs.homeDir, ".rukie/settings.json"), JSON.stringify({ hooks }));
  const { settings } = await loadSettings(dirs);
  expect(settings.hooks?.PreToolUse).toEqual(hooks.PreToolUse);
  expect(settings.hooks?.PermissionDenied).toEqual(hooks.PermissionDenied);
});
