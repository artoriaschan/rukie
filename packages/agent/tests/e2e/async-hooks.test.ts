import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { withModelAlias } from "../helpers/auxiliary-model.ts";
import { getCurrentTools } from "@earendil-works/pi-ai";
import {
  awaitWithContext,
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { watch } from "node:fs/promises";
import { join } from "node:path";
import { createSession, type Session, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
let session: Session | undefined;
const hookPids: number[] = [];
afterEach(async () => {
  await session?.close();
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

function modelText(messages: Parameters<typeof getCurrentTools>[0]) {
  return messages
    .flatMap((message) => {
      if (message.role === "system" || !("content" in message)) return [];
      const content = message.content;
      if (typeof content === "string") return [content];
      if (!Array.isArray(content)) return [];
      const blocks: readonly unknown[] = content;
      return blocks.flatMap((block) =>
        block &&
        typeof block === "object" &&
        "type" in block &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string"
          ? [block.text]
          : [],
      );
    })
    .join("\n");
}

async function completion<T>(promise: Promise<T>) {
  return awaitWithContext(promise, withAbortSignal(AbortSignal.timeout(2000), BACKGROUND_CONTEXT));
}

async function waitFile(name: string) {
  const controller = new AbortController();
  const changes = watch(dirs.cwd, {
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)]),
  });
  try {
    if (await Bun.file(join(dirs.cwd, name)).exists()) return;
    for await (const _change of changes) if (await Bun.file(join(dirs.cwd, name)).exists()) return;
    throw new Error(`Hook gate ${name} was not reached`);
  } finally {
    controller.abort();
  }
}

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
    fauxAssistantMessage(
      fauxToolCall("bash", { description: "Run test command", command: "touch release" }),
      {
        stopReason: "toolUse",
      },
    ),
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
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "hook_message") completed.resolve();
  });
  const first = await session.run("first");
  expect(first).toMatchObject({ success: true });
  expect(await Bun.file(join(dirs.cwd, "release")).exists()).toBe(true);
  expect(warnings).toEqual([]);
  await completion(completed.promise);
  unsubscribe();
  await session.run("second");
  expect(modelText(fake.contexts[2]!.messages)).toContain("background context");
  expect(modelText(fake.contexts[2]!.messages)).toContain("background notice");
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
    fauxAssistantMessage(
      fauxToolCall("bash", {
        description: "Run test command",
        command: "touch release; while [ ! -f hook-admitted ]; do sleep 0.01; done",
      }),
      {
        stopReason: "toolUse",
      },
    ),
    fauxAssistantMessage("repaired"),
    fauxAssistantMessage("unexpected extra Run"),
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
    onEvent: (event) => {
      if (event.type === "hook_message") completed.resolve();
      // Release the real tool only after the native hook input is committed.
      if (
        event.type === "submission" &&
        event.record.status === "queued" &&
        event.record.requestId?.startsWith("hook:")
      )
        void Bun.write(join(dirs.cwd, "hook-admitted"), "");
    },
  });
  await completion(completed.promise);
  await session.waitForIdle();
  expect(result.text).toBe("repaired");
  expect(fake.contexts).toHaveLength(2);
  expect(modelText(fake.contexts[1]!.messages)).toContain("repair the background failure");
  expect(modelText(fake.contexts[1]!.messages)).toContain("check detail");
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
  session.subscribe((event) => {
    if (event.type === "run_end" && ++results === 2) rewoken.resolve();
  });
  await session.run("start");
  expect(fake.contexts).toHaveLength(1);
  await Bun.write(join(dirs.cwd, "release"), "");
  await completion(rewoken.promise);
  await session.waitForIdle();
  expect(fake.contexts).toHaveLength(2);
  expect(modelText(fake.contexts[1]!.messages)).toContain("idle background failure");
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
  // A real child process must exit; a parent-process virtual clock cannot reap it.
  const probe = Bun.spawn(["sh", "-c", `while kill -0 ${pid} 2>/dev/null; do sleep 0.01; done`]);
  try {
    await completion(probe.exited);
  } finally {
    probe.kill();
  }
}

test("close stops a background hook that outlives its run", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "hook.sh"),
    `cat > hook-input
echo $$ > hook.pid
while [ ! -f release ]; do sleep 0.01; done
touch forbidden-after-close
`,
  );
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("bash", {
        description: "Run test command",
        command: "while [ ! -f hook.pid ]; do sleep 0.01; done",
      }),
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
  await session.close();
  await waitForExit(pid);
  await Bun.write(join(dirs.cwd, "release"), "");
  expect(await Bun.file(join(dirs.cwd, "forbidden-after-close")).exists()).toBe(false);
});

