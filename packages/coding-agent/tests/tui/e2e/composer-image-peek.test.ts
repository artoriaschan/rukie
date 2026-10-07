import { expect, test } from "bun:test";
import { start } from "../helpers/app";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV2UAAAAASUVORK5CYII=";
const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;

test("caret previews a bound image without taking editing or submission", async () => {
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
    app.stdin.write("\x1b[H");
    await app.waitFor(() => screen().includes("Image #1 · PNG"));
    expect(screen()).toContain("1×1");
    expect(screen()).not.toContain("Open original");
    const row = app.screen().findIndex((line) => line.includes("❯ [Image #1]"));
    expect(app.terminal.buffer.active.getLine(row)?.getCell(5)?.isInverse()).toBeTruthy();
    app.stdin.write("\x1b[C");
    await app.waitFor(() => !screen().includes("Image #1 · PNG"));
    app.stdin.write("\x1b[D");
    await app.waitFor(() => screen().includes("Image #1 · PNG"));
    app.stdin.write("look ");
    await app.waitFor(() => screen().includes("❯ look [Image #1]"));
    app.stdin.write("\x1b[C");
    await app.waitFor(() => screen().includes("Image #1 · PNG"));
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

test("caret switches bound tokens and never previews typed labels or deleted images", async () => {
  const app = await start([], {
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(`${root}/first.png`, Buffer.from(png, "base64"));
      await Bun.write(`${root}/second.png`, Buffer.from(png, "base64"));
    },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("[Image #9]");
    await app.waitFor(() => screen().includes("❯ [Image #9]"));
    app.stdin.write("\x1b[H");
    await app.waitFor(() => app.terminal.buffer.active.cursorX === 2);
    expect(screen()).not.toContain("Image #9 · PNG");
    app.stdin.write("\x03" + paste(`${app.root}/first.png`));
    await app.waitFor(() => screen().includes("❯ [Image #1]"));
    app.stdin.write(paste(`${app.root}/second.png`));
    await app.waitFor(() => screen().includes("❯ [Image #1] [Image #2]"));
    app.stdin.write("\x1b[D\x1b[D");
    await app.waitFor(() => screen().includes("Image #2 · PNG"));
    expect(screen()).toContain("second.png");
    app.stdin.write("\x1b[D\x1b[D");
    await app.waitFor(() => screen().includes("Image #1 · PNG"));
    expect(screen()).toContain("first.png");
    app.stdin.write("\x1b[C\x1b[C");
    await app.waitFor(() => screen().includes("Image #2 · PNG"));
    app.stdin.write("\x1b[3~");
    await app.waitFor(() => !screen().includes("Image #2 · PNG"));
    expect(screen()).toContain("❯ [Image #1]");
    app.stdin.write("\x03");
    await app.waitFor(() => app.screen().includes("❯"));
    expect(screen()).not.toContain("Image #1 · PNG");
  } finally {
    await app.cleanup();
  }
});

test.each([80, 40])("caret fallback stays visible above the composer at %s×12", async (columns) => {
  const app = await start([], {
    columns,
    rows: 12,
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
    app.stdin.write("\x1b[H");
    await app.waitFor(() => screen().includes("Image #1 · PNG"));
    expect(screen()).toContain(
      columns === 80 ? "Image preview unavailable in this terminal" : "Image preview unavailable",
    );
    const promptRow = app.screen().findIndex((line) => line.includes("❯ [Image #1]"));
    const fallbackRow = app
      .screen()
      .findIndex((line) => line.includes("Image preview unavailable"));
    expect(fallbackRow).toBeLessThan(promptRow);
    expect(
      app
        .screen()
        .slice(promptRow + 1)
        .join("\n"),
    ).toContain("faux");
    app.resize(80, 40);
    await app.waitFor(() => screen().includes("Image preview unavailable in this terminal"));
    expect(screen()).toContain("Image #1 · PNG · 1×1 · 68 B · shot.png");
  } finally {
    await app.cleanup();
  }
});
