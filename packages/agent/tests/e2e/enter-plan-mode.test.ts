import { withAuxiliaryRequests } from "../helpers/auxiliary-model.ts";
import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession, type PermissionAskRequest, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

const interactive = { onPlanReview: async () => ({ kind: "approve" as const }) };

test("ask requests permission before entering Plan Mode and guides the next turn", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("enter_plan_mode", {}, { id: "enter" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("planning"),
  ]);
  const requests: PermissionAskRequest[] = [];
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    ...interactive,
    onPermissionAsk: async (request) => {
      requests.push(request);
      expect(session.planMode).toBe(false);
      return "allow";
    },
  });
  expect(
    (
      await session.run("plan the work", {
        onEvent: (event) => {
          events.push(event);
        },
      })
    ).text,
  ).toBe("planning");
  expect(requests).toMatchObject([
    { toolCallId: "enter", toolName: "enter_plan_mode", args: {}, mode: "ask" },
  ]);
  expect(session.planMode).toBe(true);
  expect(fake.contexts[1]!.messages.find((message) => message.role === "toolResult")).toMatchObject(
    { role: "toolResult", isError: false },
  );
  expect(JSON.stringify(fake.contexts[1])).toContain("You are in Plan Mode");
  expect(events.some((event) => event.type === "tool_state_changed" && event.name === "plan")).toBe(
    true,
  );
});

test.each(["auto-review", "full-access"] as const)(
  "%s enters Plan Mode without launching permission review",
  async (permissionMode) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("enter_plan_mode", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("planning"),
    ]);
    const requests: PermissionAskRequest[] = [];
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      ...interactive,
      permissionMode,
      onPermissionAsk: async (request) => {
        requests.push(request);
        return "allow";
      },
    });
    await session.run("plan", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(requests.map((request) => request.toolName)).toEqual(
      permissionMode === "auto-review" ? ["enter_plan_mode"] : [],
    );
    expect(events.filter((event) => event.type === "permission_review")).toEqual([]);
    expect(session.planMode).toBe(true);
    expect(session.permissionMode).toBe(permissionMode);
    expect(fake.contexts).toHaveLength(2);
  },
);

test("auto-review batches review ordinary tools while asking the user about entering Plan Mode", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      [
        fauxToolCall(
          "bash",
          { description: "Run test command", command: "printf checked" },
          { id: "bash" },
        ),
        fauxToolCall("enter_plan_mode", {}, { id: "enter" }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("planning"),
  ]);
  const mainStream = fake.streamFn;
  let reviews = 0;
  fake.streamFn = withAuxiliaryRequests((model, context, options) => {
    if (
      context.messages.some(
        (message) => message.role === "system" && JSON.stringify(message).includes("REVIEW_POLICY"),
      )
    ) {
      reviews++;
      return fakeModel([fauxAssistantMessage('{"risk":"low","decision":"allow"}')]).streamFn(
        model,
        context,
        options,
      );
    }
    return mainStream(model, context, options);
  });
  const requests: PermissionAskRequest[] = [];
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    ...interactive,
    permissionMode: "auto-review",
    onPermissionAsk: async (request) => {
      requests.push(request);
      return "allow";
    },
  });
  await session.run("check before planning", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(reviews).toBe(1);
  expect(
    events.filter((event) => event.type === "permission_review" && event.phase === "start"),
  ).toMatchObject([{ toolCallId: "bash", toolName: "bash" }]);
  expect(requests.map((request) => request.toolName)).toEqual(["enter_plan_mode"]);
  expect(session.planMode).toBe(true);
});

test.each(["ask", "auto-review"] as const)(
  "refusing enter_plan_mode in %s leaves Plan Mode off",
  async (permissionMode) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("enter_plan_mode", {}), { stopReason: "toolUse" }),
      fauxAssistantMessage("continued"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      ...interactive,
      permissionMode,
      onPermissionAsk: async () => "deny",
    });
    expect((await session.run("plan")).text).toBe("continued");
    expect(session.planMode).toBe(false);
    expect(
      fake.contexts[1]!.messages.find((message) => message.role === "toolResult"),
    ).toMatchObject({ isError: true });
    expect(JSON.stringify(fake.contexts[1])).not.toContain("You are in Plan Mode");
  },
);