test("parent close stops a completed subagent's background hook", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "hook.sh"),
    `input=$(cat)
case "$input" in *agent_id*) ;; *) exit 0 ;; esac
echo $$ > hook.pid
while [ ! -f release ]; do sleep 0.01; done
touch forbidden-after-close
`,
  );
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", { description: "child", prompt: "start", run_in_background: false }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("bash", {
        description: "Run test command",
        command: "while [ ! -f hook.pid ]; do sleep 0.01; done",
        // Bound the actual shell gate when a missing child startup hook is the failure.
        timeout: 1,
      }),
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
  await session.close();
  await waitForExit(pid);
  await Bun.write(join(dirs.cwd, "release"), "");
  expect(await Bun.file(join(dirs.cwd, "forbidden-after-close")).exists()).toBe(false);
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
  await waitFile("stop-entered");
  await Bun.write(join(dirs.cwd, "release"), "");
  await completion(completed.promise);
  await Bun.write(join(dirs.cwd, "stop-release"), "");
  const result = await run;
  await session.waitForIdle();
  expect(result.text).toBe("repaired before stopping");
  expect(results).toBe(1);
  expect(fake.contexts).toHaveLength(2);
  expect(modelText(fake.contexts[1]!.messages)).toContain("repair during Stop");
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
  let parentCalls = 0;
  const response: Parameters<typeof fakeModel>[0][number] = async (context) => {
    const parent = getCurrentTools(context.messages).some((tool) => tool.name === "subagent");
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
      expect(modelText(context.messages)).toContain("repair while child runs");
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
  expect((await session.run("delegate")).text).toBe("waiting for child");
  const run = session.waitForRequest(session.currentRequestId!);
  await Bun.write(join(dirs.cwd, "release"), "");
  expect((await run).text).toBe("all done");
  expect(parentCalls).toBe(4);
});

test("session subscription captures startup native state once and can unsubscribe", async () => {
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
    if (event.type === "run_end") finished.resolve();
  });
  const initial = events.filter((event) => event.type === "snapshot");
  expect(initial).toHaveLength(1);
  expect(initial[0]?.run).toBeDefined();
  expect(
    initial[0]?.messages.filter((message) => message.role === "user" && message.source === "hook"),
  ).toHaveLength(1);
  firstReply.resolve();
  await completion(finished.promise);
  await session.waitForIdle();
  const direct: SessionEvent[] = [];
  await session.run("manual", {
    onEvent: (event) => {
      direct.push(event);
    },
  });
  expect(events.filter((event) => event.type === "run_end")).toHaveLength(2);
  expect(direct.filter((event) => event.type === "run_end")).toHaveLength(1);
  unsubscribe();
  await session.run("after unsubscribe");
  expect(events.filter((event) => event.type === "run_end")).toHaveLength(2);
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
    await Bun.write(join(dirs.cwd, "context.txt"), "retained fact ".repeat(6000));
    const fake = fakeModel([
      fauxAssistantMessage(
        [
          fauxToolCall("read", { path: "context.txt" }),
          fauxToolCall("read", { path: "context.txt" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("old work"),
      fauxAssistantMessage("recent retained reply"),
      fauxAssistantMessage("Saved summary."),
      fauxAssistantMessage("after compaction"),
    ]);
    const models = withModelAlias(fake.models, "hook-compact", ["main"], { contextWindow: 128000 });
    const model = models.getModel("hook-compact", "main");
    if (!model) throw new Error("Missing fixture compact model");
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
          matcher: event === "SessionStart" ? "compact" : "manual",
          hooks: [{ type: "command" as const, command: "sh compact-hook.sh" }],
        },
      ],
    };
    session = await createSession({ ...dirs, models, model, settings: { hooks } });
    await session.run("first");
    await session.run("recent retained task");
    const events: SessionEvent[] = [];
    const unsubscribe = session.subscribe((event) => {
      events.push(event);
      if (event.type === "hook_message" && event.message === "late async notice")
        void Bun.write(join(dirs.cwd, "compact-release"), "");
    });
    await session.compact();
    await session.run("after compact");
    unsubscribe();
    expect(
      session.messages.some(
        (message) => message.role === "session-notice" && message.notice.kind === "compaction",
      ),
    ).toBe(true);
    expect(modelText(fake.contexts[4]!.messages)).toContain("late async context");
    expect(modelText(fake.contexts[4]!.messages)).toContain("late async notice");
    const injected = events
      .flatMap((event) =>
        event.type === "snapshot" || event.type === "message_end" ? event.messages : [],
      )
      .filter((message) => message.role === "system-reminder" && message.source === "async-hook");
    expect(new Set(injected.map((message) => message.entryId)).size).toBe(2);
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
      if (event.type === "run_end") finished.resolve();
    });
    await firstCall.promise;
    const controller = new AbortController();
    const manual = session.run("actual human task", { signal: controller.signal });
    void manual.catch(() => {});
    try {
      if (cancel) {
        controller.abort();
        await expect(manual).rejects.toThrow();
        expect(await Bun.file(join(dirs.cwd, "human-prompts")).exists()).toBe(false);
        expect(JSON.stringify(session.messages)).not.toContain("actual human task");
        firstReply.resolve();
        await completion(finished.promise);
        await session.waitForIdle();
        expect(fake.contexts).toHaveLength(1);
      } else {
        expect(await Bun.file(join(dirs.cwd, "human-prompts")).exists()).toBe(false);
        firstReply.resolve();
        expect((await manual).text).toBe("human done");
        expect(fake.contexts).toHaveLength(2);
        expect(modelText(fake.contexts[1]!.messages)).toContain("actual human task");
        expect(
          (await Bun.file(join(dirs.cwd, "human-prompts")).text()).match(/hook_event_name/g),
        ).toHaveLength(1);
      }
    } finally {
      firstReply.resolve();
      await manual.catch(() => {});
      await session.waitForIdle();
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
  await expect(session.run("second user task")).rejects.toThrow("Session is busy");
  expect(JSON.stringify(session.messages)).not.toContain("second user task");
  reply.resolve();
  await first;
  expect(fake.contexts).toHaveLength(1);
});
