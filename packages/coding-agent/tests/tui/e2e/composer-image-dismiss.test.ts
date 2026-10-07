import { expect, test } from "bun:test";
import { start } from "../helpers/app";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV2UAAAAASUVORK5CYII=";
const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;

test("Escape dismisses only the current token and leaving rearms its preview", async () => {
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
    app.stdin.write(paste(`${app.root}/first.png`));
    await app.waitFor(() => screen().includes("❯ [Image #1]"));
    app.stdin.write(paste(`${app.root}/second.png`));
    await app.waitFor(() => screen().includes("❯ [Image #1] [Image #2]"));
    app.stdin.write("\x1b[H");
    await app.waitFor(() => screen().includes("Image #1 · PNG"));
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen().includes("Image #1 · PNG"));
    expect(screen()).toContain("❯ [Image #1] [Image #2]");
    app.resize(81, 24);
    await app.waitFor(() =>
      app.screen().some((line) => line.startsWith("╭") && Bun.stringWidth(line) === 81),
    );
    expect(screen()).not.toContain("Image #1 · PNG");
    app.stdin.write("\x1b[C\x1b[D");
    await app.waitFor(() => screen().includes("Image #1 · PNG"));
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen().includes("Image #1 · PNG"));
    app.stdin.write("\x1b[C\x1b[C");
    await app.waitFor(() => screen().includes("Image #2 · PNG"));
    expect(screen()).toContain("second.png");
    app.stdin.write("\x1b[F");
    await app.waitFor(() => !screen().includes("Image #2 · PNG"));
    app.stdin.write("\x1b[H\x1b");
    await app.waitFor(() => !screen().includes("Image #1 · PNG"));
    expect(screen()).toContain("❯ [Image #1] [Image #2]");
  } finally {
    await app.cleanup();
  }
});

test("first Escape closes the composer preview during a Run and second Escape interrupts", async () => {
  const app = await start([], {
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
    },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    app.stdin.write("start run\r");
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write(paste(`${app.root}/shot.png`));
    await app.waitFor(() => screen().includes("❯ [Image #1]"));
    app.stdin.write("\x1b[H");
    await app.waitFor(() => screen().includes("Image #1 · PNG"));
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen().includes("Image #1 · PNG"));
    expect(app.calls[0]!.signal!.aborted).toBe(false);
    expect(screen()).toContain("❯ [Image #1]");
    app.stdin.write("\x1b");
    await app.waitFor(() => app.calls[0]!.signal!.aborted);
    await app.waitFor(() => !app.isWorking());
    expect(screen()).toContain("❯ [Image #1]");
  } finally {
    await app.cleanup();
  }
});
