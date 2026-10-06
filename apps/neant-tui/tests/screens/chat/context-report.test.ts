import { join } from "node:path";
import { expect, test } from "bun:test";
import { createFauxCore } from "@earendil-works/pi-ai";
import { start } from "../../helpers/app";
const screen = (app: Awaited<ReturnType<typeof start>>) => app.screen().join("\n");

for (const [columns, window, gridColumns, gridRows] of [
  [80, 128000, 10, 10],
  [60, 128000, 5, 5],
  [120, 1000000, 20, 10],
  [60, 1000000, 5, 10],
] as const) {
  test(`context report ${columns} columns / ${window} window is a local static grid snapshot`, async () => {
    const app = await start([], {
      columns,
      rows: 50,
      env: { LANG: "en_US.UTF-8" },
      session: {
        model: {
          ...createFauxCore({ api: "faux", provider: "faux" }).getModel(),
          contextWindow: window,
        },
      },
    });
    try {
      await app.waitFor(() => screen(app).includes("╭"));
      app.stdin.write("/context\r");
      await app.waitFor(() => screen(app).includes("Estimated usage by category"));
      expect(screen(app)).toContain("❯ /context");
      expect(screen(app)).toContain("└ Context Usage");
      expect(screen(app)).toContain("faux-1");
      expect(screen(app)).toContain("/context all to expand");
      for (const label of ["System prompt", "System tools", "Free space", "Compaction reserve"])
        expect(screen(app)).toContain(label);
      const grid = app.screen().filter((line) => /^     [⛁⛀⛶⛝]( [⛁⛀⛶⛝]){4}/.test(line));
      expect(grid).toHaveLength(gridRows);
      expect(
        grid.every(
          (line) =>
            (
              line
                .trimStart()
                .split("  ")[0]!
                .match(/[⛁⛀⛶⛝]/g) ?? []
            ).length === gridColumns,
        ),
      ).toBe(true);
      expect(grid.join("")).toContain("⛝");
      expect(grid.join("")).toContain("⛶");
      expect(app.calls).toHaveLength(0);
      app.stdin.write("question\r");
      await app.waitFor(() => app.calls.length === 1);
      expect(JSON.stringify(app.calls[0]!.context)).not.toContain("Estimated usage by category");
      app.calls[0]!.delta("reply");
      app.calls[0]!.finish(700, 2, { read: 30, write: 20 });
    } finally {
      await app.cleanup();
    }
  });
}

