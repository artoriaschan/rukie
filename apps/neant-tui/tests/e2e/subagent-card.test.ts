import { expect, test } from "bun:test";
import { start } from "../helpers/app";

test("a delegated Subagent renders its running card under the initiating tool", async () => {
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
    expect(rows[card]).toMatch(/faux\/faux-1.*high.*0 tok.*0 tools.*运行中/);
    expect(rows[card - 1]).toContain("started subagent");
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
          .some((line) => line.includes("Subagent: Check results") && line.endsWith(outcome)),
      );
      const rows = app.screen();
      const card = rows.findIndex((line) => line.includes("Subagent: Check results"));
      expect(rows[card]).toMatch(
        outcome === "completed"
          ? /^  🟢 Subagent: Check results.*20 tok.*0 tools.*completed$/
          : /^  🔴 Subagent: Check results.*failed$/,
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
    await app.waitFor(() => app.calls.length === 4 && screen().includes("1 tools"));
    const card = app.screen().findIndex((line) => line.includes("子代理：Read files"));
    expect(app.screen()[card]).toContain("16 tok");
    expect(app.screen()[card + 1]).toContain("✓read");
    expect(
      app
        .screen()
        .slice(card + 2, card + 5)
        .every((line) => line.startsWith("    │")),
    ).toBe(true);
    app.calls[3]!.delta("next message");
    await app.waitFor(() => screen().includes("│ next message"));
    expect(waterfall()[0]).toBe("    │ three");
    expect(waterfall()[1]).toEndWith("…");
    expect(waterfall()[2]).toBe("    │ next message");
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
        app.screen().filter((line) => line.includes("🔴") && line.endsWith(aborted)),
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
