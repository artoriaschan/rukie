import { createJsonlStore, type SessionOptions } from "@rukie/agent";
import type { Storage } from "@earendil-works/pi-durable";
import { expect, test } from "bun:test";
import { startWithClock as start } from "../helpers/clock-app";
import { startWithClock } from "../helpers/clock-app";

for (const [lang, title, summary] of [
  ["en_US.UTF-8", "Subagents", "Summary"],
  ["zh_CN.UTF-8", "子代理", "摘要"],
] as const) {
  test(`${lang} dashboard captures all input and opens the keyboard-selected child detail`, async () => {
    const app = await start(["--permission-mode", "full-access", "delegate"], {
      columns: 160,
      rows: 40,
      env: { LANG: lang },
    });
    const screen = () => app.screen().join("\n");
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tools([
        { name: "subagent", args: { description: "First", prompt: "child first" } },
        { name: "subagent", args: { description: "Second", prompt: "child second" } },
      ]);
      await app.waitFor(() => app.calls.length === 4 && screen().includes("Second"));
      app.stdin.write("draft\x01");
      await app.waitFor(() => screen().includes(`─ ${title} `));
      const selected = app
        .screen()
        .filter((line) => /(?:Subagent: |子代理：)(First|Second)/.test(line))[1]!
        .includes("Second")
        ? "Second"
        : "First";
      app.stdin.write("ignored\x1b[200~pasted\x1b[201~\x1b[B\r");
      await app.waitFor(() => screen().includes(summary) && screen().includes("id "));
      expect(app.screen().find((line) => line.includes(selected))).toBeDefined();
      expect(screen()).not.toContain(selected === "Second" ? "First" : "Second");
      expect(screen()).not.toContain("ignored");
      expect(screen()).not.toContain("pasted");
      app.stdin.write("\x1b");
      await app.waitFor(() => screen().includes(`─ ${title} `));
      app.stdin.write("\x03");
      await app.waitFor(() => !screen().includes(`─ ${title} `) && screen().includes("draft"));
      expect(app.calls.slice(1).every((call) => !call.signal!.aborted)).toBe(true);
    } finally {
      await app.cleanup();
    }
  });
}

function click(app: Awaited<ReturnType<typeof start>>, text: string) {
  const row = app.screen().findIndex((line) => line.includes(text));
  expect(row).toBeGreaterThanOrEqual(0);
  const column = app.screen()[row]!.indexOf(text) + 1;
  app.stdin.write(`\x1b[<0;${column};${row + 1}M\x1b[<0;${column};${row + 1}m`);
}

