import { expect, test } from "bun:test";
import { start } from "../helpers/app";

function border(app: Awaited<ReturnType<typeof start>>) {
  const row = app.screen().findIndex((line) => line.startsWith("╭"));
  return app.terminal.buffer.active.getLine(row)!.getCell(0)!.getFgColor();
}

// An absent spinner can precede result settlement for an empty model reply.
async function completedRuns(app: Awaited<ReturnType<typeof start>>, count: number) {
  await app.waitFor(
    () => !app.isWorking() && app.screen().filter((line) => line.startsWith("✻ ")).length === count,
  );
}

test("/plan toggles guidance, border and chip without sending a prompt", async () => {
  const app = await start();
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    const ordinaryBorder = border(app);
    app.stdin.write("/plan\r");
    await app.waitFor(() => app.screen().some((line) => line.includes("已进入 Plan Mode")));
    expect(app.calls).toHaveLength(0);
    expect(app.screen().at(-2)).toContain("plan");
    expect(border(app)).toBe(0xb49adc);
    expect(border(app)).not.toBe(ordinaryBorder);
    app.stdin.write("/plan\r");
    await app.waitFor(() => !app.screen().at(-2)!.includes("plan"));
    expect(border(app)).toBe(ordinaryBorder);
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test.each([
  ["zh", "已进入 Plan Mode"],
  ["en", "Entered Plan Mode"],
] as const)(
  "/plan guidance reaches the next prompt and unknown slash prompts survive in %s",
  async (locale, enabled) => {
    const app = await start([], {
      prepare: async (root) => {
        await Bun.write(`${root}/.rukie/settings.json`, JSON.stringify({ locale }));
      },
    });
    try {
      await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
      app.stdin.write("/plan\r");
      await app.waitFor(() => app.screen().at(-2)!.includes("plan"));
      app.stdin.write("inspect layout\r");
      await app.waitFor(() => app.calls.length === 1);
      expect(
        app.calls[0]!.context.messages.findLast(
          (message) =>
            message.role === "user" &&
            !JSON.stringify(message.content).includes("<system-reminder>"),
        ),
      ).toMatchObject({
        role: "user",
        content: [{ type: "text", text: "inspect layout" }],
      });
      expect(JSON.stringify(app.calls[0]!.context)).toContain("You are in Plan Mode");
      expect(app.screen().at(-2)).toContain("plan");
      app.calls[0]!.finish();
      await completedRuns(app, 1);
      app.stdin.write("inspect again\r");
      await app.waitFor(() => app.calls.length === 2);
      expect(
        app.calls[1]!.context.messages.findLast(
          (message) =>
            message.role === "user" &&
            !JSON.stringify(message.content).includes("<system-reminder>"),
        ),
      ).toMatchObject({
        content: [{ type: "text", text: "inspect again" }],
      });
      app.calls[1]!.finish();
      await completedRuns(app, 2);
      app.stdin.write("/plan\r");
      await app.waitFor(() => !app.screen().at(-2)!.includes("plan"));
      app.stdin.write("/planner untouched\r");
      await app.waitFor(() => app.calls.length === 3);
      expect(
        app.calls[2]!.context.messages.findLast(
          (message) =>
            message.role === "user" &&
            !JSON.stringify(message.content).includes("<system-reminder>"),
        ),
      ).toMatchObject({
        content: [{ type: "text", text: "/planner untouched" }],
      });
      expect(JSON.stringify(app.calls[2]!.context)).toContain("You have exited Plan Mode");
      app.calls[2]!.finish();
      await completedRuns(app, 3);
      app.stdin.write("/plan\r");
      await app.waitFor(() => app.screen().some((line) => line.includes(enabled)));
    } finally {
      await app.cleanup();
    }
  },
);

test.each([40, 60, 80])(
  "Plan chip and border stay visible at %i columns and a running toggle is rejected",
  async (columns) => {
    const app = await start([], { columns, rows: 24 });
    try {
      await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
      app.stdin.write("/plan\r");
      await app.waitFor(() => app.screen().at(-2)!.includes("plan"));
      expect(border(app)).toBe(0xb49adc);
      app.stdin.write("work\r");
      await app.waitFor(() => app.calls.length === 1);
      app.stdin.write("/plan\r");
      await app.waitFor(() => app.screen().join("\n").includes("run 结束后再用"));
      expect(app.screen().at(-2)).toContain("plan");
      app.calls[0]!.finish();
      await completedRuns(app, 1);
      app.stdin.write("/plan\r");
      await app.waitFor(() => !app.screen().at(-2)!.includes("plan"));
    } finally {
      await app.cleanup();
    }
  },
);
