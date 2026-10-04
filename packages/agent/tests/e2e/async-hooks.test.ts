import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { createSession, type Session, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
let session: Session | undefined;
const hookPids: number[] = [];
afterEach(async () => {
  await session?.dispose();
  for (const pid of hookPids.splice(0)) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* Already stopped. */
    }
  }
  session = undefined;
  await dirs?.cleanup();
});

test("async hooks do not block tools or obey timeout and inject completed output before the next model call", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "hook.sh"),
    `cat > hook-input
while [ ! -f release ]; do sleep 0.01; done
echo '{"continue":false,"systemMessage":"background notice","hookSpecificOutput":{"permissionDecision":"deny","additionalContext":"background context"}}'
`,
  );
  const completed = Promise.withResolvers<void>();
  const warnings: string[] = [];
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("bash", { command: "touch release" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("first done"),
    fauxAssistantMessage("second done"),
  ]);
  session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    onWarning: (warning) => {
      warnings.push(warning);
    },
    settings: {
      hooks: {
        PreToolUse: [
          {
            matcher: "bash",
            hooks: [{ type: "command", command: "sh hook.sh", async: true, timeout: 0.001 }],
          },
        ],
      },
    },
  });
  const first = await session.run("first", {
    onEvent: (event) => {
      if (event.type === "hook_message") completed.resolve();
    },
  });
  expect(first).toMatchObject({ success: true });
  expect(await Bun.file(join(dirs.cwd, "release")).exists()).toBe(true);
  expect(warnings).toEqual([]);
  await completed.promise;
  await session.run("second");
  expect(JSON.stringify(fake.contexts[2]!.messages)).toContain("background context");
  expect(JSON.stringify(fake.contexts[2]!.messages)).toContain("background notice");
  expect(
    session.messages.filter(
      (message) => message.role === "system-reminder" && message.source === "async-hook",
    ),
  ).toHaveLength(2);
});

test("asyncRewake steers an active run with stderr without submitting a user prompt", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "rewake.sh"),
    `cat > hook-input
while [ ! -f release ]; do sleep 0.01; done
echo '{"systemMessage":"check finished","hookSpecificOutput":{"additionalContext":"check detail"}}'
echo 'repair the background failure' >&2
exit 2
`,
  );
  const completed = Promise.withResolvers<void>();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("bash", { command: "touch release" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("repaired"),
  ]);
  session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: {
      hooks: {
        PreToolUse: [
          {
            matcher: "bash",
            hooks: [{ type: "command", command: "sh rewake.sh", asyncRewake: true }],
          },
        ],
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "cat >> prompts" }] }],
      },
    },
  });
  const result = await session.run("start", {
    onEvent: async (event) => {
      if (event.type === "hook_message") completed.resolve();
      if (event.type === "tool_execution_end") await completed.promise;
    },
  });
  expect(result.text).toBe("repaired");
  expect(fake.contexts).toHaveLength(2);
  expect(JSON.stringify(fake.contexts[1]!.messages)).toContain("repair the background failure");
  expect(JSON.stringify(fake.contexts[1]!.messages)).toContain("check detail");
  expect((await Bun.file(join(dirs.cwd, "prompts")).text()).match(/hook_event_name/g)).toHaveLength(
    1,
  );
});

test("asyncRewake starts an idle run and retains its observer without submitting a user prompt", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "rewake.sh"),
    `cat > hook-input
while [ ! -f release ]; do sleep 0.01; done
echo 'idle background failure' >&2
exit 2
`,
  );
  const rewoken = Promise.withResolvers<void>();
  let results = 0;
  const fake = fakeModel([
    fauxAssistantMessage("first done"),
    fauxAssistantMessage("idle repaired"),
  ]);
  session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "sh rewake.sh", asyncRewake: true }] },
        ],
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "cat >> prompts" }] }],
      },
    },
  });
  await session.run("start", {
    onEvent: (event) => {
      if (event.type === "result" && ++results === 2) rewoken.resolve();
    },
  });
  expect(fake.contexts).toHaveLength(1);
  await Bun.write(join(dirs.cwd, "release"), "");
  await rewoken.promise;
  expect(fake.contexts).toHaveLength(2);
  expect(JSON.stringify(fake.contexts[1]!.messages)).toContain("idle background failure");
  expect((await Bun.file(join(dirs.cwd, "prompts")).text()).match(/hook_event_name/g)).toHaveLength(
    1,
  );
});

