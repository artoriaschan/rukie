import { testClock } from "../helpers/test-clock";
import { expect, test } from "bun:test";
import { startWithClock } from "../helpers/clock-app";
import { start } from "../helpers/app";
import { controlledModel } from "../helpers/model";
import { createSession } from "@rukie/agent";
import { fakeModel } from "../helpers/agent-fixtures";
import { crashUnsafeEffect } from "../helpers/native-recovery";
import {
  createAssistantMessageEventStream,
  createModels,
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
    const models = withTimestamps(fake.models, timestamp);
    const app = await startWithClock(argv, {
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
      // The event row briefly says "completed" before readSubagent supplies
      // the committed Run Outcome. Synchronize on that permanent detail frame.
      await app.waitFor(() => {
        const screen = app.screen().join("\n");
        return (
          screen.includes("Run ended normally") &&
          screen.includes(mode === "future" ? "2/3" : "3/3") &&
          screen.includes(
            mode === "future" ? "active current child marker" : "Read missing-current.txt",
          )
        );
      });
      app.stdin.write("\x1b\x1b/exit\r");
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
          advanceTimers: (ms) => testClock.advanceTimersByTime(ms),
          session: { cwd: app.root, homeDir: app.root },
        });
        try {
          await replay.waitFor(() => replay.screen().includes("❯"));
          const y = replay.screen().findIndex((line) => line.includes("Same clock child"));
          const x = Bun.stringWidth(replay.screen()[y]!.split("⤢")[0]!) + 1;
          replay.stdin.write(`\x1b[<0;${x};${y + 1}M\x1b[<0;${x};${y + 1}m`);
          await replay.waitFor(() => replay.screen().join("\n").includes("Agent View"));
          await replay.waitFor(() =>
            replay.screen().join("\n").includes("active current child marker"),
          );
          expect(replay.screen().join("\n").split("❯ new continuation marker")).toHaveLength(2);
          expect(replay.calls).toHaveLength(0);
          replay.stdin.write("\x1b");
          await replay.waitFor(() => !replay.screen().join("\n").includes("Agent View"));
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
      const { sessionId } = await crashUnsafeEffect(root, true);
      argv.push("--resume", sessionId);
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
        app.screen().join("\n").includes("uncertain-effect.txt"),
    );
    const tools = app.screen().join("\n");
    expect(tools).toContain("? Write");
    expect(tools).toContain("Outcome unknown");
    expect(tools).not.toContain("• Write");
    expect(tools).not.toContain("✗ Write");
    expect(app.calls).toHaveLength(0);
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
          for await (const event of original.streamSimple(m, c, o)) {
            if ("partial" in event) event.partial.timestamp = timestamp;
            if ("message" in event) event.message.timestamp = timestamp;
            if ("error" in event) event.error.timestamp = timestamp;
            target.push(event);
          }
          target.end();
        })();
        return target;
      },
    });
  return models;
}
