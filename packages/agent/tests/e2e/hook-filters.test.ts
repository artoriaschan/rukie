import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { realpath, symlink } from "node:fs/promises";
import type { HookEvent, HooksSettings } from "@neant/shared";
import type { SessionEvent } from "../../src/index.ts";
import { createSession } from "../../src/index.ts";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test.each([
  ["printf guarded", true],
  ["printf ordinary", false],
  ["printf ordinary && printf guarded", true],
])("handler if selects bash command %s", async (command, matched) => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("bash", { command }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: {
      hooks: {
        PreToolUse: [
          {
            hooks: [
              { type: "command", command: "echo ran > hook-ran", if: "bash(printf guarded)" },
            ],
          },
        ],
      },
    },
  });
  await session.run("try");
  expect(await Bun.file(join(dirs.cwd, "hook-ran")).exists()).toBe(matched);
  await session.dispose();
});

test.each([
  ["nested/../guarded.txt", "read(./guarded.txt)", true],
  ["ordinary.txt", "read(./guarded.txt)", false],
  ["~/guarded.txt", "read(~/guarded.txt)", true],
  ["alias.txt", "read(guarded.txt)", true],
] as const)("handler if normalizes read path %s", async (path, filter, matched) => {
  dirs = await tempDirs();
  dirs = { ...dirs, cwd: await realpath(dirs.cwd), homeDir: await realpath(dirs.homeDir) };
  await Bun.write(join(dirs.cwd, "nested/.keep"), "");
  await Bun.write(join(dirs.cwd, "guarded.txt"), "guarded");
  await Bun.write(join(dirs.cwd, "ordinary.txt"), "ordinary");
  await Bun.write(join(dirs.homeDir, "guarded.txt"), "home");
  await symlink(join(dirs.cwd, "guarded.txt"), join(dirs.cwd, "alias.txt"));
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("read", { path }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: {
        PreToolUse: [{ hooks: [{ type: "command", command: "echo ran > hook-ran", if: filter }] }],
      },
    },
  });
  await session.run("read");
  expect(await Bun.file(join(dirs.cwd, "hook-ran")).exists()).toBe(matched);
  await session.dispose();
});

test("the same command with distinct if rules runs separately while exact repeats run once", async () => {
  dirs = await tempDirs();
  const command = "echo ran >> count";
  const handler = { type: "command" as const, command, if: "bash(printf *)" };
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("bash", { command: "printf guarded" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: {
      hooks: {
        PreToolUse: [
          { hooks: [handler, { ...handler, if: "bash(printf guarded)" }] },
          { matcher: "bash", hooks: [handler] },
        ],
      },
    },
  });
  await session.run("try");
  expect(await Bun.file(join(dirs.cwd, "count")).text()).toBe("ran\nran\n");
  await session.dispose();
});

test("if on every non-tool event warns at session load and never executes", async () => {
  dirs = await tempDirs();
  const events: HookEvent[] = [
    "SessionStart",
    "UserPromptSubmit",
    "Stop",
    "SessionEnd",
    "SubagentStart",
    "SubagentStop",
    "PreCompact",
    "PostCompact",
    "Notification",
  ];
  const hooks: HooksSettings = {};
  for (const event of events)
    hooks[event] = [
      { hooks: [{ type: "command", command: "echo ran >> unexpected", if: "bash" }] },
    ];
  const warnings: string[] = [];
  const emitted: SessionEvent[] = [];
  const fake = fakeModel([fauxAssistantMessage("done")]);
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: { hooks },
    onWarning: (warning) => {
      warnings.push(warning);
    },
  });
  expect(warnings).toHaveLength(events.length);
  await session.run("try", {
    onEvent: (event) => {
      emitted.push(event);
    },
  });
  await session.dispose();
  expect(await Bun.file(join(dirs.cwd, "unexpected")).exists()).toBe(false);
  const diagnostics = emitted.filter((event) => event.type === "hook_warning");
  expect(diagnostics).toHaveLength(events.length);
  for (const event of events)
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        event,
        error: {
          code: "hook-if-nontool",
          params: { source: `settings: /hooks/${event}/0/hooks/0/if`, event },
        },
      }),
    );
});
