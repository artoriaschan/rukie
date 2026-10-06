import { withAuxiliaryRequests } from "../helpers/auxiliary-model.ts";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession } from "@neant/agent";
import { start } from "../helpers/app";

const assistant = process.platform === "darwin" ? "⏺" : "●";

test("resume replays stored text before input and appends the next Run to the same Session", async () => {
  const argv: string[] = [];
  let root = "";
  let id = "";
  const original = createFauxCore({ api: "faux", provider: "faux" });
  const storedReply = "⏵ 查一下报错原因\n**stored reply** 中\n⏵ 给补丁跑个验证\nsecond line";
  original.setResponses([fauxAssistantMessage(storedReply)]);
  const app = await start(argv, {
    prepare: async (directory) => {
      root = directory;
      await Bun.write(join(root, "AGENTS.md"), "hidden project instructions");
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: original.getModel(),
        streamFn: withAuxiliaryRequests((model, context, options) =>
          original.streamSimple(model, context, options),
        ),
      });
      await session.run("stored prompt 中");
      id = session.id;
      argv.push("--resume", id);
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    expect(app.screen().at(-2)).toContain("0→0");
    expect(app.screen().join("\n")).not.toContain("tokens");
    expect(app.calls).toHaveLength(0);
    const logoTop = "██  ██ ██▀▀▀▀  ▄▀▀▄  ██  ██ ▀▀██▀▀";
    const lines = app.allLines();
    expect(lines.some((line) => line.slice(42) === logoTop)).toBe(true);
    const metadata = lines.findIndex(
      (line) => line.slice(42) === `${app.model.provider}/${app.model.id}`,
    );
    expect(metadata).toBeGreaterThanOrEqual(0);
    expect(lines[metadata + 1]?.slice(42)).toBe(root.slice(0, 38));
    const restored = lines.indexOf("❯ stored prompt 中");
    expect(restored).toBeGreaterThan(metadata);
    expect(lines.slice(restored, restored + 3)).toEqual([
      "❯ stored prompt 中",
      `${assistant} **stored reply** 中`,
      "  second line",
    ]);
    const promptCell = app.terminal.buffer.active.getLine(restored)!.getCell(2)!;
    expect(promptCell.isBold()).toBeTruthy();
    expect(promptCell.getFgColor()).toBe(0xffdf80);
    expect(app.terminal.buffer.active.getLine(restored)!.getCell(79)!.isBgDefault()).toBe(true);
    expect(
      app.terminal.buffer.active
        .getLine(restored + 1)!
        .getCell(79)!
        .isBgDefault(),
    ).toBe(true);
    expect(app.screen()).toContain("❯");
    expect(app.allLines().join("\n")).not.toContain("hidden project instructions");
    expect(app.allLines().join("\n")).not.toContain("system-reminder");
    expect(app.allLines().join("\n")).not.toContain("⏵");

    app.stdin.write("continuation\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(app.calls[0]!.context.messages.slice(-5)).toMatchObject([
      { role: "user", content: [{ type: "text", text: "stored prompt 中" }] },
      { role: "assistant", content: [{ type: "text", text: storedReply }] },
      {
        role: "system",
        toolsAdded: expect.arrayContaining([
          expect.objectContaining({ name: "ask_user_question" }),
          expect.objectContaining({ name: "exit_plan_mode" }),
        ]),
      },
      { role: "user", content: [{ type: "text", text: expect.stringContaining("[状态栏]") }] },
      { role: "user", content: [{ type: "text", text: "continuation" }] },
    ]);
    app.calls[0]!.delta("resumed reply\n".repeat(12));
    app.calls[0]!.finish();
    await app.waitFor(
      () =>
        app
          .allLines()
          .filter((line) => line === "  resumed reply" || line === `${assistant} resumed reply`)
          .length === 12 && !app.isWorking(),
    );
    expect(app.allLines().filter((line) => line === "❯ stored prompt 中")).toHaveLength(1);
    expect(
      app.allLines().filter((line) => line === `${assistant} **stored reply** 中`),
    ).toHaveLength(1);
    expect(app.terminal.buffer.active.baseY).toBe(0);
    app.stdin.write("\x1b[5~");
    await app.waitFor(() => app.screen()[3]?.slice(42) === logoTop);
    expect(app.allLines()[0]).toBe(lines[0]);
    expect(app.allLines().filter((line) => line.slice(42) === logoTop)).toHaveLength(1);
    const resumed = await createSession({ cwd: root, homeDir: root, ...app, resumeId: id });
    expect(resumed.id).toBe(id);
    expect(resumed.messages.slice(-2)).toMatchObject([
      { role: "user", content: [{ type: "text", text: "continuation" }] },
      { role: "assistant", content: [{ type: "text", text: "resumed reply\n".repeat(12) }] },
    ]);
    const replay = await start(["--resume", id], { session: { cwd: root, homeDir: root } });
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
  const original = createFauxCore({ api: "faux", provider: "faux" });
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
    prepare: async (root) => {
      await Bun.write(join(root, "first.txt"), "hidden first output");
      await Bun.write(join(root, "second.txt"), "hidden second output");
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: original.getModel(),
        streamFn: withAuxiliaryRequests((model, context, options) =>
          original.streamSimple(model, context, options),
        ),
        permissionMode: "full-access",
      });
      await session.run("stored tools");
      argv.push("--resume", session.id);
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    expect(app.calls).toHaveLength(0);
    const lines = app.allLines();
    const restored = lines.indexOf("❯ stored tools");
    expect(restored).toBeGreaterThanOrEqual(0);
    expect(lines.slice(restored, restored + 2)).toEqual([
      "❯ stored tools",
      `${assistant} before tools`,
    ]);
    expect(lines.filter((line) => line === '• read {"path":"first.txt"}')).toHaveLength(1);
    expect(lines.filter((line) => line === '• read {"path":"second.txt"}')).toHaveLength(1);
    expect(lines.filter((line) => line.startsWith('✗ bash {"command":'))).toHaveLength(1);
    expect(lines).toContain("⎿ first failure");
    expect(lines).toContain("⎿ hidden first output");
    expect(lines).toContain("⎿ hidden second output");
    expect(lines).toContain("  second failure");
    expect(lines).toContain("  third failure");
    expect(lines.indexOf(`${assistant} after tools`)).toBeGreaterThan(
      lines.indexOf("  third failure"),
    );
    for (const hidden of ["fourth-hidden", "hidden reasoning", "system-reminder"])
      expect(lines.join("\n")).not.toContain(hidden);
    expect(
      lines.some(
        (line, row) =>
          /^[·•●] (read|bash) /.test(line) &&
          app.terminal.buffer.active.getLine(row)!.getCell(0)!.getFgColor() === 0x7da1de,
      ),
    ).toBe(false);

    app.stdin.write("next\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("next reply");
    app.calls[0]!.finish();
    await app.waitFor(() => app.allLines().includes(`${assistant} next reply`) && !app.isWorking());
    expect(app.allLines().filter((line) => line.startsWith("• read "))).toHaveLength(2);
    expect(app.allLines().filter((line) => line.startsWith("✗ bash "))).toHaveLength(1);
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("resume replays the restored compaction suffix without exposing its summary", async () => {
  const argv: string[] = [];
  const original = createFauxCore({ api: "faux", provider: "faux" });
  original.setResponses([
    fauxAssistantMessage("old transcript ".repeat(2000)),
    fauxAssistantMessage("hidden compaction summary"),
    fauxAssistantMessage("retained reply"),
  ]);
  const app = await start(argv, {
    prepare: async (root) => {
      const model = original.getModel();
      model.contextWindow = 4000;
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model,
        streamFn: withAuxiliaryRequests((model, context, options) =>
          original.streamSimple(model, context, options),
        ),
      });
      await session.run("old prompt");
      await session.run("retained prompt");
      argv.push("--resume", session.id);
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    const lines = app.allLines();
    const restored = lines.indexOf("❯ retained prompt");
    expect(restored).toBeGreaterThanOrEqual(0);
    expect(lines.slice(restored, restored + 2)).toEqual([
      "❯ retained prompt",
      `${assistant} retained reply`,
    ]);
    expect(app.allLines().join("\n")).not.toContain("old transcript");
    expect(app.allLines().join("\n")).not.toContain("hidden compaction summary");
    expect(app.allLines().join("\n")).not.toContain("system-reminder");
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test("resume hides a skill reminder retained by compaction while preserving user-authored tags", async () => {
  const argv: string[] = [];
  const original = createFauxCore({ api: "faux", provider: "faux" });
  original.setResponses([
    fauxAssistantMessage("old work ".repeat(15000)),
    fauxAssistantMessage("y".repeat(10000)),
    fauxAssistantMessage("Summary."),
    fauxAssistantMessage("done"),
  ]);
  const prompt = "next <system-reminder>user-authored</system-reminder>";
  const app = await start(argv, {
    prepare: async (root) => {
      await Bun.write(
        join(root, ".neant/skills/plan/SKILL.md"),
        "---\nname: plan\ndescription: Plan work\n---\nHidden skill instructions. " +
          "x".repeat(7000),
      );
      const model = original.getModel();
      model.contextWindow = 400000;
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model,
        streamFn: withAuxiliaryRequests((model, context, options) =>
          original.streamSimple(model, context, options),
        ),
      });
      await session.run("first");
      await session.run("/plan task");
      model.contextWindow = 16000;
      await session.run(prompt);
      argv.push("--resume", session.id);
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
  const faux = createFauxCore({ api: "faux", provider: "faux" });
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
        streamFn: withAuxiliaryRequests(faux.streamSimple),
      });
      await session.run("delegate", {
        onEvent(event) {
          if (event.type === "subagent_event") childId = event.agentId;
        },
      });
      argv.push("--resume", childId);
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
