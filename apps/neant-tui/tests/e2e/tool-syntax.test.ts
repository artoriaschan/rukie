import { expect, test } from "bun:test";
import { join } from "node:path";
import { dark } from "@neant/tui";
import { start } from "../helpers/app";

function foreground(app: Awaited<ReturnType<typeof start>>, row: string, token: string) {
  const buffer = app.terminal.buffer.active;
  for (let y = 0; y < buffer.length; y++) {
    const line = buffer.getLine(y)!;
    const text = line.translateToString(true);
    if (text.includes(row)) return line.getCell(text.indexOf(token))!.getFgColor();
  }
  throw new Error(`Missing row ${row}`);
}

test("generic arguments use JSON token colors", async () => {
  const app = await start(["--yolo", "run"], { env: { LANG: "en_US.UTF-8" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("unknown_tool", { label: "hello", count: 42 });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(foreground(app, "Unknown_tool(", "hello")).toBe(parseInt(dark.success.slice(1), 16));
    expect(foreground(app, "Unknown_tool(", "42")).toBe(parseInt(dark.warning.slice(1), 16));
  } finally {
    await app.cleanup();
  }
});

test("file read highlighting preserves multiline comments and unknown extensions stay plain", async () => {
  const app = await start(["--yolo", "read"], {
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(join(root, "code.ts"), '/* first\ncontinued */\nconst answer = "hello";');
      await Bun.write(join(root, "code.unknown"), 'const answer = "hello";');
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("read", { path: "code.ts" });
    await app.waitFor(() => app.calls.length === 2);
    await app.waitFor(() => app.screen().some((row) => row.includes("continued */")));
    expect(foreground(app, "continued */", "continued")).toBe(parseInt(dark.subtle.slice(1), 16));
    expect(foreground(app, "const answer", "const")).toBe(parseInt(dark.plan.slice(1), 16));
    app.calls[1]!.tool("read", { path: "code.unknown" });
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.finish();
    await app.waitFor(() => !app.isWorking());
    const rows = app.screen().filter((row) => row.includes("const answer"));
    expect(rows.length).toBe(2);
    const buffer = app.terminal.buffer.active;
    const y = app.screen().findLastIndex((row) => row.includes("const answer")) + buffer.viewportY;
    const line = buffer.getLine(y)!;
    expect(line.getCell(line.translateToString(true).indexOf("const"))!.getFgColor()).toBe(
      parseInt(dark.text.slice(1), 16),
    );
  } finally {
    await app.cleanup();
  }
});

test("unified diff syntax keeps source comment state on added and removed rows", async () => {
  const app = await start(["--yolo", "change"], {
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(join(root, "change.ts"), "/* first\nold comment */\nconst value = 1;\n");
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("write", {
      path: "change.ts",
      content: "/* first\nnew comment */\nconst value = 2;\n",
    });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(foreground(app, "-old comment", "old")).toBe(parseInt(dark.subtle.slice(1), 16));
    expect(foreground(app, "+new comment", "new")).toBe(parseInt(dark.subtle.slice(1), 16));
    expect(foreground(app, "+const value", "const")).toBe(parseInt(dark.plan.slice(1), 16));
  } finally {
    await app.cleanup();
  }
});