async function hookProcess() {
  const pid = Number(await Bun.file(join(dirs.cwd, "hook.pid")).text());
  hookPids.push(pid);
  return pid;
}
async function waitForExit(pid: number) {
  await Bun.spawn(["sh", "-c", `while kill -0 ${pid} 2>/dev/null; do sleep 0.01; done`]).exited;
}

test("dispose stops a background hook that outlives its run", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "hook.sh"),
    `cat > hook-input
echo $$ > hook.pid
while [ ! -f release ]; do sleep 0.01; done
touch forbidden-after-dispose
`,
  );
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("bash", { command: "while [ ! -f hook.pid ]; do sleep 0.01; done" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: {
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "sh", args: ["hook.sh"], async: true }] },
        ],
      },
    },
  });
  await session.run("start");
  const pid = await hookProcess();
  process.kill(pid, 0);
  await session.dispose();
  await waitForExit(pid);
  await Bun.write(join(dirs.cwd, "release"), "");
  expect(await Bun.file(join(dirs.cwd, "forbidden-after-dispose")).exists()).toBe(false);
});

test("parent disposal stops a completed subagent's background hook", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "hook.sh"),
    `input=$(cat)
case "$input" in *agent_id*) ;; *) exit 0 ;; esac
echo $$ > hook.pid
while [ ! -f release ]; do sleep 0.01; done
touch forbidden-after-dispose
`,
  );
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", { description: "child", prompt: "start", run_in_background: false }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("bash", { command: "while [ ! -f hook.pid ]; do sleep 0.01; done" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("child done"),
    fauxAssistantMessage("parent done"),
  ]);
  session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: {
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "sh", args: ["hook.sh"], async: true }] },
        ],
      },
    },
  });
  await session.run("delegate");
  const pid = await hookProcess();
  process.kill(pid, 0);
  await session.dispose();
  await waitForExit(pid);
  await Bun.write(join(dirs.cwd, "release"), "");
  expect(await Bun.file(join(dirs.cwd, "forbidden-after-dispose")).exists()).toBe(false);
});

test("asyncRewake delivered during a Stop check continues the same run", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "rewake.sh"),
    `cat > hook-input
while [ ! -f release ]; do sleep 0.01; done
echo '{"systemMessage":"check completed"}'
echo 'repair during Stop' >&2
exit 2
`,
  );
  await Bun.write(
    join(dirs.cwd, "stop.sh"),
    `cat > stop-input
if [ ! -f first-stop-done ]; then
  touch first-stop-done stop-entered
  while [ ! -f stop-release ]; do sleep 0.01; done
fi
`,
  );
  const completed = Promise.withResolvers<void>();
  let results = 0;
  const fake = fakeModel([
    fauxAssistantMessage("first done"),
    fauxAssistantMessage("repaired before stopping"),
  ]);
  session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "sh rewake.sh", asyncRewake: true }] },
        ],
        Stop: [{ hooks: [{ type: "command", command: "sh stop.sh" }] }],
      },
    },
  });
  const run = session.run("start", {
    onEvent: (event) => {
      if (event.type === "hook_message") completed.resolve();
      if (event.type === "result") results++;
    },
  });
  await Bun.spawn(["sh", "-c", "while [ ! -f stop-entered ]; do sleep 0.01; done"], {
    cwd: dirs.cwd,
  }).exited;
  await Bun.write(join(dirs.cwd, "release"), "");
  await completed.promise;
  await Bun.write(join(dirs.cwd, "stop-release"), "");
  expect((await run).text).toBe("repaired before stopping");
  expect(results).toBe(1);
  expect(fake.contexts).toHaveLength(2);
  expect(JSON.stringify(fake.contexts[1]!.messages)).toContain("repair during Stop");
});

