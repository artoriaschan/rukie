import { testClock } from "../helpers/test-clock";
import { auxiliaryModels } from "../helpers/auxiliary-model.ts";
import { expect, test } from "bun:test";
import { startWithClock as start } from "../helpers/clock-app";

test("a delegated Subagent renders only its dedicated running row", async () => {
  const app = await start(["--permission-mode", "full-access", "--thinking", "high", "delegate"], {
    columns: 160,
    rows: 40,
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("subagent", {
      description: "Investigate renderer",
      prompt: "child investigation",
    });
    await app.waitFor(() => app.calls.length === 3);
    const child = app.calls.find((call) =>
      call.context.messages.some(
        (message) =>
          message.role === "user" &&
          JSON.stringify(message.content).includes("child investigation"),
      ),
    )!;
    const parent = app.calls.find((call, index) => index > 0 && call !== child)!;
    child.delta("first output\nsecond output");
    await app.waitFor(
      () =>
        screen().includes("子代理：Investigate renderer") && screen().includes("│ second output"),
    );
    const rows = app.screen();
    const card = rows.findIndex((line) => line.includes("子代理：Investigate renderer"));
    expect(rows[card]).toMatch(/faux\/faux-1.*high.*0 tools.*运行中/);
    expect(rows.join("\n")).not.toContain("started subagent");
    expect(rows.slice(card + 1, card + 5)).toEqual([
      "",
      "    │ first output",
      "    │ second output",
      "    │",
    ]);
    child.finish();
    parent.finish();
    await app.waitFor(() => app.calls.length === 4);
    app.calls[3]!.finish();
  } finally {
    await app.cleanup();
  }
});

for (const outcome of ["completed", "failed"] as const) {
  test(`a ${outcome} Subagent folds to its status header with final usage and error`, async () => {
    const app = await start(["--permission-mode", "full-access", "delegate"], {
      columns: 160,
      rows: 40,
      env: { LANG: "en_US.UTF-8" },
    });
    const screen = () => app.screen().join("\n");
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("subagent", { description: "Check results", prompt: "child results" });
      await app.waitFor(() => app.calls.length === 3);
      const child = app.calls.find((call) =>
        call.context.messages.some(
          (message) =>
            message.role === "user" && JSON.stringify(message.content).includes("child results"),
        ),
      )!;
      child.delta("temporary output");
      await app.waitFor(() => screen().includes("│ temporary output"));
      if (outcome === "completed") child.finish(12, 8);
      else child.fail("provider offline");
      await app.waitFor(() =>
        app
          .screen()
          .some(
            (line) =>
              line.includes("Subagent: Check results") &&
              line.includes(
                outcome === "completed" ? "Run ended normally" : "Run ended with error",
              ),
          ),
      );
      const rows = app.screen();
      const card = rows.findIndex((line) => line.includes("Subagent: Check results"));
      expect(rows[card]).toMatch(
        outcome === "completed"
          ? /^  🟢 Subagent: Check results.*20 tok.*0 tools.*Run ended normally.*⤢$/
          : /^  🔴 Subagent: Check results.*Run ended with error.*⤢$/,
      );
      expect(rows[card + 1]).toBe(outcome === "completed" ? "" : "    └ provider offline");
      expect(screen()).not.toContain("│ temporary output");
      expect(rows[card]).not.toMatch(/\p{Script=Han}/u);
    } finally {
      await app.cleanup();
    }
  });
}

