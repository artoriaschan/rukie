import { testClock } from "../helpers/test-clock";
import { expect, test } from "bun:test";
import { startWithClock } from "../helpers/clock-app";
import { createSession } from "@rukie/agent";
import { fauxProvider, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { auxiliaryModels } from "../helpers/auxiliary-model";

test.each(["en", "zh"] as const)(
  "an interrupted Run has an end time without a success label (%s)",
  async (locale) => {
    const app = await startWithClock(["interrupted run"], { rows: 40, env: { LANG: locale } });
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.delta("partial reply");
      await app.waitFor(() => app.screen().some((line) => line.includes("partial reply")));
      app.stdin.write("\x03");
      await app.waitFor(() =>
        app.screen().some((line) => line.includes(locale === "en" ? "✻ Ran for" : "✻ 执行了")),
      );
      const summary = app.screen().find((line) => line.startsWith("✻"))!;
      expect(summary).toContain(locale === "en" ? " · ended " : " · 结束于 ");
      expect(summary).not.toContain(locale === "en" ? "done" : "完成于");
    } finally {
      await app.cleanup();
    }
  },
);

test("resume renders saved Run summaries below the corresponding replies", async () => {
  const argv: string[] = [];
  const original = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
  original.setResponses([
    fauxAssistantMessage("saved first reply"),
    fauxAssistantMessage("saved second reply"),
  ]);
  const app = await startWithClock(argv, {
    rows: 40,
    env: { LANG: "en" },
    prepare: async (root) => {
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: original.getModel(),
        models: auxiliaryModels((model, context, options) =>
          original.provider.streamSimple(model, context, options),
        ),
      });
      await session.run("saved first prompt");
      await session.run("saved second prompt");
      argv.push("--resume", session.id);
      await session.close();
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    const lines = app.screen();
    const summaries = lines.flatMap((line, index) => (line.includes("✻ Baked for") ? [index] : []));
    expect(summaries).toHaveLength(2);
    expect(summaries[0], lines.join("\n")).toBe(
      lines.findIndex((line) => line.includes("saved first reply")) + 2,
    );
    expect(summaries[1]).toBe(lines.findIndex((line) => line.includes("saved second reply")) + 2);
    expect(app.calls).toHaveLength(0);
  } finally {
    await app.cleanup();
  }
});

test("each completed Run has one duration and completion timestamp below its messages", async () => {
  const app = await startWithClock(["first run"], { rows: 40, env: { LANG: "en" } });
  try {
    await app.waitFor(() => app.calls.length === 1);
    expect(app.screen().join("\n")).not.toContain("Baked for");
    testClock.advanceTimersByTime(197000);
    app.calls[0]!.delta("first reply");
    app.calls[0]!.finish();
    await app.waitFor(
      () => !app.isWorking() && app.screen().some((line) => line.includes("first reply")),
    );
    const lines = app.screen();
    const first = lines.findIndex((line) => line.includes("✻ Baked for 3m "));
    expect(first, lines.join("\n")).toBeGreaterThan(
      lines.findIndex((line) => line.includes("first reply")),
    );
    expect(lines[first]).toMatch(/3m \d{2}s · done \d{1,2}:\d{2} [AP]M/);
    app.stdin.write("second run\r");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.delta("second reply");
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(
      app.screen().filter((line) => line.includes("✻ Baked for")),
      app.screen().join("\n"),
    ).toHaveLength(2);
    const before = app.output();
    app.resize(40, 24);
    await app.waitFor(() => app.output() !== before);
    expect(
      app.screen().filter((line) => line.includes("✻ Baked for")),
      app.screen().join("\n"),
    ).toHaveLength(2);
  } finally {
    await app.cleanup();
  }
});
