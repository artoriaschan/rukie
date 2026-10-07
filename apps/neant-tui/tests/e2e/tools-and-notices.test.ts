import { withAuxiliaryRequests } from "../helpers/auxiliary-model.ts";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession } from "@neant/agent";
import { start } from "../helpers/app";
import { startWithClock } from "../helpers/clock-app";

const assistant = process.platform === "darwin" ? "⏺" : "●";

test.each([
  ["zh_CN.UTF-8", "Hook 已结束运行"],
  ["en_US.UTF-8", "Run stopped by hook"],
])("%s shows the stop reason when a hook terminates the run", async (lang, label) => {
  const app = await start(["--yolo", "try"], {
    env: { LANG: lang },
    session: {
      settings: {
        hooks: {
          PreToolUse: [
            {
              hooks: [
                {
                  type: "command",
                  command: `echo '{"continue":false,"stopReason":"hook-stop-reason"}'`,
                },
              ],
            },
          ],
        },
      },
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", { command: "touch forbidden", description: "Run test command" });
    await app.waitFor(() => !app.isWorking());
    expect(app.allLines().join("\n")).toContain(label!);
    expect(app.allLines().join("\n")).toContain("hook-stop-reason");
    expect(app.calls).toHaveLength(1);
  } finally {
    await app.cleanup();
  }
});

test.each([
  ["zh_CN.UTF-8", "被 hook 拒绝"],
  ["en_US.UTF-8", "Denied by hook"],
])("%s shows hook denial provenance, warnings and user messages", async (lang, label) => {
  const sessionOptions = {
    settings: {
      hooks: {
        PreToolUse: [
          {
            hooks: [
              { type: "command" as const, command: "echo '{bad}'" },
              {
                type: "command" as const,
                command: `echo '{"systemMessage":"hook-user-notice","hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"protected"}}'`,
              },
            ],
          },
        ],
      },
    },
  };
  const app = await start(["--yolo", "try"], { env: { LANG: lang }, session: sessionOptions });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", { command: "touch forbidden", description: "Run test command" });
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.allLines().join("\n")).toContain(label!);
    expect(app.allLines().join("\n")).toContain("hook-user-notice");
    expect(app.allLines().join("\n")).toContain(
      lang!.startsWith("zh") ? "无效的 hook JSON" : "Invalid hook JSON",
    );
    expect(await Bun.file(join(app.root, "forbidden")).exists()).toBe(false);
  } finally {
    await app.cleanup();
  }
});

