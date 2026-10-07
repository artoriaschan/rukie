import { modelStream, withModelStream, withModelAlias } from "../helpers/auxiliary-model.ts";
import { expect, test } from "bun:test";
import {
  fauxAssistantMessage,
  fauxToolCall,
  createAssistantMessageEventStream,
  getCurrentTools,
} from "@earendil-works/pi-ai";
import { createSession } from "../../src";
import { fakeModel } from "../helpers/fake-model";
import { tempDirs } from "../helpers/temp-dirs";

test("read-only child snapshots preserve actual model, usage, outcome and ordered tools after parent resume without running", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Reader",
        prompt: "child",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("read", { path: "missing.txt" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("child result"),
    fauxAssistantMessage("parent result"),
  ]);
  const parent = await createSession({ ...dirs, ...fake });
  let id = "";
  try {
    await parent.run("delegate", {
      onEvent(event) {
        if (event.type === "subagent_event") id = event.agentId;
      },
    });
    const live = await parent.readSubagent(id);
    expect(live?.model).toBe("faux/faux-1");
    expect(live?.run?.outcome).toBe("completed");
    expect(live?.run?.tokens).toBeGreaterThan(0);
    expect(live?.run?.durationMs).toBeGreaterThanOrEqual(0);
    expect(
      live?.messages.some(
        (message) => message.role === "toolResult" && message.toolName === "read",
      ),
    ).toBe(true);
    await parent.close();
    const resumed = await createSession({ ...dirs, ...fake, resumeId: parent.id });
    try {
      const snapshot = await resumed.readSubagent(id);
      expect(snapshot?.messages).toEqual(live?.messages);
      expect(snapshot?.historyMessages).toEqual(live?.historyMessages);
      expect(snapshot?.run).toEqual(live?.run);
      expect(resumed.running).toBe(false);
      expect(await resumed.readSubagent("unrelated-id")).toBeUndefined();
    } finally {
      await resumed.close();
    }
  } finally {
    await parent.close();
    await dirs.cleanup();
  }
});

test.each([123456, 9_999_999_999_999])(
  "committed child continuation retains streamed output with colliding timestamp %s",
  async (timestamp) => {
    const dirs = await tempDirs();
    let id = "";
    const entered = Promise.withResolvers<void>();
    const partialCommitted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const prior = fauxAssistantMessage("saved prior marker");
    prior.timestamp = timestamp;
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("subagent", {
          description: "Same clock",
          prompt: "prior child",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      ),
      prior,
      fauxAssistantMessage("parent finished"),
      () =>
        fauxAssistantMessage(
          fauxToolCall("send_message", { agent_id: id, message: "current child" }),
          { stopReason: "toolUse" },
        ),
      fauxAssistantMessage("parent idle"),
      fauxAssistantMessage("parent report finished"),
    ]);
    const original = modelStream(fake.models);
    fake.models = withModelStream(fake.models, (model, context, options) => {
      if (
        !getCurrentTools(context.messages).some((tool) => tool.name === "subagent") &&
        JSON.stringify(
          context.messages.findLast((message) => message.role === "user")?.content,
        ).includes("current child")
      ) {
        const stream = createAssistantMessageEventStream();
        const partial = fauxAssistantMessage("active current child marker");
        partial.timestamp = timestamp;
        stream.push({ type: "start", partial });
        stream.push({
          type: "text_delta",
          contentIndex: 0,
          delta: "active current child marker",
          partial,
        });
        entered.resolve();
        void release.promise.then(() => {
          stream.push({ type: "done", reason: "stop", message: partial });
          stream.end(partial);
        });
        return stream;
      }
      return original(model, context, options);
    });
    const parent = await createSession({ ...dirs, ...fake });
    const off = parent.subscribe((event) => {
      if (
        event.type === "subagent_event" &&
        JSON.stringify(event.event).includes("active current child marker")
      )
        partialCommitted.resolve();
    });
    try {
      await parent.run("delegate");
      const state = parent.toolState("subagents");
      if (!Array.isArray(state) || !state[0] || typeof state[0].id !== "string")
        throw new Error("Child identity missing");
      id = state[0].id;
      await parent.run("continue");
      await entered.promise;
      await partialCommitted.promise;
      expect(JSON.stringify((await parent.readSubagent(id))?.generation?.message)).toContain(
        "active current child marker",
      );
      release.resolve();
      await parent.waitForRequest(parent.currentRequestId!);
      const committed = await parent.readSubagent(id);
      expect(committed?.run?.outcome).toBe("completed");
      expect(JSON.stringify(committed?.messages)).toContain("active current child marker");
      expect(JSON.stringify(committed?.historyMessages)).toContain("saved prior marker");
      expect(
        committed?.messages.findLast((message) => message.role === "assistant")?.timestamp,
      ).toBe(timestamp);
    } finally {
      off();
      release.resolve();
      await parent.close();
      await dirs.cleanup();
    }
  },
);

test("retained child provider requests keep their native model after parent model selection", async () => {
  const dirs = await tempDirs();
  let childId = "";
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "original",
        prompt: "first child request",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("first child done"),
    fauxAssistantMessage("parent done"),
    () =>
      fauxAssistantMessage(
        [
          fauxToolCall("send_message", { agent_id: childId, message: "retained child request" }),
          fauxToolCall("subagent", {
            description: "new",
            prompt: "new child request",
            run_in_background: false,
          }),
        ],
        { stopReason: "toolUse" },
      ),
    fauxAssistantMessage("child done"),
    fauxAssistantMessage("child done"),
    fauxAssistantMessage("parent done"),
    fauxAssistantMessage("report received"),
  ]);
  const aliased = withModelAlias(fake.models, "child-pin", ["first", "second"]);
  const original = modelStream(aliased);
  const requested = new Map<string, string>();
  const models = withModelStream(aliased, (model, context, options) => {
    const tools = getCurrentTools(context.messages);
    if (
      tools.some((tool) => tool.name === "read") &&
      !tools.some((tool) => tool.name === "subagent")
    ) {
      const input = context.messages.findLast((message) => message.role === "user");
      if (input?.role === "user" && typeof input.content === "string")
        requested.set(input.content, model.id);
    }
    return original(model, context, options);
  });
  const model = models.getModel("child-pin", "first");
  if (!model) throw new Error("Missing fixture model");
  const session = await createSession({ ...dirs, models, model });
  try {
    await session.run("delegate", {
      onEvent(event) {
        if (event.type === "subagent_event") childId ||= event.agentId;
      },
    });
    await session.setModel("child-pin/second");
    await session.run("continue and delegate");
    await session.waitForRequest(session.currentRequestId!);
    expect(requested.get("first child request")).toBe("first");
    expect(requested.get("retained child request")).toBe("first");
    expect(requested.get("new child request")).toBe("second");
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});
