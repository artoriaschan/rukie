import { withAuxiliaryRequests } from "../helpers/auxiliary-model.ts";
import { expect, test } from "bun:test";
import { createFauxCore, fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createSession } from "@neant/agent";
import { start } from "../helpers/app";

test.each(["zh", "en"] as const)(
  "%s todo transcript cards show progress within four rows",
  async (locale) => {
    const app = await start(["plan"], {
      columns: 80,
      rows: 40,
      env: { LANG: locale === "zh" ? "zh_CN.UTF-8" : "en_US.UTF-8" },
    });
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("todo_write", {
        todos: [
          { content: "Finished work", status: "completed" },
          { content: " First\nactive ", status: "in_progress" },
          { content: "Second active " + "x".repeat(100), status: "in_progress" },
          { content: "Third active", status: "in_progress" },
          { content: "Pending work", status: "pending" },
        ],
      });
      await app.waitFor(() => app.calls.length === 2);
      app.calls[1]!.delta("after card");
      app.calls[1]!.finish();
      await app.waitFor(() => !app.isWorking());
      const lines = app.allLines();
      const title = locale === "zh" ? "• 待办清单" : "• TodoWrite";
      const index = lines.indexOf(title);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(lines.slice(index, index + 4)).toEqual([
        title,
        "⎿ todos ✓ 1/5",
        "  ● First active",
        "  ● Second active " + "x".repeat(62),
      ]);
      expect(lines[index + 4]).toBe("⏺ after card");
      expect(lines.join("\n")).not.toContain("Updated todo list:");
      expect(lines.join("\n")).not.toContain('"todos":');
    } finally {
      await app.cleanup();
    }
  },
);

async function startSession(locale: "zh" | "en") {
  const argv: string[] = [];
  let root = "";
  const original = createFauxCore({ api: "faux", provider: "faux" });
  original.setResponses([fauxAssistantMessage("seed reply")]);
  const options = {
    rows: 40,
    columns: 120,
    env: { LANG: locale === "zh" ? "zh_CN.UTF-8" : "en_US.UTF-8" },
  };
  const app = await start(argv, {
    ...options,
    prepare: async (directory) => {
      root = directory;
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: original.getModel(),
        streamFn: withAuxiliaryRequests((model, context, options) =>
          original.streamSimple(model, context, options),
        ),
      });
      await session.run("seed prompt");
      argv.push("--resume", session.id);
    },
  });
  return {
    app,
    replay: () => start(argv, { ...options, session: { cwd: root, homeDir: root } }),
  };
}

test.each(["zh", "en"] as const)(
  "%s todo transcript cards keep each call's list live and after resume even after clearing",
  async (locale) => {
    const { app, replay } = await startSession(locale);
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      app.stdin.write("plan\r");
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("todo_write", {
        todos: [
          { content: "Already done", status: "completed" },
          { content: "Original active", status: "in_progress" },
          { content: "Next work", status: "pending" },
        ],
      });
      await app.waitFor(() => app.calls.length === 2);
      app.calls[1]!.tool("todo_write", {
        todos: [
          { content: "Original active", status: "completed" },
          { content: "Replacement active", status: "in_progress" },
        ],
      });
      await app.waitFor(() => app.calls.length === 3);
      app.calls[2]!.tool("todo_write", { todos: [] });
      await app.waitFor(() => app.calls.length === 4);
      app.calls[3]!.finish();
      await app.waitFor(() => !app.isWorking());
      const title = locale === "zh" ? "• 待办清单" : "• TodoWrite";
      const expected = [
        title,
        "⎿ todos ✓ 1/3",
        "  ● Original active",
        title,
        "⎿ todos ✓ 1/2",
        "  ● Replacement active",
        title,
        "⎿ todos ✓ 0/0",
      ];
      const lines = app.allLines();
      const index = lines.indexOf(title);
      expect(lines.slice(index, index + expected.length)).toEqual(expected);
      const resumed = await replay();
      try {
        await resumed.waitFor(() => resumed.screen().includes("❯"));
        const lines = resumed.allLines();
        const index = lines.indexOf(title);
        expect(lines.slice(index, index + expected.length)).toEqual(expected);
      } finally {
        await resumed.cleanup();
      }
    } finally {
      await app.cleanup();
    }
  },
);

test.each(["zh", "en"] as const)(
  "%s invalid todo calls retain ordinary error cards live and after resume",
  async (locale) => {
    const { app, replay } = await startSession(locale);
    try {
      await app.waitFor(() => app.screen().includes("❯"));
      app.stdin.write("plan\r");
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("todo_write", {
        todos: [
          { content: "repeat", status: "in_progress" },
          { content: "repeat", status: "completed" },
        ],
      });
      await app.waitFor(() => app.calls.length === 2);
      app.calls[1]!.tool("todo_write", { todos: [{ content: "invalid", status: "cancelled" }] });
      await app.waitFor(() => app.calls.length === 3);
      app.calls[2]!.finish();
      await app.waitFor(() => !app.isWorking());
      const lines = app.allLines();
      const errors = lines.filter((line) =>
        line.startsWith(locale === "zh" ? "✗ 待办(" : "✗ Todos("),
      );
      expect(errors).toHaveLength(2);
      expect(lines).toContain('⎿ Invalid todos: duplicate content "repeat".');
      expect(lines.join("\n")).toContain("Validation failed");
      expect(lines.join("\n")).not.toContain("todos ✓");
      expect(lines).not.toContain(locale === "zh" ? "• 待办清单" : "• TodoWrite");
      const resumed = await replay();
      try {
        await resumed.waitFor(() => resumed.screen().includes("❯"));
        const replayLines = resumed.allLines();
        expect(
          replayLines.filter((line) => line.startsWith(locale === "zh" ? "✗ 待办(" : "✗ Todos(")),
        ).toEqual(errors);
        expect(replayLines).toContain('⎿ Invalid todos: duplicate content "repeat".');
        expect(replayLines.join("\n")).toContain("Validation failed");
        expect(replayLines.join("\n")).not.toContain("todos ✓");
      } finally {
        await resumed.cleanup();
      }
    } finally {
      await app.cleanup();
    }
  },
);
