import { expect, test } from "bun:test";
import { start } from "../helpers/app";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV2UAAAAASUVORK5CYII=";
const paste = (text: string) => `\x1b[200~${text}\x1b[201~`;
const options = {
  rows: 40,
  env: { LANG: "en_US.UTF-8" },
  prepare: async (root: string) => {
    await Bun.write(`${root}/shot.png`, Buffer.from(png, "base64"));
  },
};
async function draftImage(app: Awaited<ReturnType<typeof start>>, number = 1) {
  app.stdin.write(paste(`${app.root}/shot.png`));
  await app.waitFor(() => app.screen().join("\n").includes(`❯ [Image #${number}]`));
  app.stdin.write("\x1b[H");
  await app.waitFor(() => app.screen().join("\n").includes(`Image #${number} · PNG`));
}

test("caret preview yields to a pending permission and restores after approval", async () => {
  const app = await start(["work"], options);
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    await draftImage(app);
    app.calls[0]!.tool("bash", { command: "printf peek", description: "Run test command" });
    await app.waitFor(() => screen().includes("Waiting for approval"));
    expect(screen()).not.toContain("Image #1 · PNG");
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 2 && screen().includes("Image #1 · PNG"));
    expect(app.calls[1]!.signal!.aborted).toBe(false);
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("caret preview yields to questions, including a folded question, and restores after declining", async () => {
  const app = await start(["work"], options);
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    await draftImage(app);
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
    expect(screen()).not.toContain("Image #1 · PNG");
    app.stdin.write("\x0b");
    await app.waitFor(() => screen().includes("Ctrl+K to expand"));
    expect(screen()).not.toContain("Image #1 · PNG");
    app.stdin.write("\x0b");
    await app.waitFor(() => screen().includes("Enter submit"));
    app.stdin.write("\x1b");
    await app.waitFor(() => app.calls.length === 2 && screen().includes("Image #1 · PNG"));
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("The user declined to answer.") }],
    });
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("caret preview restores after crossing both small-terminal thresholds and leaving a non-chat view", async () => {
  const app = await start([], options);
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    await draftImage(app);
    for (const [columns, rows] of [
      [39, 40],
      [80, 11],
    ]) {
      app.resize(columns!, rows!);
      await app.waitFor(() => screen().includes("Resize to at least"));
      expect(screen()).not.toContain("Image #1 · PNG");
      app.resize(80, 40);
      await app.waitFor(() => screen().includes("Image #1 · PNG"));
    }
    app.stdin.write("\x01");
    await app.waitFor(() => !screen().includes("❯ [Image #1]"));
    expect(screen()).not.toContain("Image #1 · PNG");
    app.stdin.write("\x1b");
    await app.waitFor(() => screen().includes("Image #1 · PNG"));
  } finally {
    await app.cleanup();
  }
});

test("a modal thumbnail preview takes priority and closing restores the caret preview", async () => {
  const app = await start([], options);
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    await draftImage(app);
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 1 && screen().includes("[Image · shot.png]"));
    await draftImage(app, 2);
    const row = app.screen().findIndex((line) => line.includes("[Image · sho"));
    expect(row).toBeGreaterThanOrEqual(0);
    const col = app.screen()[row]!.indexOf("[Image · sho") + 1;
    app.stdin.write(`\x1b[<0;${col};${row + 1}M\x1b[<0;${col};${row + 1}m`);
    await app.waitFor(() => screen().includes("Open original"));
    expect(app.screen().filter((line) => line.includes("PNG · 1×1")).length).toBe(1);
    app.stdin.write("\r");
    await app.waitFor(
      () => !screen().includes("Open original") && screen().includes("Image #2 · PNG"),
    );
    expect(app.calls[0]!.signal!.aborted).toBe(false);
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});
