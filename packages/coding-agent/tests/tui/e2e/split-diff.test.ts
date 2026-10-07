import { expect, test } from "bun:test";
import { join } from "node:path";
import { dark } from "../../../src/ink/index.ts";
import { start } from "../helpers/app";

test("auto split diff begins at 110 columns and switches to unified on resize", async () => {
  const app = await start(["--yolo", "change"], {
    columns: 110,
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(join(root, "code.ts"), 'const value = "old";\n');
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("write", { path: "code.ts", content: 'const value = "new";\n' });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(
      () =>
        !app.isWorking() && app.screen().some((row) => row.includes("old") && row.includes("new")),
    );
    const row = app.screen().findIndex((row) => row.includes("old") && row.includes("new"));
    expect(app.screen()[row]).toContain("│");
    const line = app.terminal.buffer.active.getLine(app.terminal.buffer.active.viewportY + row)!;
    expect(line.getCell(app.screen()[row]!.indexOf("const"))!.getFgColor()).toBe(
      parseInt(dark.plan.slice(1), 16),
    );
    expect(line.getCell(app.screen()[row]!.indexOf("old"))!.getBgColor()).toBe(
      parseInt(dark.error.slice(1), 16),
    );
    expect(line.getCell(app.screen()[row]!.indexOf("new"))!.getBgColor()).toBe(
      parseInt(dark.success.slice(1), 16),
    );
    await app.resize(109, 40);
    await app.waitFor(
      () =>
        app.screen().some((row) => row.includes('-const value = "old";')) &&
        !app.screen().some((row) => row.includes("old") && row.includes("new")),
    );
    expect(app.screen().some((row) => row.includes("old") && row.includes("new"))).toBe(false);
    expect(app.screen().join("\n")).toContain('+const value = "new";');
    await app.resize(110, 40);
    await app.waitFor(() => app.screen().some((row) => row.includes("old") && row.includes("new")));
  } finally {
    await app.cleanup();
  }
});

test.each([
  ["unified", 120],
  ["split", 80],
] as const)("user setting %s forces its layout at %i columns", async (diffLayout, columns) => {
  const app = await start(["--yolo", "change"], {
    columns,
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(join(root, ".rukie", "settings.json"), JSON.stringify({ diffLayout }));
      await Bun.write(join(root, "code.txt"), "old value\n");
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("write", { path: "code.txt", content: "new value\n" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking() && app.screen().join("\n").includes("new value"));
    expect(app.screen().some((row) => row.includes("old value") && row.includes("new value"))).toBe(
      diffLayout === "split",
    );
    expect(app.screen().every((row) => Bun.stringWidth(row) <= columns)).toBe(true);
  } finally {
    await app.cleanup();
  }
});

test("split diff aligns inserted lines before a changed pair and truncates long source rows", async () => {
  const app = await start(["--yolo", "change"], {
    columns: 120,
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(join(root, "code.txt"), "first\nfoo\nlast\n");
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("write", { path: "code.txt", content: "first\ninserted\nFOO\nlast\n" });
    await app.waitFor(() => app.calls.length === 2);
    await app.waitFor(() => app.screen().join("\n").includes("FOO"));
    expect(app.screen().some((row) => row.includes("foo") && row.includes("FOO"))).toBe(true);
    expect(app.screen().some((row) => row.includes("foo") && row.includes("inserted"))).toBe(false);
    app.calls[1]!.tool("write", {
      path: "long.txt",
      content: "short-start " + "long-source ".repeat(30) + "hidden-tail\n",
    });
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.finish();
    await app.waitFor(() => !app.isWorking() && app.screen().join("\n").includes("short-start"));
    expect(app.screen().filter((row) => row.includes("short-start"))).toHaveLength(1);
    expect(app.screen().join("\n")).not.toContain("hidden-tail");
    await app.resize(40, 18);
    await app.waitFor(() => app.screen().every((row) => Bun.stringWidth(row) <= 40));
  } finally {
    await app.cleanup();
  }
});

test("forced split on a small terminal folds eight rows and expands without wrapping", async () => {
  const app = await start(["--yolo", "change"], {
    columns: 40,
    rows: 34,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(
        join(root, ".rukie", "settings.json"),
        JSON.stringify({ diffLayout: "split" }),
      );
      await Bun.write(
        join(root, "small.txt"),
        Array.from({ length: 12 }, (_, i) => `old-${i}`).join("\n") + "\n",
      );
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("write", {
      path: "small.txt",
      content: Array.from({ length: 12 }, (_, i) => `new-${i}`).join("\n") + "\n",
    });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking() && app.screen().join("\n").includes("new-6"));
    expect(app.screen().some((row) => row.includes("old-0") && row.includes("new-0"))).toBe(true);
    expect(app.screen().join("\n")).not.toContain("new-7");
    expect(app.screen().join("\n")).toContain("+5 lines");
    expect(app.screen().every((row) => Bun.stringWidth(row) <= 40)).toBe(true);
    const bodyRow = app.screen().findIndex((row) => row.includes("old-0")) + 1;
    app.stdin.write(`\x1b[<0;5;${bodyRow}M\x1b[<0;5;${bodyRow}m`);
    await app.waitFor(() =>
      app.screen().some((row) => row.includes("old-11") && row.includes("new-11")),
    );
    const expandedRow = app.screen().findIndex((row) => row.includes("old-0")) + 1;
    app.stdin.write(`\x1b[<0;18;${expandedRow}M\x1b[<0;18;${expandedRow}m`);
    await app.flush();
    expect(app.screen().some((row) => row.includes("old-11") && row.includes("new-11"))).toBe(true);
    expect(app.screen().every((row) => Bun.stringWidth(row) <= 40)).toBe(true);
    await app.resize(12, 14);
    await app.waitFor(() => app.screen().every((row) => Bun.stringWidth(row) <= 12));
  } finally {
    await app.cleanup();
  }
});

test("invalid diffLayout in user settings is rejected before creating a Session", async () => {
  const app = await start([], {
    prepare: async (root) => {
      await Bun.write(
        join(root, ".rukie", "settings.json"),
        JSON.stringify({ diffLayout: "sideways" }),
      );
    },
  });
  try {
    await app.exit;
    expect(app.stderr()).toContain("diffLayout");
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test("resumed patch-only diffs keep split pairs and hunk boundaries", async () => {
  const argv: string[] = [];
  const { createSession } = await import("@rukie/agent");
  const { fauxProvider, fauxAssistantMessage, fauxToolCall } =
    await import("@earendil-works/pi-ai");
  const { auxiliaryModels } = await import("../helpers/auxiliary-model");
  const app = await start(argv, {
    columns: 120,
    rows: 48,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      const old = `old-start\n${"unchanged context\n".repeat(5000)}old-end\n`;
      await Bun.write(join(root, "large.txt"), old);
      const model = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
      model.setResponses([
        fauxAssistantMessage(
          fauxToolCall("write", {
            path: "large.txt",
            content: old.replace("old-start", "new-start").replace("old-end", "new-end"),
          }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("done"),
      ]);
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: model.getModel(),
        models: auxiliaryModels((m, c, o) => model.provider.streamSimple(m, c, o)),
        permissionMode: "full-access",
      });
      try {
        await session.run("change large file");
        argv.push("--resume", session.id);
      } finally {
        await session.close();
      }
    },
  });
  try {
    await app.waitFor(
      () => app.screen().includes("❯") && app.screen().join("\n").includes("new-start"),
    );
    expect(app.screen().some((row) => row.includes("old-start") && row.includes("new-start"))).toBe(
      true,
    );
    expect(app.screen().join("\n")).toContain("⋯");
    expect(app.screen().join("\n")).toContain("Only diff hunks retained");
    app.stdin.write("\x0f");
    await app.waitFor(() =>
      app.screen().some((row) => row.includes("old-end") && row.includes("new-end")),
    );
  } finally {
    await app.cleanup();
  }
});
