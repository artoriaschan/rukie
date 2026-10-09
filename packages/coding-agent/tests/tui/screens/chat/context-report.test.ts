import { join } from "node:path";
import { expect, test } from "bun:test";
import { fauxProvider } from "@earendil-works/pi-ai";
import { listSessions } from "@rukie/agent";
import { start } from "../../helpers/app";
import { startWithClock } from "../../helpers/clock-app";
const screen = (app: Awaited<ReturnType<typeof start>>) => app.screen().join("\n");

test("context opens an expanded panel and returns without adding a chat message", async () => {
  const app = await start([], { rows: 60, env: { LANG: "en_US.UTF-8" } });
  try {
    await app.waitFor(() => screen(app).includes("╭"));
    app.stdin.write("/context\r");
    await app.waitFor(() => screen(app).includes("Estimated usage by category"));
    expect(screen(app)).toContain("└ general-purpose:");
    expect(screen(app)).not.toContain("❯ /context");
    expect(screen(app)).toContain("Esc / Ctrl+C");
    app.stdin.write("\x1b");
    await app.waitFor(() => screen(app).includes("╭"));
    expect(screen(app)).not.toContain("Context Usage");
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

for (const [columns, window, gridColumns, gridRows] of [
  [80, 128000, 10, 10],
  [60, 128000, 5, 5],
  [120, 1000000, 20, 10],
  [60, 1000000, 5, 10],
] as const) {
  test(`context report ${columns} columns / ${window} window is an expanded panel snapshot`, async () => {
    const app = await start([], {
      columns,
      rows: 50,
      env: { LANG: "en_US.UTF-8" },
      session: {
        model: {
          ...fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 }).getModel(),
          contextWindow: window,
        },
      },
    });
    try {
      await app.waitFor(() => screen(app).includes("╭"));
      app.stdin.write("/context\r");
      await app.waitFor(() => screen(app).includes("Estimated usage by category"));
      expect(screen(app)).not.toContain("❯ /context");
      expect(screen(app)).toContain("└ Context Usage");
      expect(screen(app)).toContain("faux-1");
      expect(screen(app)).not.toContain("/context all");
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
      app.stdin.write("\x1b");
      await app.waitFor(() => screen(app).includes("╭"));
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
    await app.waitFor(() => !app.isWorking());
    expect(screen(app)).toContain("750/128k tokens");
    app.stdin.write("\x1b");
    await app.waitFor(() => screen(app).includes("╭"));
    app.stdin.write("/context\r");
    await app.waitFor(() => screen(app).includes("1.2k/128k tokens"));
    expect(screen(app)).not.toContain("750/128k tokens");
    app.stdin.write("\x03");
    await app.waitFor(() => screen(app).includes("╭"));
    app.stdin.write("third question\r");
    await app.waitFor(() => app.calls.length === 3);
    expect(JSON.stringify(app.calls[2]!.context)).not.toContain("Estimated usage by category");
    expect(JSON.stringify(app.calls[2]!.context)).not.toContain("750/128k");
    app.calls[2]!.finish();
  } finally {
    release.resolve(Response.json({}));
    await app.cleanup();
    await server.stop(true);
  }
});

test("context visualization paints full, partial, free and reserved cells with token percentages", async () => {
  const app = await start([], {
    rows: 50,
    env: { LANG: "en_US.UTF-8" },
    session: {
      model: {
        ...fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 }).getModel(),
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

test("context panel shows resource summaries and all details locally during a Run", async () => {
  const app = await start([], {
    columns: 160,
    rows: 70,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(join(root, "AGENTS.md"), "Project contract.");
      await Bun.write(join(root, ".rukie/AGENTS.md"), "User contract.");
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
    const lines = app.screen();
    expect(lines.findIndex((line) => line.includes("Memory files ·"))).toBeGreaterThan(
      lines.findLastIndex((line) => /^     [⛁⛀⛶⛝]( [⛁⛀⛶⛝]){4}/.test(line)),
    );
    expect(screen(app)).toContain(`└ ${join(app.root, "AGENTS.md")}:`);
    expect(screen(app)).toContain(`└ ${join(app.root, ".rukie/AGENTS.md")}:`);
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
        ...fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 }).getModel(),
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
    await app.waitFor(() => screen(app).includes("Esc / Ctrl+C"));
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
        return gridY >= 0 && modelY > gridY + 9 && screen(app).includes("Esc / Ctrl+C");
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

test("context panel details and navigation use the startup Chinese locale", async () => {
  const app = await start([], { columns: 100, rows: 60 });
  try {
    await app.waitFor(() => screen(app).includes("╭"));
    app.stdin.write("/context\r");
    await app.waitFor(() => screen(app).includes("Esc / Ctrl+C 返回"));
    expect(screen(app)).toContain("└ 上下文占用");
    expect(screen(app)).toContain("└ 2 个代理 · 20 tokens");
    expect(screen(app)).toContain("└ general-purpose: 12 tokens");
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test("context panel scrolls at 40×12, owns input and restores its position after approval", async () => {
  const app = await start(["inspect panel"], {
    columns: 40,
    rows: 12,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      for (let index = 0; index < 20; index++) {
        const name = `panel-skill-${String(index).padStart(2, "0")}`;
        await Bun.write(
          join(root, `.agents/skills/${name}/SKILL.md`),
          `---\nname: ${name}\ndescription: Panel fixture\n---\nInspect.\n`,
        );
      }
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("/context\r");
    await app.waitFor(() => screen(app).includes("Context Usage"));
    expect(app.screen().at(-1)).toContain("Esc / Ctrl+C");
    app.stdin.write("\x1b[<65;10;3M");
    await app.waitFor(() => !screen(app).includes("Context Usage"));
    app.stdin.write("\x1b[H");
    await app.waitFor(() => screen(app).includes("Context Usage"));
    app.stdin.write("\x1b[B\x1b[B");
    await app.waitFor(() => !screen(app).includes("Context Usage"));
    app.stdin.write("\x1b[A\x1b[A");
    await app.waitFor(() => screen(app).includes("Context Usage"));
    app.stdin.write("\x1b[6~");
    await app.waitFor(() => !screen(app).includes("Context Usage"));
    app.stdin.write("\x1b[F");
    await app.waitFor(() => screen(app).includes("panel-skill-19:"));
    const tail = app.screen().slice(1, -1);
    app.stdin.write("ignored\x1b[200~paste ignored\x1b[201~\r");
    await app.flush();
    expect(app.screen().slice(1, -1)).toEqual(tail);
    app.calls[0]!.tool("bash", {
      command: "printf panel-approved",
      description: "Approve panel fixture",
    });
    await app.waitFor(
      () => !screen(app).includes("panel-skill-19:") && screen(app).includes("bash"),
    );
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 2 && screen(app).includes("panel-skill-19:"));
    expect(app.screen().slice(1, -1)).toEqual(tail);
    app.resize(80, 24);
    await app.waitFor(() => app.screen().length === 24 && screen(app).includes("Esc / Ctrl+C"));
    app.stdin.write("\x1b[H");
    await app.waitFor(() => screen(app).includes("Context Usage"));
    app.stdin.write("\x1b");
    // Context hides the Run indicator. Observe the active chat before finishing
    // the reply, then wait for its completion instead of treating hidden as idle.
    await app.waitFor(() => screen(app).includes("╭") && app.isWorking());
    app.calls[1]!.finish();
    await app.waitFor(
      () =>
        !app.isWorking() &&
        !screen(app).includes("esc interrupt") &&
        screen(app).includes("✻ Baked for"),
    );
    app.stdin.write("clean question\r");
    await app.waitFor(() => app.calls.length === 3);
    expect(
      app.calls[2]!.context.messages.findLast((message) => message.role === "user"),
    ).toMatchObject({ content: [{ type: "text", text: "clean question" }] });
    app.calls[2]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("resume restores chat history and context opens a fresh panel without historical reports", async () => {
  const app = await start(["retained context question"], {
    rows: 60,
    env: { LANG: "en_US.UTF-8" },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("retained context answer");
    app.calls[0]!.finish(700, 2);
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("/context\r");
    await app.waitFor(() => screen(app).includes("700/128k tokens"));
    await app.shutdown();
    const [stored] = await listSessions({ cwd: app.root, homeDir: app.root });
    const replay = await start(["--resume", stored!.id], {
      session: { cwd: app.root, homeDir: app.root },
      rows: 60,
      env: { LANG: "en_US.UTF-8" },
    });
    try {
      await replay.waitFor(() => screen(replay).includes("retained context answer"));
      expect(screen(replay)).not.toContain("Context Usage");
      expect(replay.calls).toHaveLength(0);
      replay.stdin.write("/context\r");
      await replay.waitFor(() => screen(replay).includes("700/128k tokens"));
      expect(screen(replay)).toContain("└ general-purpose:");
      replay.stdin.write("\x03");
      await replay.waitFor(() => screen(replay).includes("retained context answer"));
      expect(screen(replay)).not.toContain("Context Usage");
    } finally {
      await replay.cleanup();
    }
  } finally {
    await app.cleanup();
  }
});

test("closing context restores chat reading position while new reply text arrives", async () => {
  const app = await startWithClock(["read earlier reply"], {
    rows: 16,
    env: { LANG: "en_US.UTF-8" },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(
      Array.from({ length: 20 }, (_, index) => `history-row-${index}`).join("\n"),
    );
    await app.waitFor(() => screen(app).includes("history-row-19"));
    app.stdin.write("\x1b[5~");
    await app.waitFor(() => !screen(app).includes("history-row-19"));
    const before = app.screen().slice(0, 7);
    app.stdin.write("/context\r");
    await app.waitFor(() => screen(app).includes("Context Usage"));
    app.calls[0]!.delta("\nnew reply tail");
    app.stdin.write("\x1b");
    await app.waitFor(() => screen(app).includes("╭"));
    expect(app.screen().slice(0, 7)).toEqual(before);
    expect(screen(app)).not.toContain("new reply tail");
    expect(app.calls[0]!.signal!.aborted).toBe(false);
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
  } finally {
    await app.cleanup();
  }
});
