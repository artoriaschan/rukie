import { expect, jest, test } from "bun:test";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createSession } from "@rukie/agent";
import { start } from "../helpers/app";
import { startWithClock } from "../helpers/clock-app";
import { withAuxiliaryRequests } from "../helpers/auxiliary-model";

async function seeded(
  locale: "en" | "zh",
  session: NonNullable<Parameters<typeof startWithClock>[1]>["session"] = {},
) {
  const argv: string[] = [];
  const env = { LANG: locale === "zh" ? "zh_CN.UTF-8" : "en_US.UTF-8" };
  const app = await startWithClock(argv, {
    session,
    columns: 80,
    rows: 40,
    env,
    prepare: async (root) => {
      const model = createFauxCore({ api: "faux", provider: "faux" });
      model.setResponses([fauxAssistantMessage("seed reply")]);
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: model.getModel(),
        streamFn: withAuxiliaryRequests((m, c, o) => model.streamSimple(m, c, o)),
      });
      try {
        await session.run("seed prompt");
        argv.push("--resume", session.id);
      } finally {
        await session.dispose();
      }
    },
  });
  return {
    app,
    async replay() {
      return start(argv, {
        columns: 80,
        rows: 40,
        env,
        advanceTimers: (ms) => jest.advanceTimersByTime(ms),
        session: { cwd: app.root, homeDir: app.root },
      });
    },
  };
}

for (const locale of ["en", "zh"] as const) {
  for (const outcome of ["error", "aborted"] as const) {
    test(`${locale} ${outcome} keeps committed partial output and one durable outcome live and after Resume`, async () => {
      const { app, replay } = await seeded(locale);
      try {
        await app.waitFor(() => app.screen().includes("❯"));
        app.stdin.write("reason\r");
        await app.waitFor(() => app.calls.length === 1);
        app.calls[0]!.thinking("saved partial thinking");
        app.calls[0]!.delta("saved partial **body**");
        await app.waitFor(() => app.screen().join("\n").includes("saved partial body"));
        if (outcome === "error") app.calls[0]!.fail("broken provider");
        else app.stdin.write("\x03");
        await app.waitFor(() => !app.isWorking());
        const expected =
          outcome === "error"
            ? "✗ broken provider"
            : locale === "en"
              ? "Interrupted by user"
              : "用户已中断";
        await app.waitFor(() => app.screen().join("\n").includes(expected));
        expect(app.screen().filter((row) => row.includes(expected))).toHaveLength(1);
        expect(app.screen().join("\n")).toContain("saved partial body");
        const restored = await replay();
        try {
          await restored.waitFor(() => restored.screen().includes("❯"));
          expect(restored.screen().filter((row) => row.includes(expected))).toHaveLength(1);
          expect(restored.screen().join("\n")).toContain("saved partial body");
          restored.stdin.write("\x0f");
          await restored.waitFor(() =>
            restored.screen().join("\n").includes("saved partial thinking"),
          );
          expect(restored.calls).toHaveLength(0);
        } finally {
          await restored.cleanup();
        }
      } finally {
        await app.cleanup();
      }
    });
  }
}

