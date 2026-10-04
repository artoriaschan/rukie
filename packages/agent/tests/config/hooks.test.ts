import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { loadSettings } from "../../src/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import type { HooksSettings } from "@neant/shared";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test.each([false, true])(
  "project hooks require trust and identical handlers run once: %s",
  async (trusted) => {
    dirs = await tempDirs();
    const repeated = { type: "command", command: "echo user" };
    await Bun.write(
      join(dirs.homeDir, ".neant/settings.json"),
      JSON.stringify({
        trustedProjects: trusted ? [dirs.cwd] : [],
        hooks: { PreToolUse: [{ matcher: "bash", hooks: [repeated] }] },
      }),
    );
    await Bun.write(
      join(dirs.cwd, ".neant/settings.json"),
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
  const source = join(dirs.homeDir, ".neant/settings.json");
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
  await Bun.write(join(dirs.homeDir, ".neant/settings.json"), JSON.stringify({ hooks }));
  const { settings } = await loadSettings(dirs);
  expect(settings.hooks?.PreToolUse).toEqual(hooks.PreToolUse);
  expect(settings.hooks?.PermissionDenied).toEqual(hooks.PermissionDenied);
});
