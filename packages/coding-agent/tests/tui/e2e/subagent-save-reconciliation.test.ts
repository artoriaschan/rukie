import { testClock } from "../helpers/test-clock";
import { test, expect } from "bun:test";
import { createSession } from "@rukie/agent";
import { start } from "../helpers/app";
import { startWithClock } from "../helpers/clock-app";
import { failingStorage } from "../../helpers/native-storage-failure";
import { fakeModel } from "../helpers/agent-fixtures";

test.each(["assistant", "toolResult"] as const)(
  "child rejected %s save reconciles open Agent View and Resume",
  async (rejectedRole) => {
    let rejected = false;
    let parentId = "";
    let childId = "";
    const options: NonNullable<Parameters<typeof startWithClock>[1]> = {
      columns: 120,
      rows: 40,
      env: { LANG: "en" },
      session: { permissionMode: "full-access" },
      prepare: async (root) => {
        const failing = failingStorage(root, (writes) => {
          if (rejected) return;
          if (
            writes.some(
              (write) =>
                write.type === "entry" &&
                write.value.model?.some((message) =>
                  rejectedRole === "assistant"
                    ? message.role === "assistant" &&
                      message.stopReason === "stop" &&
                      JSON.stringify(message.content).includes("child rejected final body")
                    : message.role === "toolResult" && message.toolName === "write",
                ),
            )
          ) {
            rejected = true;
            return new Error("child save rejected");
          }
        });
        options.session!.store = {
          ...failing,
          async open(...args) {
            const lease = await failing.open(...args);
            parentId = lease.id;
            return lease;
          },
        };
      },
    };
    const app = await startWithClock(["delegate"], options);
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("subagent", {
        description: "Reject child",
        prompt: "child rejected prompt",
      });
      await app.waitFor(() => app.calls.length === 3);
      const child = app.calls.find((c) =>
        c.context.messages.some(
          (m) => m.role === "user" && JSON.stringify(m.content).includes("child rejected prompt"),
        ),
      )!;
      app.calls
        .slice(1)
        .find((call) => call !== child)!
        .finish();
      child.thinking("durable child partial");
      child.tool("read", { path: "missing-durable.txt" });
      await app.waitFor(() => app.calls.length === 4);
      const tail = app.calls[3]!;
      tail.delta("durable child tail");
      await app.waitFor(() => app.screen().join("\n").includes("durable child tail"));
      const y = app.screen().findIndex((r) => r.includes("Subagent: Reject child"));
      const x = app.screen()[y]!.indexOf("⤢");
      app.stdin.write(`\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`);
      await app.waitFor(() => app.screen().join("\n").includes("Agent View"));
      if (rejectedRole === "assistant") tail.reply("child rejected final body");
      else tail.tool("write", { path: "child-effect.txt", content: "saved effect" });
      await app.waitFor(() => rejected);
      await app.waitFor(() => !app.screen().join("\n").includes("child rejected final body"));

      expect(rejected).toBe(true);
      expect(app.screen().join("\n")).not.toContain("child rejected final body");
      app.stdin.write("\r");
      await app.waitFor(() => app.screen().join("\n").includes("durable child partial"));
      expect(app.screen().join("\n")).toContain("durable child partial");
      await app.shutdown();
      const restored = await createSession({
        cwd: app.root,
        homeDir: app.root,
        resumeId: parentId,
        ...(await fakeModel([])),
      });
      try {
        if (restored.currentRequestId) await restored.waitForRequest(restored.currentRequestId);
        const identities = restored.toolState("subagents");
        if (!Array.isArray(identities) || !identities[0] || typeof identities[0].id !== "string")
          throw new Error("Native child identity missing");
        childId = identities[0].id;
        const snapshot = await restored.readSubagent(childId);
        expect(JSON.stringify(snapshot!.messages)).toContain("durable child partial");
        expect(JSON.stringify(snapshot!.messages)).not.toContain("child rejected final body");
        expect(snapshot!.run!.outcome).toBe("error");
        if (rejectedRole === "toolResult") {
          const result = snapshot!.messages.find(
            (m) => m.role === "toolResult" && m.toolName === "write",
          );
          expect(result?.role === "toolResult" && result.outcomeUnknown).toBe(true);
          expect(await Bun.file(app.root + "/child-effect.txt").text()).toBe("saved effect");
        }
      } finally {
        await restored.close();
      }
      const replay = await start(["--resume", parentId], {
        columns: 120,
        rows: 40,
        env: { LANG: "en" },
        advanceTimers: (ms) => testClock.advanceTimersByTime(ms),
        session: { cwd: app.root, homeDir: app.root },
      });
      try {
        await replay.waitFor(() =>
          replay.screen().some((r) => r.includes("Subagent: Reject child")),
        );
        const row = replay.screen().findIndex((r) => r.includes("Subagent: Reject child"));
        const col = replay.screen()[row]!.indexOf("⤢");
        replay.stdin.write(`\x1b[<0;${col + 1};${row + 1}M\x1b[<0;${col + 1};${row + 1}m`);
        await replay.waitFor(() => replay.screen().join("\n").includes("Agent View"));
        replay.stdin.write("\r");
        await replay.waitFor(() => replay.screen().join("\n").includes("durable child partial"));
        expect(replay.screen().join("\n")).not.toContain("child rejected final body");
        expect(replay.calls).toHaveLength(0);
        replay.stdin.write("\x1b");
        await replay.waitFor(() => replay.screen().includes("❯"));
        replay.stdin.write("continue child\r");
        await replay.waitFor(() => replay.calls.length === 1);
        replay.calls[0]!.tool("send_message", {
          agent_id: childId,
          message: "fresh child continuation",
        });
        await replay.waitFor(() =>
          replay.calls.some((call) =>
            call.context.messages.some(
              (message) =>
                message.role === "user" &&
                JSON.stringify(message.content).includes("fresh child continuation"),
            ),
          ),
        );
        const next = replay.calls.find((call) =>
          call.context.messages.some(
            (message) =>
              message.role === "user" &&
              JSON.stringify(message.content).includes("fresh child continuation"),
          ),
        )!;
        expect(JSON.stringify(next.context.messages)).toContain("durable child partial");
        expect(JSON.stringify(next.context.messages)).not.toContain("child rejected final body");
        next.reply("fresh child live output");
        await replay.waitFor(() => replay.screen().join("\n").includes("fresh child live output"));
      } finally {
        await replay.cleanup();
      }

      expect(app.stderr()).toBe("");
    } finally {
      await app.cleanup();
    }
  },
);