test.each(["assistant", "toolResult"] as const)(
  "a %s persistence failure reconciles committed history live and after Resume",
  async (failure) => {
    const { createJsonlStore } = await import("@rukie/agent");
    const argv: string[] = [];
    let store: ReturnType<typeof createJsonlStore>;
    let rejected = false;
    const options: NonNullable<Parameters<typeof startWithClock>[1]> = {
      rows: 40,
      env: { LANG: "en" },
      session: { permissionMode: "full-access" },
      prepare: async (root) => {
        store = createJsonlStore({ cwd: root, homeDir: root });
        const model = createFauxCore({ api: "faux", provider: "faux" });
        model.setResponses([fauxAssistantMessage("seed reply")]);
        const seed = await createSession({
          cwd: root,
          homeDir: root,
          model: model.getModel(),
          streamFn: withAuxiliaryRequests((m, c, o) => model.streamSimple(m, c, o)),
        });
        try {
          await seed.run("seed prompt");
          argv.push("--resume", seed.id);
        } finally {
          await seed.dispose();
        }
        options.session!.store = {
          ...store,
          async open(...args) {
            const stored = await store.open(...args);
            return new Proxy(stored, {
              get(target, key) {
                if (key === "branch")
                  return async (...branchArgs: Parameters<typeof stored.branch>) => {
                    const branch = await target.branch(...branchArgs);
                    if (!branch) return branch;
                    return new Proxy(branch, {
                      get(owner, method) {
                        if (method === "appendMessage")
                          return async (
                            ...messageArgs: Parameters<typeof branch.appendMessage>
                          ) => {
                            const message = messageArgs[0];
                            if (
                              !rejected &&
                              ((failure === "assistant" &&
                                message.role === "assistant" &&
                                JSON.stringify(message).includes("ghost-tail")) ||
                                (failure === "toolResult" &&
                                  message.role === "toolResult" &&
                                  message.toolName === "write"))
                            ) {
                              rejected = true;
                              throw new Error(`${failure} save failed`);
                            }
                            return owner.appendMessage(...messageArgs);
                          };
                        const value = Reflect.get(owner, method);
                        return typeof value === "function" ? value.bind(owner) : value;
                      },
                    });
                  };
                const value = Reflect.get(target, key);
                return typeof value === "function" ? value.bind(target) : value;
              },
            });
          },
        };
      },
    };
    const app = await startWithClock(argv, options);
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      app.stdin.write("try saving\r");
      await app.waitFor(() => app.calls.length === 1);
      if (failure === "assistant") {
        app.calls[0]!.thinking("ghost-thinking");
        app.calls[0]!.delta("ghost-tail");
        await app.waitFor(() => app.screen().join("\n").includes("ghost-tail"));
      } else {
        app.calls[0]!.tool("write", { path: "executed.txt", content: "actual side effect" });
      }
      app.calls[0]!.finish();
      await app.waitFor(() => !app.isWorking());
      await app.waitFor(() => app.screen().join("\n").includes(`${failure} save failed`));
      expect(app.screen().join("\n")).not.toContain("ghost-tail");
      expect(app.screen().join("\n")).not.toContain("ghost-thinking");
      if (failure === "toolResult") {
        expect(app.screen().join("\n")).toContain("Outcome unknown");
        expect(await Bun.file(`${app.root}/executed.txt`).text()).toBe("actual side effect");
        expect(app.calls).toHaveLength(1);
      }
      expect(app.screen().join("\n")).toContain("seed reply");
      const restored = await start(argv, {
        rows: 40,
        env: { LANG: "en" },
        advanceTimers: (ms) => jest.advanceTimersByTime(ms),
        session: { cwd: app.root, homeDir: app.root },
      });
      try {
        await restored.waitFor(() => restored.screen().includes("❯"));
        expect(restored.screen().join("\n")).toContain(`${failure} save failed`);
        expect(restored.screen().join("\n")).not.toContain("ghost-tail");
        expect(restored.screen().join("\n")).not.toContain("ghost-thinking");
        if (failure === "toolResult") {
          expect(restored.screen().join("\n")).toContain("Outcome unknown");
          expect(restored.calls).toHaveLength(0);
          expect(await Bun.file(`${app.root}/executed.txt`).text()).toBe("actual side effect");
        }
        restored.stdin.write("continue\r");
        await restored.waitFor(() => restored.calls.length === 1);
        expect(JSON.stringify(restored.calls[0]!.context.messages)).not.toContain("ghost-tail");
        expect(JSON.stringify(restored.calls[0]!.context.messages)).not.toContain("session-notice");
        if (failure === "toolResult")
          expect(JSON.stringify(restored.calls[0]!.context.messages)).toContain(
            "unknown-tool-outcome",
          );
        restored.calls[0]!.finish();
      } finally {
        await restored.cleanup();
      }
    } finally {
      await app.cleanup();
    }
  },
);

test("native compaction notices use a quiet divider and reconstruct once on Resume", async () => {
  const { app, replay } = await seeded("en");
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("/compact\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.reply("Preserved compacted summary.");
    await app.waitFor(() => app.screen().some((row) => row.startsWith("─ Context compacted")));
    expect(app.screen().filter((row) => row.includes("Context compacted"))).toHaveLength(1);
    const row = app.screen().findIndex((row) => row.includes("Context compacted"));
    expect(app.terminal.buffer.active.getLine(row)!.getCell(0)!.getFgColor()).toBe(0x5e6673);
    const restored = await replay();
    try {
      await restored.waitFor(() => restored.screen().includes("❯"));
      expect(restored.screen().filter((row) => row.includes("Context compacted"))).toHaveLength(1);
      expect(restored.calls).toHaveLength(0);
    } finally {
      await restored.cleanup();
    }
  } finally {
    await app.cleanup();
  }
});

test.each(["en", "zh"] as const)(
  "%s actual Hook messages and warnings persist once in order with localized replay",
  async (locale) => {
    const { app, replay } = await seeded(locale, {
      onWarning: () => {},
      settings: {
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                { type: "command", command: `printf '%s' '{"systemMessage":"durable hook note"}'` },
                { type: "command", command: "exit 3" },
              ],
            },
          ],
        },
      },
    });
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      app.stdin.write("hooked prompt\r");
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.finish();
      await app.waitFor(
        () => !app.isWorking() && app.screen().join("\n").includes("durable hook note"),
      );
      const notice = app.screen().find((row) => row.includes("durable hook note"))!;
      const warning = app.screen().find((row) => row.includes("UserPromptSubmit hook"))!;
      expect(notice.startsWith("─ ")).toBe(true);
      expect(warning).toBeDefined();
      expect(app.screen().filter((row) => row.includes("durable hook note"))).toHaveLength(1);
      expect(app.screen().indexOf(notice)).toBeLessThan(app.screen().indexOf("❯ hooked prompt"));
      expect(JSON.stringify(app.calls[0]!.context.messages)).not.toContain("durable hook note");
      const restored = await replay();
      try {
        await restored.waitFor(() => restored.screen().includes("❯"));
        expect(restored.screen()).toContain(notice);
        expect(restored.screen()).toContain(warning);
        expect(restored.screen().filter((row) => row.includes("durable hook note"))).toHaveLength(
          1,
        );
        expect(restored.calls).toHaveLength(0);
      } finally {
        await restored.cleanup();
      }
    } finally {
      await app.cleanup();
    }
  },
);
