import { expect, test } from "bun:test";
import { startWithClock } from "../helpers/clock-app";
import { controlledModel } from "../helpers/model";
import { createSession, createJsonlStore } from "@neant/agent";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/pi-agent-core/harness/context";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai";

test.each(["future", "past"] as const)(
  "active continuation history remains exact with %s colliding provider timestamps",
  async (mode) => {
    const argv: string[] = [];
    let childId = "";
    const fake = controlledModel();
    const timestamp = mode === "future" ? Date.now() + 10_000_000 : 123456;
    const streamFn: typeof fake.streamFn = (m, c, o) => {
      const target = createAssistantMessageEventStream();
      void (async () => {
        for await (const event of await fake.streamFn(m, c, o)) {
          if ("partial" in event) event.partial.timestamp = timestamp;
          if ("message" in event) event.message.timestamp = timestamp;
          if ("error" in event) event.error.timestamp = timestamp;
          target.push(event);
        }
        target.end();
      })();
      return target;
    };
    const app = await startWithClock(argv, {
      columns: 100,
      rows: 40,
      env: { LANG: "en" },
      session: { model: fake.model, streamFn },
      async prepare(root) {
        const store = createJsonlStore({ cwd: root, homeDir: root });
        const parent = await store.create({ cwd: root }, context);
        const branch = await parent.createBranch("main", null, context);
        const child = await store.create(
          { cwd: root, parentSessionId: parent.metadata.id },
          context,
        );
        childId = child.metadata.id;
        const childBranch = await child.createBranch("main", null, context);
        await childBranch.appendMessage(
          { role: "user", content: [{ type: "text", text: "old child prompt" }], timestamp },
          context,
        );
        await childBranch.appendMessage(
          fauxAssistantMessage("saved prior child marker", { timestamp }),
          context,
        );
        const run = {
          id: "saved-child-run",
          sessionId: childId,
          parentSessionId: parent.metadata.id,
          startedAt: Date.now() - 100,
          endedAt: Date.now() - 50,
          outcome: "completed",
        };
        await childBranch.appendCustomEntry(
          "tool-state/subagent-run",
          { version: 1, value: run },
          context,
        );
        await branch.appendCustomEntry(
          "tool-state/subagents",
          {
            version: 2,
            value: [
              {
                id: childId,
                description: "Same clock child",
                type: "general-purpose",
                latestRun: run,
              },
            ],
          },
          context,
        );
        await child.close(context);
        await parent.close(context);
        argv.push("--resume", parent.metadata.id);
        const observed = await createSession({
          cwd: root,
          homeDir: root,
          resumeId: parent.metadata.id,
          model: fake.model,
          streamFn: () => {
            throw new Error("history observation must not run model");
          },
        });
        try {
          const snapshot = await observed.readSubagent(childId);
          expect(
            snapshot!.messages.find((message) => message.role === "assistant")!.timestamp,
          ).toBe(timestamp);
          expect(JSON.stringify(snapshot!.messages)).toContain("saved prior child marker");
        } finally {
          await observed.dispose();
        }
      },
    });
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      expect(fake.calls).toHaveLength(0);
      app.stdin.write("continue saved child\r");
      await app.waitFor(() => fake.calls.length === 1);
      fake.calls[0]!.tool("send_message", {
        agent_id: childId,
        message: "new continuation marker",
      });
      await app.waitFor(() => fake.calls.length === 3);
      let child = fake.calls
        .slice(1)
        .find(
          (call) =>
            JSON.stringify(call.context.messages).includes("new continuation marker") &&
            !JSON.stringify(call.context.messages).includes('"name":"subagent"'),
        )!;
      expect(child).toBeDefined();
      if (mode === "past") {
        child.thinking("current committed child thinking");
        child.tool("read", { path: "missing-current.txt" });
        await app.waitFor(() => fake.calls.length === 4);
        child = fake.calls[3]!;
      }
      child.delta("active current child marker");
      app.stdin.write("\x01\r");
      await app.waitFor(() => app.screen().join("\n").includes("id "));
      app.stdin.write("\x1b[C");
      await app.waitFor(() => app.screen().join("\n").includes("active current child marker"));
      if (mode === "past") {
        app.stdin.write("\r");
        await app.waitFor(() =>
          app.screen().join("\n").includes("current committed child thinking"),
        );
      }
      const output = app.screen().join("\n");
      expect(fake.calls).toHaveLength(mode === "future" ? 3 : 4);
      if (mode === "past") {
        app.stdin.write("\x1b[C");
        await app.waitFor(() => app.screen().join("\n").includes("3/3"));
        expect(app.screen().filter((line) => line.includes("✗ Read"))).toHaveLength(1);
      }
      child.finish();
      await app.waitFor(() => app.screen().join("\n").includes("completed"));
      const restored = await createSession({
        cwd: app.root,
        homeDir: app.root,
        resumeId: argv[1],
        model: fake.model,
        streamFn: () => {
          throw new Error("verification must not run model");
        },
      });
      try {
        const snapshot = await restored.readSubagent(childId);
        const assistants = snapshot!.messages.filter((message) => message.role === "assistant");
        expect(assistants.map((message) => message.timestamp)).toEqual(
          mode === "future" ? [timestamp, timestamp] : [timestamp, timestamp, timestamp],
        );
        expect(JSON.stringify(snapshot!.messages)).toContain("active current child marker");
        expect(JSON.stringify(snapshot!.historyMessages)).toContain("saved prior child marker");
        expect(JSON.stringify(snapshot!.historyMessages)).not.toContain(
          "active current child marker",
        );
        expect(JSON.stringify(snapshot!.historyMessages)).not.toContain(
          "current committed child thinking",
        );
      } finally {
        await restored.dispose();
      }
      expect(output).toContain("saved prior child marker");
      if (mode === "past") expect(output.split("current committed child thinking")).toHaveLength(2);
      expect(output.split("active current child marker")).toHaveLength(2);
      expect(fake.calls).toHaveLength(mode === "future" ? 3 : 4);
    } finally {
      await app.cleanup();
    }
  },
);

