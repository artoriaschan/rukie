import { expect, test } from "bun:test";
import { join } from "node:path";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession } from "@neant/agent";
import { start } from "../helpers/app";

const assistant = process.platform === "darwin" ? "⏺" : "●";

function runningTools(app: Awaited<ReturnType<typeof start>>) {
  const buffer = app.terminal.buffer.active;
  return app.screen().filter(
    (line, row) =>
      /^[·•●] (write|bash) /.test(line) &&
      buffer
        .getLine(buffer.viewportY + row)!
        .getCell(0)!
        .getFgColor() === 0x7da1de,
  );
}

test("a tool shows an animated one-line summary then remains once in the scrollable body", async () => {
  const permission = Promise.withResolvers<"allow" | "deny">();
  const app = await start(["write a file"], {
    session: { onPermissionAsk: () => permission.promise },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("write", {
      path: "written.txt",
      content: "first line\n" + "long content ".repeat(30) + "hidden tail",
    });
    await app.waitFor(() => runningTools(app).some((line) => line.includes("write ")));
    const first = app.screen().find((line) => line.includes("write {"))!;
    expect(first).toContain('"path":"written.txt"');
    expect(app.screen().filter((line) => line.includes("write {"))).toHaveLength(1);
    expect(app.screen().join("\n")).not.toContain("hidden tail");
    await app.waitFor(() =>
      app.screen().some((line) => line.includes("write {") && line !== first),
    );
    permission.resolve("allow");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.delta("file written");
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.allLines().filter((line) => line.startsWith("• write "))).toHaveLength(1);
    expect(app.allLines().join("\n")).toContain("⎿ Successfully wrote");
    expect(runningTools(app).some((line) => line.includes("write "))).toBe(false);
    app.stdin.write("next\r");
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.delta("next reply\n".repeat(12));
    app.calls[2]!.finish();
    await app.waitFor(
      () =>
        app
          .allLines()
          .filter((line) => line === "  next reply" || line === `${assistant} next reply`)
          .length === 12 && !app.isWorking(),
    );
    expect(app.allLines().filter((line) => line.startsWith("• write "))).toHaveLength(1);
    expect(app.terminal.buffer.active.baseY).toBe(0);
    app.stdin.write("\x1b[5~");
    await app.waitFor(() => app.screen().includes("❯ write a file"));
    // The return button takes two rows from the transcript viewport while reading above the bottom.
    app.stdin.write("\x1b[<65;5;2M");
    await app.waitFor(() => app.screen().some((line) => line.startsWith("• write ")));
    expect(app.screen().filter((line) => line.startsWith("• write "))).toHaveLength(1);
  } finally {
    permission.resolve("deny");
    await app.cleanup();
  }
});

