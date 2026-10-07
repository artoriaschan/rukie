import { expect, test } from "bun:test";
import { startWithClock } from "../helpers/clock-app";

test("bottom-following messages leave two blank rows above the input through resize", async () => {
  const app = await startWithClock(["bottom spacing"], { columns: 80, rows: 24 });
  const gap = () => {
    const screen = app.screen();
    const message = screen.findIndex((line) => line.includes("bottom marker"));
    const input = screen.findIndex((line) => line.startsWith("╭"));
    expect(message).toBeGreaterThanOrEqual(0);
    expect(input).toBe(message + 3);
    expect(screen.slice(message + 1, input)).toEqual(["", ""]);
  };
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(
      Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n") + "\nbottom marker",
    );
    app.calls[0]!.finish();
    await app.waitFor(
      () => !app.isWorking() && app.screen().some((line) => line.includes("bottom marker")),
    );
    gap();
    const before = app.output();
    app.resize(40, 12);
    await app.waitFor(() => app.output() !== before);
    gap();
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("messages retain one blank row between live and settled cards through resize", async () => {
  const app = await startWithClock(["--yolo", "spacing prompt"], {
    columns: 80,
    rows: 50,
    env: { LANG: "en" },
    prepare: async (root) => {
      await Bun.write(`${root}/first.txt`, "first output\n");
      await Bun.write(`${root}/second.txt`, "second output\n");
    },
  });
  const row = (text: string) => app.screen().findIndex((line) => line.includes(text));
  const separated = (before: string, after: string) => {
    const top = row(before);
    const bottom = row(after);
    expect(top, `${before} -> ${after}\n${app.screen().join("\n")}`).toBeGreaterThanOrEqual(0);
    expect(bottom).toBe(top + 2);
    expect(app.screen()[top + 1]).toBe("");
  };
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.thinking("reason marker");
    await app.waitFor(() => row("reason marker") >= 0);
    separated("spacing prompt", "Thinking");
    app.calls[0]!.delta("answer marker");
    await app.waitFor(() => row("answer marker") >= 0 && row("reason marker") < 0);
    separated("Thinking", "answer marker");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("tool prompt\r");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.tool("read", { path: "first.txt" });
    await app.waitFor(() => app.calls.length === 3 && row("first output") >= 0);
    app.calls[2]!.tool("read", { path: "second.txt" });
    await app.waitFor(() => app.calls.length === 4 && row("second output") >= 0);
    separated("answer marker", "tool prompt");
    separated("tool prompt", "Read first.txt");
    separated("first output", "Read second.txt");
    app.calls[3]!.delta("final marker");
    app.calls[3]!.finish();
    await app.waitFor(() => !app.isWorking() && row("final marker") >= 0);
    separated("second output", "final marker");
    app.resize(40, 50);
    await app.waitFor(() => app.screen().every((line) => Bun.stringWidth(line) <= 40));
    separated("spacing prompt", "Thinking");
    separated("Thinking", "answer marker");
    separated("answer marker", "tool prompt");
    separated("tool prompt", "Read first.txt");
    separated("first output", "Read second.txt");
    separated("second output", "final marker");
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});
