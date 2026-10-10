import { expect, test } from "bun:test";
import { start } from "../helpers/app";
import { controlledModel } from "../helpers/model";
import { createSession, createJsonlStore, type SessionOptions } from "@rukie/agent";
import type { Storage } from "@earendil-works/pi-durable";
import { fakeModel } from "../helpers/agent-fixtures";
import { crashUnsafeEffect } from "../helpers/native-recovery";
import {
  createAssistantMessageEventStream,
  createModels,
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentTools,
} from "@earendil-works/pi-ai";

test.each(["future", "past"] as const)(
  "active continuation history remains exact with %s colliding provider timestamps",
  async (mode) => {
    const argv: string[] = [];
    let childId = "";
    const fake = controlledModel();
    const timestamp = mode === "future" ? 4_000_000_000_000 : 123456;
    const models = withTimestamps(fake.models, timestamp);
    const app = await start(argv, {
      columns: 100,
      rows: 40,
      env: { LANG: "en" },
      session: { model: fake.model, models },
      async prepare(root) {
        const preparation = await fakeModel(
          Array.from({ length: 20 }, () => (context) => {
            const lastUser = context.messages.findLast((message) => message.role === "user");
            if (JSON.stringify(lastUser).includes("old child prompt"))
              return fauxAssistantMessage("saved prior child marker");
            if (
              !context.messages.some(
                (message) => message.role === "toolResult" && message.toolName === "subagent",
              )
            )
              return fauxAssistantMessage(
                fauxToolCall("subagent", {
                  description: "Same clock child",
                  prompt: "old child prompt",
                }),
                { stopReason: "toolUse" },
              );
            return fauxAssistantMessage("parent idle");
          }),
        );
        const fixture = await createSession({
          cwd: root,
          homeDir: root,
          ...preparation,
          models: withTimestamps(preparation.models, timestamp),
        });
        try {
          await fixture.run("delegate saved child");
          await fixture.waitForRequest(fixture.currentRequestId!);
          const state = fixture.toolState("subagents");
          if (!Array.isArray(state) || !state[0] || typeof state[0].id !== "string")
            throw new Error("Native child fixture identity missing");
          childId = state[0].id;
          const snapshot = await fixture.readSubagent(childId);
          expect(
            snapshot!.messages.find((message) => message.role === "assistant")!.timestamp,
          ).toBe(timestamp);
          expect(JSON.stringify(snapshot!.messages)).toContain("saved prior child marker");
          argv.push("--resume", fixture.id);
        } finally {
          await fixture.close();
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
      const completedParents = new Set([fake.calls[0]!]);
      // The event row briefly says "completed" before readSubagent supplies
      // the committed Run Outcome. Synchronize on that permanent detail frame.
      await app.waitFor(() => {
        for (const call of fake.calls) {
          if (
            completedParents.has(call) ||
            !getCurrentTools(call.context.messages).some((tool) => tool.name === "send_message")
          )
            continue;
          completedParents.add(call);
          call.reply("parent continuation settled");
        }
        const screen = app.screen().join("\n");
        return (
          screen.includes("Run ended normally") &&
          screen.includes(mode === "future" ? "2/3" : "3/3") &&
          screen.includes(
            mode === "future" ? "active current child marker" : "Read missing-current.txt",
          )
        );
      });
      app.stdin.write("\x1b");
      await app.waitFor(() => !app.screen().some((line) => line.includes(`id ${childId} ·`)));
      app.stdin.write("\x1b");
      await app.waitFor(
        () => !app.screen().join("\n").includes("↑/↓ select · Enter detail · Esc close"),
      );
      await app.waitFor(() => {
        for (const call of fake.calls) {
          if (
            completedParents.has(call) ||
            !getCurrentTools(call.context.messages).some((tool) => tool.name === "send_message")
          )
            continue;
          completedParents.add(call);
          call.reply("parent continuation settled");
        }
        return (
          fake.calls.length >= (mode === "future" ? 4 : 5) &&
          !app.screen().some((line) => line.includes("esc interrupt"))
        );
      });
      app.stdin.write("/exit\r");
      await app.exit;
      const restored = await createSession({
        cwd: app.root,
        homeDir: app.root,
        resumeId: argv[1],
        ...(await fakeModel([])),
      });
      try {
        const snapshot = await restored.readSubagent(childId);
        const assistants = snapshot!.messages.filter((message) => message.role === "assistant");
        expect(assistants.map((message) => message.timestamp)).toEqual(
          mode === "future" ? [timestamp, timestamp] : [timestamp, timestamp, timestamp],
        );
        expect(JSON.stringify(snapshot!.messages)).toContain("active current child marker");
        expect(JSON.stringify(snapshot!.messages).split("new continuation marker")).toHaveLength(2);
        expect(JSON.stringify(snapshot!.historyMessages)).toContain("saved prior child marker");
        expect(JSON.stringify(snapshot!.historyMessages)).not.toContain(
          "active current child marker",
        );
        expect(JSON.stringify(snapshot!.historyMessages)).not.toContain(
          "current committed child thinking",
        );
      } finally {
        await restored.close();
      }
      if (mode === "future") {
        const replay = await start(argv, {
          columns: 100,
          rows: 40,
          env: { LANG: "en" },
          session: { cwd: app.root, homeDir: app.root },
        });
        try {
          // History boundaries are independent of pointer geometry; card clicks are
          // covered by subagent-views. Open the same child's History through its dashboard.
          await replay.waitFor(() => replay.screen().includes("❯"));
          replay.stdin.write("\x01\r");
          await replay.waitFor(() => replay.screen().join("\n").includes(`id ${childId} ·`));
          replay.stdin.write("\x1b[C");
          await replay.waitFor(() => {
            const screen = replay.screen().join("\n");
            return screen.includes("2/3") && screen.includes("active current child marker");
          });
          expect(replay.screen().join("\n").split("❯ new continuation marker")).toHaveLength(2);
          expect(replay.calls).toHaveLength(0);
          replay.stdin.write("\x1b");
          await replay.waitFor(() => !replay.screen().join("\n").includes(`id ${childId} ·`));
          expect(replay.calls).toHaveLength(0);
        } finally {
          await replay.cleanup();
        }
      }
      expect(output.split("❯ new continuation marker")).toHaveLength(2);
      expect(output.indexOf("new continuation marker")).toBeLessThan(
        output.indexOf("active current child marker"),
      );
      expect(output).toContain("saved prior child marker");
      if (mode === "past") expect(output.split("current committed child thinking")).toHaveLength(2);
      expect(output.split("active current child marker")).toHaveLength(2);
      expect(fake.calls.length).toBeGreaterThanOrEqual(mode === "future" ? 4 : 5);
    } finally {
      await app.cleanup();
    }
  },
);

test("read-only child history retains an unknown Tool outcome without success, failure or replay", async () => {
  const argv: string[] = [];
  const fake = await fakeModel([
    () => fauxAssistantMessage("restored history reviewed"),
    () => fauxAssistantMessage("restored history reviewed"),
    () => fauxAssistantMessage("restored history reviewed"),
  ]);
  const session: Partial<SessionOptions> = { ...fake };
  let reporterSettled = false;
  let childId: string | undefined;
  const app = await start(argv, {
    session,
    columns: 100,
    rows: 40,
    env: { LANG: "en" },
    async prepare(root) {
      const crashed = await crashUnsafeEffect(root, true);
      childId = crashed.childId;
      argv.push("--resume", crashed.sessionId);
      const store = createJsonlStore({ cwd: root, homeDir: root });
      session.store = {
        ...store,
        async open(...args) {
          const lease = await store.open(...args);
          return {
            ...lease,
            storage: new Proxy(lease.storage, {
              get(target, key) {
                if (key === "commit")
                  return async (...commit: Parameters<Storage["commit"]>) => {
                    const result = await target.commit(...commit);
                    // Parent idle does not settle the recovered child/report chain.
                    // This exact native driver ends only after its reporter receipt.
                    if (
                      commit[0].some(
                        (write) =>
                          write.type === "task" &&
                          write.value.kind === "rukie.subagent-driver" &&
                          write.value.state.status === "terminal",
                      )
                    )
                      reporterSettled = true;
                    return result;
                  };
                const value = Reflect.get(target, key);
                return typeof value === "function" ? value.bind(target) : value;
              },
            }),
          };
        },
      };
    },
  });
  try {
    await app.waitFor(() => reporterSettled && app.screen().includes("❯") && !app.isWorking());
    expect(
      fake.contexts
        .at(-1)
        ?.messages.some(
          (message) =>
            message.role === "user" &&
            typeof message.content === "string" &&
            message.content.startsWith(`Subagent ${childId} (Unknown child) finished.`),
        ),
    ).toBe(true);
    const requests = fake.contexts.length;
    app.stdin.write("\x01\r");
    await app.waitFor(() => app.screen().join("\n").includes("id "));
    app.stdin.write("\x1b[C\x1b[C");
    await app.waitFor(() => app.screen().join("\n").includes("uncertain-effect.txt"));
    const tools = app.screen().join("\n");
    expect(tools).toContain("? Write");
    expect(tools).toContain("Outcome unknown");
    expect(tools).not.toContain("• Write");
    expect(tools).not.toContain("✗ Write");
    expect(fake.contexts).toHaveLength(requests);
    expect(await Bun.file(`${app.root}/uncertain-effect.txt`).text()).toBe("saved effect");
  } finally {
    await app.cleanup();
  }
});

function withTimestamps(source: ReturnType<typeof createModels>, timestamp: number) {
  const models = createModels();
  for (const original of source.getProviders())
    models.setProvider({
      ...original,
      streamSimple(m, c, o) {
        const target = createAssistantMessageEventStream();
        void (async () => {
          const source = original.streamSimple(m, c, o);
          for await (const event of source) {
            if ("partial" in event) event.partial.timestamp = timestamp;
            if ("message" in event) event.message.timestamp = timestamp;
            if ("error" in event) event.error.timestamp = timestamp;
            target.push(event);
          }
          const reply = await source.result();
          reply.timestamp = timestamp;
          target.end(reply);
        })();
        return target;
      },
    });
  return models;
}