test("message card opens detail; tabs, thinking fold, Markdown, tool rows and conclusion update while the parent run continues", async () => {
  const app = await start(["--permission-mode", "full-access", "delegate"], {
    columns: 120,
    rows: 40,
    env: { LANG: "en_US.UTF-8" },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("subagent", { description: "Reader", prompt: "child reader" });
    await app.waitFor(() => app.calls.length === 3 && screen().includes("Subagent: Reader"));
    const child = app.calls.find((call) =>
      call.context.messages.some(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("child reader"),
      ),
    )!;
    child.thinking("private reasoning");
    child.delta("## Findings\n**useful result**\n- first item\n- second item");
    click(app, "Subagent: Reader");
    await app.waitFor(() => screen().includes("Summary") && screen().includes("id "));
    app.stdin.write("\x1b[C");
    await app.waitFor(() => screen().includes("▸ Thinking") && screen().includes("useful result"));
    expect(screen()).not.toContain("private reasoning");
    expect(screen()).not.toContain("**useful result**");
    expect(screen()).not.toContain("## Findings");
    app.stdin.write("\r");
    await app.waitFor(() => screen().includes("private reasoning"));
    child.tool("read", { path: "missing.txt" });
    await app.waitFor(() => app.calls.length === 4 && screen().includes("✗ Read"));
    app.stdin.write("\x1b[C");
    await app.waitFor(() => screen().includes("missing.txt") && screen().includes("3/3"));
    click(app, "Output");
    await app.waitFor(() => screen().includes("2/3"));
    app.calls[3]!.delta("Final answer");
    app.calls[3]!.finish();
    await app.waitFor(
      () => screen().includes("── Conclusion ──") && screen().includes("Final answer"),
    );
    app.stdin.write("\x1b");
    await app.waitFor(() => screen().includes("Subagent: ") && !screen().includes("id "));
    expect(
      app.calls.find((call, index) => index > 0 && call !== child && call !== app.calls[3])!.signal!
        .aborted,
    ).toBe(false);
  } finally {
    await app.cleanup();
  }
});

test("running output follows the tail and x interrupts only its child, returning to the exact chat reading position", async () => {
  const app = await start(["--permission-mode", "full-access", "delegate"], {
    columns: 120,
    rows: 24,
    env: { LANG: "en_US.UTF-8" },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta(Array.from({ length: 50 }, (_, i) => `parent line ${i}`).join("\n"));
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("delegate again\r");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.tool("subagent", { description: "Streaming", prompt: "child streaming" });
    await app.waitFor(() => app.calls.length === 4 && screen().includes("Subagent: Streaming"));
    const child = app.calls.find((call) =>
      call.context.messages.some(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("child streaming"),
      ),
    )!;
    const parent = app.calls.find((call, index) => index > 1 && call !== child)!;
    app.stdin.write("\x1b[5~");
    await app.waitFor(
      () => screen().includes("parent line ") && screen().includes("Back to bottom"),
    );
    const before = app.screen().slice(0, 8);
    app.stdin.write("\x01");
    await app.waitFor(() => screen().includes("─ Subagents "));
    app.stdin.write("\r\x1b[C");
    await app.waitFor(() => screen().includes("2/3"));
    child.delta(Array.from({ length: 40 }, (_, i) => `child output ${i}`).join("\n"));
    await app.waitFor(() => screen().includes("child output 39"));
    expect(screen()).not.toContain("child output 0");
    expect(screen()).toContain("Subagent: Streaming");
    child.delta("\nlatest streamed line");
    await app.waitFor(() => screen().includes("latest streamed line"));
    app.stdin.write("x");
    await app.waitFor(() => screen().includes("aborted") && !screen().includes("X interrupt"));
    expect(child.signal!.aborted).toBe(true);
    expect(parent.signal!.aborted).toBe(false);
    app.stdin.write("\x1b");
    await app.waitFor(() => screen().includes("─ Subagents "));
    app.stdin.write("\x1b");
    await app.waitFor(
      () =>
        !screen().includes("─ Subagents ") &&
        JSON.stringify(app.screen().slice(0, 8)) === JSON.stringify(before),
    );
    expect(app.screen().slice(0, 8)).toEqual(before);
    parent.finish();
    await app.waitFor(() => app.calls.length === 5);
    expect(JSON.stringify(app.calls[4]!.context.messages)).toContain("aborted.");
    app.calls[4]!.finish();
    await app.waitFor(() => !app.isWorking());
  } finally {
    await app.cleanup();
  }
});

test("dashboard cards, tabs, interrupt and close buttons work with the mouse and detail returns to chat", async () => {
  const app = await start(["--permission-mode", "full-access", "delegate"], {
    columns: 80,
    rows: 24,
    env: { LANG: "en_US.UTF-8" },
  });
  const screen = () => app.screen().join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("subagent", { description: "Clickable", prompt: "child click" });
    await app.waitFor(() => app.calls.length === 3 && screen().includes("Subagent: Clickable"));
    app.stdin.write("\x01");
    await app.waitFor(() => screen().includes("─ Subagents "));
    click(app, "Subagent: Clickable");
    await app.waitFor(() => screen().includes("id "));
    click(app, "Tools");
    await app.waitFor(() => screen().includes("No tool calls yet"));
    click(app, "X interrupt");
    await app.waitFor(() => screen().includes("aborted"));
    click(app, "✕");
    await app.waitFor(() => screen().includes("─ Subagents "));
    click(app, "✕");
    await app.waitFor(() => screen().includes("Subagent: ") && !screen().includes("─ Subagents "));
    const before = app.screen().filter((line) => line.includes("started subagent"));
    click(app, "Subagent: Clickable");
    await app.waitFor(() => screen().includes("id "));
    app.stdin.write("\x03");
    await app.waitFor(() => !screen().includes("id ") && screen().includes("Subagent: "));
    expect(app.screen().filter((line) => line.includes("started subagent"))).toEqual(before);
  } finally {
    await app.cleanup();
  }
});

test.each([false, true])(
  "eight cards (mixed=%s) keep keyboard focus visible in a short dashboard and preserve its selection and scroll on return",
  async (mixed) => {
    const session: Partial<SessionOptions> = {};
    // Observe each native partial commit before measuring keyboard scroll geometry.
    const previews = new Set<number>();
    const prepare = async (root: string) => {
      const store = createJsonlStore({ cwd: root, homeDir: root });
      session.store = {
        ...store,
        async open(...args) {
          const lease = await store.open(...args);
          return {
            ...lease,
            storage: new Proxy(lease.storage, {
              get(target, key) {
                if (key === "commit")
                  return async (...args: Parameters<Storage["commit"]>) => {
                    const result = await target.commit(...args);
                    for (const write of args[0])
                      if (
                        write.type === "document.change" &&
                        JSON.stringify(write.content).includes("live preview")
                      )
                        previews.add(write.id);
                    return result;
                  };
                const value = Reflect.get(target, key);
                return typeof value === "function" ? value.bind(target) : value;
              },
            }),
          };
        },
      };
    };
    const app = await start(["--permission-mode", "full-access", "delegate"], {
      session,
      prepare,
      columns: 100,
      rows: 16,
      env: { LANG: "en_US.UTF-8" },
    });
    const screen = () => app.screen().join("\n");
    const focused = () =>
      app
        .screen()
        .find((line, row) => {
          const column = line.indexOf("Subagent: Child ");
          return (
            column >= 0 &&
            app.terminal.buffer.active.getLine(row)?.getCell(column)?.getFgColor() === 0xe85693
          );
        })
        ?.match(/Subagent: Child \d+/)?.[0];
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tools(
        Array.from({ length: 8 }, (_, index) => ({
          name: "subagent",
          args: { description: `Child ${index}`, prompt: `child mixed ${index}` },
        })),
      );
      await app.waitFor(() => app.calls.length === 10);
      const children = app.calls.filter((call) =>
        call.context.messages.some(
          (message) =>
            message.role === "user" && JSON.stringify(message.content).includes("child mixed"),
        ),
      );
      // All eight card heights must be published; one visible preview is insufficient.
      for (const child of children) child.delta("live preview");
      await app.waitFor(() => previews.size === 8);
      app.stdin.write("\x01");
      await app.waitFor(
        () => screen().includes("─ Subagents ") && screen().includes("live preview") && !!focused(),
      );
      for (const [index, child] of children.entries()) if (mixed && index % 2 === 0) child.finish();
      await app.waitFor(
        () =>
          screen().includes("─ Subagents ") &&
          screen().includes(mixed ? "4 completed" : "8 running") &&
          !!focused(),
      );
      let previous = focused();
      for (let index = 0; index < 7; index++) {
        app.stdin.write("\x1b[B");
        await app.waitFor(() => !!focused() && focused() !== previous);
        previous = focused();
      }
      const selected = focused()!.match(/Subagent: (Child \d)/)![1]!;
      // Live elapsed labels may advance while detail is open; compare the
      // selected rows and geometry independently of that ticking value.
      const dashboardRows = () =>
        app
          .screen()
          .slice(4, 11)
          .map((line) => line.replace(/ · \d+(?:\.\d+)?(?:ms|s|m\d+s)(?= ·)/g, " · <elapsed>"));
      const before = dashboardRows();
      app.stdin.write("\r");
      await app.waitFor(
        () => screen().includes("id ") && screen().includes(`Subagent: ${selected}`),
      );
      app.stdin.write("\x1b");
      await app.waitFor(
        () => screen().includes("─ Subagents ") && focused()?.includes(selected) === true,
      );
      expect(dashboardRows()).toEqual(before);
      app.stdin.write("\x1b[A\x1b[A");
      await app.waitFor(() => !!focused() && !focused()!.includes(selected));
    } finally {
      await app.cleanup();
    }
  },
);

