import { expect, test } from "bun:test";
import { start } from "../helpers/app";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV2UAAAAASUVORK5CYII=";
const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;
function clickToken(app: Awaited<ReturnType<typeof start>>, token: string) {
  const row = app.screen().findLastIndex((line) => line.includes(token));
  expect(row).toBeGreaterThanOrEqual(0);
  const col = Bun.stringWidth(app.screen()[row]!.slice(0, app.screen()[row]!.indexOf(token)));
  // Click the middle of the token, independently of the current caret cell.
  app.stdin.write(`\x1b[<0;${col + 6};${row + 1}M\x1b[<0;${col + 6};${row + 1}m`);
  return { row, col };
}

test("clicking a composer image reuses the message modal and preserves the highlighted draft", async () => {
  const app = await start([], {
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
    },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => screen().includes("❯ [Image #1]"));
    const { row, col } = clickToken(app, "[Image #1]");
    await app.waitFor(
      () => screen().includes("Image #1 · PNG") && screen().includes("Open original"),
    );
    expect(
      app.terminal.buffer.active
        .getLine(row)
        ?.getCell(col + 5)
        ?.isInverse(),
    ).toBeTruthy();
    expect(screen()).toContain("Open original");
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen().includes("Image #1 · PNG"));
    clickToken(app, "[Image #1]");
    await app.waitFor(
      () => screen().includes("Image #1 · PNG") && screen().includes("Open original"),
    );
    expect(
      app.terminal.buffer.active
        .getLine(row)
        ?.getCell(col + 5)
        ?.isInverse(),
    ).toBeTruthy();
    app.stdin.write("ignored\r");
    await app.waitFor(() => !screen().includes("Open original"));
    expect(screen()).toContain("❯ [Image #1]");
    expect(screen()).not.toContain("ignored");
    expect(app.calls).toHaveLength(0);
    app.stdin.write("look ");
    await app.waitFor(() => screen().includes("❯ look [Image #1]"));
    clickToken(app, "[Image #1]");
    await app.waitFor(
      () => screen().includes("Image #1 · PNG") && screen().includes("Open original"),
    );
    expect(screen()).toContain("Open original");
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen().includes("Image #1 · PNG"));
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 1);
    expect(
      app.calls[0]!.context.messages.findLast((message) => message.role === "user"),
    ).toMatchObject({
      content: [
        { type: "text", text: "look [Image #1] " },
        { type: "image", data: png },
      ],
    });
    expect(screen()).not.toContain("Image #1 · PNG");
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("click targets follow wrapped image units and resize while typed labels stay inert", async () => {
  const app = await start([], {
    columns: 40,
    rows: 32,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(`${root}/first.png`, Buffer.from(png, "base64"));
      await Bun.write(`${root}/second.png`, Buffer.from(png, "base64"));
    },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("中文🙂" + "x".repeat(24) + paste(`${app.root}/first.png`));
    await app.waitFor(() => screen().includes("[Image #1]"));
    app.stdin.write(paste(`${app.root}/second.png`));
    await app.waitFor(() => screen().includes("[Image #2]"));
    const first = clickToken(app, "[Image #1]");
    await app.waitFor(
      () => screen().includes("Image #1 · PNG") && screen().includes("Open original"),
    );
    expect(
      app.terminal.buffer.active
        .getLine(first.row)
        ?.getCell(first.col + 5)
        ?.isInverse(),
    ).toBeTruthy();
    expect(screen()).toContain("1/2");
    app.stdin.write("\x1b[C");
    await app.waitFor(() => screen().includes("Image #2 · PNG") && screen().includes("2/2"));
    const secondRow = app.screen().findLastIndex((line) => line.includes("[Image #2]"));
    const secondCol = Bun.stringWidth(
      app.screen()[secondRow]!.slice(0, app.screen()[secondRow]!.indexOf("[Image #2]")),
    );
    const second = { row: secondRow, col: secondCol };
    await app.waitFor(
      () => screen().includes("Image #2 · PNG") && screen().includes("Open original"),
    );
    expect(
      app.terminal.buffer.active
        .getLine(first.row)
        ?.getCell(first.col + 5)
        ?.isInverse(),
    ).toBeFalsy();
    expect(
      app.terminal.buffer.active
        .getLine(second.row)
        ?.getCell(second.col + 5)
        ?.isInverse(),
    ).toBeTruthy();
    app.resize(60, 32);
    await app.waitFor(() =>
      app.screen().some((line) => line.startsWith("╭") && Bun.stringWidth(line) === 60),
    );
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen().includes("Open original"));
    clickToken(app, "[Image #1]");
    await app.waitFor(
      () => screen().includes("Image #1 · PNG") && !screen().includes("Image #2 · PNG"),
    );
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen().includes("Open original"));
    app.stdin.write("\x1b[F" + paste("\n[Image #9]!"));
    await app.waitFor(() => screen().includes("[Image #9]!"));
    clickToken(app, "[Image #9]");
    // A subsequent edit paints a new frame and proves the literal click did not move the caret.
    app.stdin.write("?");
    await app.waitFor(() => screen().includes("[Image #9]!?"));
    expect(screen()).not.toContain("Image #9 · PNG");
    expect(screen()).not.toContain("Image #1 · PNG");
    clickToken(app, "[Image #2]");
    await app.waitFor(
      () => screen().includes("Image #2 · PNG") && screen().includes("Open original"),
    );
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen().includes("Open original"));
    app.stdin.write("\x1b[3~");
    await app.waitFor(() => !screen().includes("Image #2 · PNG"));
    expect(screen()).not.toContain("Image #2 · PNG");
  } finally {
    await app.cleanup();
  }
});

test("a folded pending question blocks composer image clicks and preserves the Run", async () => {
  const app = await start(["work"], {
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
    },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => screen().includes("❯ [Image #1]"));
    app.calls[0]!.tool("ask_user_question", {
      questions: [
        {
          question: "Which storage?",
          header: "Storage",
          multiSelect: false,
          options: [
            { label: "SQLite", description: "Local" },
            { label: "Postgres", description: "Remote" },
          ],
        },
      ],
    });
    await app.waitFor(() => screen().includes("Which storage?"));
    app.stdin.write("\x0b");
    await app.waitFor(() => screen().includes("Ctrl+K to expand"));
    clickToken(app, "[Image #1]");
    app.stdin.write("x");
    await app.waitFor(() => screen().includes("❯ [Image #1] x"));
    expect(screen()).not.toContain("Image #1 · PNG");
    app.stdin.write("\x0b");
    await app.waitFor(() => screen().includes("Enter submit"));
    app.stdin.write("\x1b");
    await app.waitFor(() => app.calls.length === 2 && !screen().includes("Enter submit"));
    expect(app.calls[1]!.signal!.aborted).toBe(false);
    clickToken(app, "[Image #1]");
    await app.waitFor(
      () => screen().includes("Image #1 · PNG") && screen().includes("Open original"),
    );
    expect(screen()).toContain("Open original");
    app.stdin.write("\x03");
    await app.waitFor(() => !screen().includes("Open original"));
    expect(app.calls[1]!.signal!.aborted).toBe(false);
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});