test("parallel calls of the same tool finish independently and show only the first error lines", async () => {
  let root = "";
  const app = await start(["--yolo", "run tools"], {
    prepare: async (directory) => {
      root = directory;
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools([
      {
        name: "bash",
        args: {
          command: "while [ ! -f first.release ]; do sleep 0.01; done; echo hidden-success-output",
        },
      },
      {
        name: "bash",
        args: {
          command:
            "while [ ! -f second.release ]; do sleep 0.01; done; printf 'first failure\\nsecond failure\\nthird failure\\nfourth-hidden\\n'; exit 1",
        },
      },
    ]);
    const active = () => runningTools(app);
    await app.waitFor(() => active().length === 2);
    expect(active()[0]).toContain("first.release");
    expect(active()[1]).toContain("second.release");
    await Bun.write(join(root, "second.release"), "");
    await app.waitFor(() => app.allLines().some((line) => line.startsWith("✗ bash ")));
    expect(active()).toHaveLength(1);
    expect(active()[0]).toContain("first.release");
    expect(app.allLines()).toContain("⎿ first failure");
    expect(app.allLines()).toContain("  second failure");
    expect(app.allLines()).toContain("  third failure");
    expect(app.allLines()).not.toContain("fourth-hidden");
    await Bun.write(join(root, "first.release"), "");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.delta("tools finished");
    app.calls[1]!.finish();
    await app.waitFor(
      () => app.allLines().includes(`${assistant} tools finished`) && !app.isWorking(),
    );
    expect(active()).toHaveLength(0);
    const completed = app.allLines().filter((line) => /^[•✗] bash /.test(line));
    expect(completed).toHaveLength(2);
    expect(completed[0]).toContain("✗ bash");
    expect(completed[0]).toContain("second.release");
    expect(completed[1]).toContain("• bash");
    expect(completed[1]).toContain("first.release");
    expect(app.allLines()).toContain("⎿ hidden-success-output");
  } finally {
    await Promise.all([
      Bun.write(join(root, "first.release"), ""),
      Bun.write(join(root, "second.release"), ""),
    ]);
    await app.cleanup();
  }
});

test.each([
  ["zh", "MCP 服务器 broken 出错："],
  ["en", "MCP server broken:"],
] as const)(
  "%s MCP failures appear once as a warning-colored one-line notice while system reminders stay hidden",
  async (locale, prefix) => {
    const app = await start(["--trust-project-mcp", "hi"], {
      env: { LANG: locale },
      prepare: async (root) => {
        await Bun.write(join(root, ".mcp.json"), JSON.stringify({ mcpServers: { broken: {} } }));
        await Bun.write(join(root, "AGENTS.md"), "private-project-reminder");
      },
      session: {
        reminderSources: [{ source: "private", currentContent: () => "private-custom-reminder" }],
      },
    });
    try {
      await app.waitFor(() => app.calls.length === 1);
      await app.waitFor(() => app.screen().some((line) => line.startsWith(prefix)));
      const row = app.screen().findIndex((line) => line.startsWith(prefix));
      const cell = app.terminal.buffer.active
        .getLine(app.terminal.buffer.active.viewportY + row)!
        .getCell(0)!;
      expect(cell.getFgColor()).toBe(0xd8b270);
      expect(app.screen()[row]).toContain("Invalid MCP configuration:");
      expect(app.allLines().filter((line) => line.startsWith(prefix))).toHaveLength(1);
      expect(app.stderr()).toBe("");
      app.calls[0]!.delta("MCP checked");
      app.calls[0]!.finish();
      await app.waitFor(() => app.allLines().includes(`${assistant} MCP checked`));
      expect(app.allLines().filter((line) => line.startsWith(prefix))).toHaveLength(1);
      expect(app.allLines().join("\n")).not.toContain("private-project-reminder");
      expect(app.allLines().join("\n")).not.toContain("private-custom-reminder");
      expect(app.allLines().join("\n")).not.toContain("system-reminder");
    } finally {
      await app.cleanup();
    }
  },
);

test.each([
  ["zh", "上下文已压缩"],
  ["en", "Context compacted"],
] as const)(
  "%s compaction is a warning-colored one-line message notice without exposing the summary",
  async (locale, prefix) => {
    const app = await start(["read the file"], {
      env: { LANG: locale },
      prepare: async (root) => {
        await Bun.write(join(root, "large.txt"), "tool output ".repeat(2500));
      },
    });
    app.model.contextWindow = 4000;
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("read", { path: "large.txt" });
      await app.waitFor(() => app.calls.length === 2);
      if (locale === "zh")
        await app.waitFor(() =>
          app.screen().some((line) => /收拾一下上下文…|整理背包中…/.test(line)),
        );
      app.calls[1]!.delta("private-compaction-summary\nsecond summary line");
      app.calls[1]!.finish();
      await app.waitFor(() => app.calls.length === 3);
      await app.waitFor(() => app.screen().some((line) => line.startsWith(prefix)));
      await app.waitFor(() => app.screen().some((line) => / · [\d.]+k→[\d.]+k/.test(line)));
      expect(app.screen().join("\n")).not.toMatch(/收拾一下上下文…|整理背包中…/);
      const row = app.screen().findIndex((line) => line.startsWith(prefix));
      expect(
        app.terminal.buffer.active
          .getLine(app.terminal.buffer.active.viewportY + row)!
          .getCell(0)!
          .getFgColor(),
      ).toBe(0xd8b270);
      app.calls[2]!.delta("after compaction\n".repeat(10));
      app.calls[2]!.finish();
      await app.waitFor(
        () =>
          app
            .allLines()
            .filter(
              (line) => line === "  after compaction" || line === `${assistant} after compaction`,
            ).length === 10 && !app.isWorking(),
      );
      expect(app.allLines().filter((line) => line.startsWith(prefix))).toHaveLength(1);
      expect(app.allLines().join("\n")).not.toContain("private-compaction-summary");
      expect(app.allLines().join("\n")).not.toContain("second summary line");
      expect(app.allLines().join("\n")).toContain("⎿ tool output");
    } finally {
      await app.cleanup();
    }
  },
);

test.each([
  ["zh", "被权限规则拒绝：bash(printf forbidden*)"],
  ["en", "Denied by permission rule: bash(printf forbidden*)"],
] as const)("%s rule denial displays its original rule on the tool card", async (locale, text) => {
  const app = await start(["--yolo", "try forbidden"], {
    env: { LANG: locale },
    session: { settings: { permissions: { deny: ["bash(printf forbidden*)"] } } },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", { command: "printf forbidden > marker" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.delta("done");
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.allLines().join("\n")).toContain(text);
    expect(await Bun.file(join(app.root, "marker")).exists()).toBe(false);
  } finally {
    await app.cleanup();
  }
});

test.each([
  ["zh", "被权限规则拒绝：read"],
  ["en", "Denied by permission rule: read"],
] as const)("%s resume retains localized rule denial on the tool card", async (locale, text) => {
  const argv: string[] = [];
  const original = createFauxCore({ api: "faux", provider: "faux" });
  original.setResponses([
    fauxAssistantMessage(fauxToolCall("read", { path: "secret" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  const app = await start(argv, {
    env: { LANG: locale },
    prepare: async (root) => {
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: original.getModel(),
        streamFn: (model, context, options) => original.streamSimple(model, context, options),
        settings: { permissions: { deny: ["read"] } },
      });
      await session.run("try secret");
      argv.push("--resume", session.id);
    },
  });
  try {
    await app.waitFor(() => app.screen().includes("❯"));
    expect(app.allLines().join("\n")).toContain(text);
  } finally {
    await app.cleanup();
  }
});
