import { expect, spyOn, test } from "bun:test";
import { createSession } from "@neant/agent";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { start } from "../../helpers/app";

const esc = "\x1b";
const text = (app: Awaited<ReturnType<typeof start>>) => app.screen().join("\n");

async function ready(options: Parameters<typeof start>[1] = {}) {
  const app = await start([], { env: { LANG: "en_US.UTF-8" }, ...options });
  await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
  return app;
}

test("empty idle input asks for a second Escape and an empty session never opens a picker", async () => {
  const app = await ready();
  try {
    app.stdin.write(esc);
    await app.waitFor(() => text(app).includes("Press Esc again to rewind"));
    app.stdin.write(esc);
    await app.waitFor(() => text(app).includes("Nothing to rewind yet"));
    expect(text(app)).not.toContain("Pick a message to rewind to");
  } finally {
    await app.cleanup();
  }
});

async function prompt(app: Awaited<ReturnType<typeof start>>, value: string) {
  const index = app.calls.length;
  app.stdin.write(value + "\r");
  await app.waitFor(() => app.calls.length === index + 1);
  app.calls[index]!.delta(`answer ${index}`);
  app.calls[index]!.finish();
  await app.waitFor(
    () =>
      text(app).includes(`answer ${index}`) &&
      !app.isWorking() &&
      !/esc (interrupt|中断)/.test(text(app)),
  );
}

async function open(app: Awaited<ReturnType<typeof start>>) {
  app.stdin.write(esc);
  await app.waitFor(() => text(app).includes("Press Esc again to rewind"));
  app.stdin.write(esc);
  await app.waitFor(() => text(app).includes("Pick a message to rewind to"));
}

test.each([24, 48, 100].flatMap((rows) => [1, 2, 20].map((count) => [rows, count] as const)))(
  "rewind at %i rows with %i prompts grows naturally and stops at fourteen rows",
  async (rows, count) => {
    const app = await ready({ rows });
    try {
      for (let index = 0; index < count; index++) await prompt(app, `prompt ${index}`);
      await open(app);
      const lines = app.screen();
      const input = lines.findIndex((line) => line === "❯");
      const footer = lines.findIndex((line) => line.includes("Enter to select"));
      const divider = lines.findIndex((line, index) => index < footer && /^─+$/.test(line));
      expect(footer - divider + 3).toBe(count === 1 ? 9 : count === 2 ? 10 : 14);
      expect(input - footer).toBe(3);
      expect(
        lines
          .slice(lines.findIndex((line) => line.includes("last message")) + 1, footer)
          .filter((line) => !line.trim()),
      ).toHaveLength(0);
    } finally {
      await app.cleanup();
    }
  },
);