test("asyncRewake wakes a parent waiting for a running child", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "rewake.sh"),
    `input=$(cat)
case "$input" in *agent_id*) exit 0 ;; esac
while [ ! -f release ]; do sleep 0.01; done
echo 'repair while child runs' >&2
exit 2
`,
  );
  const childRelease = Promise.withResolvers<void>();
  const parentWaiting = Promise.withResolvers<void>();
  let parentCalls = 0;
  const response: Parameters<typeof fakeModel>[0][number] = async (context) => {
    const parent = context.messages.some(
      (message) =>
        message.role === "system" && message.toolsAdded?.some((tool) => tool.name === "subagent"),
    );
    if (!parent) {
      await childRelease.promise;
      return fauxAssistantMessage("child done");
    }
    const turn = parentCalls++;
    if (turn === 0)
      return fauxAssistantMessage(
        fauxToolCall("subagent", { description: "child", prompt: "work" }),
        { stopReason: "toolUse" },
      );
    if (turn === 1) return fauxAssistantMessage("waiting for child");
    if (turn === 2) {
      expect(JSON.stringify(context.messages)).toContain("repair while child runs");
      childRelease.resolve();
      return fauxAssistantMessage("background repaired");
    }
    return fauxAssistantMessage("all done");
  };
  const fake = fakeModel(Array.from({ length: 7 }, () => response));
  session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: {
      hooks: {
        SessionStart: [
          { hooks: [{ type: "command", command: "sh rewake.sh", asyncRewake: true }] },
        ],
      },
    },
  });
  const run = session.run("delegate", {
    onEvent: (event) => {
      if (event.type === "subagents_waiting") parentWaiting.resolve();
    },
  });
  await parentWaiting.promise;
  await Bun.write(join(dirs.cwd, "release"), "");
  expect((await run).text).toBe("all done");
  expect(parentCalls).toBe(4);
});

test("session subscription replays startup autorun events once and can unsubscribe", async () => {
  dirs = await tempDirs();
  const firstCall = Promise.withResolvers<void>();
  const firstReply = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  const events: SessionEvent[] = [];
  const fake = fakeModel([
    async () => {
      firstCall.resolve();
      await firstReply.promise;
      return fauxAssistantMessage("startup done");
    },
    fauxAssistantMessage("manual done"),
    fauxAssistantMessage("after unsubscribe"),
  ]);
  session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: "echo startup-failure >&2; exit 2", asyncRewake: true },
            ],
          },
        ],
      },
    },
  });
  await firstCall.promise;
  expect(session.running).toBe(true);
  const unsubscribe = session.subscribe((event) => {
    events.push(event);
    if (event.type === "result") finished.resolve();
  });
  expect(events.filter((event) => event.type === "session_start")).toHaveLength(1);
  expect(
    events.filter((event) => event.type === "message_end" && event.message.role === "user"),
  ).toHaveLength(1);
  firstReply.resolve();
  await finished.promise;
  // Wait for the public running flag to settle, through the live result boundary.
  await Promise.resolve();
  const direct: SessionEvent[] = [];
  await session.run("manual", {
    onEvent: (event) => {
      direct.push(event);
    },
  });
  expect(events.filter((event) => event.type === "result")).toHaveLength(2);
  expect(direct.filter((event) => event.type === "result")).toHaveLength(1);
  unsubscribe();
  await session.run("after unsubscribe");
  expect(events.filter((event) => event.type === "result")).toHaveLength(2);
});

