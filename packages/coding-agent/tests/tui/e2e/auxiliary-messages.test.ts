import { failingStorage } from "../../helpers/native-storage-failure";
import { testClock } from "../helpers/test-clock";
import { expect, test } from "bun:test";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession } from "@rukie/agent";
import { start } from "../helpers/app";
import { startWithClock } from "../helpers/clock-app";
import { auxiliaryModels } from "../helpers/auxiliary-model";

async function seeded(
  locale: "en" | "zh",
  session: NonNullable<Parameters<typeof startWithClock>[1]>["session"] = {},
  compactable = false,
) {
  const argv: string[] = [];
  const env = { LANG: locale === "zh" ? "zh_CN.UTF-8" : "en_US.UTF-8" };
  const app = await startWithClock(argv, {
    session,
    columns: 80,
    rows: 40,
    env,
    prepare: async (root) => {
      const model = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
      if (compactable) {
        await Bun.write(`${root}/context.txt`, "retained fact ".repeat(6000));
        model.setResponses([
          fauxAssistantMessage(
            [
              fauxToolCall("read", { path: "context.txt" }, { id: "read-context-1" }),
              fauxToolCall("read", { path: "context.txt" }, { id: "read-context-2" }),
            ],
            { stopReason: "toolUse" },
          ),
          fauxAssistantMessage("seed reply"),
          fauxAssistantMessage("recent retained reply"),
        ]);
      } else model.setResponses([fauxAssistantMessage("seed reply")]);
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: model.getModel(),
        models: auxiliaryModels((m, c, o) => model.provider.streamSimple(m, c, o)),
      });
      try {
        await session.run("seed prompt");
        if (compactable) await session.run("recent retained task");
        argv.push("--resume", session.id);
      } finally {
        await session.close();
      }
    },
  });
  return {
    app,
    async replay() {
      app.stdin.write("/exit\r");
      await app.exit;
      return start(argv, {
        columns: 80,
        rows: 40,
        env,
        advanceTimers: (ms) => testClock.advanceTimersByTime(ms),
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
    const argv: string[] = [];
    let rejected = false;
    const options: NonNullable<Parameters<typeof startWithClock>[1]> = {
      rows: 40,
      env: { LANG: "en" },
      session: { permissionMode: "full-access" },
      prepare: async (root) => {
        const model = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
        model.setResponses([fauxAssistantMessage("seed reply")]);
        const seed = await createSession({
          cwd: root,
          homeDir: root,
          model: model.getModel(),
          models: auxiliaryModels((m, c, o) => model.provider.streamSimple(m, c, o)),
        });
        try {
          await seed.run("seed prompt");
          argv.push("--resume", seed.id);
        } finally {
          await seed.close();
        }
        options.session!.store = failingStorage(root, (writes) => {
          if (
            rejected ||
            !writes.some(
              (write) =>
                write.type === "entry" &&
                write.value.model?.some(
                  (message) =>
                    (failure === "assistant" &&
                      message.role === "assistant" &&
                      JSON.stringify(message).includes("ghost-tail")) ||
                    (failure === "toolResult" &&
                      message.role === "toolResult" &&
                      message.toolName === "write"),
                ),
            )
          )
            return;
          rejected = true;
          return new Error(`${failure} save failed`);
        });
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
      if (failure === "assistant") app.calls[0]!.finish();
      await app.waitFor(() => !app.isWorking());
      await app.waitFor(() => app.screen().join("\n").includes(`${failure} save failed`));
      expect(app.screen().join("\n")).not.toContain("ghost-tail");
      expect(app.screen().join("\n")).not.toContain("ghost-thinking");
      if (failure === "toolResult") {
        expect(app.screen().join("\n")).toMatch(/\? Write/);
        expect(await Bun.file(`${app.root}/executed.txt`).text()).toBe("actual side effect");
        expect(app.calls).toHaveLength(1);
      }
      expect(app.screen().join("\n")).toContain("seed reply");
      app.stdin.write("/exit\r");
      await app.exit;
      const restored = await start(argv, {
        rows: 40,
        env: { LANG: "en" },
        advanceTimers: (ms) => testClock.advanceTimersByTime(ms),
        session: { cwd: app.root, homeDir: app.root },
      });
      try {
        await restored.waitFor(() => restored.calls.length === 1);
        const recoveryContext = JSON.stringify(restored.calls[0]!.context.messages);
        expect(recoveryContext).not.toContain("session-notice");
        expect(recoveryContext).not.toContain("unknown-tool-outcome");
        if (failure === "toolResult") {
          expect(recoveryContext).toContain("may have partially run");
          expect(await Bun.file(`${app.root}/executed.txt`).text()).toBe("actual side effect");
        }
        restored.calls[0]!.reply("recovered conclusion");
        await restored.waitFor(
          () =>
            !restored.isWorking() && restored.screen().join("\n").includes("recovered conclusion"),
        );
        expect(restored.screen().join("\n")).toContain("seed reply");
        expect(
          restored.screen().filter((line) => line.includes("recovered conclusion")),
        ).toHaveLength(1);
        if (failure === "assistant") {
          // Native resume archives the committed partial attempt before retrying the failed completion.
          expect(restored.screen().join("\n")).toContain("ghost-tail");
        } else {
          expect(restored.screen().join("\n")).not.toContain("ghost-tail");
        }
        restored.stdin.write("continue\r");
        await restored.waitFor(() => restored.calls.length === 2);
        expect(JSON.stringify(restored.calls[1]!.context.messages)).toContain(
          "recovered conclusion",
        );
        restored.calls[1]!.finish();
      } finally {
        await restored.cleanup();
      }
    } finally {
      await app.cleanup();
    }
  },
);

test("native compaction notices use a quiet divider and reconstruct once on Resume", async () => {
  const { app, replay } = await seeded("en", {}, true);
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
