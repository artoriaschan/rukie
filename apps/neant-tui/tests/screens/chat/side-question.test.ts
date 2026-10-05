import { expect, test } from "bun:test";
import { start } from "../../helpers/app";

const screen = (app: Awaited<ReturnType<typeof start>>) => app.screen().join("\n");

test("/btw streams in a separate overlay during the main Run and Escape aborts only the side request", async () => {
  const app = await start([], { env: { LANG: "en_US.UTF-8" } });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("main task\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("Main task continues.");
    app.stdin.write("/btw explain current work\r");
    await app.waitFor(() => app.sideQuestions.length === 1);
    const side = app.sideQuestions[0]!;
    expect(screen(app)).toContain("explain current work");
    side.thinking("PRIVATE_SIDE_REASONING");
    side.delta("First side sentence.");
    await app.waitFor(() => screen(app).includes("First side sentence."));
    expect(screen(app)).not.toContain("PRIVATE_SIDE_REASONING");
    expect(app.calls).toHaveLength(1);
    expect(app.calls[0]!.signal!.aborted).toBe(false);
    app.calls[0]!.delta(" Main output still arrives.");
    await app.waitFor(() => screen(app).includes("Main output still arrives."));
    app.stdin.write("\x1b");
    await app.waitFor(() => side.signal!.aborted);
    await app.waitFor(() => !screen(app).includes("First side sentence."));
    expect(app.calls[0]!.signal!.aborted).toBe(false);
    expect(app.isWorking()).toBe(true);
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("next main prompt\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(JSON.stringify(app.calls[1]!.context)).not.toContain("explain current work");
    expect(JSON.stringify(app.calls[1]!.context)).not.toContain("First side sentence.");
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
  } finally {
    await app.cleanup();
  }
});

test("closing a side overlay restores a folded main question without answering or interrupting it", async () => {
  const app = await start([], { env: { LANG: "en_US.UTF-8" }, columns: 40, rows: 12 });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("main question task\r");
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("ask_user_question", {
      questions: [
        {
          question: "Choose storage",
          header: "Storage",
          options: [
            { label: "SQLite", description: "local" },
            { label: "JSONL", description: "portable" },
          ],
        },
      ],
    });
    await app.waitFor(() => screen(app).includes("Choose storage"));
    app.stdin.write("\x0b");
    await app.waitFor(() => screen(app).includes("Waiting for your answer"));
    app.stdin.write("/btw explain the options\r");
    await app.waitFor(() => app.sideQuestions.length === 1);
    app.sideQuestions[0]!.delta("Both store local data.");
    await app.waitFor(() => screen(app).includes("Both store local data."));
    expect(screen(app)).not.toContain("Waiting for your answer");
    app.stdin.write("\x1b");
    await app.waitFor(() => screen(app).includes("Waiting for your answer"));
    expect(app.sideQuestions[0]!.signal!.aborted).toBe(true);
    expect(app.calls[0]!.signal!.aborted).toBe(false);
    expect(app.calls).toHaveLength(1);
    app.stdin.write("\x0b");
    await app.waitFor(() => screen(app).includes("Choose storage"));
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(JSON.stringify(app.calls[1]!.context)).toContain("SQLite");
    expect(JSON.stringify(app.calls[1]!.context)).not.toContain("Both store local data.");
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
  } finally {
    await app.cleanup();
  }
});

test("a second side question replaces and aborts the first while title and main requests keep separate queues", async () => {
  const app = await start([], { env: { LANG: "en_US.UTF-8" }, controlTitles: true });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("main work\r");
    await app.waitFor(() => app.calls.length === 1 && app.titles.length === 1);
    app.stdin.write("/btw first question\r");
    await app.waitFor(() => app.sideQuestions.length === 1);
    const first = app.sideQuestions[0]!;
    first.delta("Old side answer.");
    await app.waitFor(() => screen(app).includes("Old side answer."));
    app.stdin.write("/btw second question\r");
    await app.waitFor(() => app.sideQuestions.length === 2);
    const second = app.sideQuestions[1]!;
    expect(first.signal!.aborted).toBe(true);
    first.delta("LATE_OLD_DELTA");
    second.delta("Replacement side answer.");
    second.finish();
    await app.waitFor(() => screen(app).includes("Replacement side answer."));
    expect(screen(app)).not.toContain("Old side answer.");
    expect(screen(app)).not.toContain("LATE_OLD_DELTA");
    expect(JSON.stringify(second.context)).not.toContain("Old side answer.");
    expect(app.calls).toHaveLength(1);
    expect(app.titles).toHaveLength(1);
    expect(app.calls[0]!.signal!.aborted).toBe(false);
    expect(app.titles[0]!.signal!.aborted).toBe(false);
    app.titles[0]!.delta("Main title");
    app.titles[0]!.finish();
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen(app).includes("Replacement side answer."));
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
  } finally {
    await app.cleanup();
  }
});

test("40×12 side overlay localizes usage and errors, scrolls long replies, and keeps an editable replacement prompt", async () => {
  const app = await start([], { columns: 40, rows: 12 });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("/btw\r");
    await app.waitFor(() => screen(app).includes("用法：/btw <问题>"));
    expect(app.sideQuestions).toHaveLength(0);
    expect(app.calls).toHaveLength(0);
    app.stdin.write("/btw 很长的侧问\r");
    await app.waitFor(() => app.sideQuestions.length === 1);
    const first = app.sideQuestions[0]!;
    first.delta(Array.from({ length: 30 }, (_, index) => `第 ${index} 行侧问回答`).join("\n"));
    first.finish();
    await app.waitFor(() => screen(app).includes("第 29 行侧问回答"));
    expect(screen(app)).toContain("Esc 关闭");
    app.stdin.write("\x1b[A\x1b[A");
    await app.waitFor(() => !screen(app).includes("第 29 行侧问回答"));
    app.stdin.write("/btw retry\r");
    await app.waitFor(() => app.sideQuestions.length === 2);
    app.sideQuestions[1]!.fail("Side provider unavailable");
    await app.waitFor(() => screen(app).includes("Side provider unavailable"));
    expect(screen(app)).toContain("/btw retry");
    expect(app.calls).toHaveLength(0);
    app.stdin.write("\x1b");
    await app.waitFor(() => !screen(app).includes("Side provider unavailable"));
  } finally {
    await app.cleanup();
  }
});
