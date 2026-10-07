import { expect, test } from "bun:test";
import { start } from "../helpers/app";
import { startWithClock } from "../helpers/clock-app";
import { testClock } from "../helpers/test-clock";
import { dark } from "../../../src/ink/index.ts";
import { createJsonlStore, createSession } from "@rukie/agent";
import { controlledModel } from "../helpers/model";
import { join } from "node:path";
import { count } from "../../../src/view/transcript/metrics";

test("resumed context bar retains provider input and includes MCP definitions in hover details", async () => {
  const argv: string[] = [];
  let tools = 0;
  const app = await start(argv, {
    columns: 120,
    rows: 24,
    env: { LANG: "en_US.UTF-8" },
    async prepare(root) {
      const manifest = join(root, "manifest.json");
      await Bun.write(manifest, JSON.stringify({ tools: ["search"] }));
      await Bun.write(
        join(root, ".rukie/mcp.json"),
        JSON.stringify({
          mcpServers: {
            docs: {
              command: process.execPath,
              args: [join(import.meta.dir, "../../../../agent/tests/helpers/mcp-server.ts")],
              env: {
                MCP_MANIFEST: manifest,
                MCP_PIDS: join(root, "pids"),
                MCP_CALLS: join(root, "calls"),
              },
            },
          },
        }),
      );
      const fake = controlledModel();
      const session = await createSession({
        cwd: root,
        homeDir: root,
        ...fake,
        store: createJsonlStore({ cwd: root, homeDir: root }),
      });
      const entered = Promise.withResolvers<void>();
      const dispose = session.subscribe(() => {
        if (fake.calls.length) entered.resolve();
      });
      try {
        const run = session.run("query");
        await entered.promise;
        fake.calls[0]!.reply("answer");
        // Preserve the provider's reported input/cache usage through a completed native Run.
        await run;
        const counted = session.run("counted query", {
          onEvent(event) {
            if (event.type === "context_usage") tools = event.segments.tools;
          },
        });
        const ready = Promise.withResolvers<void>();
        const unsubscribe = session.subscribe(() => {
          if (fake.calls.length === 2) ready.resolve();
        });
        await ready.promise;
        unsubscribe();
        fake.calls[1]!.finish(70000, 5, { read: 2000, write: 1000 });
        await counted;
        const report = session.contextReport();
        expect(report.mcpTools).toMatchObject([{ server: "docs", name: "search" }]);
        expect(tools).toBeGreaterThan(0);
        argv.push("--resume", session.id);
      } finally {
        dispose();
        await session.close();
      }
    },
  });
  try {
    await app.waitFor(() => app.screen().at(-2)?.includes("ctx 57% (73k/128k)") === true);
    app.stdin.write("\x1b[<35;3;22M");
    await app.waitFor(
      () =>
        app
          .screen()
          .at(-1)
          ?.includes(`tools ${count(tools)}`) === true,
    );
    expect(app.calls).toHaveLength(0);
    app.resize(80, 24);
    await app.waitFor(() => app.screen().at(-2)?.includes("ctx 57% (73k/128k)") === true);
    app.stdin.write("\x1b[<35;3;22M");
    await app.waitFor(
      () =>
        app
          .screen()
          .at(-1)
          ?.includes(`tools ${count(tools)}`) === true,
    );
  } finally {
    await app.cleanup();
  }
});

// Metric samples own their exact wall-time deadline. Renderer completion advances
// the same clock's timers without moving that sample's Date beyond the assertion.
function paintAtSampleTime(ms: number) {
  const now = Date.now();
  testClock.advanceTimersByTime(ms);
  testClock.setSystemTime(now);
}

