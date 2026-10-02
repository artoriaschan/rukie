import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../../src/main";
import { start } from "../helpers/app";
import { createTerminal } from "../helpers/terminal";
import { controlledModel } from "../helpers/model";

test("non-interactive terminals fail before rendering or requesting a model", async () => {
  for (const [stdin, stdout, term] of [
    [false, true, "xterm-256color"],
    [true, false, "xterm-256color"],
    [true, true, "dumb"],
  ] as const) {
    const terminal = createTerminal();
    terminal.stdin.isTTY = stdin;
    terminal.stdout.isTTY = stdout;
    let stderr = "";
    try {
      expect(
        await main(["hello"], {
          ...terminal,
          term,
          stderr: (text) => {
            stderr += text;
          },
        }),
      ).toBe(1);
      expect(stderr).toContain("neant-cli");
      expect(terminal.output()).toBe("");
      expect(terminal.stdin.isRaw).toBe(false);
    } finally {
      terminal.dispose();
    }
  }
});

test("a fatal paint IO error restores the terminal before stderr and aborts the active Run", async () => {
  const root = await mkdtemp(join(tmpdir(), "neant-tui-fatal-"));
  const terminal = createTerminal();
  const fake = controlledModel();
  let fail = false;
  const emissions: string[] = [];
  const exit = main(["hello"], {
    ...terminal,
    stdout: {
      isTTY: true,
      columns: 80,
      rows: 24,
      write(text) {
        if (fail) {
          fail = false;
          throw new Error("paint IO failed");
        }
        emissions.push(text);
        return terminal.stdout.write(text);
      },
    },
    stderr(text) {
      expect(terminal.stdin.isRaw).toBe(false);
      emissions.push(`stderr:${text}`);
    },
    session: { cwd: root, homeDir: root, ...fake },
  });
  try {
    await terminal.waitFor(() => fake.calls.length === 1);
    fail = true;
    fake.calls[0]!.delta("reply");
    expect(await exit).toBe(1);
    await terminal.flush();
    expect(fake.calls[0]!.signal!.aborted).toBe(true);
    expect(terminal.terminal.buffer.active.type).toBe("normal");
    const restored = emissions.findIndex((text) => text.includes("\x1b[?1049l"));
    const error = emissions.findIndex((text) => text === "stderr:paint IO failed\n");
    expect(restored).toBeGreaterThanOrEqual(0);
    expect(error).toBeGreaterThan(restored);
  } finally {
    terminal.stdin.write("\x03\x03\x03");
    await exit;
    terminal.dispose();
    await rm(root, { recursive: true, force: true });
  }
});

test("Chat fills the alternate screen, scrolls its body and clears the UI on exit", async () => {
  const app = await start(["long reply"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(
      Array.from({ length: 50 }, (_, i) => `line-${String(i).padStart(2, "0")}`).join("\n"),
    );
    await app.waitFor(() => app.screen().includes("line-49"));
    expect(app.terminal.buffer.active.type).toBe("alternate");
    expect(app.screen().at(-1)).toContain("input");
    expect(app.screen().at(-2)).toMatch(/^─+$/);
    app.stdin.write("\x1b[<64;5;2M");
    await app.waitFor(() => app.screen().some((line) => line.includes("Ctrl+End 回到底部")));
    const bodyHeight = app.screen().findIndex((line) => line.includes("Ctrl+End 回到底部"));
    const reading = app.screen().slice(0, bodyHeight);
    app.calls[0]!.delta("\nnew output");
    await app.waitFor(() => app.screen().some((line) => line.includes("有新输出")));
    expect(app.screen().slice(0, bodyHeight)).toEqual(reading);
    app.stdin.write("\x1b[1;5F");
    await app.waitFor(() => app.screen().includes("new output"));
    expect(app.screen().join("\n")).not.toContain("回到底部");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("\x04");
    expect(await app.exit).toBe(0);
    await app.flush();
    expect(app.terminal.buffer.active.type).toBe("normal");
    expect(app.screen().every((line) => line === "")).toBe(true);
  } finally {
    await app.cleanup();
  }
});

test("small windows suspend editing and restore the draft while a Run continues", async () => {
  const app = await start(["running"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("retained reply");
    app.stdin.write("kept draft");
    await app.waitFor(() => app.screen().includes("❯ kept draft"));
    app.resize(39, 11);
    await app.waitFor(() => app.screen().some((line) => line.includes("请调整窗口")));
    app.stdin.write("ignored\r");
    await Bun.sleep(25);
    expect(app.calls).toHaveLength(1);
    expect(app.calls[0]!.signal!.aborted).toBe(false);
    app.resize(40, 12);
    await app.waitFor(() => app.screen().includes("❯ kept draft"));
    expect(app.screen().join("\n")).not.toContain("ignored");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "kept draft" }],
    });
  } finally {
    await app.cleanup();
  }
});

