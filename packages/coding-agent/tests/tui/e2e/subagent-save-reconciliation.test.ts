import { test, expect } from "bun:test";
import { createJsonlStore, createSession } from "@rukie/agent";
import { controlledModel } from "../helpers/model";
import { start } from "../helpers/app";
import { jest } from "bun:test";
import { startWithClock } from "../helpers/clock-app";

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
        const store = createJsonlStore({ cwd: root, homeDir: root });
        const wrap = (stored: Awaited<ReturnType<typeof store.create>>) => {
          const wrapBranch = (branch: Awaited<ReturnType<typeof stored.createBranch>>) =>
            new Proxy(branch, {
              get(owner, method) {
                if (method === "appendMessage")
                  return async (...args: Parameters<typeof branch.appendMessage>) => {
                    const m = args[0];
                    if (
                      !rejected &&
                      ((rejectedRole === "assistant" &&
                        m.role === "assistant" &&
                        JSON.stringify(m).includes("child ghost body")) ||
                        (rejectedRole === "toolResult" &&
                          m.role === "toolResult" &&
                          m.toolName === "write"))
                    ) {
                      rejected = true;
                      throw new Error("child save rejected");
                    }
                    return owner.appendMessage(...args);
                  };
                const v = Reflect.get(owner, method);
                return typeof v === "function" ? v.bind(owner) : v;
              },
            });
          return new Proxy(stored, {
            get(target, key) {
              if (key === "createBranch")
                return async (...args: Parameters<typeof stored.createBranch>) =>
                  wrapBranch(await target.createBranch(...args));
              if (key === "branch")
                return async (...args: Parameters<typeof stored.branch>) => {
                  const branch = await target.branch(...args);
                  return branch ? wrapBranch(branch) : branch;
                };
              const v = Reflect.get(target, key);
              return typeof v === "function" ? v.bind(target) : v;
            },
          });
        };
        options.session!.store = {
          ...store,
          create: async (...args) => {
            const saved = await store.create(...args);
            if (saved.metadata.parentSessionId) childId = saved.metadata.id;
            else parentId = saved.metadata.id;
            return wrap(saved);
          },
          open: async (...args) => wrap(await store.open(...args)),
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
      child.thinking("durable child partial");
      child.tool("read", { path: "missing-durable.txt" });
      await app.waitFor(() => app.calls.length === 4);
      const tail = app.calls[3]!;
      tail.delta("child ghost body");
      await app.waitFor(() => app.screen().join("\n").includes("child ghost body"));
      const y = app.screen().findIndex((r) => r.includes("Subagent: Reject child"));
      const x = app.screen()[y]!.indexOf("⤢");
      app.stdin.write(`\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`);
      await app.waitFor(() => app.screen().join("\n").includes("Agent View"));
      if (rejectedRole === "assistant") tail.finish();
      else tail.tool("write", { path: "child-effect.txt", content: "saved effect" });
      await app.waitFor(() => rejected);
      await app.waitFor(() => app.screen().join("\n").includes("Run ended with error"));
      await app.waitFor(() => !app.screen().join("\n").includes("child ghost body"));

      expect(rejected).toBe(true);
      expect(app.screen().join("\n")).not.toContain("child ghost body");
      app.stdin.write("\r");
      await app.waitFor(() => app.screen().join("\n").includes("durable child partial"));
      expect(app.screen().join("\n")).toContain("durable child partial");
      const restored = await createSession({
        cwd: app.root,
        homeDir: app.root,
        resumeId: parentId,
        model: controlledModel().model,
        streamFn: () => {
          throw new Error("read-only verification must not run");
        },
      });
      try {
        const snapshot = await restored.readSubagent(childId);
        expect(JSON.stringify(snapshot!.messages)).toContain("durable child partial");
        expect(JSON.stringify(snapshot!.messages)).not.toContain("child ghost body");
        expect(snapshot!.run!.outcome).toBe("error");
        if (rejectedRole === "toolResult") {
          const result = snapshot!.messages.find(
            (m) => m.role === "toolResult" && m.toolName === "write",
          );
          expect(JSON.stringify(result)).toContain("unknown-tool-outcome");
          expect(await Bun.file(app.root + "/child-effect.txt").text()).toBe("saved effect");
        }
      } finally {
        await restored.dispose();
      }
      const replay = await start(["--resume", parentId], {
        columns: 120,
        rows: 40,
        env: { LANG: "en" },
        advanceTimers: (ms) => jest.advanceTimersByTime(ms),
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
        expect(replay.screen().join("\n")).not.toContain("child ghost body");
        expect(replay.calls).toHaveLength(0);
      } finally {
        await replay.cleanup();
      }
      if (rejectedRole === "toolResult") {
        app.stdin.write("\x1b[C");
        await app.waitFor(() => app.screen().join("\n").includes("? Write"));
        expect(app.screen().join("\n")).not.toContain("✓ Write");
      }
      const parent = app.calls
        .slice(1)
        .find((c) =>
          c.context.messages.some(
            (m) => m.role === "user" && JSON.stringify(m.content).includes("delegate"),
          ),
        )!;
      expect(parent).toBeDefined();
      const count = app.calls.length;
      parent.tool("send_message", { agent_id: childId, message: "fresh child continuation" });
      await app.waitFor(() => app.calls.length >= count + 2);
      const next = app.calls
        .slice(count)
        .find((c) =>
          c.context.messages.some(
            (m) =>
              m.role === "user" && JSON.stringify(m.content).includes("fresh child continuation"),
          ),
        )!;
      next.delta("fresh child live output");
      if (rejectedRole === "toolResult") app.stdin.write("\x1b[D");
      await app.waitFor(() => app.screen().join("\n").includes("fresh child live output"));
      expect(app.screen().join("\n")).not.toContain("child ghost body");
      next.finish();
      await app.waitFor(() => app.screen().join("\n").includes("completed"));
      expect(app.stderr()).toBe("");
    } finally {
      await app.cleanup();
    }
  },
);