test.each(["PostCompact", "SessionStart"] as const)(
  "async output completed during %s reaches the next actual model request",
  async (event) => {
    dirs = await tempDirs();
    await Bun.write(
      join(dirs.cwd, "background.sh"),
      `cat > background-input
while [ ! -f release ]; do sleep 0.01; done
echo '{"systemMessage":"late async notice","hookSpecificOutput":{"additionalContext":"late async context"}}'
`,
    );
    await Bun.write(
      join(dirs.cwd, "compact-hook.sh"),
      `cat > compact-input
touch release
while [ ! -f compact-release ]; do sleep 0.01; done
`,
    );
    const fake = fakeModel([
      fauxAssistantMessage("old work ".repeat(2500)),
      fauxAssistantMessage("Saved summary."),
      fauxAssistantMessage("after compaction"),
    ]);
    fake.model.contextWindow = 4000;
    const hooks = {
      SessionStart: [
        {
          matcher: "startup",
          hooks: [{ type: "command" as const, command: "sh background.sh", async: true }],
        },
      ],
      [event]: [
        ...(event === "SessionStart"
          ? [
              {
                matcher: "startup",
                hooks: [{ type: "command" as const, command: "sh background.sh", async: true }],
              },
            ]
          : []),
        {
          matcher: event === "SessionStart" ? "compact" : "auto",
          hooks: [{ type: "command" as const, command: "sh compact-hook.sh" }],
        },
      ],
    };
    session = await createSession({ ...dirs, ...fake, settings: { hooks } });
    await session.run("first");
    const events: SessionEvent[] = [];
    await session.run("compact", {
      onEvent: async (event) => {
        events.push(event);
        if (event.type === "hook_message" && event.message === "late async notice")
          await Bun.write(join(dirs.cwd, "compact-release"), "");
      },
    });
    expect(JSON.stringify(fake.contexts[2]!.messages)).toContain("late async context");
    expect(JSON.stringify(fake.contexts[2]!.messages)).toContain("late async notice");
    expect(
      events.filter((event) => event.type === "reminder_injected" && event.source === "async-hook"),
    ).toHaveLength(2);
    const input = await Bun.file(join(dirs.cwd, "background-input")).json();
    expect(await Bun.file(input.transcript_path).text()).toContain("late async context");
  },
);

test.each([false, true])(
  "a user run waits for an active hook autorun and cancellation does not submit it: %s",
  async (cancel) => {
    dirs = await tempDirs();
    const firstCall = Promise.withResolvers<void>();
    const firstReply = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    const fake = fakeModel([
      async () => {
        firstCall.resolve();
        await firstReply.promise;
        return fauxAssistantMessage("autorun done");
      },
      fauxAssistantMessage("human done"),
    ]);
    session = await createSession({
      ...dirs,
      ...fake,
      settings: {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: "echo background-failure >&2; exit 2",
                  asyncRewake: true,
                },
              ],
            },
          ],
          UserPromptSubmit: [{ hooks: [{ type: "command", command: "cat >> human-prompts" }] }],
        },
      },
    });
    session.subscribe((event) => {
      if (event.type === "result") finished.resolve();
    });
    await firstCall.promise;
    const controller = new AbortController();
    const manual = session.run("actual human task", { signal: controller.signal });
    if (cancel) {
      controller.abort();
      await expect(manual).rejects.toThrow();
      expect(await Bun.file(join(dirs.cwd, "human-prompts")).exists()).toBe(false);
      expect(JSON.stringify(session.messages)).not.toContain("actual human task");
      firstReply.resolve();
      await finished.promise;
      expect(fake.contexts).toHaveLength(1);
    } else {
      expect(await Bun.file(join(dirs.cwd, "human-prompts")).exists()).toBe(false);
      firstReply.resolve();
      expect((await manual).text).toBe("human done");
      expect(fake.contexts).toHaveLength(2);
      expect(JSON.stringify(fake.contexts[1]!.messages)).toContain("actual human task");
      expect(
        (await Bun.file(join(dirs.cwd, "human-prompts")).text()).match(/hook_event_name/g),
      ).toHaveLength(1);
    }
  },
);

test("a competing user run is still rejected rather than queued", async () => {
  dirs = await tempDirs();
  const called = Promise.withResolvers<void>();
  const reply = Promise.withResolvers<void>();
  const fake = fakeModel([
    async () => {
      called.resolve();
      await reply.promise;
      return fauxAssistantMessage("done");
    },
  ]);
  session = await createSession({ ...dirs, ...fake });
  const first = session.run("first user task");
  await called.promise;
  await expect(session.run("second user task")).rejects.toThrow(
    "Session already has an active Run",
  );
  expect(JSON.stringify(session.messages)).not.toContain("second user task");
  reply.resolve();
  await first;
  expect(fake.contexts).toHaveLength(1);
});