for (const columns of [80, 60, 40]) {
  test(`Chat places fields below input until context is available at ${columns} columns`, async () => {
    const app = await start([], { columns });
    try {
      await app.waitFor(
        () => app.stdin.isRaw && app.screen().at(-2)?.startsWith(" 询问 ·") === true,
      );
      expect(app.screen().at(-3)).toMatch(/^╰─+╯$/);
      expect(app.screen().at(-1)).toBe("");
      const fieldsBeforeRun = app.screen().at(-2)!;
      const modelStart = fieldsBeforeRun.indexOf("·") + (fieldsBeforeRun.includes(" · ") ? 2 : 1);
      const modelX = Bun.stringWidth(fieldsBeforeRun.slice(0, modelStart)) + 1;
      app.stdin.write(`\x1b[<35;${modelX};23M`);
      await app.waitFor(() => app.screen().at(-1)?.includes("模型 faux-1") === true);
      expect(app.screen().at(-3)).toMatch(/^╰─+╯$/);
      app.stdin.write("\x1b[<35;80;1M");
      await app.waitFor(() => app.screen().at(-1) === "");
      app.stdin.write("first\r");
      await app.waitFor(() => app.calls.length === 1 && app.screen().at(-1)?.trim() === "esc 中断");
      expect(app.screen().at(-2)).toContain("ctx ");
      expect(app.screen().at(-4)).toMatch(/^╰─+╯$/);
      const activity = app.screen().find((line) => /^[🌑🌒🌓🌔🌕🌖🌗🌘] /u.test(line));
      expect(activity).toBeDefined();
      expect(activity).not.toContain("esc 中断");
      app.calls[0]!.finish(1000, 2000);
      await app.waitFor(() => !app.isWorking() && app.screen().at(-1) === "");
      const fields = app.screen().at(-2)!;
      expect(fields).toContain("ctx ");
      if (columns === 80) expect(fields).toContain("1.0k→2");
      app.stdin.write("second\r");
      await app.waitFor(() => app.calls.length === 2 && app.screen().at(-1)?.trim() === "esc 中断");
      if (columns === 80) {
        const fields = app.screen().at(-2)!;
        const x = Bun.stringWidth(fields.slice(0, fields.indexOf("1.0k→"))) + 1;
        app.stdin.write(`\x1b[<35;${x};23M`);
        await app.waitFor(() => app.screen().at(-1)?.includes("输入 1,000 · 输出 2,000") === true);
        app.stdin.write("\x1b[<35;80;1M");
        await app.waitFor(() => app.screen().at(-1)?.trim() === "esc 中断");
      }
      app.calls[1]!.finish(2000, 3000);
      await app.waitFor(() => !app.isWorking() && app.screen().at(-1) === "");
      if (columns === 80) {
        const fields = app.screen().at(-2)!;
        expect(fields).toContain("3.0k→5");
        const x = Bun.stringWidth(fields.slice(0, fields.indexOf("3.0k→"))) + 1;
        app.stdin.write(`\x1b[<35;${x};23M`);
        await app.waitFor(() => app.screen().at(-1)?.includes("输入 3,000 · 输出 5,000") === true);
      }
      expect(app.screen().at(-4)).toMatch(/^╰─+╯$/);
    } finally {
      await app.cleanup();
    }
  });
}

test("tps starts after 500ms of decoding and final usage corrects the Run sample", async () => {
  const app = await startWithClock(["decode"], { advanceTimers: paintAtSampleTime });
  let now = Date.now();
  const hoverSpeed = () => {
    const fields = app.screen().at(-2)!;
    const prefix = fields.slice(0, fields.indexOf("▕"));
    app.stdin.write(`\x1b[<35;${Bun.stringWidth(prefix) + 1};23M`);
  };
  try {
    await app.waitFor(() => app.calls.length === 1 && app.screen().at(-1)?.trim() === "esc 中断");
    now += 5000; // Waiting for the first delta must not count as decode time.
    testClock.setSystemTime(now);
    app.calls[0]!.thinking("x".repeat(800));
    await app.waitFor(() => app.screen().join("\n").includes("↓ 200 tokens"));
    hoverSpeed();
    await app.waitFor(() => app.screen().at(-1)?.includes("tps 0 · avg60 0.0") === true);
    now += 499;
    testClock.setSystemTime(now);
    app.calls[0]!.delta("abcd");
    await app.waitFor(() => app.screen().join("\n").includes("↓ 201 tokens"));
    expect(app.screen().at(-1)).toContain("tps 0 ·");
    now += 1;
    testClock.setSystemTime(now);
    app.calls[0]!.delta("efgh");
    await app.waitFor(() => app.screen().at(-1)?.includes("tps 404 ·") === true);
    now += 500;
    testClock.setSystemTime(now);
    app.calls[0]!.finish(1000, 50);
    await app.waitFor(() => !app.isWorking());
    // The idle sparkline occupies the same field, and moving away/back tests fresh hover.
    app.stdin.write("\x1b[<35;80;1M");
    await app.waitFor(() => app.screen().at(-1) === "");
    const fields = app.screen().at(-2)!;
    const x = Bun.stringWidth(fields.slice(0, fields.indexOf("▅"))) + 1;
    app.stdin.write(`\x1b[<35;${x};23M`);
    await app.waitFor(
      () => app.screen().at(-1)?.includes("tps 50 · avg60 50.0 · 均值 50.0 · p95 50.0") === true,
    );
  } finally {
    await app.cleanup();
  }
});

