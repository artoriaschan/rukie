import { expect, test } from "bun:test";
import { start } from "../helpers/app";

test.each([
  ["zh", "bash"],
  ["en", "bash"],
  ["zh", "ask_user_question"],
  ["en", "ask_user_question"],
])("%s child %s dialog displays its origin before the title", async (locale, tool) => {
  const app = await start(["delegate"], {
    env: { LANG: locale === "zh" ? "zh_CN.UTF-8" : "en_US.UTF-8" },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("subagent", {
      description: "Inspect",
      prompt: "child",
      run_in_background: false,
    });
    await app.waitFor(() => app.calls.length === 2);
    if (tool === "bash")
      app.calls[1]!.tool("bash", { command: "printf origin", description: "Run test command" });
    else
      app.calls[1]!.tool("ask_user_question", {
        questions: [
          {
            question: "Proceed?",
            header: "Next",
            options: [
              { label: "Yes", description: "Proceed" },
              { label: "No", description: "Stop" },
            ],
          },
        ],
      });
    await app.waitFor(() =>
      app
        .screen()
        .join("\n")
        .includes(tool === "bash" ? "printf origin" : "Proceed?"),
    );
    const heading = app
      .screen()
      .find((line) =>
        line.includes(
          tool === "bash"
            ? locale === "zh"
              ? "等待审批"
              : "Waiting for approval"
            : locale === "zh"
              ? "第 1/1 题"
              : "Question 1/1",
        ),
      );
    expect(heading).toContain(locale === "zh" ? "子代理：Inspect" : "Subagent: Inspect");
    app.stdin.write(tool === "bash" ? "1\r" : "\r");
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.finish();
    await app.waitFor(() => app.calls.length === 4);
    app.calls[3]!.finish();
    await app.waitFor(() => !app.isWorking());
  } finally {
    await app.cleanup();
  }
});