test.each(["ask", "auto-review", "full-access"] as const)(
  "enter_plan_mode respects explicit rules in %s",
  async (permissionMode) => {
    dirs = await tempDirs();
    for (const rule of ["allow", "ask", "deny"] as const) {
      const fake = fakeModel([
        fauxAssistantMessage(fauxToolCall("enter_plan_mode", {}), { stopReason: "toolUse" }),
        fauxAssistantMessage("continued"),
      ]);
      let asked = 0;
      const session = await createSession({
        ...dirs,
        ...fake,
        ...interactive,
        permissionMode,
        settings: { permissions: { [rule]: ["enter_plan_mode"] } },
        onPermissionAsk: async () => {
          asked++;
          return "deny";
        },
      });
      await session.run("plan");
      expect(asked).toBe(rule === "ask" ? 1 : 0);
      expect(session.planMode).toBe(rule === "allow");
      expect(session.permissionMode).toBe(permissionMode);
      expect(
        fake.contexts[1]!.messages.find((message) => message.role === "toolResult"),
      ).toMatchObject({ isError: rule !== "allow" });
    }
  },
);

test("enter_plan_mode reports an error when already in Plan Mode", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("enter_plan_mode", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("continued"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    ...interactive,
    permissionMode: "full-access",
  });
  await session.setPlanMode(true);
  await session.run("plan again");
  expect(session.planMode).toBe(true);
  expect(fake.contexts[1]!.messages.find((message) => message.role === "toolResult")).toMatchObject(
    {
      isError: true,
      content: [{ type: "text", text: "already in plan mode" }],
    },
  );
});

test("enter_plan_mode is absent when the frontend has no plan review callback", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("done")]);
  const session = await createSession({ ...dirs, ...fake, onPermissionAsk: async () => "allow" });
  const events: SessionEvent[] = [];
  await session.run("list tools", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  const started = events.find((event) => event.type === "session_start");
  if (started?.type !== "session_start") throw new Error("missing session start");
  expect(started.tools).not.toContain("enter_plan_mode");
});

test.each(["general-purpose", "explore", "custom", "fork"])(
  "%s subagents cannot request Plan Mode",
  async (type) => {
    dirs = await tempDirs();
    if (type === "custom")
      await Bun.write(
        `${dirs.cwd}/.agents/agents/custom.md`,
        `---
name: custom
description: Custom investigation
tools: [read, enter_plan_mode]
---
Inspect the project.
`,
      );
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall(type === "fork" ? "subagent_fork" : "subagent", {
          description: "Inspect",
          prompt: "child",
          run_in_background: false,
          ...(type !== "fork" && { subagent_type: type }),
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("child done"),
      fauxAssistantMessage("parent done"),
    ]);
    const session = await createSession({ ...dirs, ...fake, ...interactive });
    const events: SessionEvent[] = [];
    await session.run("delegate", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(fake.contexts).toHaveLength(3);
    const childStarted = events.flatMap((event) =>
      event.type === "subagent_event" && event.event.type === "session_start" ? [event.event] : [],
    );
    expect(childStarted).toHaveLength(1);
    expect(childStarted[0]!.tools).not.toContain("enter_plan_mode");
    const parentStarted = events.find((event) => event.type === "session_start");
    if (parentStarted?.type !== "session_start") throw new Error("missing parent start");
    expect(parentStarted.tools).toContain("enter_plan_mode");
  },
);

test("aborting a pending permission request discards a late approval", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("enter_plan_mode", {}), { stopReason: "toolUse" }),
  ]);
  const asked = Promise.withResolvers<PermissionAskRequest>();
  const answer = Promise.withResolvers<"allow">();
  const session = await createSession({
    ...dirs,
    ...fake,
    ...interactive,
    permissionMode: "auto-review",
    onPermissionAsk: (request) => {
      asked.resolve(request);
      return answer.promise;
    },
  });
  const controller = new AbortController();
  const run = session.run("plan", { signal: controller.signal });
  void run.catch(() => {});
  const request = await asked.promise;
  controller.abort(new Error("cancel planning request"));
  await expect(run).rejects.toThrow("cancel planning request");
  expect(request.signal.aborted).toBe(true);
  answer.resolve("allow");
  expect(session.planMode).toBe(false);
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.planMode).toBe(false);
});