test("running cards retain exactly three single output rows through streaming, tools and resize", async () => {
  const app = await start(["--permission-mode", "full-access", "delegate"], {
    columns: 160,
    rows: 40,
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("subagent", { description: "Read files", prompt: "child files" });
    await app.waitFor(() => app.calls.length === 3);
    const child = app.calls.find((call) =>
      call.context.messages.some(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("child files"),
      ),
    )!;
    child.delta("oldest\none\ntwo");
    await app.waitFor(() => screen().includes("│ oldest"));
    child.delta("\nthree\n" + "宽".repeat(100));
    await app.waitFor(() => screen().includes("│ three") && !screen().includes("│ oldest"));
    const waterfall = () => app.screen().filter((line) => line.startsWith("    │"));
    expect(waterfall()).toHaveLength(3);
    expect(waterfall().slice(0, 2)).toEqual(["    │ two", "    │ three"]);
    app.resize(40, 40);
    await app.waitFor(() => waterfall().length === 3 && waterfall()[2]!.endsWith("…"));
    expect(waterfall()).toHaveLength(3);
    app.resize(160, 40);
    child.tool("read", { path: "missing.txt" });
    await app.waitFor(
      () => app.calls.length === 4 && screen().includes("1 tools") && screen().includes("✗read"),
    );
    expect(screen()).not.toContain("│ three");
    expect(waterfall()).toEqual(["    │", "    │", "    │"]);
    const card = app.screen().findIndex((line) => line.includes("子代理：Read files"));
    expect(app.screen()[card]).toContain("16 tok");
    expect(app.screen()[card + 1]).toContain("✗read");
    expect(
      app
        .screen()
        .slice(card + 2, card + 5)
        .every((line) => line.startsWith("    │")),
    ).toBe(true);
    app.calls[3]!.delta("next message");
    await app.waitFor(() => screen().includes("│ next message"));
    expect(waterfall()).toEqual(["    │ next message", "    │", "    │"]);
  } finally {
    await app.cleanup();
  }
});

for (const [locale, waiting, aborted] of [
  ["en_US.UTF-8", "waiting for 2 subagents", "aborted"],
  ["zh_CN.UTF-8", "等待 2 个子代理", "已中止"],
] as const) {
  test(`${locale} waits only while the parent is idle and Esc aborts every running Subagent`, async () => {
    const app = await start(["--permission-mode", "full-access", "delegate"], {
      columns: 160,
      rows: 40,
      env: { LANG: locale },
    });
    const screen = () => app.screen().join("\n");
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tools([
        { name: "subagent", args: { description: "First", prompt: "child first" } },
        { name: "subagent", args: { description: "Second", prompt: "child second" } },
      ]);
      await app.waitFor(() => app.calls.length === 4 && screen().includes("Second"));
      const children = app.calls.filter((call) =>
        call.context.messages.some(
          (message) =>
            message.role === "user" &&
            /child first|child second/.test(JSON.stringify(message.content)),
        ),
      );
      const parent = app.calls.find((call, index) => index > 0 && !children.includes(call))!;
      expect(screen()).not.toContain(waiting);
      parent.finish();
      await app.waitFor(() => screen().includes(waiting));
      expect(app.isWorking()).toBe(true);
      expect(screen()).toContain(locale.startsWith("en") ? "esc interrupt" : "esc 中断");
      app.stdin.write("\x1b");
      await app.waitFor(() => !app.isWorking() && !screen().includes(waiting));
      expect(children.every((child) => child.signal!.aborted)).toBe(true);
      expect(
        app.screen().filter((line) => line.includes("🔴") && line.includes(aborted)),
      ).toHaveLength(2);
      expect(screen()).not.toContain("    │");
      app.stdin.write("again\r");
      await app.waitFor(() => app.calls.length === 5);
      expect(screen()).not.toContain(waiting);
    } finally {
      await app.cleanup();
    }
  });
}

