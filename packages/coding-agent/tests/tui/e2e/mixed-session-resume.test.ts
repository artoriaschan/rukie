import { failingStorage } from "../../helpers/native-storage-failure";
import { testClock } from "../helpers/test-clock";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession } from "@rukie/agent";
import { start } from "../helpers/app";
import { startWithClock } from "../helpers/clock-app";
import { auxiliaryModels } from "../helpers/auxiliary-model";

const todos = [{ content: "Saved mixed task", status: "pending" }];

async function saveMixedSession(root: string) {
  let childId = "";
  await Bun.write(join(root, "mixed.txt"), "read-one\nread-two\nread-three\nread-four\nread-five");
  const original = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
  original.setResponses([
    fauxAssistantMessage(
      [
        { type: "thinking", thinking: "saved mixed reasoning" },
        { type: "text", text: "saved **mixed intro**" },
        fauxToolCall("read", { path: "mixed.txt" }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("ask_user_question", {
        questions: [
          {
            question: "Mixed choice?",
            header: "Choice",
            options: [
              { label: "Keep", description: "Save" },
              { label: "Drop", description: "Remove" },
            ],
          },
        ],
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("todo_write", { todos }), { stopReason: "toolUse" }),
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Mixed saved child",
        prompt: "actual mixed child input",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("saved child answer"),
    fauxAssistantMessage("saved mixed conclusion"),
  ]);
  const session = await createSession({
    cwd: root,
    homeDir: root,
    model: original.getModel(),
    models: auxiliaryModels((m, c, o) => original.provider.streamSimple(m, c, o)),
    permissionMode: "full-access",
    onQuestion: async () => ({ answers: [{ selected: ["Keep"] }] }),
  });
  try {
    session.subscribe((event) => {
      if (event.type === "subagent_event") childId = event.agentId;
    });
    await session.run("mixed saved prompt");
    expect(childId).not.toBe("");
    expect(session.toolState("todo")).toEqual(todos);
    expect((await session.readSubagent(childId))!.run?.outcome).toBe("completed");
    return { id: session.id, childId };
  } finally {
    await session.close();
  }
}

test.each([
  { locale: "en", outcome: "error" },
  { locale: "zh", outcome: "aborted" },
] as const)(
  "$locale $outcome preserves mixed committed facts and resets the fresh interface",
  async ({ locale, outcome }) => {
    const argv: string[] = [];
    let childId = "";
    const env = { LANG: locale };
    const copied: string[] = [];
    const app = await startWithClock(argv, {
      rows: 60,
      columns: 100,
      env,
      host: { writeClipboard: async (text) => (copied.push(text), true) },
      prepare: async (root) => {
        const saved = await saveMixedSession(root);
        childId = saved.childId;
        argv.push("--resume", saved.id);
      },
    });
    try {
      await app.waitFor(() => app.screen().join("\n").includes("saved mixed conclusion"));
      expect(app.calls).toHaveLength(0);
      app.stdin.write("partial mixed prompt\r");
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.thinking("committed partial mixed thinking");
      app.calls[0]!.delta("committed partial **mixed body**");
      await app.waitFor(() => app.screen().join("\n").includes("committed partial mixed body"));
      if (outcome === "error") app.calls[0]!.fail("mixed provider failure");
      else app.stdin.write("\x03");
      const ending = outcome === "error" ? "mixed provider failure" : "用户已中断";
      await app.waitFor(() => !app.isWorking() && app.screen().join("\n").includes(ending));
      const markers = [
        "mixed saved prompt",
        "saved mixed intro",
        "mixed.txt",
        "Mixed choice? → Keep",
        "Mixed saved child",
        "saved mixed conclusion",
        "partial mixed prompt",
        "committed partial mixed body",
        ending,
      ];
      const checkOrder = (text: string) => {
        let before = -1;
        for (const marker of markers) {
          expect(text.split(marker), marker).toHaveLength(2);
          const position = text.indexOf(marker);
          expect(position).toBeGreaterThan(before);
          before = position;
        }
        expect(text).not.toContain("ask_user_question");
        expect(text).not.toContain("todo_write");
        expect(text).not.toContain("system-reminder");
      };
      checkOrder(app.screen().join("\n"));
      app.stdin.write("\x0f");
      await app.waitFor(
        () =>
          app.screen().join("\n").includes("saved mixed reasoning") &&
          app.screen().join("\n").includes("read-five"),
      );
      app.stdin.write("\x1b[1;2A");
      await app.waitFor(() => {
        const row = app.screen().findIndex((line) => line.includes(ending));
        return row >= 0 && !app.terminal.buffer.active.getLine(row)!.getCell(3)!.isBgDefault();
      });
      const y = app.screen().findIndex((line) => line.includes("committed partial mixed body"));
      const readY = app.screen().findIndex((line) => line.includes("mixed.txt"));
      app.stdin.write(`\x1b[<35;4;${readY + 1}M`);
      await app.waitFor(
        () => app.terminal.buffer.active.getLine(readY)!.getCell(96)!.getBgColor() === 0x2e3440,
      );
      // Hover first: no-button motion during a native drag ends a lost release.
      app.stdin.write(`\x1b[<0;3;${y + 1}M\x1b[<32;15;${y + 1}M`);
      await app.waitFor(() => !app.terminal.buffer.active.getLine(y)!.getCell(3)!.isBgDefault());
      await app.shutdown();
      const saved = await createSession({
        cwd: app.root,
        homeDir: app.root,
        resumeId: argv[1],
        model: app.model,
        models: auxiliaryModels(() => {
          throw new Error("observation cannot request a model");
        }),
      });
      try {
        expect(saved.toolState("todo")).toEqual(todos);
        expect(saved.jobs()).toEqual([]);
        expect(
          saved.messages.filter((m) => m.role === "toolResult").map((m) => m.toolName),
        ).toEqual(["read", "ask_user_question", "todo_write", "subagent"]);
        expect(saved.messages.findLast((m) => m.role === "assistant")).toMatchObject({
          stopReason: outcome,
          content: [
            { type: "thinking", thinking: "committed partial mixed thinking" },
            { type: "text", text: "committed partial **mixed body**" },
          ],
        });
        const child = await saved.readSubagent(childId);
        expect(child!.run!.outcome).toBe("completed");
        expect(JSON.stringify(child!.messages)).toContain("actual mixed child input");
        expect(JSON.stringify(child!.messages)).toContain("saved child answer");
      } finally {
        await saved.close();
      }

      const replay = await start(argv, {
        rows: 60,
        columns: 100,
        env,
        session: { cwd: app.root, homeDir: app.root },
        advanceTimers: (ms) => testClock.advanceTimersByTime(ms),
        host: { writeClipboard: async (text) => (copied.push(text), true) },
      });
      try {
        await replay.waitFor(() => replay.screen().join("\n").includes(ending));
        checkOrder(replay.screen().join("\n"));
        expect(replay.screen().join("\n")).not.toContain("saved mixed reasoning");
        expect(replay.screen().join("\n")).not.toContain("committed partial mixed thinking");
        expect(replay.screen().join("\n")).not.toContain("read-five");
        expect(replay.calls).toHaveLength(0);
        expect(replay.isWorking()).toBe(false);
        expect(copied).toEqual([]);
        const bodyY = replay
          .screen()
          .findIndex((line) => line.includes("committed partial mixed body"));
        expect(replay.terminal.buffer.active.getLine(bodyY)!.getCell(3)!.isBgDefault()).toBe(true);
        const freshReadY = replay.screen().findIndex((line) => line.includes("mixed.txt"));
        expect(replay.terminal.buffer.active.getLine(freshReadY)!.getCell(96)!.isBgDefault()).toBe(
          true,
        );
        // A release from the old terminal gesture must not copy in this new interface.
        replay.stdin.write(`\x1b[<0;15;${bodyY + 1}m`);
        await replay.flush();
        expect(copied).toEqual([]);
        replay.stdin.write("fresh draft");
        await replay.waitFor(() => replay.screen().join("\n").includes("❯ fresh draft"));
        const cardY = replay.screen().findIndex((line) => line.includes("Mixed saved child"));
        const x = Bun.stringWidth(replay.screen()[cardY]!.split("⤢")[0]!) + 1;
        replay.stdin.write(`\x1b[<0;${x};${cardY + 1}M\x1b[<0;${x};${cardY + 1}m`);
        await replay.waitFor(() => replay.screen().join("\n").includes("Agent View"));
        await replay.waitFor(() => replay.screen().join("\n").includes("saved child answer"));
        expect(replay.screen().join("\n")).toContain("actual mixed child input");
        expect(replay.screen().join("\n")).toContain("saved child answer");
        replay.stdin.write("cannot run\r");
        await replay.flush();
        expect(replay.calls).toHaveLength(0);
        replay.stdin.write("\x1b");
        await replay.waitFor(() => replay.screen().join("\n").includes("❯ fresh draft"));
        expect(replay.stderr()).toBe("");
      } finally {
        await replay.cleanup();
      }
    } finally {
      await app.cleanup();
    }
  },
);

test("a failed write result keeps earlier mixed facts and an honest unknown outcome after cold Resume", async () => {
  const argv: string[] = [];
  let childId = "";
  let rejected = false;
  const options: NonNullable<Parameters<typeof startWithClock>[1]> = {
    rows: 60,
    columns: 100,
    env: { LANG: "en" },
    session: { permissionMode: "full-access" },
    prepare: async (root) => {
      const saved = await saveMixedSession(root);
      childId = saved.childId;
      argv.push("--resume", saved.id);
      options.session!.store = failingStorage(root, (writes) => {
        if (
          rejected ||
          !writes.some(
            (write) =>
              write.type === "entry" &&
              write.value.model?.some(
                (message) => message.role === "toolResult" && message.toolName === "write",
              ),
          )
        )
          return;
        rejected = true;
        return new Error("mixed write save failed");
      });
    },
  };
  const app = await startWithClock(argv, options);
  try {
    await app.waitFor(() => app.screen().join("\n").includes("saved mixed conclusion"));
    app.stdin.write("write after mixed history\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.thinking("committed write reasoning");
    app.calls[0]!.tool("write", { path: "effect.txt", content: "side effect ran once" });
    await app.waitFor(
      () => !app.isWorking() && app.screen().join("\n").includes("mixed write save failed"),
    );
    const assertHistory = (text: string) => {
      for (const marker of [
        "saved mixed intro",
        "Mixed choice? → Keep",
        "Mixed saved child",
        "saved mixed conclusion",
      ])
        expect(text.split(marker), marker).toHaveLength(2);
      expect(text).not.toContain("Wrote 1 lines");
      expect(text).not.toContain("running");
    };
    assertHistory(app.screen().join("\n"));
    expect(app.screen().join("\n")).toContain("Outcome unknown");
    expect(app.calls).toHaveLength(1);
    expect(await Bun.file(join(app.root, "effect.txt")).text()).toBe("side effect ran once");
    app.stdin.write("/exit\r");
    await app.exit;
    const recovered = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    recovered.setResponses([fauxAssistantMessage("recovered mixed conclusion")]);
    const saved = await createSession({
      cwd: app.root,
      homeDir: app.root,
      resumeId: argv[1],
      model: recovered.getModel(),
      models: auxiliaryModels(recovered.provider.streamSimple),
    });
    try {
      await saved.waitForIdle();
      const writeResult = saved.messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === "write",
      );
      expect(writeResult?.role === "toolResult" && writeResult.isError).toBe(true);
      expect(JSON.stringify(writeResult)).toContain("may have partially run");
      expect(JSON.stringify(writeResult)).not.toContain("unknown-tool-outcome");
      expect(saved.toolState("todo")).toEqual(todos);
      expect(saved.jobs()).toEqual([]);
      expect((await saved.readSubagent(childId))!.run!.outcome).toBe("completed");
      expect(JSON.stringify(saved.messages)).toContain("committed write reasoning");
    } finally {
      await saved.close();
    }
    const replay = await start(argv, {
      rows: 60,
      columns: 100,
      env: { LANG: "en" },
      session: { cwd: app.root, homeDir: app.root },
      advanceTimers: (ms) => testClock.advanceTimersByTime(ms),
    });
    try {
      await replay.waitFor(() => replay.screen().join("\n").includes("recovered mixed conclusion"));
      assertHistory(replay.screen().join("\n"));
      expect(replay.calls).toHaveLength(0);
      expect(await Bun.file(join(app.root, "effect.txt")).text()).toBe("side effect ran once");
      replay.stdin.write("continue explicitly\r");
      await replay.waitFor(() => replay.calls.length === 1);
      expect(JSON.stringify(replay.calls[0]!.context.messages)).toContain("may have partially run");
      expect(JSON.stringify(replay.calls[0]!.context.messages)).toContain("saved mixed conclusion");
      expect(JSON.stringify(replay.calls[0]!.context.messages)).not.toContain("session-notice");
      replay.calls[0]!.finish();
      await replay.waitFor(() => !replay.isWorking());
      expect(replay.calls).toHaveLength(1);
    } finally {
      await replay.cleanup();
    }
  } finally {
    await app.cleanup();
  }
});

test("cold mixed history starts at the bottom with fresh message navigation", async () => {
  const argv: string[] = [];
  const app = await startWithClock(argv, {
    columns: 100,
    rows: 24,
    env: { LANG: "en" },
    prepare: async (root) => {
      const saved = await saveMixedSession(root);
      argv.push("--resume", saved.id);
    },
  });
  try {
    await app.waitFor(() => app.screen().join("\n").includes("saved mixed conclusion"));
    app.stdin.write("long mixed tail\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(Array.from({ length: 45 }, (_, i) => `saved-tail-${i}`).join("\n"));
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking() && app.screen().join("\n").includes("saved-tail-44"));
    app.stdin.write("\x1b[5~");
    await app.waitFor(() => !app.screen().join("\n").includes("saved-tail-44"));
    app.stdin.write("\x1b[1;2A");
    await app.waitFor(() =>
      app
        .screen()
        .some(
          (line, y) =>
            line.includes("saved-tail-") &&
            app.terminal.buffer.active.getLine(y)?.getCell(2)?.getBgColor() === 0x2e333d,
        ),
    );
    const replay = await start(argv, {
      columns: 100,
      rows: 24,
      env: { LANG: "en" },
      session: { cwd: app.root, homeDir: app.root },
      advanceTimers: (ms) => testClock.advanceTimersByTime(ms),
    });
    try {
      await replay.waitFor(() => replay.screen().join("\n").includes("saved-tail-44"));
      expect(replay.screen()[0]).not.toContain("❯ long mixed tail");
      const y = replay.screen().findIndex((line) => line.includes("saved-tail-44"));
      expect(replay.terminal.buffer.active.getLine(y)!.getCell(2)!.isBgDefault()).toBe(true);
      replay.stdin.write("fresh bottom draft");
      await replay.waitFor(() => replay.screen().join("\n").includes("❯ fresh bottom draft"));
      expect(replay.calls).toHaveLength(0);
      expect(replay.screen().join("\n")).toContain("saved-tail-44");
      expect(replay.screen().join("\n")).not.toContain("Agent View");
      expect(replay.screen().join("\n")).not.toContain("New output");
      expect(replay.stderr()).toBe("");
    } finally {
      await replay.cleanup();
    }
  } finally {
    await app.cleanup();
  }
});
