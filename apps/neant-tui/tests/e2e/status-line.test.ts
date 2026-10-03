import { expect, spyOn, test } from "bun:test";
import { start } from "../helpers/app";
import { dark } from "@neant/tui";

for (const columns of [80, 60, 40]) {
  test(`Chat places fields below input until context is available at ${columns} columns`, async () => {
    const app = await start([], { columns });
    try {
      await app.waitFor(
        () => app.stdin.isRaw && app.screen().at(-2)?.startsWith(" ask ·") === true,
      );
      expect(app.screen().at(-3)).toMatch(/^╰─+╯$/);
      expect(app.screen().at(-1)).toBe("");
      const fieldsBeforeRun = app.screen().at(-2)!;
      const modelX = fieldsBeforeRun.indexOf("·") + 2 + (fieldsBeforeRun.includes(" · ") ? 1 : 0);
      app.stdin.write(`\x1b[<35;${modelX};23M`);
      await app.waitFor(() => app.screen().at(-1)?.includes("model faux-1") === true);
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
      if (columns === 80) expect(fields).toContain("1.0k→2.0");
      app.stdin.write("second\r");
      await app.waitFor(() => app.calls.length === 2 && app.screen().at(-1)?.trim() === "esc 中断");
      if (columns === 80) {
        const fields = app.screen().at(-2)!;
        const x = Bun.stringWidth(fields.slice(0, fields.indexOf("1.0k→"))) + 1;
        app.stdin.write(`\x1b[<35;${x};23M`);
        await app.waitFor(() => app.screen().at(-1)?.includes("in 1,000 · out 2,000") === true);
        app.stdin.write("\x1b[<35;80;1M");
        await app.waitFor(() => app.screen().at(-1)?.trim() === "esc 中断");
      }
      app.calls[1]!.finish(2000, 3000);
      await app.waitFor(() => !app.isWorking() && app.screen().at(-1) === "");
      if (columns === 80) expect(app.screen().at(-2)).toContain("3.0k→5.0");
      expect(app.screen().at(-4)).toMatch(/^╰─+╯$/);
    } finally {
      await app.cleanup();
    }
  });
}

test("tps starts after 500ms of decoding and final usage corrects the Run sample", async () => {
  let now = Date.UTC(2026, 9, 2);
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  const app = await start(["decode"]);
  const hoverSpeed = () => {
    const fields = app.screen().at(-2)!;
    const prefix = fields.slice(0, fields.indexOf("▕"));
    app.stdin.write(`\x1b[<35;${Bun.stringWidth(prefix) + 1};23M`);
  };
  try {
    await app.waitFor(() => app.calls.length === 1 && app.screen().at(-1)?.trim() === "esc 中断");
    now += 5000; // Waiting for the first delta must not count as decode time.
    app.calls[0]!.thinking("x".repeat(800));
    await app.waitFor(() => app.screen().join("\n").includes("↓ 200 tokens"));
    hoverSpeed();
    await app.waitFor(() => app.screen().at(-1)?.includes("tps 0 · avg60 0.0") === true);
    now += 499;
    app.calls[0]!.delta("abcd");
    await app.waitFor(() => app.screen().join("\n").includes("↓ 201 tokens"));
    expect(app.screen().at(-1)).toContain("tps 0 ·");
    now += 1;
    app.calls[0]!.delta("efgh");
    await app.waitFor(() => app.screen().at(-1)?.includes("tps 404 ·") === true);
    now += 500;
    app.calls[0]!.finish(1000, 50);
    await app.waitFor(() => !app.isWorking());
    // The idle sparkline occupies the same field, and moving away/back tests fresh hover.
    app.stdin.write("\x1b[<35;80;1M");
    await app.waitFor(() => app.screen().at(-1) === "");
    const fields = app.screen().at(-2)!;
    const x = Bun.stringWidth(fields.slice(0, fields.indexOf("▄"))) + 1;
    app.stdin.write(`\x1b[<35;${x};23M`);
    await app.waitFor(
      () => app.screen().at(-1)?.includes("tps 50 · avg60 50.0 · mean 50.0 · p95 50.0") === true,
    );
  } finally {
    await app.cleanup();
    clock.mockRestore();
  }
});

