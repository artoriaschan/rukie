import { testClock } from "../helpers/test-clock";
import { expect, test } from "bun:test";
import { figures } from "../../../src/ink/index.ts";
import { startWithClock } from "../helpers/clock-app";

test("streamed and completed replies keep the marker beside the first word and user blocks retain their style", async () => {
  const app = await startWithClock(["prompt 中\n  code"], { columns: 40 });
  const firstLine = `${figures.assistant} ${"x".repeat(38)}`;
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(" ");
    await app.waitFor(() => app.screen().some((line) => line.includes("↓ 1")));
    expect(app.screen()).not.toContain(figures.assistant);
    app.calls[0]!.delta("\n\n" + "x".repeat(39) + "\n\nnext");
    await app.waitFor(() => app.screen().includes(firstLine) && app.screen().includes("  next"));
    const reply = app.screen().indexOf(firstLine);
    expect(app.screen().slice(reply, reply + 4)).toEqual([firstLine, "  x", "", "  next"]);
    const prompt = app.screen().indexOf("❯ prompt 中");
    expect(prompt).toBeGreaterThanOrEqual(0);
    expect(app.screen()[prompt + 1]).toBe("    code");
    const cell = (x: number, y: number) => app.terminal.buffer.active.getLine(y)!.getCell(x)!;
    expect(cell(2, prompt).isBold()).toBeTruthy();
    expect(cell(2, prompt).getFgColor()).toBe(0xffdf80);
    for (const y of [prompt, prompt + 1]) {
      expect(cell(0, y).isBgDefault()).toBe(true);
      expect(cell(39, y).isBgDefault()).toBe(true);
    }
    expect(cell(0, reply).getFgColor()).toBe(0xe8e6e0);
    expect(cell(0, reply).isBgDefault()).toBe(true);
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen()).toContain(firstLine);
    expect(app.screen()).not.toContain(figures.assistant);
    app.resize(60, 24);
    await app.waitFor(() => app.screen().includes(`${figures.assistant} ${"x".repeat(39)}`));
    const resizedPrompt = app.screen().indexOf("❯ prompt 中");
    expect(resizedPrompt).toBeGreaterThanOrEqual(0);
    expect(cell(59, resizedPrompt).isBgDefault()).toBe(true);
    expect(cell(59, resizedPrompt + 2).isBgDefault()).toBe(true);
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("assistant renders open fences as code and closes into subsequent Markdown blocks", async () => {
  const app = await startWithClock(["explain"], { columns: 80, rows: 40 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(
      "# Result\n\n**中文** and `value`\n\n- first\n- second\n\n```ts\nconst value = 1;",
    );
    await app.waitFor(() => app.screen().join("\n").includes("const value = 1;"));
    expect(app.screen().join("\n")).not.toContain("```ts");
    expect(app.screen().join("\n")).not.toContain("**中文**");
    expect(app.screen().join("\n")).toContain("- first");
    app.calls[0]!.delta("\n```\n\n> quoted\n\n---\n\nfinal 🐋");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    await app.waitFor(() => app.screen().join("\n").includes("final 🐋"));
    expect(app.screen().filter((row) => row.includes("const value = 1;"))).toHaveLength(1);
    expect(app.screen().join("\n")).toContain("▎ quoted");
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("a burst reveals at 30fps and keeps chasing the saved reply after Run completion", async () => {
  const app = await startWithClock(["explain"], { columns: 80, rows: 40 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("你好🐋" + "x".repeat(180) + " tail");
    await app.flush();
    // Commit the event projection before the first reveal frame.
    testClock.advanceTimersByTime(16);
    await app.flush();
    expect(app.screen().join("\n")).not.toContain("tail");
    testClock.advanceTimersByTime(18);
    await app.flush();
    testClock.advanceTimersByTime(16);
    await app.flush();
    expect(app.screen().join("\n")).toContain("你好🐋");
    expect(app.screen().join("\n")).not.toContain("tail");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().join("\n")).not.toContain("tail");
    await app.waitFor(() => app.screen().join("\n").includes("tail"));
    expect(app.screen().join("\n")).not.toContain("�");
    expect(app.screen().filter((row) => row.includes("你好🐋"))).toHaveLength(1);
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("assistant renders GFM tables and tasks, Unicode math, Mermaid and literal fallbacks", async () => {
  const app = await startWithClock(["explain"], { columns: 80, rows: 50 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(
      "| Name | Value |\n| --- | --- |\n| 中文 | **yes** |\n\n- [x] checked\n- [ ] pending\n\n$\\alpha^2$\n\n$$\n\\frac{1}{2}",
    );
    await app.waitFor(() => app.screen().join("\n").includes("frac{1}{2}"));
    expect(app.screen().join("\n")).toContain("α²");
    expect(app.screen().join("\n")).toContain("- [x] checked");
    expect(app.screen().join("\n")).toContain("┌");
    expect(app.screen().join("\n")).not.toContain("| --- |");
    app.calls[0]!.delta(
      "\n$$\n\n$\\unsupported{keep}$\n\n```mermaid\nflowchart LR\n A[Start] --> B[End]\n```\n",
    );
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    await app.waitFor(() => app.screen().join("\n").includes("unsupported{keep}"));
    await app.waitFor(
      () =>
        app.screen().join("\n").includes("Start") && !app.screen().join("\n").includes("A[Start]"),
    );
    expect(app.screen().join("\n")).toContain("$\\unsupported{keep}$");
    expect(app.screen().join("\n")).not.toContain("\\frac{1}{2}");
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("a fresh one-shot response reveals while resumed assistant Markdown paints in full", async () => {
  const { createSession } = await import("@rukie/agent");
  const { fauxProvider, fauxAssistantMessage } = await import("@earendil-works/pi-ai");
  const { auxiliaryModels } = await import("../helpers/auxiliary-model");
  const body = "**history 中文🐋**\n\n" + "x".repeat(180) + " tail";
  const argv: string[] = [];
  const app = await startWithClock(argv, {
    columns: 80,
    rows: 40,
    prepare: async (root) => {
      const model = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
      model.setResponses([fauxAssistantMessage(body)]);
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: model.getModel(),
        models: auxiliaryModels((m, c, o) => model.provider.streamSimple(m, c, o)),
      });
      try {
        await session.run("saved prompt");
        argv.push("--resume", session.id);
      } finally {
        await session.close();
      }
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    expect(app.screen().join("\n")).toContain("tail");
    expect(app.screen().join("\n")).toContain("history 中文🐋");
    expect(app.screen().join("\n")).not.toContain("**history");
    app.stdin.write("new prompt\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.reply("fresh " + "y".repeat(180) + " final-tail");
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().join("\n")).not.toContain("final-tail");
    await app.waitFor(() => app.screen().join("\n").includes("final-tail"));
    expect(app.screen().filter((row) => row.includes("history 中文🐋"))).toHaveLength(1);
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("TeX delimiters preserve pending source and do not parse inside code", async () => {
  const app = await startWithClock(["math"], { columns: 80, rows: 40 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("\\(\\beta^2\\) and `\\(\\alpha\\)`\n\n\\[\n\\sqrt{x}");
    await app.waitFor(() => app.screen().join("\n").includes("sqrt{x}"));
    expect(app.screen().join("\n")).toContain("β²");
    expect(app.screen().join("\n")).toContain("\\(\\alpha\\)");
    expect(app.screen().join("\n")).toContain("\\[");
    app.calls[0]!.delta("\n\\]\n\n\\begin{aligned}\na &= b\\\\\nc &= d\n\\end{aligned}");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    await app.waitFor(() => app.screen().join("\n").includes("c = d"));
    expect(app.screen().join("\n")).not.toContain("sqrt{x}");
    expect(app.screen().join("\n")).not.toContain("begin{aligned}");
  } finally {
    await app.cleanup();
  }
});

test("a caught-up live identity does not restart and a non-prefix final replacement snaps", async () => {
  const app = await startWithClock(["explain"], { columns: 80, rows: 40 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("caught up");
    await app.waitFor(() => app.screen().join("\n").includes("caught up"));
    app.calls[0]!.delta(" later " + "x".repeat(180) + " immediate-tail");
    await app.flush();
    testClock.advanceTimersByTime(16);
    await app.flush();
    expect(app.screen().join("\n")).toContain("immediate-tail");
    app.calls[0]!.reply("replacement **final**");
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().join("\n")).toContain("replacement final");
    expect(app.screen().join("\n")).not.toContain("caught up");
  } finally {
    await app.cleanup();
  }
});

test("assistant search uses visible Markdown text without phantom formatting matches", async () => {
  const app = await startWithClock(["search"], {
    columns: 80,
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("**visible** and $\\alpha$\n\n[linked](https://example.com/hidden-path)");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    await app.waitFor(() => app.screen().join("\n").includes("linked"));
    app.stdin.write("\x0f/**\r");
    await app.waitFor(() => app.screen().join("\n").includes("No matches:"));
    app.stdin.write("/hidden-path\r");
    await app.waitFor(() => app.screen().join("\n").includes("No matches: hidden-path"));
    app.stdin.write("/α\r");
    await app.waitFor(() => app.screen().some((line) => / · 1\/1 · /.test(line)));
    const row = app.screen().findIndex((line) => line.includes("visible and α"));
    expect(row).toBeGreaterThanOrEqual(0);
    const line = app.terminal.buffer.active.getLine(row)!;
    const col = line.translateToString().indexOf("α");
    await app.waitFor(
      () =>
        app.terminal.buffer.active.getLine(row)!.getCell(col)!.isInverse() !== 0 &&
        app.terminal.buffer.active.getLine(row)!.getCell(col)!.getFgColor() === 3,
    );
    const cell = app.terminal.buffer.active.getLine(row)!.getCell(col)!;
    expect(cell.isInverse()).toBeTruthy();
    expect(cell.getFgColor()).toBe(3);
    expect(app.calls).toHaveLength(1);
  } finally {
    await app.cleanup();
  }
});