test("context reports during a Run stay local and keep their original provider totals after later responses", async () => {
  const stopping = Promise.withResolvers<void>();
  const release = Promise.withResolvers<Response>();
  let held = true;
  const server = Bun.serve({
    port: 0,
    fetch: () => {
      if (!held) return Response.json({});
      held = false;
      stopping.resolve();
      return release.promise;
    },
  });
  const app = await start([], {
    rows: 60,
    env: { LANG: "en_US.UTF-8" },
    session: {
      settings: { hooks: { Stop: [{ hooks: [{ type: "http", url: server.url.href }] }] } },
    },
  });
  try {
    await app.waitFor(() => screen(app).includes("╭"));
    app.stdin.write("first question\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.finish(700, 2, { read: 30, write: 20 });
    await stopping.promise;
    await app.waitFor(() => screen(app).includes("0.6%"));
    // Provider totals are already visible while Stop still owns the Run.
    expect(app.isWorking()).toBe(true);
    release.resolve(Response.json({}));
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("second question\r");
    await app.waitFor(() => app.calls.length === 2);
    app.stdin.write("/context\r");
    await app.waitFor(() => screen(app).includes("750/128k tokens"));
    expect(app.calls).toHaveLength(2);
    app.calls[1]!.finish(1200, 2);
    await app.waitFor(() => screen(app).includes("0.9%"));
    await app.waitFor(() => !app.isWorking());
    expect(screen(app)).toContain("750/128k tokens");
    app.stdin.write("/context\r");
    await app.waitFor(() => screen(app).includes("1.2k/128k tokens"));
    expect(screen(app)).toContain("750/128k tokens");
    app.stdin.write("third question\r");
    await app.waitFor(() => app.calls.length === 3);
    expect(JSON.stringify(app.calls[2]!.context)).not.toContain("Estimated usage by category");
    expect(JSON.stringify(app.calls[2]!.context)).not.toContain("750/128k");
    app.calls[2]!.finish();
  } finally {
    release.resolve(Response.json({}));
    await app.cleanup();
    server.stop(true);
  }
});

test("context visualization paints full, partial, free and reserved cells with token percentages", async () => {
  const app = await start([], {
    rows: 50,
    env: { LANG: "en_US.UTF-8" },
    session: {
      model: {
        ...createFauxCore({ api: "faux", provider: "faux" }).getModel(),
        // A non-round window keeps estimated schema usage between grid cells.
        contextWindow: 12100,
      },
    },
  });
  try {
    await app.waitFor(() => screen(app).includes("╭"));
    app.stdin.write("/context\r");
    await app.waitFor(() => screen(app).includes("/12.1k tokens"));
    for (const symbol of ["⛁", "⛀", "⛶", "⛝"]) expect(screen(app)).toContain(symbol);
    expect(screen(app)).toContain("Compaction reserve: 2.4k tokens (20.0%)");
    expect(screen(app)).not.toContain("Messages: 0 tokens (0.0%)");
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test("context shows resource summaries below the grid and expands details locally during a Run", async () => {
  const app = await start([], {
    columns: 160,
    rows: 70,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(join(root, "AGENTS.md"), "Project contract.");
      await Bun.write(join(root, ".neant/AGENTS.md"), "User contract.");
      await Bun.write(
        join(root, ".agents/skills/review/SKILL.md"),
        "---\nname: review\ndescription: Review widgets\n---\nInspect widgets.\n",
      );
      await Bun.write(
        join(root, ".agents/agents/editor.md"),
        "---\nname: editor\ndescription: Edit widgets\n---\nEdit carefully.\n",
      );
    },
  });
  try {
    await app.waitFor(() => screen(app).includes("╭"));
    app.stdin.write("inspect widgets\r");
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("/context\r");
    await app.waitFor(() => screen(app).includes("Estimated usage by category"));
    expect(screen(app)).toContain("Memory files · /memory");
    expect(screen(app)).toContain("└ 2 files ·");
    expect(screen(app)).toContain("Skills · /skills");
    expect(screen(app)).toContain("└ 1 skill ·");
    expect(screen(app)).toContain("Custom agents · .agents/agents/");
    expect(screen(app)).not.toContain("└ review:");
    const lines = app.screen();
    const userY = lines.findIndex((line) => line === "❯ inspect widgets");
    const userCell = app.terminal.buffer.active.getLine(userY)!.getCell(2)!;
    const userStyle = { foreground: userCell.getFgColor(), bold: userCell.isBold() };
    const commandY = lines.findIndex((line) => line === "❯ /context");
    const commandLine = app.terminal.buffer.active.getLine(commandY)!;
    for (const x of [0, 2, 9, 10]) {
      const cell = commandLine.getCell(x)!;
      expect(cell.isBgDefault()).toBe(true);
      if (x < 10) {
        expect(cell.getFgColor()).toBe(userStyle.foreground);
        expect(cell.isBold()).toBe(userStyle.bold);
      }
    }
    expect(lines.findIndex((line) => line.includes("Memory files ·"))).toBeGreaterThan(
      lines.findLastIndex((line) => /^     [⛁⛀⛶⛝]( [⛁⛀⛶⛝]){4}/.test(line)),
    );
    app.stdin.write("/context all\r");
    await app.waitFor(() => screen(app).includes("└ review:"));
    const expandedY = app.screen().findIndex((line) => line === "❯ /context all");
    const expandedLine = app.terminal.buffer.active.getLine(expandedY)!;
    for (const x of [0, 2, 13, 14]) {
      const cell = expandedLine.getCell(x)!;
      expect(cell.isBgDefault()).toBe(true);
      if (x < 14) {
        expect(cell.getFgColor()).toBe(userStyle.foreground);
        expect(cell.isBold()).toBe(userStyle.bold);
      }
    }
    expect(screen(app)).toContain(`└ ${join(app.root, "AGENTS.md")}:`);
    expect(screen(app)).toContain(`└ ${join(app.root, ".neant/AGENTS.md")}:`);
    expect(screen(app)).toContain("└ review:");
    expect(screen(app)).toContain("└ editor:");
    expect(app.calls).toHaveLength(1);
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

// Inspect terminal cells so a plain-text match cannot hide a lost color or style.
test("context uses colored symbols, muted values and an italic legend after resize", async () => {
  const app = await start([], {
    columns: 120,
    rows: 80,
    env: { LANG: "en_US.UTF-8" },
    session: {
      model: {
        ...createFauxCore({ api: "faux", provider: "faux" }).getModel(),
        contextWindow: 1000000,
      },
    },
    prepare: async (root) => {
      await Bun.write(join(root, "AGENTS.md"), "Project contract.");
      await Bun.write(
        join(root, ".agents/skills/review/SKILL.md"),
        "---\nname: review\ndescription: Review widgets\n---\nInspect widgets.\n",
      );
    },
  });
  try {
    await app.waitFor(() => screen(app).includes("╭"));
    app.stdin.write("inspect widgets\r");
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("/context\r");
    await app.waitFor(() => screen(app).includes("/context all to expand"));
    const lines = app.screen();
    const categoryY = lines.findIndex((line) => line.includes("⛁ Skills:"));
    const categoryX = lines[categoryY]!.indexOf("⛁ Skills:");
    const category = app.terminal.buffer.active.getLine(categoryY)!;
    expect(category.getCell(categoryX)!.getFgColor()).toBe(0xd7af00);
    expect(category.getCell(categoryX + 2)!.getFgColor()).toBe(0x999999);
    const valueX = lines[categoryY]!.indexOf("tokens") - 2;
    expect(category.getCell(valueX)!.getFgColor()).toBe(0x666666);
    const estimateY = lines.findIndex((line) => line.includes("Estimated usage"));
    const estimateX = lines[estimateY]!.indexOf("Estimated usage");
    expect(
      app.terminal.buffer.active.getLine(estimateY)!.getCell(estimateX)!.isItalic(),
    ).toBeTruthy();
    const titleY = lines.findIndex((line) => line.includes("Context Usage"));
    expect(app.terminal.buffer.active.getLine(titleY)!.getCell(4)!.isBold()).toBeTruthy();
    const firstGridY = lines.findIndex((line) => /^     [⛁⛀⛶⛝]( [⛁⛀⛶⛝]){19}/.test(line));
    const grid = app.terminal.buffer.active.getLine(firstGridY)!;
    // Even a tiny memory/skill category gets its own cell and matching legend color.
    expect(grid.getCell(9)!.getFgColor()).toBe(0xd77757);
    expect(grid.getCell(11)!.getFgColor()).toBe(0xd7af00);
    expect(lines[firstGridY]).toContain("(1m context)");
    for (const columns of [60, 40]) {
      app.resize(columns, 80);
      await app.waitFor(() => {
        const lines = app.screen();
        const gridY = lines.findIndex((line) => /^     [⛁⛀⛶⛝]( [⛁⛀⛶⛝]){4}/.test(line));
        const modelY = lines.findIndex((line) => line.includes("(1m context)"));
        return gridY >= 0 && modelY > gridY + 9 && screen(app).includes("/context all to expand");
      });
      expect(screen(app)).toContain("Skills · /skills");
      expect(screen(app)).toContain("1 skill ·");
    }
    expect(app.calls).toHaveLength(1);
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("context summaries and expansion use the startup Chinese locale", async () => {
  const app = await start([], { columns: 100, rows: 60 });
  try {
    await app.waitFor(() => screen(app).includes("╭"));
    app.stdin.write("/context\r");
    await app.waitFor(() => screen(app).includes("/context all 展开详情"));
    expect(screen(app)).toContain("└ 上下文占用");
    expect(screen(app)).toContain("└ 2 个代理 · 20 tokens");
    app.stdin.write("/context all\r");
    await app.waitFor(() => screen(app).includes("└ general-purpose: 12 tokens"));
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});