test("eight child Runs stream in chat before any Subagent view opens", async () => {
  const app = await startWithClock(["--permission-mode", "full-access", "delegate"], {
    columns: 100,
    rows: 16,
    env: { LANG: "en_US.UTF-8" },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools(
      Array.from({ length: 8 }, (_, index) => ({
        name: "subagent",
        args: { description: `Concurrent ${index}`, prompt: `child concurrent ${index}` },
      })),
    );
    await app.waitFor(() => app.calls.length === 10);
    const children = app.calls.filter((call) =>
      call.context.messages.some(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("child concurrent"),
      ),
    );
    expect(children).toHaveLength(8);
    // The dock's child panel leaves only the tail of the fixed three-line card
    // output visible in this short viewport. Fill those lines to observe updates.
    children.forEach((child, index) =>
      child.delta(`first line\nsecond line\nstreamed child ${index}`),
    );
    await app.waitFor(() => app.screen().some((line) => line.includes("│ streamed child")));
    expect(children.every((child) => !child.signal!.aborted)).toBe(true);
    expect(app.screen().join("\n")).not.toContain("Maximum update depth");
    children.forEach((child) => child.finish());
    app.calls.find((call, index) => index > 0 && !children.includes(call))!.finish();
    let answered = 10;
    let received = "";
    for (;;) {
      await app.waitFor(() => app.calls.length > answered);

      const response = app.calls[answered++]!;
      const messages = JSON.stringify(response.context.messages);
      expect(messages).not.toContain("Maximum update depth");
      expect(messages).not.toContain("failed:");
      response.delta("parent final reply");
      response.finish();
      received = messages;
      if (
        Array.from({ length: 8 }, (_, index) =>
          received.includes(`(Concurrent ${index}) finished.`),
        ).every(Boolean)
      )
        break;
    }
    for (let index = 0; index < 8; index++)
      expect(received).toContain(`(Concurrent ${index}) finished.`);
    await app.waitFor(() => app.screen().join("\n").includes("parent final reply"));
  } finally {
    await app.cleanup();
  }
});

for (const failed of [false, true]) {
  test(`child Tools page exposes ${failed ? "failure reason" : "result preview"} and elapsed duration`, async () => {
    const app = await start(["--permission-mode", "full-access", "delegate"], {
      columns: 120,
      rows: 40,
      env: { LANG: "en_US.UTF-8" },
    });
    const screen = () => app.screen().join("\n");
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("subagent", { description: "Tool details", prompt: "child tools review" });
      await app.waitFor(
        () => app.calls.length === 3 && screen().includes("Subagent: Tool details"),
      );
      const child = app.calls.find((call) =>
        call.context.messages.some(
          (message) =>
            message.role === "user" &&
            JSON.stringify(message.content).includes("child tools review"),
        ),
      )!;
      if (failed) child.tool("read", { path: "absent-review.txt" });
      else
        child.tool("bash", {
          command: "printf tool-completed-output",
          description: "Run test command",
        });
      await app.waitFor(() => app.calls.length === 4);
      click(app, "Subagent: Tool details");
      await app.waitFor(() => screen().includes("id "));
      click(app, "Tools");
      await app.waitFor(
        () => screen().includes("3/3") && screen().includes(failed ? "✗ Read " : "• Bash("),
      );
      expect(screen()).toContain(failed ? "ENOENT" : "⎿ tool-completed-output");
      const row = app.screen().find((line) => line.includes(failed ? "✗ Read " : "• Bash("))!;
      expect(row).toMatch(/ · \d+(?:\.\d+)?(?:ms|s|m\d+s)$/);
    } finally {
      await app.cleanup();
    }
  });
}

