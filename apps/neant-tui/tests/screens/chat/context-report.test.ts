import { join } from "node:path";
import { expect, test } from "bun:test";
import { createFauxCore } from "@earendil-works/pi-ai";
import { start } from "../../helpers/app";
const screen = (app: Awaited<ReturnType<typeof start>>) => app.screen().join("\n");

for (const [columns, window, gridColumns, gridRows] of [
  [80, 128000, 10, 10],
  [60, 128000, 5, 5],
  [80, 1000000, 20, 10],
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
      expect(screen(app)).toContain("faux/faux-1 ·");
      for (const label of [
        "System prompt",
        "Memory files",
        "System tools",
        "MCP tools",
        "Skills",
        "Messages",
        "Free space",
        "Compaction reserve",
      ])
        expect(screen(app)).toContain(label);
      const grid = app.screen().filter((line) => /^[⛁⛀⛶⛝]/.test(line));
      expect(grid).toHaveLength(gridRows);
      expect(
        grid.every((line) => (line.split("  ")[0]!.match(/[⛁⛀⛶⛝]/g) ?? []).length === gridColumns),
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
  const app = await start([], { rows: 60, env: { LANG: "en_US.UTF-8" } });
  try {
    await app.waitFor(() => screen(app).includes("╭"));
    app.stdin.write("first question\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.finish(700, 2, { read: 30, write: 20 });
    await app.waitFor(() => screen(app).includes("0.6%"));
    app.stdin.write("second question\r");
    await app.waitFor(() => app.calls.length === 2);
    app.stdin.write("/context\r");
    await app.waitFor(() => screen(app).includes("750/128,000 tokens"));
    expect(app.calls).toHaveLength(2);
    app.calls[1]!.finish(1200, 2);
    await app.waitFor(() => screen(app).includes("0.9%"));
    expect(screen(app)).toContain("750/128,000 tokens");
    app.stdin.write("/context\r");
    await app.waitFor(() => screen(app).includes("1,200/128,000 tokens"));
    expect(screen(app)).toContain("750/128,000 tokens");
    app.stdin.write("third question\r");
    await app.waitFor(() => app.calls.length === 3);
    expect(JSON.stringify(app.calls[2]!.context)).not.toContain("Estimated usage by category");
    expect(JSON.stringify(app.calls[2]!.context)).not.toContain("750/128,000");
    app.calls[2]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("context visualization paints full, partial, free and reserved cells with token percentages", async () => {
  const app = await start([], {
    rows: 50,
    env: { LANG: "en_US.UTF-8" },
    session: {
      model: {
        ...createFauxCore({ api: "faux", provider: "faux" }).getModel(),
        contextWindow: 10000,
      },
    },
  });
  try {
    await app.waitFor(() => screen(app).includes("╭"));
    app.stdin.write("/context\r");
    await app.waitFor(() => screen(app).includes("/10,000 tokens"));
    for (const symbol of ["⛁", "⛀", "⛶", "⛝"]) expect(screen(app)).toContain(symbol);
    expect(screen(app)).toContain("Compaction reserve: 2,000 tokens (20.0%)");
    expect(screen(app)).toContain("Messages: 0 tokens (0.0%)");
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test("context legend exposes memory, skills and agent type details while the main Run continues", async () => {
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
