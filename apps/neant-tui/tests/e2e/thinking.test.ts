import { expect, jest, test } from "bun:test";
import { startWithClock } from "../helpers/clock-app";

function click(app: Awaited<ReturnType<typeof startWithClock>>, x: number, y: number) {
  app.stdin.write(`\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`);
}

test("thinking preview holds three rows, keeps newest Unicode and folds on first text", async () => {
  const app = await startWithClock(["reason"], { columns: 40, rows: 40, env: { LANG: "en" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.thinking("old\nfirst\nsecond\n" + "中".repeat(40) + " newest🐋");
    await app.waitFor(() => app.screen().join("\n").includes("newest🐋"));
    const headerRow = app.screen().findIndex((row) => row.includes("Thinking"));
    const rows = app.screen().filter((row) => row.startsWith("  │ "));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain("first");
    expect(rows[1]).toContain("second");
    expect(rows[2]).toContain("…");
    expect(app.screen().every((row) => Bun.stringWidth(row) <= 40)).toBe(true);
    app.calls[0]!.thinking(" updated🐋");
    await app.waitFor(() => app.screen().join("\n").includes("updated🐋"));
    expect(app.screen().findIndex((row) => row.includes("Thinking"))).toBe(headerRow);
    expect(app.screen().filter((row) => row.startsWith("  │ "))).toHaveLength(3);
    app.resize(60, 40);
    await app.waitFor(() => app.screen().filter((row) => row.startsWith("  │ ")).length === 3);
    app.calls[0]!.delta("answer");
    await app.waitFor(() => app.screen().join("\n").includes("answer"));
    expect(app.screen().filter((row) => row.startsWith("  │ "))).toHaveLength(0);
    expect(app.screen().join("\n")).not.toContain("newest🐋");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().join("\n")).toContain("🧠 Thinking");
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("thinking header whitespace click shows full content until Run end and ignores body clicks", async () => {
  const app = await startWithClock(["reason"], { rows: 40, env: { LANG: "en" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.thinking("first secret\nsecond\nthird\nlatest");
    await app.waitFor(() => app.screen().join("\n").includes("latest"));
    const header = () => app.screen().findIndex((row) => row.includes("Thinking"));
    click(app, 79, header());
    await app.waitFor(() => app.screen().join("\n").includes("first secret"));
    expect(app.screen().join("\n")).toContain("first secret");
    const body = app.screen().findIndex((row) => row.includes("first secret"));
    click(app, 3, body);
    await app.flush();
    expect(app.screen().join("\n")).toContain("first secret");
    const firstCell = app.terminal.buffer.active.getLine(body)!.getCell(2)!;
    expect(firstCell.isDim()).toBeTruthy();
    app.calls[0]!.delta("answer");
    await app.waitFor(() => app.screen().join("\n").includes("answer"));
    expect(app.screen().join("\n")).toContain("first secret");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    await app.waitFor(() => !app.screen().join("\n").includes("first secret"));
    click(app, 3, header());
    await app.waitFor(() => app.screen().join("\n").includes("first secret"));
  } finally {
    await app.cleanup();
  }
});

test("full thinking survives tool settlement and subsequent Turns, then folds at Run end", async () => {
  const app = await startWithClock(["--yolo", "reason"], { rows: 40, env: { LANG: "en" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.thinking("first secret\nsecond\nthird\nlatest");
    await app.waitFor(() => app.screen().join("\n").includes("latest"));
    const header = app.screen().findIndex((row) => row.includes("Thinking"));
    click(app, 3, header);
    await app.waitFor(() => app.screen().join("\n").includes("first secret"));
    app.calls[0]!.tool("read", { path: ".keep" });
    await app.waitFor(() => app.calls.length === 2);
    expect(app.screen().join("\n")).toContain("first secret");
    app.calls[1]!.delta("final answer");
    await app.waitFor(() => app.screen().join("\n").includes("final answer"));
    expect(app.screen().join("\n")).toContain("first secret");
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    await app.waitFor(() => !app.screen().join("\n").includes("first secret"));
  } finally {
    await app.cleanup();
  }
});

test("thinking preview settles on streamed tool input and measured duration is displayed", async () => {
  const app = await startWithClock(["reason"], { rows: 40 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.thinking("最新思考🐋");
    await app.waitFor(() => app.screen().join("\n").includes("最新思考🐋"));
    jest.advanceTimersByTime(2500);
    await app.flush();
    app.calls[0]!.toolDelta("{");
    await app.waitFor(() => !app.screen().join("\n").includes("最新思考🐋"));
    expect(app.screen().join("\n")).toContain("思考 · 2s");
    expect(app.screen().join("\n")).toContain("Ctrl+O");
    app.calls[0]!.fail("provider ended");
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().join("\n")).toContain("思考 · 2s");
  } finally {
    await app.cleanup();
  }
});

test("resumed thinking paints its full Markdown immediately with saved duration and default fold", async () => {
  const { createSession } = await import("@neant/agent");
  const { createFauxCore, createAssistantMessageEventStream, fauxAssistantMessage } =
    await import("@earendil-works/pi-ai");
  const { withAuxiliaryRequests } = await import("../helpers/auxiliary-model");
  const argv: string[] = [];
  const app = await startWithClock(argv, {
    rows: 40,
    env: { LANG: "en" },
    prepare: async (root) => {
      const partial = fauxAssistantMessage(
        [
          {
            type: "thinking",
            thinking: "**saved reasoning**\n\n```ts\nconst saved = 1;\n```\n\nfinal 🐋",
          },
        ],
        { stopReason: "pending" },
      );
      const stream = createAssistantMessageEventStream();
      let clock = 1000;
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: createFauxCore({ api: "faux", provider: "faux" }).getModel(),
        now: () => new Date(clock),
        streamFn: withAuxiliaryRequests(() => {
          stream.push({ type: "start", partial });
          stream.push({
            type: "thinking_delta",
            contentIndex: 0,
            delta: "saved reasoning",
            partial,
          });
          return stream;
        }),
      });
      try {
        await session.run("saved prompt", {
          onEvent(event) {
            if (event.type !== "message_update") return;
            clock = 3500;
            const final = { ...partial, stopReason: "stop" as const };
            stream.push({ type: "done", reason: "stop", message: final });
            stream.end(final);
          },
        });
        argv.push("--resume", session.id);
      } finally {
        await session.dispose();
      }
    },
  });
  try {
    await app.waitFor(() => app.screen().join("\n").includes("Thinking · 2s"));
    expect(app.screen().join("\n")).not.toContain("saved reasoning");
    const header = app.screen().findIndex((row) => row.includes("Thinking · 2s"));
    click(app, 3, header);
    await app.waitFor(() => app.screen().join("\n").includes("final 🐋"));
    expect(app.screen().join("\n")).toContain("const saved = 1;");
    expect(app.screen().join("\n")).not.toContain("**saved reasoning**");
    const code = app.screen().findIndex((row) => row.includes("const saved = 1;"));
    expect(app.terminal.buffer.active.getLine(code)!.getCell(4)!.isDim()).toBeTruthy();
    expect(app.calls).toHaveLength(0);
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("live full thinking reveals smoothly while the raw ticker follows arrivals and settlement chases the tail", async () => {
  const app = await startWithClock(["reason"], { rows: 50, env: { LANG: "en" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.thinking("start " + "x".repeat(1800) + " latest-tail");
    await app.waitFor(() => app.screen().join("\n").includes("latest-tail"));
    const header = app.screen().findIndex((row) => row.includes("Thinking"));
    click(app, 3, header);
    await app.waitFor(() => app.screen().join("\n").includes("start"));
    expect(app.screen().join("\n")).not.toContain("latest-tail");
    app.calls[0]!.delta("answer");
    await app.waitFor(() => app.screen().join("\n").includes("answer"));
    expect(app.screen().join("\n")).not.toContain("latest-tail");
    await app.waitFor(() => app.screen().join("\n").includes("latest-tail"));
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    await app.waitFor(() => !app.screen().join("\n").includes("latest-tail"));
  } finally {
    await app.cleanup();
  }
});

test.each(["before", "during"] as const)(
  "settled thinking manually expanded %s the next Run survives its completion",
  async (when) => {
    const app = await startWithClock(["first"], { rows: 50, env: { LANG: "en" } });
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.thinking("historical secret marker");
      app.calls[0]!.delta("first answer");
      app.calls[0]!.finish();
      await app.waitFor(() => !app.isWorking() && app.screen().join("\n").includes("first answer"));
      const y = app.screen().findIndex((line) => line.includes("Thinking"));
      if (when === "before") {
        click(app, 3, y);
        await app.waitFor(() => app.screen().join("\n").includes("historical secret marker"));
      }
      app.stdin.write("second\r");
      await app.waitFor(() => app.calls.length === 2);
      if (when === "during") {
        click(app, 3, y);
        await app.waitFor(() => app.screen().join("\n").includes("historical secret marker"));
      }
      expect(app.screen().join("\n")).toContain("historical secret marker");
      app.calls[1]!.delta("second answer");
      app.calls[1]!.finish();
      await app.waitFor(
        () => !app.isWorking() && app.screen().join("\n").includes("second answer"),
      );
      await app.flush();
      expect(app.screen().join("\n")).toContain("historical secret marker");
    } finally {
      await app.cleanup();
    }
  },
);