test("read-only child history retains an unknown Tool outcome without success, failure or replay", async () => {
  const argv: string[] = [];
  const app = await startWithClock(argv, {
    columns: 100,
    rows: 40,
    env: { LANG: "en" },
    async prepare(root) {
      const store = createJsonlStore({ cwd: root, homeDir: root });
      const parent = await store.create({ cwd: root }, context);
      const branch = await parent.createBranch("main", null, context);
      const child = await store.create({ cwd: root, parentSessionId: parent.metadata.id }, context);
      const childBranch = await child.createBranch("main", null, context);
      await childBranch.appendMessage(
        fauxAssistantMessage(
          fauxToolCall(
            "write",
            { path: "unexecuted-write.txt", content: "payload" },
            { id: "lost-child-write" },
          ),
          { stopReason: "toolUse" },
        ),
        context,
      );
      await childBranch.appendMessage(
        {
          role: "toolResult",
          toolCallId: "lost-child-write",
          toolName: "write",
          content: [
            { type: "text", text: "Outcome unknown: saved call without confirmed result." },
          ],
          isError: false,
          details: { recovery: { type: "unknown-tool-outcome", version: 1 } },
          timestamp: Date.now(),
        },
        context,
      );
      const run = {
        id: "saved-unknown-run",
        sessionId: child.metadata.id,
        parentSessionId: parent.metadata.id,
        startedAt: 10,
        endedAt: 20,
        outcome: "completed",
      };
      await childBranch.appendCustomEntry(
        "tool-state/subagent-run",
        { version: 1, value: run },
        context,
      );
      await branch.appendCustomEntry(
        "tool-state/subagents",
        {
          version: 2,
          value: [
            {
              id: child.metadata.id,
              description: "Unknown child",
              type: "general-purpose",
              latestRun: run,
            },
          ],
        },
        context,
      );
      await child.close(context);
      await parent.close(context);
      argv.push("--resume", parent.metadata.id);
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("\x01\r");
    await app.waitFor(() => app.screen().join("\n").includes("id "));
    app.stdin.write("\x1b[C\x1b[C");
    await app.waitFor(
      () =>
        app.screen().join("\n").includes("3/3") &&
        app.screen().join("\n").includes("unexecuted-write.txt"),
    );
    const tools = app.screen().join("\n");
    expect(tools).toContain("? Write");
    expect(tools).toContain("Outcome unknown");
    expect(tools).not.toContain("• Write");
    expect(tools).not.toContain("✗ Write");
    expect(app.calls).toHaveLength(0);
    expect(await Bun.file(`${app.root}/unexecuted-write.txt`).exists()).toBe(false);
  } finally {
    await app.cleanup();
  }
});