test("tps includes tool-call deltas and completed Turns while excluding time between Turns", async () => {
  const app = await startWithClock(["tool decode"], {
    advanceTimers: paintAtSampleTime,
    columns: 120,
    session: { permissionMode: "full-access" },
  });
  let now = Date.now();
  try {
    await app.waitFor(() => app.calls.length === 1);
    testClock.setSystemTime(now);
    app.calls[0]!.toolDelta("x".repeat(800));
    await app.flush();
    now += 500;
    testClock.setSystemTime(now);
    app.calls[0]!.toolDelta("abcd");
    await app.waitFor(() => app.screen().at(-2)?.includes("402 tps") === true);
    now += 500;
    testClock.setSystemTime(now);
    app.calls[0]!.tool("bash", { command: "printf ok", description: "Run test command" });
    await app.waitFor(() => app.calls.length === 2);
    now += 10000;
    testClock.setSystemTime(now);
    app.calls[1]!.delta("x".repeat(800));
    await app.waitFor(() => app.screen().join("\n").includes("↓ 205 tokens"));
    now += 500;
    testClock.setSystemTime(now);
    app.calls[1]!.delta("abcd");
    await app.waitFor(() => app.screen().at(-2)?.includes("137 tps") === true);
    now += 500;
    testClock.setSystemTime(now);
    app.calls[1]!.finish(21, 95);
    await app.waitFor(() => !app.isWorking() && app.screen().at(-2)?.includes("▅ 50 tps") === true);
    const fields = app.screen().at(-2)!;
    const x = Bun.stringWidth(fields.slice(0, fields.indexOf("▅"))) + 1;
    app.stdin.write(`\x1b[<35;${x};23M`);
    await app.waitFor(
      () => app.screen().at(-1)?.includes("tps 50 · avg60 50.0 · 均值 50.0 · p95 50.0") === true,
    );
  } finally {
    await app.cleanup();
  }
});

