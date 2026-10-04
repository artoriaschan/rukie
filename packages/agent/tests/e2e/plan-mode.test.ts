import { afterEach, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { branchTip } from "@earendil-works/pi-agent-core/harness/session";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createJsonlStore, createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test("Plan Mode persists outside a Run and injects changed guidance once", async () => {
  dirs = await tempDirs();
  const fake = fakeModel(Array.from({ length: 5 }, () => fauxAssistantMessage("done")));
  const session = await createSession({ ...dirs, ...fake });
  expect(session.planMode).toBe(false);
  await session.run("ordinary");
  expect(JSON.stringify(fake.contexts[0])).not.toContain("Plan Mode");
  await session.setPlanMode(true);
  expect(session.planMode).toBe(true);
  expect(session.toolState("plan")).toEqual({ active: true });
  const events: SessionEvent[] = [];
  await session.run("plan", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(JSON.stringify(fake.contexts[1])).toContain("You are in Plan Mode");
  expect(JSON.stringify(fake.contexts[1])).toContain("markdown");
  expect(JSON.stringify(fake.contexts[1])).toContain("Permissions still apply");
  const next = fakeModel(Array.from({ length: 3 }, () => fauxAssistantMessage("resumed")));
  const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
  expect(resumed.planMode).toBe(true);
  await resumed.run("continue planning");
  expect(JSON.stringify(next.contexts[0])).toContain("You are in Plan Mode");
  expect(JSON.stringify(next.contexts[0])).toContain(
    "give the plan directly as text in your final response",
  );
  // Continue with the resumed handle so the append-only transcript has one writer.

  await resumed.setPlanMode(false);
  await resumed.run("execute", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  await resumed.run("again", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(
    events.flatMap((event) =>
      event.type === "reminder_injected" && event.source === "plan-mode" ? [event.content] : [],
    ),
  ).toEqual([
    expect.stringContaining("You are in Plan Mode"),
    expect.stringContaining("You have exited Plan Mode"),
  ]);
  expect(
    events.flatMap((event) =>
      event.type === "tool_state_changed" && event.name === "plan" ? [event.value] : [],
    ),
  ).toEqual([{ active: true }, { active: false }]);
});

test("switching during a Run affects the next model call and repeated changes are idempotent", async () => {
  dirs = await tempDirs();
  const ready = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const fake = fakeModel([
    async () => {
      ready.resolve();
      await release.promise;
      return fauxAssistantMessage(fauxToolCall("todo_write", { todos: [] }), {
        stopReason: "toolUse",
      });
    },
    (context) => {
      expect(JSON.stringify(context)).toContain("You are in Plan Mode");
      return fauxAssistantMessage(fauxToolCall("todo_write", { todos: [] }), {
        stopReason: "toolUse",
      });
    },
    (context) => {
      expect(JSON.stringify(context.messages.at(-1))).toContain("You have exited Plan Mode");
      return fauxAssistantMessage("done");
    },
  ]);
  const session = await createSession({ ...dirs, ...fake });
  const events: SessionEvent[] = [];
  let tools = 0;
  const run = session.run("work", {
    onEvent: async (event) => {
      events.push(structuredClone(event));
      if (event.type === "tool_execution_end" && ++tools === 2) {
        await session.setPlanMode(false);
        await session.setPlanMode(false);
      }
    },
  });
  await ready.promise;
  await session.setPlanMode(true);
  await session.setPlanMode(true);
  expect(JSON.stringify(fake.contexts[0])).not.toContain("Plan Mode");
  release.resolve();
  await run;
  expect(
    events.flatMap((event) =>
      event.type === "tool_state_changed" && event.name === "plan" ? [event.value] : [],
    ),
  ).toEqual([{ active: true }, { active: false }]);
});

test.each(["subagent", "subagent_fork"])(
  "%s reads the parent's live Plan Mode without its own state snapshot",
  async (toolName) => {
    dirs = await tempDirs();
    const childReady = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall(toolName, {
          description: "Inspect",
          prompt: "child",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      ),
      async (context) => {
        expect(JSON.stringify(context)).toContain("You are in Plan Mode");
        childReady.resolve();
        await release.promise;
        return fauxAssistantMessage(fauxToolCall("todo_write", { todos: [] }), {
          stopReason: "toolUse",
        });
      },
      (context) => {
        expect(JSON.stringify(context.messages.at(-1))).toContain("You have exited Plan Mode");
        return fauxAssistantMessage("child done");
      },
      fauxAssistantMessage("parent done"),
    ]);
    const session = await createSession({ ...dirs, ...fake });
    await session.setPlanMode(true);
    const childEvents: SessionEvent[] = [];
    const run = session.run("delegate", {
      onEvent: (event) => {
        if (event.type === "subagent_event") childEvents.push(event.event);
      },
    });
    await childReady.promise;
    await session.setPlanMode(false);
    release.resolve();
    await run;
    expect(
      childEvents.some((event) => event.type === "tool_state_changed" && event.name === "plan"),
    ).toBe(false);
  },
);

test.each(["ask", "auto-review", "full-access"] as const)(
  "Plan Mode preserves bash/edit rules and permission mode in %s",
  async (permissionMode) => {
    dirs = await tempDirs();
    await Bun.write(`${dirs.cwd}/file.txt`, "before");
    const fake = fakeModel([
      fauxAssistantMessage(
        [
          fauxToolCall("bash", { command: "printf allowed" }),
          fauxToolCall("edit", {
            path: "file.txt",
            edits: [{ oldText: "before", newText: "after" }],
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    let asked = 0;
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode,
      settings: { permissions: { allow: ["bash"], ask: ["edit"] } },
      onPermissionAsk: async () => {
        asked++;
        return "deny";
      },
    });
    await session.setPlanMode(true);
    await session.run("inspect");
    expect(asked).toBe(1);
    expect(session.permissionMode).toBe(permissionMode);
    expect(
      fake.contexts[1]!.messages.filter((message) => message.role === "toolResult"),
    ).toMatchObject([
      { toolName: "bash", isError: false },
      { toolName: "edit", isError: true },
    ]);
    expect(await Bun.file(`${dirs.cwd}/file.txt`).text()).toBe("before");
  },
);

test("Compaction re-injects active guidance and never repeats a consumed exit reminder", async () => {
  dirs = await tempDirs();
  const work = () =>
    fauxAssistantMessage(
      [{ type: "text", text: "old work ".repeat(2500) }, fauxToolCall("todo_write", { todos: [] })],
      { stopReason: "toolUse" },
    );
  const fake = fakeModel([
    fauxAssistantMessage("saved"),
    work(),
    fauxAssistantMessage("First summary."),
    fauxAssistantMessage("continued"),
    fauxAssistantMessage("execute"),
    work(),
    fauxAssistantMessage("Second summary."),
    fauxAssistantMessage("done"),
  ]);
  fake.model.contextWindow = 4000;
  const session = await createSession({ ...dirs, ...fake });
  await session.setPlanMode(true);
  const events: SessionEvent[] = [];
  const onEvent = (event: SessionEvent) => {
    events.push(event);
  };
  await session.run("plan", { onEvent });
  await session.run("work", { onEvent });
  expect(
    events.filter((event) => event.type === "reminder_injected" && event.source === "plan-mode"),
  ).toHaveLength(2);
  expect(JSON.stringify(fake.contexts[3])).toContain("You are in Plan Mode");
  await session.setPlanMode(false);
  await session.run("execute", { onEvent });
  await session.run("more", { onEvent });
  expect(events.filter((event) => event.type === "compaction_end")).toHaveLength(2);
  expect(
    events
      .flatMap((event) =>
        event.type === "reminder_injected" && event.source === "plan-mode" ? [event.content] : [],
      )
      .filter((text) => text.includes("exited")),
  ).toHaveLength(1);
});

test("rewind restores Plan Mode from the snapshot at the selected transcript point", async () => {
  dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const session = await createSession({ ...dirs, ...fakeModel([]), store });
  await session.setPlanMode(true);
  const metadata = (await store.list({ cwd: dirs.cwd }, BACKGROUND_CONTEXT))[0]!;
  const stored = await store.open(metadata, BACKGROUND_CONTEXT);
  const point = await (await stored.branch("main", BACKGROUND_CONTEXT))!.getTipId(
    BACKGROUND_CONTEXT,
  );
  await stored.close(BACKGROUND_CONTEXT);
  await session.setPlanMode(false);
  const rewind = await store.open(metadata, BACKGROUND_CONTEXT);
  await rewind.setValue(branchTip("main"), point, BACKGROUND_CONTEXT);
  await rewind.close(BACKGROUND_CONTEXT);
  const fake = fakeModel([fauxAssistantMessage("planning")]);
  const resumed = await createSession({ ...dirs, ...fake, store, resumeId: session.id });
  expect(resumed.planMode).toBe(true);
  await resumed.run("continue");
  expect(JSON.stringify(fake.contexts[0])).toContain("You are in Plan Mode");
});

test("frontend can await a second Plan Mode change from its state event", async () => {
  dirs = await tempDirs();
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage(fauxToolCall("todo_write", { todos: [] }), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]),
  });
  const values: unknown[] = [];
  await session.run("plan", {
    onEvent: async (event) => {
      if (event.type === "tool_execution_end") await session.setPlanMode(true);
      if (event.type !== "tool_state_changed" || event.name !== "plan") return;
      values.push(event.value);
      if ((event.value as { active: boolean }).active) await session.setPlanMode(false);
    },
  });
  expect(values).toEqual([{ active: true }, { active: false }]);
  expect(session.planMode).toBe(false);
}, 1000);
