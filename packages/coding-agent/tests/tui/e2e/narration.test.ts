import { startWithClock } from "../helpers/clock-app";
import { expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { figures } from "../../../src/ink/index.ts";
import { start } from "../helpers/app";

test.each(["environment", "settings"])(
  "%s English locale injects the English narration contract once and renders streamed narration",
  async (source) => {
    const env = { LANG: source === "environment" ? "en_US.UTF-8" : "zh_CN.UTF-8" };
    const app = await startWithClock(["investigate"], {
      env,
      columns: 160,
      prepare:
        source === "settings"
          ? async (root) => {
              await mkdir(join(root, ".rukie"));
              await writeFile(
                join(root, ".rukie", "settings.json"),
                JSON.stringify({ locale: "en-GB" }),
              );
            }
          : undefined,
    });
    try {
      await app.waitFor(() => app.calls.length === 1);
      const first = app.calls[0]!.context.messages;
      const reminders = first.filter(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("[Status line]"),
      );
      expect(reminders).toHaveLength(1);
      expect(JSON.stringify(reminders)).toContain(
        "a concrete description of what you are doing (20 words max)",
      );
      expect(JSON.stringify(reminders)).not.toMatch(/\p{Script=Han}/u);
      expect(JSON.stringify(first.filter((message) => message.role === "system"))).not.toContain(
        "[Status line]",
      );
      app.calls[0]!.delta("⏵ Investigating the error\nFound the cause");
      await app.waitFor(() =>
        app.screen().some((line) => line.includes("⏵ Investigating the error")),
      );
      expect(app.screen().filter((line) => line.includes("Investigating the error"))).toHaveLength(
        1,
      );
      await app.waitFor(() => app.screen().includes(`${figures.assistant} Found the cause`));
      expect(app.screen()).toContain(`${figures.assistant} Found the cause`);
      app.calls[0]!.finish();
      await app.waitFor(() => !app.isWorking());
      env.LANG = "zh_CN.UTF-8";
      app.stdin.write("again\r");
      await app.waitFor(() => app.calls.length === 2);
      expect(
        app.calls[1]!.context.messages.filter(
          (message) =>
            message.role === "user" && JSON.stringify(message.content).includes("[Status line]"),
        ),
      ).toEqual(reminders);
      expect(JSON.stringify(app.calls[1]!.context.messages)).not.toContain("[状态栏]");
      app.calls[1]!.finish();
    } finally {
      await app.cleanup();
    }
  },
);

test("TUI injects narration once per Session alongside caller reminders without changing the System Prompt", async () => {
  const app = await start(["first"], {
    session: {
      reminderSources: [{ source: "custom", currentContent: () => "caller reminder" }],
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    const first = app.calls[0]!.context;
    const system = first.messages.filter((message) => message.role === "system");
    expect(system).toHaveLength(1);
    expect(JSON.stringify(system)).not.toContain("[状态栏]");
    const reminders = first.messages.filter(
      (message) => message.role === "user" && JSON.stringify(message.content).includes("[状态栏]"),
    );
    expect(reminders).toHaveLength(1);
    expect(JSON.stringify(reminders[0]!.content)).toContain("⏵ 你在做的具体事情（不超过20字）");
    expect(JSON.stringify(first.messages)).toContain("caller reminder");
    app.calls[0]!.delta("first reply");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("second\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(
      app.calls[1]!.context.messages.filter(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("[状态栏]"),
      ),
    ).toEqual(reminders);
    expect(app.calls[1]!.context.messages.filter((message) => message.role === "system")).toEqual(
      system,
    );
  } finally {
    await app.cleanup();
  }
});

test("streamed narration stays in the activity line while reply text enters scrollback", async () => {
  const app = await start(["investigate"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("⏵");
    await app.waitFor(() => app.screen().some((line) => line.includes("↓ 1 tokens")));
    expect(app.allLines().join("\n")).not.toContain(`${figures.assistant}`);
    app.calls[0]!.delta(" 查一下报错原因");
    await app.waitFor(() => app.screen().some((line) => line.includes("⏵ 查一下报错原因")));
    expect(app.screen().filter((line) => line.includes("查一下报错原因"))).toHaveLength(1);
    expect(app.allLines().join("\n")).not.toContain(`${figures.assistant} ⏵`);
    app.calls[0]!.delta("\n找到原因");
    await app.waitFor(() => app.screen().includes(`${figures.assistant} 找到原因`));
    expect(app.screen().filter((line) => line.includes("查一下报错原因"))).toHaveLength(1);
    app.calls[0]!.delta("\n⏵ 给补丁跑个验证\n验证通过");
    await app.waitFor(() => app.screen().some((line) => line.includes("⏵ 给补丁跑个验证")));
    expect(app.screen()).toContain("  验证通过");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.allLines()).toContain(`${figures.assistant} 找到原因`);
    expect(app.allLines()).toContain("  验证通过");
    expect(app.allLines().join("\n")).not.toContain("⏵");
    app.stdin.write("next\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        content: [{ type: "text", text: "⏵ 查一下报错原因\n找到原因\n⏵ 给补丁跑个验证\n验证通过" }],
      }),
    );
  } finally {
    await app.cleanup();
  }
});