test("tps includes tool-call deltas and completed Turns while excluding time between Turns", async () => {
  let now = Date.UTC(2026, 9, 2);
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  const app = await start(["tool decode"], {
    columns: 120,
    session: { permissionMode: "full-access" },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.toolDelta("x".repeat(800));
    await Bun.sleep(25);
    now += 500;
    app.calls[0]!.toolDelta("abcd");
    await app.waitFor(() => app.screen().at(-2)?.includes("402 tps") === true);
    now += 500;
    app.calls[0]!.tool("bash", { command: "printf ok" });
    await app.waitFor(() => app.calls.length === 2);
    now += 10000;
    app.calls[1]!.delta("x".repeat(800));
    await app.waitFor(() => app.screen().join("\n").includes("↓ 205 tokens"));
    now += 500;
    app.calls[1]!.delta("abcd");
    await app.waitFor(() => app.screen().at(-2)?.includes("137 tps") === true);
    now += 500;
    app.calls[1]!.finish(21, 95);
    await app.waitFor(() => !app.isWorking() && app.screen().at(-2)?.includes("▄") === true);
    const fields = app.screen().at(-2)!;
    const x = Bun.stringWidth(fields.slice(0, fields.indexOf("▄"))) + 1;
    app.stdin.write(`\x1b[<35;${x};23M`);
    await app.waitFor(
      () => app.screen().at(-1)?.includes("tps 50 · avg60 50.0 · mean 50.0 · p95 50.0") === true,
    );
  } finally {
    await app.cleanup();
    clock.mockRestore();
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
        app.screen().at(-1)?.includes("cache 60.0% · read 6.0k · write 2.0k · input 2.0k") === true,
    );
  } finally {
    await app.cleanup();
  }
});

test("tps statistics retain only the latest 500 Run samples", async () => {
  let now = Date.UTC(2026, 9, 2);
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  const app = await start();
  try {
    await app.waitFor(() => app.stdin.isRaw);
    for (let run = 0; run < 501; run++) {
      app.stdin.write(`run ${run}\r`);
      await app.waitFor(() => app.calls.length === run + 1 && app.isWorking());
      app.calls[run]!.thinking("x");
      await app.waitFor(() => app.screen().join("\n").includes("↓ 1 tokens"));
      now += 1000;
      app.calls[run]!.finish(1, run === 0 ? 10000 : 50);
      await app.waitFor(() => !app.isWorking());
    }
    const fields = app.screen().at(-2)!;
    expect(fields).toMatch(/▄{6,12}/);
    const x = Bun.stringWidth(fields.slice(0, fields.indexOf("▄"))) + 1;
    app.stdin.write(`\x1b[<35;${x};23M`);
    await app.waitFor(
      () => app.screen().at(-1)?.includes("tps 50 · avg60 50.0 · mean 50.0 · p95 50.0") === true,
    );
  } finally {
    await app.cleanup();
    clock.mockRestore();
  }
}, 60000);

test("hover details and scroll hints share the third footer row without shrinking the body", async () => {
  const app = await start(["long reply"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(Array.from({ length: 50 }, (_, i) => `line-${i}`).join("\n"));
    await app.waitFor(() => app.screen().includes("  line-49"));
    const inputTop = app.screen().findIndex((line) => /^╭─+╮$/.test(line));
    const body = app.screen().slice(0, inputTop - 2);
    app.stdin.write("\x1b[<35;75;23M");
    await app.waitFor(() => app.screen().at(-1)?.includes("free ") === true);
    expect(app.screen().at(-2)).toContain("ctx ▕");
    expect(app.screen().slice(0, inputTop - 2)).toEqual(body);
    expect(app.screen().findIndex((line) => /^╭─+╮$/.test(line))).toBe(inputTop);
    app.stdin.write(`\x1b[<35;${app.screen().at(-2)!.indexOf("faux") + 1};23M`);
    await app.waitFor(
      () => app.screen().at(-1)?.includes("model faux-1 · provider faux · ctx 128k") === true,
    );
    expect(app.screen().at(-2)).toContain("ctx ");
    expect(app.screen().at(-2)).not.toContain("ctx ▕");
    app.stdin.write("\x1b[<35;80;1M\x1b[<64;5;2M");
    await app.waitFor(() => app.screen().at(-1)?.trim() === "Ctrl+End 回到底部");
    expect(app.screen().findIndex((line) => /^╭─+╮$/.test(line))).toBe(inputTop);
    const reading = app.screen().slice(0, inputTop - 2);
    app.calls[0]!.delta("\nnew output");
    await app.waitFor(() => app.screen().at(-1)?.trim() === "有新输出 · Ctrl+End 回到底部");
    expect(app.screen().slice(0, inputTop - 2)).toEqual(reading);
    expect(app.screen().filter((line) => line.includes("回到底部"))).toHaveLength(1);
    app.stdin.write(`\x1b[<35;${app.screen().at(-2)!.indexOf("faux") + 1};23M`);
    await app.waitFor(() => app.screen().at(-1)?.startsWith(" model faux-1") === true);
    app.stdin.write("\x1b[<35;80;1M");
    await app.waitFor(() => app.screen().at(-1)?.includes("有新输出") === true);
    app.stdin.write("\x1b[1;5F");
    await app.waitFor(() => app.screen().includes("  new output"));
    expect(app.screen().at(-1)?.trim()).toBe("esc 中断");
  } finally {
    await app.cleanup();
  }
});

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