test("Session cache counters accumulate across Runs in hover details", async () => {
  const app = await start(["first"], { columns: 120 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.finish(1000, 100, { read: 2000, write: 1000 });
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("second\r");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish(1000, 200, { read: 4000, write: 1000 });
    await app.waitFor(
      () => !app.isWorking() && app.screen().at(-2)?.includes("缓存 60.0%") === true,
    );
    const fields = app.screen().at(-2)!;
    const x = Bun.stringWidth(fields.slice(0, fields.indexOf("缓存"))) + 1;
    app.stdin.write(`\x1b[<35;${x};23M`);
    await app.waitFor(
      () =>
        app.screen().at(-1)?.includes("缓存 60.0% · 读取 6.0k · 写入 2.0k · 输入 2.0k") === true,
    );
  } finally {
    await app.cleanup();
  }
});

test("tps hover summarizes completed Run samples", async () => {
  const app = await startWithClock([], { advanceTimers: paintAtSampleTime });
  let now = Date.now();
  try {
    await app.waitFor(() => app.stdin.isRaw);
    for (let run = 0; run < 12; run++) {
      app.stdin.write(`run ${run}\r`);
      await app.waitFor(() => app.calls.length === run + 1 && app.isWorking());
      now = Date.now();
      app.calls[run]!.thinking("x");
      await app.waitFor(() => app.screen().join("\n").includes("↓ 1 tokens"));
      now += 1000;
      testClock.setSystemTime(now);
      app.calls[run]!.finish(1, 50);
      await app.waitFor(() => !app.isWorking());
    }
    const fields = app.screen().at(-2)!;
    expect(fields).toMatch(/▅{6,12}/);
    const x = Bun.stringWidth(fields.slice(0, fields.indexOf("▅"))) + 1;
    app.stdin.write(`\x1b[<35;${x};23M`);
    await app.waitFor(
      () => app.screen().at(-1)?.includes("tps 50 · avg60 50.0 · 均值 50.0 · p95 50.0") === true,
    );
  } finally {
    try {
      await app.cleanup();
    } finally {
    }
  }
}, 60000);

test("centered return button sits above activity and input, survives footer hover, and clicks restore following", async () => {
  const app = await startWithClock(["long reply"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(Array.from({ length: 50 }, (_, i) => `line-${i}`).join("\n"));
    await app.waitFor(() => app.screen().includes("  line-49"));
    const inputTop = app.screen().findIndex((line) => /^╭─+╮$/.test(line));
    const body = app.screen().slice(0, inputTop - 2);
    app.stdin.write("\x1b[<35;75;23M");
    await app.waitFor(() => app.screen().at(-1)?.includes("剩余 ") === true);
    expect(app.screen().at(-2)).toContain("ctx ▕");
    expect(app.screen().slice(0, inputTop - 2)).toEqual(body);
    expect(app.screen().findIndex((line) => /^╭─+╮$/.test(line))).toBe(inputTop);
    const modelColumn = () => {
      const fields = app.screen().at(-2)!;
      return Bun.stringWidth(fields.slice(0, fields.indexOf("faux"))) + 1;
    };
    app.stdin.write(`\x1b[<35;${modelColumn()};23M`);
    await app.waitFor(
      () => app.screen().at(-1)?.includes("模型 faux-1 · 提供商 faux · ctx 128k") === true,
    );
    expect(app.screen().at(-2)).toContain("ctx ");
    expect(app.screen().at(-2)).not.toContain("ctx ▕");
    app.stdin.write("keep draft");
    app.stdin.write("\x1b[<35;80;1M\x1b[<64;5;2M");
    await app.waitFor(() => app.screen().some((line) => line.includes("↓ 回到底部（Ctrl+End）")));
    expect(app.screen().findIndex((line) => /^╭─+╮$/.test(line))).toBe(inputTop);
    const pillY = app.screen().findIndex((line) => line.includes("回到底部"));
    const activityY = app.screen().findIndex((line) => line.includes("tokens"));
    expect(pillY).toBeLessThan(activityY);
    expect(activityY).toBeLessThan(inputTop);
    expect(app.screen()[pillY - 1]).toBe("");
    expect(app.screen().at(-1)?.trim()).toBe("esc 中断");
    const reading = app.screen().slice(0, pillY - 1);
    app.calls[0]!.delta("\nnew output");
    await app.waitFor(
      () => app.screen()[pillY]?.includes("↓ 有新输出 · 回到底部（Ctrl+End）") === true,
    );
    expect(app.screen().slice(0, pillY - 1)).toEqual(reading);
    expect(app.screen().filter((line) => line.includes("回到底部"))).toHaveLength(1);
    app.stdin.write(`\x1b[<35;${modelColumn()};23M`);
    await app.waitFor(() => app.screen().at(-1)?.startsWith(" 模型 faux-1") === true);
    expect(app.screen()[pillY]).toContain("有新输出");
    app.stdin.write("\x1b[<35;80;1M");
    await app.waitFor(() => app.screen().at(-1)?.trim() === "esc 中断");
    app.stdin.write(`\x1b[<0;1;${pillY + 1}M\x1b[<0;1;${pillY + 1}m`);
    await app.flush();
    expect(app.screen()[pillY]).toContain("有新输出");
    const x = Bun.stringWidth(app.screen()[pillY]!.split("↓")[0]!) + 1;
    app.stdin.write(`\x1b[<0;${x};${pillY + 1}M\x1b[<0;${x};${pillY + 1}m`);
    await app.waitFor(
      () => app.screen().includes("  new output") && !app.screen().join("\n").includes("回到底部"),
    );
    expect(app.screen().join("\n")).not.toContain("回到底部");
    expect(app.screen().join("\n")).toContain("keep draft");
    expect(app.calls).toHaveLength(1);
    app.calls[0]!.delta("\nafter click");
    await app.waitFor(() => app.screen().includes("  after click"));
    expect(app.screen().at(-1)?.trim()).toBe("esc 中断");
  } finally {
    await app.cleanup();
  }
});

test.each(["idle", "approval"] as const)(
  "return button also works while %s without confirming permission",
  async (phase) => {
    const app = await startWithClock(["long reply"], {
      columns: 40,
      rows: phase === "approval" ? 24 : 12,
    });
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.delta(Array.from({ length: 50 }, (_, i) => `line-${i}`).join("\n"));
      await app.waitFor(() => app.screen().includes("  line-49"));
      if (phase === "idle") {
        app.calls[0]!.finish();
        await app.waitFor(() => !app.isWorking());
      } else {
        app.calls[0]!.tool("bash", {
          command: "printf must-wait-for-permission",
          description: "Run test command",
        });
        await app.waitFor(() => app.screen().some((line) => line.includes("等待审批")));
      }
      app.stdin.write("\x1b[<64;5;1M");
      await app.waitFor(() => app.screen().some((line) => line.includes("↓ 回到底部")));
      const y = app.screen().findIndex((line) => line.includes("回到底部"));
      expect(app.screen().at(-2)).toContain("ctx ");
      expect(app.screen().at(-1)?.trim()).toBe(phase === "idle" ? "" : "esc 中断");
      if (phase === "approval") {
        expect(y).toBeLessThan(app.screen().findIndex((line) => line.includes("等待审批")));
        expect(app.screen().some((line) => line.trim() === "printf must-wait-for-permission")).toBe(
          true,
        );
        for (const label of ["1. 允许", "2. 本 session", "3. 拒绝", "Esc拒绝"])
          expect(app.screen().join("\n")).toContain(label);
      } else expect(y).toBeLessThan(app.screen().findIndex((line) => /^╭─+╮$/.test(line)));
      const x = Bun.stringWidth(app.screen()[y]!.split("↓")[0]!) + 1;
      app.stdin.write(`\x1b[<0;${x};${y + 1}M\x1b[<0;${x};${y + 1}m`);
      await app.waitFor(() => !app.screen().some((line) => line.includes("回到底部")));
      if (phase === "idle") expect(app.screen()).toContain("  line-49");
      else expect(app.screen().some((line) => /^(?:[●⏺] |  )执行\(/.test(line))).toBe(true);
      expect(app.calls).toHaveLength(1);
      if (phase === "approval") expect(app.screen().join("\n")).toContain("等待审批");
    } finally {
      await app.cleanup();
    }
  },
);

for (const [input, pct, color] of [
  [102400, 80, dark.warning],
  [121600, 95, dark.error],
] as const) {
  test(`Chat retains context usage and warns at ${pct}% on the next Run`, async () => {
    const app = await start(["first"], { columns: 120 });
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.finish(input, 10);
      await app.waitFor(
        () => !app.isWorking() && app.screen().at(-2)?.includes(`ctx ${pct}%`) === true,
      );
      app.stdin.write("second\r");
      await app.waitFor(
        () =>
          app.calls.length === 2 && app.screen().some((line) => line.includes(`⚠ 上下文 ${pct}%`)),
      );
      const y = app.screen().findIndex((line) => line.includes("⚠ 上下文"));
      expect(app.terminal.buffer.active.getLine(y)!.getCell(3)!.getFgColor()).toBe(
        Number.parseInt(color.slice(1), 16),
      );
      expect(app.screen()[y]).not.toContain("esc 中断");
      expect(app.screen().at(-1)?.trim()).toBe("esc 中断");
    } finally {
      await app.cleanup();
    }
  });
}