test("the input area includes its dividers within the six-row and one-third budget", async () => {
  for (const [columns, rows, budget] of [
    [80, 24, 6],
    [40, 12, 4],
  ]) {
    const app = await start([], { columns, rows });
    try {
      await app.waitFor(() => app.stdin.isRaw);
      app.stdin.write(
        "\x1b[200~" + Array.from({ length: 10 }, (_, i) => `draft-${i}`).join("\n") + "\x1b[201~",
      );
      await app.waitFor(() => app.screen().some((line) => line.trim() === "draft-9"));
      const dividers = app.screen().flatMap((line, i) => (/^─+$/.test(line) ? [i] : []));
      expect(dividers).toHaveLength(2);
      expect(dividers[1]! - dividers[0]! + 1).toBe(budget!);
      expect(app.terminal.buffer.active.cursorY).toBeLessThan(dividers[1]!);
    } finally {
      await app.cleanup();
    }
  }
});

test("Home and End use the available input columns rather than the longest draft line", async () => {
  const app = await start([], { columns: 40, rows: 12 });
  try {
    await app.waitFor(() => app.stdin.isRaw);
    app.stdin.write("\x1b[200~AAAA\nB\x1b[201~");
    await app.waitFor(() => app.screen().includes("❯ AAAA"));
    const row = app.screen().indexOf("❯ AAAA");
    app.stdin.write("\x1b[H\x1b[A\x1b[F");
    await Bun.sleep(25);
    await app.flush();
    expect(app.terminal.buffer.active.cursorX).toBe(6);
    expect(app.terminal.buffer.active.cursorY).toBe(row);
  } finally {
    await app.cleanup();
  }
});

test("approval details scroll independently with pinned choices and preserve the draft", async () => {
  const app = await start(["write"], { columns: 40, rows: 12 });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("next draft");
    await app.waitFor(() => app.screen().includes("❯ next draft"));
    app.calls[0]!.tool("write", {
      path: "file.txt",
      content: "start-marker " + "abcdefghij ".repeat(40) + "tail-marker",
    });
    await app.waitFor(() => app.screen().some((line) => line.includes("权限确认")));
    expect(app.screen()).toContain("write");
    expect(app.screen()).toContain("❯ 1. 允许一次");
    app.resize(39, 11);
    await app.waitFor(() => app.screen().some((line) => line.includes("请调整窗口")));
    app.stdin.write("\r");
    await Bun.sleep(25);
    expect(app.calls).toHaveLength(1);
    app.resize(40, 12);
    await app.waitFor(() => app.screen().includes("write"));
    app.stdin.write("\t" + "\x1b[6~".repeat(30));
    await app.waitFor(() => app.screen().includes("}"));
    expect(app.screen()).toContain("❯ 1. 允许一次");
    const divider = app.screen().findIndex((line) => line.includes("权限确认"));
    expect(app.screen().length - 1 - divider).toBeLessThanOrEqual(6);
    app.stdin.write("\x1b[<64;5;6M");
    await Bun.sleep(25);
    expect(app.screen()).toContain("❯ 1. 允许一次");
    app.stdin.write("\x1b");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      role: "toolResult",
      isError: true,
    });
    await app.waitFor(() => app.screen().includes("❯ next draft"));
    expect(app.calls).toHaveLength(2);
  } finally {
    await app.cleanup();
  }
});