test("ordinary chat Escape cancels the foreground Run while its background child remains usable", async () => {
  const app = await startWithClock(["--permission-mode", "full-access", "parent escape boundary"], {
    rows: 24,
    env: { LANG: "en" },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("subagent", {
      description: "Escape survivor",
      prompt: "child survives ordinary Escape",
      run_in_background: true,
    });
    await app.waitFor(() => app.calls.length === 3);
    const child = app.calls.find((call) =>
      call.context.messages.some(
        (message) =>
          message.role === "user" &&
          JSON.stringify(message.content).includes("child survives ordinary Escape"),
      ),
    )!;
    const parent = app.calls.find((call, index) => index > 0 && call !== child)!;
    parent.delta("foreground partial before Escape");
    await app.waitFor(() => app.screen().join("\n").includes("foreground partial before Escape"));
    app.stdin.write("\x1b");
    await app.waitFor(
      () =>
        parent.signal!.aborted && app.screen().join("\n").includes("background tasks: 1 subagents"),
    );
    expect(child.signal!.aborted).toBe(false);
    child.delta("child continues after Escape");
    app.stdin.write("\x01\r\x1b[C");
    await app.waitFor(() => app.screen().join("\n").includes("child continues after Escape"));
    child.reply("child completed after Escape");
    await app.waitFor(() => app.calls.length === 4);
    app.calls[3]!.reply("report processed after ordinary Escape");
    await app.waitFor(() => app.screen().join("\n").includes("Conclusion"));
    expect(app.screen()).toHaveLength(24);
  } finally {
    await app.cleanup();
  }
});
