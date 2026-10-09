import { testClock } from "../helpers/test-clock";
import { auxiliaryModels } from "../helpers/auxiliary-model.ts";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession } from "@rukie/agent";
import { start } from "../helpers/app";
import { startWithClock } from "../helpers/clock-app";

const assistant = process.platform === "darwin" ? "⏺" : "●";

test("resume rebuilds the footer context preview before submitting a new prompt", async () => {
  const argv: string[] = [];
  const original = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
  original.setResponses([fauxAssistantMessage("restored context ".repeat(100))]);
  const app = await startWithClock(argv, {
    rows: 24,
    env: { LANG: "en" },
    prepare: async (root) => {
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: original.getModel(),
        models: auxiliaryModels((model, context, options) =>
          original.provider.streamSimple(model, context, options),
        ),
      });
      await session.run("saved prompt");
      argv.push("--resume", session.id);
      await session.close();
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    expect(app.screen().join("\n")).toContain("/128k");
    expect(app.screen().at(-2)).toContain("0→0");
    expect(app.calls).toHaveLength(0);
    const before = app.output();
    app.resize(40, 12);
    await app.waitFor(() => app.output() !== before);
    expect(app.screen().join("\n")).toContain("/128k");
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test("resume replays stored text before input and appends the next Run to the same Session", async () => {
  const argv: string[] = [];
  let root = "";
  let id = "";
  const original = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
  const storedReply = "⏵ 查一下报错原因\n**stored reply** 中\n⏵ 给补丁跑个验证\nsecond line";
  original.setResponses([fauxAssistantMessage(storedReply)]);
  const app = await startWithClock(argv, {
    rows: 28,
    prepare: async (directory) => {
      root = directory;
      await Bun.write(join(root, "AGENTS.md"), "hidden project instructions");
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: original.getModel(),
        models: auxiliaryModels((model, context, options) =>
          original.provider.streamSimple(model, context, options),
        ),
      });
      await session.run("stored prompt 中");
      id = session.id;
      argv.push("--resume", id);
      await session.close();
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    expect(app.screen().at(-2)).toContain("0→0");
    expect(app.screen().join("\n")).not.toContain("tokens");
    expect(app.calls).toHaveLength(0);
    const logoTop = "██▀▀▄▄ ██  ██ ██  ██ ▀▀██▀▀ ██▀▀▀▀";
    const lines = app.allLines();
    expect(lines.some((line) => line.slice(42) === logoTop)).toBe(true);
    const metadata = lines.findIndex(
      (line) => line.slice(42) === `${app.model.provider}/${app.model.id}`,
    );
    expect(metadata).toBeGreaterThanOrEqual(0);
    expect(lines[metadata + 1]?.slice(42)).toBe(root.slice(0, 37) + "…");
    const restored = lines.indexOf("❯ stored prompt 中");
    expect(restored).toBeGreaterThan(metadata);
    expect(lines.slice(restored, restored + 4)).toEqual([
      "❯ stored prompt 中",
      "",
      `${assistant} stored reply 中`,
      "  second line",
    ]);
    const promptCell = app.terminal.buffer.active.getLine(restored)!.getCell(2)!;
    expect(promptCell.isBold()).toBeTruthy();
    expect(promptCell.getFgColor()).toBe(0xffdf80);
    expect(app.terminal.buffer.active.getLine(restored)!.getCell(79)!.isBgDefault()).toBe(true);
    expect(
      app.terminal.buffer.active
        .getLine(restored + 2)!
        .getCell(79)!
        .isBgDefault(),
    ).toBe(true);
    expect(app.screen()).toContain("❯");
    expect(app.allLines().join("\n")).not.toContain("hidden project instructions");
    expect(app.allLines().join("\n")).not.toContain("system-reminder");
    expect(app.allLines().join("\n")).not.toContain("⏵");

    app.stdin.write("continuation\r");
    await app.waitFor(() => app.calls.length === 1);
    const context = app.calls[0]!.context.messages;
    expect(context).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "user",
          content: [{ type: "text", text: "stored prompt 中" }],
        }),
        expect.objectContaining({
          role: "assistant",
          content: [{ type: "text", text: storedReply }],
        }),
        expect.objectContaining({
          role: "system",
          toolsAdded: expect.arrayContaining([
            expect.objectContaining({ name: "ask_user_question" }),
            expect.objectContaining({ name: "exit_plan_mode" }),
          ]),
        }),
      ]),
    );
    expect(context.findLast((message) => message.role === "user")).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "continuation" }],
    });
    expect(
      context.filter(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("[状态栏]"),
      ),
    ).toHaveLength(1);
    app.calls[0]!.delta("resumed reply\n".repeat(12));
    app.calls[0]!.finish();
    await app.waitFor(
      () =>
        app.allLines().filter((line) => {
          const body = line.slice(0, 78).trimEnd();
          return body === "  resumed reply" || body === `${assistant} resumed reply`;
        }).length === 12 && !app.isWorking(),
    );
    expect(app.terminal.buffer.active.baseY).toBe(0);
    app.stdin.write("\x1b[5~");
    await app.waitFor(() => app.screen()[4]?.slice(42) === logoTop);
    expect(app.allLines().filter((line) => line === "❯ stored prompt 中")).toHaveLength(1);
    expect(app.allLines().filter((line) => line === `${assistant} stored reply 中`)).toHaveLength(
      1,
    );
    // The added Logo/message gap changes the initial bottom-follow crop.
    expect(app.allLines()).toContain(lines[0]!);
    expect(app.allLines().filter((line) => line.slice(42) === logoTop)).toHaveLength(1);
    await app.shutdown();
    const resumed = await createSession({ cwd: root, homeDir: root, ...app, resumeId: id });
    expect(resumed.id).toBe(id);
    expect(
      resumed.messages
        .filter(
          (message) =>
            message.role === "assistant" || (message.role === "user" && !("source" in message)),
        )
        .slice(-2),
    ).toMatchObject([
      { role: "user", content: [{ type: "text", text: "continuation" }] },
      { role: "assistant", content: [{ type: "text", text: "resumed reply\n".repeat(12) }] },
    ]);
    await resumed.close();
    const replay = await start(["--resume", id], {
      session: { cwd: root, homeDir: root },
      advanceTimers: (ms) => testClock.advanceTimersByTime(ms),
    });
    try {
      await replay.waitFor(() => replay.screen().includes("❯"));
      expect(replay.allLines().join("\n")).not.toContain("⏵");
      replay.stdin.write("resume again\r");
      await replay.waitFor(() => replay.calls.length === 1);
      expect(
        replay.calls[0]!.context.messages.filter(
          (message) =>
            message.role === "user" && JSON.stringify(message.content).includes("[状态栏]"),
        ),
      ).toHaveLength(1);
    } finally {
      await replay.cleanup();
    }
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("resume replays each tool's collapsed result and error preview without reminders", async () => {
  const argv: string[] = [];
  const original = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
  original.setResponses([
    fauxAssistantMessage(
      [
        { type: "thinking", thinking: "hidden reasoning" },
        { type: "text", text: "before tools" },
        fauxToolCall("read", { path: "first.txt" }, { id: "first-read" }),
        fauxToolCall("read", { path: "second.txt" }, { id: "second-read" }),
        fauxToolCall(
          "bash",
          {
            command:
              "printf 'first failure\\nsecond failure\\nthird failure\\nfourth-hidden\\n'; exit 1",
            description: "Run test command",
          },
          { id: "failed-bash" },
        ),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("after tools"),
  ]);
  const app = await start(argv, {
    rows: 40,
    prepare: async (root) => {
      await Bun.write(join(root, "first.txt"), "hidden first output");
      await Bun.write(join(root, "second.txt"), "hidden second output");
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: original.getModel(),
        models: auxiliaryModels((model, context, options) =>
          original.provider.streamSimple(model, context, options),
        ),
        permissionMode: "full-access",
      });
      await session.run("stored tools");
      argv.push("--resume", session.id);
      await session.close();
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    expect(app.calls).toHaveLength(0);
    const lines = app.allLines();
    const restored = lines.indexOf("❯ stored tools");
    expect(restored).toBeGreaterThanOrEqual(0);
    expect(lines.slice(restored, restored + 5)).toEqual([
      "❯ stored tools",
      "",
      "🧠 思考 （Ctrl+O 展开）",
      "",
      `${assistant} before tools`,
    ]);
    expect(lines.filter((line) => line.startsWith("• 读取 first.txt"))).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith("• 读取 second.txt"))).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith("✗ 执行("))).toHaveLength(1);
    expect(lines).toContain(" ⎿ first failure");
    expect(lines).toContain(" ⎿ hidden first output");
    expect(lines).toContain(" ⎿ hidden second output");
    expect(lines).toContain("   second failure");
    expect(lines).toContain("   third failure");
    expect(lines.indexOf(`${assistant} after tools`)).toBeGreaterThan(
      lines.indexOf("   third failure"),
    );
    expect(lines).not.toContain("   fourth-hidden");
    for (const hidden of ["hidden reasoning", "system-reminder"])
      expect(lines.join("\n")).not.toContain(hidden);
    expect(
      lines.some(
        (line, row) =>
          /^[·•●] (read|bash) /.test(line) &&
          app.terminal.buffer.active.getLine(row)!.getCell(0)!.getFgColor() === 0xe85693,
      ),
    ).toBe(false);

    app.stdin.write("next\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("next reply");
    app.calls[0]!.finish();
    await app.waitFor(() => app.allLines().includes(`${assistant} next reply`) && !app.isWorking());
    expect(app.allLines().filter((line) => line.startsWith("• 读取 "))).toHaveLength(2);
    expect(app.allLines().filter((line) => line.startsWith("✗ 执行("))).toHaveLength(1);
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("resume replays the restored compaction suffix without exposing its summary", async () => {
  const argv: string[] = [];
  const original = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
  original.setResponses([
    fauxAssistantMessage(fauxToolCall("read", { path: "old.txt" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("old transcript"),
    fauxAssistantMessage(fauxToolCall("read", { path: "old.txt" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("second old transcript"),
    fauxAssistantMessage("retained reply"),
    fauxAssistantMessage("hidden compaction summary"),
  ]);
  const app = await start(argv, {
    prepare: async (root) => {
      const model = original.getModel();
      await Bun.write(join(root, "old.txt"), "OLD_EVIDENCE widget contract ".repeat(2000));
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model,
        models: auxiliaryModels((model, context, options) =>
          original.provider.streamSimple(model, context, options),
        ),
      });
      await session.run("old prompt");
      await session.run("second old prompt");
      await session.run("retained prompt");
      await session.compact();
      argv.push("--resume", session.id);
      await session.close();
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    const lines = app.allLines();
    const restored = lines.indexOf("❯ retained prompt");
    expect(restored).toBeGreaterThanOrEqual(0);
    expect(lines.slice(restored, restored + 3)).toEqual([
      "❯ retained prompt",
      "",
      `${assistant} retained reply`,
    ]);
    // Native compaction retains committed Transcript while shortening model context.
    expect(app.allLines()).toContain(`${assistant} second old transcript`);
    expect(app.allLines().join("\n")).not.toContain("hidden compaction summary");
    expect(app.allLines().join("\n")).not.toContain("system-reminder");
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test("resume hides a skill reminder retained by compaction while preserving user-authored tags", async () => {
  const argv: string[] = [];
  const original = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
  original.setResponses([
    fauxAssistantMessage(fauxToolCall("read", { path: "old.txt" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("first evidence"),
    fauxAssistantMessage(fauxToolCall("read", { path: "old.txt" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("second evidence"),
    fauxAssistantMessage("done"),
    fauxAssistantMessage("Summary."),
  ]);
  const prompt = "next <system-reminder>user-authored</system-reminder>";
  const app = await start(argv, {
    prepare: async (root) => {
      await Bun.write(
        join(root, ".rukie/skills/plan/SKILL.md"),
        "---\nname: plan\ndescription: Plan work\n---\nHidden skill instructions. " +
          "x".repeat(7000),
      );
      const model = original.getModel();
      await Bun.write(join(root, "old.txt"), "OLD_EVIDENCE widget contract ".repeat(2000));
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model,
        models: auxiliaryModels((model, context, options) =>
          original.provider.streamSimple(model, context, options),
        ),
      });
      await session.run("first");
      await session.run("/plan task");
      await session.run(prompt);
      await session.compact();
      argv.push("--resume", session.id);
      await session.close();
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    expect(app.allLines().join("\n")).not.toContain("Hidden skill instructions.");
    expect(app.allLines()).not.toContain("❯ <system-reminder>");
    expect(app.allLines()).toContain(`❯ ${prompt}`);
    expect(app.allLines()).toContain(`${assistant} done`);
    expect(app.calls).toHaveLength(0);
    app.stdin.write("continue\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(JSON.stringify(app.calls[0]!.context.messages)).toContain("Hidden skill instructions.");
    app.calls[0]!.delta("continued");
    app.calls[0]!.finish();
    await app.waitFor(() => app.allLines().includes(`${assistant} continued`) && !app.isWorking());
    expect(app.allLines().join("\n")).not.toContain("Hidden skill instructions.");
  } finally {
    await app.cleanup();
  }
});

test("--resume rejects a child session before requesting a model turn", async () => {
  const argv: string[] = [];
  let childId = "";
  const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("subagent", { description: "Child", prompt: "child", run_in_background: false }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("child closing"),
    fauxAssistantMessage("parent closing"),
  ]);
  const app = await start(argv, {
    prepare: async (root) => {
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: faux.getModel(),
        models: auxiliaryModels(faux.provider.streamSimple),
      });
      session.subscribe((event) => {
        if (event.type === "subagent_event") childId = event.agentId;
      });
      await session.run("delegate");
      argv.push("--resume", childId);
      await session.close();
    },
  });
  try {
    expect(await app.exit).toBe(1);
    expect(app.stderr()).toContain(childId);
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});