test("picker shows recent prompts first, cycles, confirms conversation and refills the input", async () => {
  const app = await ready();
  try {
    await prompt(app, "old question");
    await prompt(app, "latest question");
    await open(app);
    let lines = app.screen();
    expect(lines.findIndex((line) => line.includes("❯ latest question"))).toBeLessThan(
      lines.findIndex((line) => line.startsWith("╭")),
    );
    expect(text(app)).toContain("last message");
    app.stdin.write("\x1b[A");
    await app.waitFor(() =>
      app
        .screen()
        .some((line) => line.startsWith("  ❯ old question") || line.startsWith(" ❯ old question")),
    );
    app.stdin.write("\x1b[B");
    await app.waitFor(() => text(app).includes("❯ latest question"));
    app.stdin.write("\r");
    await app.waitFor(() => text(app).includes("Rewind to this message?"));
    expect(text(app)).toContain("conversation restarts here");
    expect(text(app)).not.toContain("Restore code");
    app.stdin.write(esc);
    await app.waitFor(() => text(app).includes("Pick a message to rewind to"));
    app.stdin.write("\r");
    await app.waitFor(() => text(app).includes("Rewind to this message?"));
    app.stdin.write("\r");
    await app.waitFor(() => text(app).includes("Rewound — edit and press Enter to resend"));
    expect(text(app)).not.toContain("Rewind to this message?");
    app.stdin.write(" revised\r");
    await app.waitFor(() => app.calls.length === 3);
    const users = app.calls[2]!.context.messages.filter((message) => message.role === "user");
    expect(
      users
        .map((message) =>
          typeof message.content === "string"
            ? message.content
            : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
        )
        .filter((value) => !value.includes("<system-reminder>")),
    ).toEqual(["old question", "latest question revised"]);
    app.calls[2]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("expired Escape window restarts, content Escape clears and running Escape aborts", async () => {
  const app = await ready();
  const now = performance.now.bind(performance);
  let advance = 0;
  const clock = spyOn(performance, "now").mockImplementation(() => now() + advance);
  try {
    await prompt(app, "checkpoint");
    app.stdin.write(esc);
    await app.waitFor(() => text(app).includes("Press Esc again to rewind"));
    advance = 3100;
    app.stdin.write(esc);
    await app.waitFor(
      () => app.screen().filter((line) => line.includes("Press Esc again to rewind")).length === 2,
    );
    expect(text(app)).not.toContain("Pick a message to rewind to");
    app.stdin.write("draft");
    await app.waitFor(() => app.screen().includes("❯ draft"));
    app.stdin.write(esc);
    await app.waitFor(() => !app.screen().includes("❯ draft"));
    app.stdin.write(esc);
    await app.waitFor(
      () => app.screen().filter((line) => line.includes("Press Esc again to rewind")).length === 3,
    );
    app.stdin.write("running\r");
    await app.waitFor(() => app.calls.length === 2);
    app.stdin.write(esc);
    await app.waitFor(() => app.calls[1]!.signal!.aborted);
    expect(text(app)).not.toContain("Pick a message to rewind to");
  } finally {
    clock.mockRestore();
    await app.cleanup();
  }
});

async function toolsPrompt(
  app: Awaited<ReturnType<typeof start>>,
  value: string,
  tools: Parameters<(typeof app.calls)[number]["tools"]>[0],
  answer = "",
) {
  const index = app.calls.length;
  app.stdin.write(value + "\r");
  await app.waitFor(() => app.calls.length === index + 1);
  app.calls[index]!.tools(tools);
  await app.waitFor(() => app.calls.length === index + 2);
  if (answer) app.calls[index + 1]!.delta(answer);
  app.calls[index + 1]!.finish();
  await app.waitFor(() => !app.isWorking());
}

test.each([
  [0, true, true],
  [1, false, true],
  [2, true, false],
] as const)(
  "mode %i restores real files=%s and conversation=%s",
  async (mode, code, conversation) => {
    const app = await ready({
      session: { permissionMode: "full-access" },
      prepare: async (root) => {
        await Bun.write(join(root, "existing.txt"), "original");
      },
    });
    try {
      await prompt(app, "keep this prompt");
      await toolsPrompt(
        app,
        "target prompt",
        [
          { name: "write", args: { path: "existing.txt", content: "target" } },
          { name: "write", args: { path: "created.txt", content: "new" } },
        ],
        "discard this answer",
      );
      await toolsPrompt(app, "later prompt", [
        { name: "write", args: { path: "existing.txt", content: "later" } },
      ]);
      await Bun.write(join(app.root, "existing.txt"), "manual");
      await open(app);
      app.stdin.write("\x1b[B");
      await app.waitFor(() => text(app).includes("❯ target prompt"));
      expect(text(app)).toContain("2 files changed");
      app.stdin.write("\r");
      await app.waitFor(() => text(app).includes("Rewind to this message?"));
      expect(text(app)).toContain("Restore existing.txt");
      expect(text(app)).toContain("Delete created.txt");
      expect(text(app)).toContain("Changes made by bash are not restored");
      if (mode) app.stdin.write("\x1b[B".repeat(mode));
      app.stdin.write("\r");
      await app.waitFor(() =>
        text(app).includes(conversation ? "Rewound — edit" : "Restored 2 files"),
      );
      expect(await Bun.file(join(app.root, "existing.txt")).text()).toBe(
        code ? "original" : "manual",
      );
      expect(await Bun.file(join(app.root, "created.txt")).exists()).toBe(!code);
      if (conversation) expect(text(app)).not.toContain("discard this answer");
      else expect(text(app)).toContain("discard this answer");
      app.stdin.write(conversation ? " revised\r" : "next\r");
      await app.waitFor(() => app.calls.length === 6);
      const context = JSON.stringify(app.calls[5]!.context);
      expect(context.includes("discard this answer")).toBe(!conversation);
      expect(context.includes("later prompt")).toBe(!conversation);
      expect(context).toContain(conversation ? "target prompt revised" : "next");
      app.calls[5]!.finish();
    } finally {
      await app.cleanup();
    }
  },
);

function click(app: Awaited<ReturnType<typeof start>>, row: number, column = 4) {
  app.stdin.write(`\x1b[<0;${column};${row + 1}M\x1b[<0;${column};${row + 1}m`);
}

function cell(app: Awaited<ReturnType<typeof start>>, row: number, column: number) {
  return app.terminal.buffer.active.getLine(row)!.getCell(column)!;
}

test("picker cells match dsh title, focus, description, hover and native cursor", async () => {
  const app = await ready();
  try {
    await prompt(app, "old question");
    await prompt(app, "latest question");
    await open(app);
    const lines = app.screen();
    const title = lines.findIndex((line) => line.trim() === "Rewind");
    const subtitle = lines.findIndex((line) => line.includes("Pick a message"));
    const focus = lines.findIndex((line) => line.startsWith("  ❯ latest question"));
    const description = lines.findIndex((line) => line.includes("last message"));
    expect(title + 1).toBe(subtitle);
    expect(focus - subtitle).toBe(2);
    expect(lines[focus]).toBe("  ❯ latest question");
    expect(cell(app, title, 2).getFgColor()).toBe(0xabc2ec);
    expect(cell(app, title, 2).isBold()).toBeTruthy();
    expect(cell(app, focus, 4).getFgColor()).toBe(0xabc2ec);
    expect(cell(app, focus, 4).isBold()).toBeFalsy();
    expect(cell(app, description, 4).getFgColor()).toBe(0x8d95a6);
    expect(cell(app, description, 4).isDim()).toBeFalsy();
    expect(app.terminal.buffer.active.cursorY).toBe(focus);
    expect(app.terminal.buffer.active.cursorX).toBe(2);

    const old = lines.findIndex((line) => line === "    old question");
    app.stdin.write(`\x1b[<35;5;${old + 1}M`);
    await app.waitFor(() => cell(app, old, 4).getBgColor() === 0x3b5bdb);
    expect(text(app)).toContain("❯ latest question");
    app.stdin.write("\x1b[<35;1;1M");
    await app.waitFor(() => cell(app, old, 4).getBgColor() !== 0x3b5bdb);
    click(app, old);
    await app.waitFor(() =>
      app
        .screen()
        .some((line) => line.startsWith("  ❯ old question") || line.startsWith(" ❯ old question")),
    );
    expect(app.terminal.buffer.active.cursorY).toBe(old);
    expect(text(app)).not.toContain("Rewind to this message?");
  } finally {
    await app.cleanup();
  }
});

test("focus-centered window balances both sides and puts scroll indicators in the left gutter", async () => {
  const app = await ready({ rows: 48 });
  try {
    for (let index = 0; index < 20; index++) await prompt(app, `window ${index}`);
    await open(app);
    app.stdin.write("\x1b[B".repeat(10));
    await app.waitFor(() => app.screen().some((line) => line.startsWith("  ❯ window 9")));
    const lines = app.screen();
    const first = lines.findIndex((line) => line.includes("↑ window 12"));
    const focus = lines.findIndex((line) => line.startsWith("  ❯ window 9"));
    const last = lines.findIndex((line) => line.includes("↓ window 6"));
    expect(focus - first).toBe(3);
    expect(last - focus).toBe(3);
    expect(lines[focus]).toBe("  ❯ window 9");
  } finally {
    await app.cleanup();
  }
});

test("conversation-only confirmation uses dsh plain shape and a click executes it", async () => {
  const app = await ready();
  try {
    await prompt(app, "plain target");
    await open(app);
    app.stdin.write("\r");
    await app.waitFor(() => text(app).includes("Rewind to this message?"));
    const lines = app.screen();
    const title = lines.findIndex((line) => line.includes("Rewind to this message?"));
    expect(lines[title]).toBe("  Rewind to this message?");
    expect(lines[title + 1]).toBe("");
    expect(lines[title + 2]).toBe("    plain target");
    expect(lines[title + 3]).toBe("    conversation restarts here");
    click(app, title + 2);
    await app.waitFor(() => text(app).includes("Rewound — edit"));
    expect(app.screen()).toContain("❯ plain target");
  } finally {
    await app.cleanup();
  }
});

test.each([0, 1, 2])("confirmation mouse click executes real rewind mode %i", async (mode) => {
  const app = await ready({ session: { permissionMode: "full-access" } });
  try {
    await toolsPrompt(
      app,
      "mouse target",
      [{ name: "write", args: { path: "mouse.txt", content: "new" } }],
      "mouse answer",
    );
    await open(app);
    app.stdin.write("\r");
    await app.waitFor(() => text(app).includes("Rewind to this message?"));
    const label = ["❯ Restore code and conversation", "Restore conversation", "    Restore code"][
      mode
    ]!;
    const row = app.screen().findIndex((line) => line.includes(label));
    expect(row).toBeGreaterThan(0);
    click(app, row);
    await app.waitFor(() => text(app).includes(mode === 2 ? "Restored 1 files" : "Rewound — edit"));
    expect(await Bun.file(join(app.root, "mouse.txt")).exists()).toBe(mode === 1);
    expect(text(app).includes("mouse answer")).toBe(mode === 2);
    if (mode !== 2) expect(app.screen()).toContain("❯ mouse target");
  } finally {
    await app.cleanup();
  }
});

test.each([24, 48, 100].flatMap((rows) => [0, 1, 10].map((files) => [rows, files] as const)))(
  "confirmation at %i rows with %i files has its own natural height and fourteen-row cap",
  async (rows, files) => {
    const app = await ready({ rows, session: { permissionMode: "full-access" } });
    try {
      if (files)
        await toolsPrompt(
          app,
          "sized target",
          Array.from({ length: files }, (_, index) => ({
            name: "write",
            args: { path: `${index}.txt`, content: "new" },
          })),
        );
      else await prompt(app, "sized target");
      await open(app);
      app.stdin.write("\r");
      await app.waitFor(() => text(app).includes("Rewind to this message?"));
      const lines = app.screen();
      const footer = lines.findIndex((line) => line.includes("Enter to rewind"));
      const divider = lines.findIndex((line, index) => index < footer && /^─+$/.test(line));
      expect(footer - divider + 3).toBe(files === 0 ? 8 : files === 1 ? 11 : 14);
      expect(lines.findIndex((line) => line === "❯") - footer).toBe(3);
    } finally {
      await app.cleanup();
    }
  },
);

test.each([
  [40, 12],
  [60, 24],
  [80, 24],
] as const)(
  "windowed CJK picker at %i×%i keeps focus and chrome visible",
  async (columns, rows) => {
    const app = await ready({ columns, rows });
    try {
      for (let i = 0; i < 12; i++) await prompt(app, `消息${i} 中文长预览`.repeat(3));
      await open(app);
      expect(text(app)).toContain("last message");
      expect(text(app)).toContain("↓");
      const inputRow = app.screen().findIndex((line) => line === "❯");
      const footerRow = app.screen().findIndex((line) => line.includes("Enter to select"));
      expect(inputRow).toBeGreaterThanOrEqual(0);
      expect(footerRow).toBeLessThan(inputRow);
      app.stdin.write("\x1b[A");
      await app.waitFor(() => text(app).includes("❯ 消息0"));
      expect(text(app)).toContain("↑");
      expect(app.screen().findIndex((line) => line === "❯")).toBe(inputRow);
      expect(app.screen().findIndex((line) => line.includes("Enter to select"))).toBe(footerRow);
      expect(app.screen().every((line) => Bun.stringWidth(line) <= columns)).toBe(true);
      app.stdin.write("\x1b[B");
      await app.waitFor(() => text(app).includes("❯ 消息11"));
      app.stdin.write(esc);
      await app.waitFor(() => !text(app).includes("Pick a message to rewind to"));
      expect(text(app)).toContain("消息11");
    } finally {
      await app.cleanup();
    }
  },
);

test("preview collapses whitespace, caps at 80 characters, and mouse only moves focus", async () => {
  const argv: string[] = [];
  const app = await start(argv, {
    columns: 100,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      const faux = createFauxCore({ api: "faux", provider: "faux" });
      faux.setResponses([fauxAssistantMessage("old answer"), fauxAssistantMessage("new answer")]);
      await mkdir(join(root, ".neant/file-history"), { recursive: true });
      const seed = await createSession({
        cwd: root,
        homeDir: root,
        model: faux.getModel(),
        streamFn: faux.streamSimple,
      });
      await seed.run("old  \n  question");
      await seed.run("x".repeat(90));
      argv.push("--resume", seed.id);
      await seed.dispose();
    },
  });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    await open(app);
    expect(app.screen()).toContain("  ❯ " + "x".repeat(80) + "…");
    const oldRow = app.screen().findIndex((line) => line.includes("old question"));
    click(app, oldRow);
    await app.waitFor(() =>
      app
        .screen()
        .some((line) => line.startsWith("  ❯ old question") || line.startsWith(" ❯ old question")),
    );
    expect(text(app)).not.toContain("Rewind to this message?");
    app.stdin.write("\r");
    await app.waitFor(() => text(app).includes("Rewind to this message?"));
    app.stdin.write(esc);
    await app.waitFor(() => text(app).includes("Pick a message to rewind to"));
    app.resize(40, 12);
    await app.waitFor(() => app.screen().some((line) => line.includes("Enter to select")));
    expect(text(app)).toContain("❯ old question");
    expect(app.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
  } finally {
    await app.cleanup();
  }
});

test.each([
  [40, 12],
  [60, 24],
  [80, 24],
] as const)(
  "confirmation at %i×%i reserves fixed files and footer across modes",
  async (columns, rows) => {
    const app = await ready({ columns, rows, session: { permissionMode: "full-access" } });
    try {
      await toolsPrompt(
        app,
        "target 中文",
        Array.from({ length: 10 }, (_, index) => ({
          name: "write",
          args: { path: `${index}文件.txt`, content: "created" },
        })),
      );
      await open(app);
      expect(text(app)).toContain("10 files changed");
      app.stdin.write("\r");
      await app.waitFor(() => text(app).includes("Rewind to this message?"));
      expect(text(app)).toContain("Delete 0文件.txt");
      expect(text(app)).toMatch(/\+\d+ more/);
      expect(text(app)).toContain("Changes made by bash are not restored");
      const inputRow = app.screen().findIndex((line) => line === "❯");
      const hintRow = app.screen().findIndex((line) => line.includes("Enter to rewind"));
      app.stdin.write("\x1b[B");
      await app.waitFor(() => text(app).includes("❯ Restore conversation"));
      expect(text(app)).not.toContain("Changes made by bash");
      app.stdin.write("\x1b[B");
      await app.waitFor(() => text(app).includes("❯ Restore code"));
      expect(text(app)).toContain("Delete 0文件.txt");
      expect(app.screen().findIndex((line) => line === "❯")).toBe(inputRow);
      expect(app.screen().findIndex((line) => line.includes("Enter to rewind"))).toBe(hintRow);
      expect(app.screen().every((line) => Bun.stringWidth(line) <= columns)).toBe(true);
      app.stdin.write("\x1b[B");
      await app.waitFor(() => text(app).includes("❯ Restore code and conversation"));
      app.stdin.write(esc);
      await app.waitFor(() => text(app).includes("Pick a message to rewind to"));
      app.stdin.write(esc);
      await app.waitFor(() => !text(app).includes("Pick a message to rewind to"));
    } finally {
      await app.cleanup();
    }
  },
);

test("a target with no own file changes still offers code modes for later checkpoints", async () => {
  const app = await ready({ session: { permissionMode: "full-access" } });
  try {
    await prompt(app, "unchanged target");
    await toolsPrompt(app, "later writes", [
      { name: "write", args: { path: "later.txt", content: "created" } },
    ]);
    await open(app);
    app.stdin.write("\x1b[B\r");
    await app.waitFor(() => text(app).includes("Rewind to this message?"));
    expect(text(app)).toContain("Restore code and conversation");
    expect(text(app)).toContain("Delete later.txt");
    app.stdin.write("\r");
    await app.waitFor(() => text(app).includes("Rewound — edit"));
    expect(await Bun.file(join(app.root, "later.txt")).exists()).toBe(false);
    expect(text(app)).not.toContain("later writes");
  } finally {
    await app.cleanup();
  }
});

test("missing backup closes the picker with an error and preserves files and conversation", async () => {
  const app = await ready({
    session: { permissionMode: "full-access" },
    prepare: async (root) => {
      await Bun.write(join(root, "existing.txt"), "original");
    },
  });
  try {
    await toolsPrompt(
      app,
      "keep target",
      [{ name: "write", args: { path: "existing.txt", content: "changed" } }],
      "keep answer",
    );
    await rm(join(app.root, ".neant/file-history"), { recursive: true, force: true });
    await open(app);
    app.stdin.write("\r");
    await app.waitFor(() => text(app).includes("Rewind to this message?"));
    app.stdin.write("\r");
    await app.waitFor(() => text(app).includes("Checkpoint backup missing"));
    expect(text(app)).not.toContain("Rewind to this message?");
    expect(text(app)).toContain("keep answer");
    expect(await Bun.file(join(app.root, "existing.txt")).text()).toBe("changed");
    app.stdin.write("next\r");
    await app.waitFor(() => app.calls.length === 3);
    expect(JSON.stringify(app.calls[2]!.context)).toContain("keep answer");
    expect(JSON.stringify(app.calls[2]!.context)).toContain('"text":"next"');
    app.calls[2]!.finish();
  } finally {
    await app.cleanup();
  }
});

test.each(["permission", "question", "plan"] as const)(
  "%s pending at 40×12 takes Escape priority with Todo visible",
  async (kind) => {
    const app = await ready({ columns: 40, rows: 12 });
    try {
      await toolsPrompt(app, "keep todo", [
        { name: "todo_write", args: { todos: [{ content: "parent task", status: "pending" }] } },
      ]);
      app.stdin.write((kind === "plan" ? "/plan review" : "request") + "\r");
      await app.waitFor(() => app.calls.length === 3);
      const tool: Parameters<(typeof app.calls)[number]["tools"]>[0][number] =
        kind === "permission"
          ? { name: "write", args: { path: "file.txt", content: "created" } }
          : kind === "question"
            ? {
                name: "ask_user_question",
                args: {
                  questions: [
                    {
                      question: "Which storage?",
                      header: "Storage",
                      options: [
                        { label: "SQLite", description: "local" },
                        { label: "JSONL", description: "portable" },
                      ],
                    },
                  ],
                },
              }
            : { name: "exit_plan_mode", args: { plan: "# Review storage" } };
      app.calls[2]!.tool(tool.name, tool.args);
      await app.waitFor(() =>
        text(app).includes(
          kind === "permission"
            ? "1. Allow"
            : kind === "question"
              ? "Which storage?"
              : "Plan review",
        ),
      );
      expect(text(app)).toContain("✓ 0/1");
      app.stdin.write(esc);
      await app.waitFor(() => (kind === "plan" ? !app.isWorking() : app.calls.length === 4));
      expect(text(app)).not.toContain("Press Esc again to rewind");
      expect(text(app)).not.toContain("Pick a message to rewind to");
      if (kind !== "plan") {
        app.stdin.write(esc);
        await app.waitFor(() => app.calls[3]!.signal!.aborted);
      }
    } finally {
      await app.cleanup();
    }
  },
);

test.each([true, false])(
  "real conversation rewind restores prior Todo=%s, clears plan and discarded child display",
  async (priorTodo) => {
    const argv: string[] = [];
    const app = await start(argv, {
      columns: 60,
      rows: 24,
      env: { LANG: "en_US.UTF-8" },
      prepare: async (root) => {
        await mkdir(join(root, ".neant/file-history"), { recursive: true });
        const faux = createFauxCore({ api: "faux", provider: "faux" });
        faux.setResponses([
          ...(priorTodo
            ? [
                fauxAssistantMessage(
                  fauxToolCall("todo_write", {
                    todos: [{ content: "prior todo", status: "pending" }],
                  }),
                  { stopReason: "toolUse" },
                ),
              ]
            : []),
          fauxAssistantMessage("prior answer"),
          fauxAssistantMessage(
            [
              fauxToolCall("todo_write", {
                todos: [{ content: "discarded todo", status: "pending" }],
              }),
              fauxToolCall("subagent", {
                description: "discarded child",
                prompt: "child",
                run_in_background: false,
              }),
            ],
            { stopReason: "toolUse" },
          ),
          fauxAssistantMessage("child answer"),
          fauxAssistantMessage("discarded answer"),
        ]);
        const seed = await createSession({
          cwd: root,
          homeDir: root,
          model: faux.getModel(),
          streamFn: faux.streamSimple,
        });
        await seed.run("prior prompt");
        await seed.run("discarded prompt");
        await seed.setPlanMode(true);
        argv.push("--resume", seed.id);
        await seed.dispose();
      },
    });
    try {
      await app.waitFor(
        () => text(app).includes("discarded todo") && text(app).includes("discarded child"),
      );
      expect(text(app)).toContain("plan");
      await open(app);
      app.stdin.write("\r");
      await app.waitFor(() => text(app).includes("Rewind to this message?"));
      app.stdin.write("\r");
      await app.waitFor(() => text(app).includes("Rewound — edit"));
      expect(text(app)).not.toContain("discarded answer");
      expect(text(app)).not.toContain("discarded todo");
      expect(text(app)).not.toContain("discarded child");
      expect(app.screen().at(-2)).not.toContain("plan");
      expect(text(app).includes("prior todo")).toBe(priorTodo);
      app.stdin.write("\x01");
      await app.waitFor(() => text(app).includes("No subagents yet"));
      expect(text(app)).not.toContain("discarded child");
      app.stdin.write(esc);
      await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    } finally {
      await app.cleanup();
    }
  },
);

test("Chinese rewind title, choices and completion use frontend copy", async () => {
  const app = await ready({ env: { LANG: "zh_CN.UTF-8" } });
  try {
    await prompt(app, "inspect");
    app.stdin.write(esc);
    await app.waitFor(() => text(app).includes("再按一次 Esc 回退"));
    app.stdin.write(esc);
    await app.waitFor(() => text(app).includes("选择要回退到的消息"));
    expect(text(app)).toContain("最新消息");
    app.stdin.write("\r");
    await app.waitFor(() => text(app).includes("回退到这条消息？"));
    expect(text(app)).toContain("对话从此处重新开始");
    app.stdin.write("\r");
    await app.waitFor(() => text(app).includes("已回退 — 修改后按 Enter 重新发送"));
    expect(app.screen()).toContain("❯ inspect");
  } finally {
    await app.cleanup();
  }
});

test("40×12 rewind preserves Todo and resumed child panels while confirmation focus changes", async () => {
  const argv: string[] = [];
  const app = await start(argv, {
    columns: 40,
    rows: 12,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      await mkdir(join(root, ".neant/file-history"), { recursive: true });
      const faux = createFauxCore({ api: "faux", provider: "faux" });
      faux.setResponses([
        fauxAssistantMessage(
          [
            fauxToolCall("todo_write", {
              todos: [{ content: "retained task", status: "pending" }],
            }),
            fauxToolCall("subagent", {
              description: "retained child",
              prompt: "child",
              run_in_background: false,
            }),
          ],
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("child answer"),
        fauxAssistantMessage("prior answer"),
        fauxAssistantMessage(fauxToolCall("write", { path: "new.txt", content: "created" }), {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage("latest answer"),
      ]);
      const seed = await createSession({
        cwd: root,
        homeDir: root,
        model: faux.getModel(),
        streamFn: faux.streamSimple,
        permissionMode: "full-access",
      });
      await seed.run("prior prompt");
      await seed.run("target");
      argv.push("--resume", seed.id);
      await seed.dispose();
    },
  });
  try {
    await app.waitFor(() => text(app).includes("Subagents 0/1"));
    await open(app);
    expect(text(app)).toContain("✓ 0/1");
    expect(text(app)).toContain("Subagents 0/1");
    app.stdin.write("\r");
    await app.waitFor(() => text(app).includes("Rewind to this message?"));
    const inputRow = app.screen().findIndex((line) => line === "❯");
    const footerRow = app.screen().findIndex((line) => line.includes("Enter to rewind"));
    expect(text(app)).toContain("Delete new.txt");
    expect(text(app)).toContain("Changes made by bash are not restored");
    app.stdin.write("\x1b[B\x1b[B");
    await app.waitFor(() => text(app).includes("❯ Restore code"));
    expect(text(app)).toContain("✓ 0/1");
    expect(text(app)).toContain("Subagents 0/1");
    expect(app.screen().findIndex((line) => line === "❯")).toBe(inputRow);
    expect(app.screen().findIndex((line) => line.includes("Enter to rewind"))).toBe(footerRow);
    expect(app.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
    app.stdin.write("\r");
    await app.waitFor(() => text(app).includes("Restored 1 files"));
    expect(await Bun.file(join(app.root, "new.txt")).exists()).toBe(false);
    expect(text(app)).toContain("retained task");
    expect(text(app)).toContain("Subagents 0/1");
  } finally {
    await app.cleanup();
  }
});

test("40×12 confirmation keeps +N more visible beside long CJK file paths", async () => {
  const app = await ready({ columns: 40, rows: 12, session: { permissionMode: "full-access" } });
  try {
    await toolsPrompt(
      app,
      "target",
      ["甲", "乙", "丙"].map((label) => ({
        name: "write",
        args: { path: label.repeat(30) + ".txt", content: "created" },
      })),
    );
    await open(app);
    app.stdin.write("\r");
    await app.waitFor(() => text(app).includes("Rewind to this message?"));
    expect(text(app)).toContain("+2 more");
    expect(text(app)).toContain("Delete 甲");
    expect(text(app)).toContain("Changes made by bash are not restored");
    expect(app.screen().every((line) => Bun.stringWidth(line) <= 40)).toBe(true);
  } finally {
    await app.cleanup();
  }
});

test.each([8, 10])(
  "resize to 40×%i suspends rewind editing and restores focus at supported size",
  async (rows) => {
    const app = await ready({ columns: 40, rows: 12 });
    try {
      await prompt(app, "resize 中文 target");
      await open(app);
      app.resize(40, rows);
      await app.waitFor(() => text(app).includes("Resize to at least 40 columns"));
      expect(text(app)).not.toContain("Enter to select");
      app.stdin.write("\r");
      await app.flush();
      expect(app.calls).toHaveLength(1);
      app.resize(80, 48);
      await app.waitFor(() => text(app).includes("Pick a message to rewind to"));
      expect(app.screen()).toContain("  ❯ resize 中文 target");
      app.stdin.write("\r");
      await app.waitFor(() => text(app).includes("Rewind to this message?"));
      app.resize(40, 12);
      await app.waitFor(() => app.screen().some((line) => line.includes("Enter to rewind")));
      expect(text(app)).toContain("resize 中文 target");
      expect(app.screen().findIndex((line) => line.includes("Enter to rewind"))).toBeLessThan(
        app.screen().findIndex((line) => line === "❯"),
      );
    } finally {
      await app.cleanup();
    }
  },
);