function runningTools(app: Awaited<ReturnType<typeof start>>) {
  return app.screen().filter((line) => /^(?:[●⏺] |  )(?:写入 |执行\()/.test(line));
}

test("a tool animates its localized header then remains once in the scrollable body", async () => {
  const permission = Promise.withResolvers<"allow" | "deny">();
  const app = await startWithClock(["write a file"], {
    session: { onPermissionAsk: () => permission.promise },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("write", {
      path: "written.txt",
      content: "first line\n" + "long content ".repeat(30) + "hidden tail",
    });
    await app.waitFor(() => runningTools(app).some((line) => line.includes("写入 ")));
    const first = app.screen().find((line) => line.includes("写入 written.txt"))!;
    expect(first).toContain("written.txt");
    expect(app.screen().filter((line) => line.includes("写入 written.txt"))).toHaveLength(1);
    expect(app.screen().join("\n")).not.toContain("hidden tail");
    await app.waitFor(() =>
      app.screen().some((line) => line.includes("写入 written.txt") && line !== first),
    );
    permission.resolve("allow");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.delta("file written");
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.allLines().filter((line) => line.startsWith("• 写入 "))).toHaveLength(1);
    expect(app.allLines().join("\n")).toContain("+first line");
    expect(runningTools(app).some((line) => line.includes("写入 "))).toBe(false);
    app.stdin.write("next\r");
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.delta("next reply\n".repeat(12));
    app.calls[2]!.finish();
    await app.waitFor(
      () =>
        app
          .allLines()
          .map((line) =>
            line
              .padEnd(app.stdout.columns)
              .slice(0, app.stdout.columns - 2)
              .trimEnd(),
          )
          .filter((line) => line === "  next reply" || line === `${assistant} next reply`)
          .length === 12 && !app.isWorking(),
    );
    app.stdin.write("\x1b[5~");
    await app.waitFor(() => app.allLines().some((line) => line.startsWith("• 写入 ")));
    expect(app.allLines().filter((line) => line.startsWith("• 写入 "))).toHaveLength(1);
    expect(app.terminal.buffer.active.baseY).toBe(0);
    app.stdin.write("\x1b[5~");
    await app.waitFor(() => app.screen().some((line) => line.includes("Neant")));
    // Page down from the welcome header to the settled tool in the transcript.
    app.stdin.write("\x1b[6~");
    await app.waitFor(() => app.screen().some((line) => line.startsWith("• 写入 ")));
    expect(app.screen().filter((line) => line.startsWith("• 写入 "))).toHaveLength(1);
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
          description: "Run test command",
        },
      },
      {
        name: "bash",
        args: {
          command:
            "while [ ! -f second.release ]; do sleep 0.01; done; printf 'first failure\\nsecond failure\\nthird failure\\nfourth-hidden\\n'; exit 1",
          description: "Run test command",
        },
      },
    ]);
    const active = () => runningTools(app);
    await app.waitFor(() => active().length === 2);
    expect(active()[0]).toContain("first.release");
    expect(active()[1]).toContain("second.release");
    await Bun.write(join(root, "second.release"), "");
    await app.waitFor(() => app.allLines().some((line) => line.startsWith("✗ 执行(")));
    expect(active()).toHaveLength(1);
    expect(active()[0]).toContain("first.release");
    expect(app.allLines()).toContain(" ⎿ first failure");
    expect(app.allLines()).toContain("   second failure");
    expect(app.allLines()).toContain("   third failure");
    expect(app.allLines()).not.toContain("fourth-hidden");
    await Bun.write(join(root, "first.release"), "");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.delta("tools finished");
    app.calls[1]!.finish();
    await app.waitFor(
      () => app.allLines().includes(`${assistant} tools finished`) && !app.isWorking(),
    );
    expect(active()).toHaveLength(0);
    const completed = app.allLines().filter((line) => /^[•✗] 执行\(/.test(line));
    expect(completed).toHaveLength(2);
    expect(completed[0]).toContain("✗ 执行(");
    expect(completed[0]).toContain("second.release");
    expect(completed[1]).toContain("• 执行(");
    expect(completed[1]).toContain("first.release");
    expect(app.allLines()).toContain(" ⎿ hidden-success-output");
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
  "%s MCP failures appear once as a quiet divider notice while system reminders stay hidden",
  async (locale, prefix) => {
    const app = await startWithClock(["--trust-project-mcp", "hi"], {
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
      await app.waitFor(() => app.screen().some((line) => line.startsWith(`─ ${prefix}`)));
      const row = app.screen().findIndex((line) => line.startsWith(`─ ${prefix}`));
      const cell = app.terminal.buffer.active
        .getLine(app.terminal.buffer.active.viewportY + row)!
        .getCell(0)!;
      expect(cell.getFgColor()).toBe(0x5e6673);
      expect(app.screen()[row]).toContain(
        locale === "zh" ? "MCP 配置无效：" : "Invalid MCP configuration:",
      );
      expect(app.allLines().filter((line) => line.startsWith(`─ ${prefix}`))).toHaveLength(1);
      expect(app.stderr()).toBe("");
      app.calls[0]!.delta("MCP checked");
      app.calls[0]!.finish();
      await app.waitFor(() => app.allLines().includes(`${assistant} MCP checked`));
      expect(app.allLines().filter((line) => line.startsWith(`─ ${prefix}`))).toHaveLength(1);
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
  "%s compaction is a quiet divider message notice without exposing the summary",
  async (locale, prefix) => {
    const app = await startWithClock(["read the file"], {
      rows: 40,
      env: { LANG: locale },
      prepare: async (root) => {
        await Bun.write(join(root, "large.txt"), "tool output\n".repeat(2500));
      },
    });
    // Keep tool declarations below the trigger; the large read starts compaction.
    app.model.contextWindow = 5000;
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
      await app.waitFor(() => app.screen().some((line) => line.startsWith(`─ ${prefix}`)));
      await app.waitFor(() => app.screen().some((line) => / · [\d.]+k→[\d.]+k/.test(line)));
      expect(app.screen().join("\n")).not.toMatch(/收拾一下上下文…|整理背包中…/);
      const row = app.screen().findIndex((line) => line.startsWith(`─ ${prefix}`));
      expect(
        app.terminal.buffer.active
          .getLine(app.terminal.buffer.active.viewportY + row)!
          .getCell(0)!
          .getFgColor(),
      ).toBe(0x5e6673);
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
      expect(app.allLines().filter((line) => line.startsWith(`─ ${prefix}`))).toHaveLength(1);
      expect(app.allLines().join("\n")).not.toContain("private-compaction-summary");
      expect(app.allLines().join("\n")).not.toContain("second summary line");
      expect(app.allLines().join("\n")).toContain("   tool output");
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
    app.calls[0]!.tool("bash", {
      command: "printf forbidden > marker",
      description: "Run test command",
    });
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
        streamFn: withAuxiliaryRequests((model, context, options) =>
          original.streamSimple(model, context, options),
        ),
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