test("a child completion clears waiting while the parent resumes and then counts the remaining child", async () => {
  const app = await start(["--permission-mode", "full-access", "delegate"], {
    columns: 160,
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools([
      { name: "subagent", args: { description: "First", prompt: "child first" } },
      { name: "subagent", args: { description: "Second", prompt: "child second" } },
    ]);
    await app.waitFor(() => app.calls.length === 4);
    const children = app.calls.filter((call) =>
      call.context.messages.some(
        (message) =>
          message.role === "user" &&
          /child first|child second/.test(JSON.stringify(message.content)),
      ),
    );
    app.calls.find((call, index) => index > 0 && !children.includes(call))!.finish();
    await app.waitFor(() => screen().includes("waiting for 2 subagents"));
    children[0]!.finish();
    await app.waitFor(() => app.calls.length === 5 && !screen().includes("waiting for"));
    expect(app.isWorking()).toBe(true);
    app.calls[4]!.finish();
    await app.waitFor(() => screen().includes("waiting for 1 subagents"));
    children[1]!.finish();
    await app.waitFor(() => app.calls.length === 6 && !screen().includes("waiting for"));
    app.calls[5]!.finish();
    await app.waitFor(() => !app.isWorking());
  } finally {
    await app.cleanup();
  }
});

test("the Subagent waterfall includes thinking and keeps it separate from streamed text", async () => {
  const app = await start(["--permission-mode", "full-access", "delegate"], {
    columns: 160,
    rows: 40,
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("subagent", { description: "Plan", prompt: "child plan" });
    await app.waitFor(() => app.calls.length === 3);
    const child = app.calls.find((call) =>
      call.context.messages.some(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("child plan"),
      ),
    )!;
    child.thinking("first thought\nsecond thought\nthird thought");
    await app.waitFor(() => screen().includes("│ third thought"));
    child.delta("answer");
    await app.waitFor(() => screen().includes("│ answer"));
    expect(app.screen().filter((line) => line.startsWith("    │"))).toEqual([
      "    │ second thought",
      "    │ third thought",
      "    │ answer",
    ]);
  } finally {
    await app.cleanup();
  }
});

test("an idle child's continuation retains exactly one dedicated row", async () => {
  const app = await start(["--permission-mode", "full-access", "delegate"], {
    columns: 160,
    rows: 60,
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("subagent", {
      description: "Continue investigation",
      prompt: "child original",
      run_in_background: false,
    });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.delta("original result");
    app.calls[1]!.finish();
    await app.waitFor(
      () => app.calls.length === 3 && screen().includes("子代理：Continue investigation"),
    );
    const result = app.calls[2]!.context.messages.findLast(
      (message) => message.role === "toolResult",
    )!;
    if (result.role !== "toolResult") throw new Error("Expected child result");
    const id = (result.details as { agentId: string }).agentId;
    app.calls[2]!.tool("send_message", { agent_id: id, message: "follow up" });
    await app.waitFor(() => app.calls.length === 5);
    const child = app.calls.find((call) =>
      call.context.messages.some(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("follow up"),
      ),
    )!;
    child.delta("continuation output");
    await app.waitFor(() => screen().includes("│ continuation output"));
    const rows = app.screen();
    const cards = rows
      .map((row, index) => (row.includes("子代理：Continue investigation") ? index : -1))
      .filter((index) => index >= 0);
    expect(cards).toHaveLength(1);
    expect(rows.join("\n")).not.toContain(`delivered to ${id}`);
    expect(rows[cards[0]!]).toContain("运行中");
    child.finish();
    const parent = app.calls[4] === child ? app.calls[3]! : app.calls[4]!;
    parent.finish();
    await app.waitFor(() => app.calls.length === 6);
    app.calls[5]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("\x0f/Continue investigation\r");
    await app.waitFor(() => screen().includes("1/2"));
    expect(screen()).toContain("1/2");
  } finally {
    await app.cleanup();
  }
});

test("parent resume initializes its persisted child card as idle before cold continuation", async () => {
  const argv: string[] = [];
  let id = "";
  const { fauxProvider, fauxAssistantMessage, fauxToolCall } =
    await import("@earendil-works/pi-ai");
  const { createSession } = await import("@rukie/agent");
  const original = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
  original.setResponses([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Stored child",
        prompt: "original child",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      [
        { type: "thinking", thinking: "stored reasoning" },
        { type: "text", text: "before tool" },
        fauxToolCall("read", { path: "missing.txt" }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("stored answer"),
    fauxAssistantMessage("parent answer"),
  ]);
  const app = await start(argv, {
    columns: 160,
    rows: 50,
    prepare: async (root) => {
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: original.getModel(),
        models: auxiliaryModels(original.provider.streamSimple),
      });
      session.subscribe((event) => {
        if (event.type === "subagent_event") id = event.agentId;
      });
      await session.run("delegate");
      argv.push("--resume", session.id);
      await session.close();
    },
  });
  try {
    const screen = () => app.screen().join("\n");
    await app.waitFor(() => screen().includes("子代理：Stored child"));
    expect(app.screen().find((row) => row.includes("子代理：Stored child"))).toContain(
      "Run 正常结束",
    );
    expect(app.isWorking()).toBe(false);
    expect(app.calls).toHaveLength(0);
    const y = app.screen().findIndex((row) => row.includes("子代理：Stored child"));
    const x = Bun.stringWidth(app.screen()[y]!.split("⤢")[0]!) + 1;
    app.stdin.write(`\x1b[<0;${x};${y + 1}M\x1b[<0;${x};${y + 1}m`);
    await app.waitFor(() => screen().includes("Agent View"));
    await app.waitFor(() => screen().includes("stored answer"));
    expect(app.calls).toHaveLength(0);
    expect(screen()).toContain("before tool");
    expect(screen()).toContain("missing.txt");
    expect(screen().indexOf("before tool")).toBeLessThan(screen().indexOf("missing.txt"));
    expect(screen().indexOf("missing.txt")).toBeLessThan(screen().indexOf("stored answer"));
    app.stdin.write("\r");
    await app.waitFor(() => screen().includes("stored reasoning"));
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen().includes("Agent View"));
    app.stdin.write("continue\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("send_message", { agent_id: id, message: "cold followup" });
    await app.waitFor(() => app.calls.length === 3);
    const child = app.calls.find((call) =>
      call.context.messages.some(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("cold followup"),
      ),
    )!;
    expect(JSON.stringify(child.context.messages)).toContain("stored answer");
    child.delta("cold output");
    await app.waitFor(() => screen().includes("│ cold output"));
    const rows = app.screen();
    expect(rows.filter((row) => row.includes("子代理：Stored child"))).toHaveLength(1);
    expect(rows.join("\n")).not.toContain(`delivered to ${id}`);
  } finally {
    await app.cleanup();
  }
});

test("fork, agent listing and failed messaging use dedicated rows live and after resume", async () => {
  const { fauxProvider, fauxAssistantMessage } = await import("@earendil-works/pi-ai");
  const { createSession } = await import("@rukie/agent");
  const argv: string[] = ["--permission-mode", "full-access"];
  let root = "";
  const app = await start(argv, {
    columns: 160,
    rows: 50,
    env: { LANG: "en_US.UTF-8" },
    async prepare(directory) {
      root = directory;
      const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
      faux.setResponses([fauxAssistantMessage("seed reply")]);
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: faux.getModel(),
        models: auxiliaryModels(faux.provider.streamSimple),
      });
      await session.run("seed prompt");
      argv.push("--resume", session.id);
      await session.close();
    },
  });
  const assertRows = (view: typeof app) => {
    const text = view.allLines().join("\n");
    expect(text).toContain("Subagent: Forked reader");
    expect(text).not.toContain("Fork subagent(");
    expect(text).not.toContain("List agents(");
    expect(text).not.toContain("Send message(");
    expect(text).not.toContain("started subagent");
    expect(text).toContain("not-found-child");
  };
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("fork reader\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("subagent_fork", {
      description: "Forked reader",
      prompt: "inspect fork",
      run_in_background: false,
    });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.delta("fork conclusion");
    app.calls[1]!.finish();
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.tool("list_agents", {});
    await app.waitFor(() => app.calls.length === 4);
    app.calls[3]!.tool("send_message", { agent_id: "not-found-child", message: "inspect more" });
    await app.waitFor(() => app.calls.length === 5);
    app.calls[4]!.finish();
    await app.waitFor(() => !app.isWorking());
    assertRows(app);
    const replay = await (
      await import("../helpers/app")
    ).start(argv, {
      columns: 160,
      rows: 50,
      env: { LANG: "en_US.UTF-8" },
      session: { cwd: root, homeDir: root },
      advanceTimers: (ms) => testClock.advanceTimersByTime(ms),
    });
    try {
      await replay.waitFor(() => replay.screen().includes("❯"));
      assertRows(replay);
    } finally {
      await replay.cleanup();
    }
  } finally {
    await app.cleanup();
  }
});
