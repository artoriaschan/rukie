import { join } from "node:path";
import { expect, test } from "bun:test";
import { start } from "../helpers/app";
import { committedJobNotifications } from "../helpers/job-notifications";

test.each(["question", "permission", "decline", "plan"] as const)(
  "parent %s takes AgentView screen and keys, then restores child reading and parent draft",
  async (kind) => {
    const app = await start(
      kind === "plan" ? [] : kind === "permission" ? ["delegate"] : ["--yolo", "delegate"],
      { columns: 120, rows: 40, env: { LANG: "en" } },
    );
    try {
      if (kind === "plan") {
        await app.waitFor(() => app.screen().join("\n").includes("❯"));
        app.stdin.write("/plan\r");
        await app.waitFor(() => app.screen().at(-2)?.includes("plan") ?? false);
        app.stdin.write("delegate\r");
      }
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("subagent", {
        description: "Interaction reader",
        prompt: "child interaction-only",
        run_in_background: true,
      });
      await app.waitFor(
        () =>
          app.calls.length === 3 &&
          app.screen().some((line) => line.includes("Subagent: Interaction reader")),
      );
      const child = app.calls.find((call) =>
        call.context.messages.some(
          (message) =>
            message.role === "user" &&
            JSON.stringify(message.content).includes("child interaction-only"),
        ),
      )!;
      const parent = app.calls.find((call) => call !== child && call !== app.calls[0])!;
      app.stdin.write("saved draft");
      child.delta("before request");
      await app.waitFor(() => app.screen().some((line) => line.includes("before request")));
      const y = app.screen().findIndex((line) => line.includes("Subagent: Interaction reader"));
      const x = app.screen()[y]!.indexOf("⤢");
      app.stdin.write(`\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`);
      await app.waitFor(() => app.screen().join("\n").includes("Agent View"));
      child.delta("\n" + Array.from({ length: 50 }, (_, i) => `child line ${i}`).join("\n"));
      await app.waitFor(() => app.screen().join("\n").includes("child line 49"));
      app.stdin.write("\x1b[5~");
      await app.waitFor(() => !app.screen().join("\n").includes("child line 49"));
      const reading = app.screen().filter((line) => line.includes("child line"));
      if (kind === "plan")
        parent.tool("exit_plan_mode", { plan: "# Parent plan\nKeep the reader" });
      else if (kind === "permission")
        parent.tool("bash", { command: "printf approved", description: "Parent approval" });
      else
        parent.tool("ask_user_question", {
          questions: [
            {
              question: "Which owner?",
              header: "Owner",
              options: [
                { label: "First", description: "one" },
                { label: "Second", description: "two" },
              ],
            },
          ],
        });
      const request =
        kind === "permission"
          ? "Allow this operation?"
          : kind === "plan"
            ? "Plan review"
            : "Which owner?";
      await app.waitFor(() => app.screen().join("\n").includes(request));
      expect(app.screen().join("\n")).toContain(request);
      expect(app.screen().join("\n")).not.toContain("Agent View");
      child.delta("\nchild line 50");
      if (kind === "permission") {
        app.resize(40, 12);
        await app.waitFor(() => app.screen().join("\n").includes(request));
        expect(app.screen()).toHaveLength(12);
        app.resize(39, 11);
        await app.waitFor(() => app.screen().every((line) => Bun.stringWidth(line) <= 39));
        app.stdin.write("\r");
        await app.flush();
        expect(app.calls).toHaveLength(3);
        app.resize(120, 40);
        await app.waitFor(() => app.screen().join("\n").includes(request));
      }
      app.stdin.write(kind === "decline" ? "\x1b[27u" : kind === "plan" ? "1" : "\x1b[B\r");
      await app.waitFor(
        () => app.calls.length === 4 && app.screen().join("\n").includes("Agent View"),
      );
      expect(
        app.calls[3]!.context.messages.findLast((message) => message.role === "toolResult"),
      ).toMatchObject({ isError: false });
      if (kind === "question")
        expect(JSON.stringify(app.calls[3]!.context.messages.at(-1))).toContain("Second");
      expect(app.screen().filter((line) => line.includes("child line"))).toEqual(reading);
      expect(child.signal!.aborted).toBe(false);
      app.stdin.write("\x1b[27u");
      await app.waitFor(() => app.screen().join("\n").includes("saved draft"));
      expect(app.stderr()).toBe("");
    } finally {
      await app.cleanup();
    }
  },
);

test("a parent question temporarily replaces the jobs panel and returns its focused details", async () => {
  const notifications = committedJobNotifications();
  const app = await start(["--yolo", "launch"], {
    session: notifications.session,
    prepare: notifications.prepare,
    columns: 80,
    rows: 24,
    env: { LANG: "zh" },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools([
      {
        name: "bash",
        args: {
          command:
            "printf 'worker ready\\n'; while [ ! -f go ]; do sleep 0.01; done; printf 'worker done\\n'",
          description: "Live job",
          run_in_background: true,
        },
      },
      {
        name: "bash",
        args: {
          command: "while [ ! -f go ]; do sleep 0.01; done",
          description: "Sibling job",
          run_in_background: true,
        },
      },
    ]);
    await app.waitFor(
      () => app.calls.length === 2 && app.screen().join("\n").includes("worker ready"),
    );
    app.stdin.write("saved draft");
    const y = app.screen().findIndex((line) => line.includes("bash-1"));
    app.stdin.write(`\x1b[<0;5;${y + 1}M\x1b[<0;5;${y + 1}m`);
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ bash-1")));
    await app.waitFor(() => app.screen().some((line) => line.includes("│ worker ready")));
    app.resize(40, 12);
    await app.waitFor(
      () =>
        app.screen().some((line) => line.includes("│ worker ready")) &&
        app.screen().at(-1)?.includes("Esc 返回") === true,
    );
    app.stdin.write("\x1b[6~");
    await app.waitFor(() => !app.screen().some((line) => line.includes("❯ bash-1")));
    const panel = app
      .screen()
      .filter((line) => line.includes("worker ready") || line.includes("❯ bash-1"));
    app.calls[1]!.tool("ask_user_question", {
      questions: [
        {
          question: "Which job owner?",
          header: "Job",
          options: [
            { label: "First", description: "one" },
            { label: "Second", description: "two" },
          ],
        },
      ],
    });
    await app.waitFor(() => app.screen().join("\n").includes("Which job owner?"));
    expect(app.screen().some((line) => line.includes("❯ bash-1"))).toBe(false);
    app.stdin.write("\x1b[B\r");
    await app.waitFor(
      () =>
        app.calls.length === 3 &&
        !app.screen().join("\n").includes("Which job owner?") &&
        app.screen().some((line) => line.includes("worker ready")),
    );
    expect(JSON.stringify(app.calls[2]!.context.messages.at(-1))).toContain("Second");
    expect(
      app.screen().filter((line) => line.includes("worker ready") || line.includes("❯ bash-1")),
    ).toEqual(panel);
    app.resize(80, 24);
    await app.waitFor(() => app.screen().some((line) => line.includes("│ worker ready")));
    app.stdin.write("\x1b[27u");
    await app.waitFor(() => app.screen().join("\n").includes("saved draft"));
    await Bun.write(join(app.root, "go"), "go");
    await app.waitFor(() => app.screen().join("\n").includes("worker done"));
    // Keep the parent Run active until both notifications commit. Otherwise an
    // idle Reporter can add inputs and move the output card outside this viewport.
    await app.waitFor(() => notifications.count() === 2);
    app.calls[2]!.finish();
    await app.waitFor(() => notifications.pendingTasks() === 0);
    await app.waitFor(() => !app.isWorking() && !app.screen().join("\n").includes("esc 中断"));
    expect(app.calls).toHaveLength(3);
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("a pending parent request owns Escape before a focused child tool window", async () => {
  const app = await start(["--yolo", "delegate"], {
    columns: 120,
    rows: 450,
    env: { LANG: "en" },
    prepare: (root) =>
      Bun.write(
        join(root, "long.txt"),
        Array.from({ length: 450 }, (_, i) => `source-${i + 1}`).join("\n"),
      ).then(() => {}),
  });
  const click = (label: string) => {
    const y = app.screen().findIndex((line) => line.includes(label));
    expect(y).toBeGreaterThanOrEqual(0);
    const x = app.screen()[y]!.indexOf(label);
    app.stdin.write(`\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`);
  };
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("subagent", {
      description: "Window reader",
      prompt: "child window-only",
      run_in_background: true,
    });
    await app.waitFor(() => app.calls.length === 3);
    const child = app.calls.find((call) =>
      call.context.messages.some(
        (message) =>
          message.role === "user" && JSON.stringify(message.content).includes("child window-only"),
      ),
    )!;
    const parent = app.calls.find((call) => call !== child && call !== app.calls[0])!;
    child.tool("read", { path: "long.txt" });
    await app.waitFor(() => app.calls.length === 4);
    click("⤢");
    await app.waitFor(
      () =>
        app.screen().join("\n").includes("Agent View") &&
        app.screen().join("\n").includes("Read long.txt"),
    );
    click("Read long.txt");
    await app.waitFor(() => app.screen().join("\n").includes("Showing lines 1–400 of 450"));
    click("Next 400");
    await app.waitFor(() => app.screen().join("\n").includes("Window focused"));
    parent.tool("ask_user_question", {
      questions: [
        {
          question: "Window owner?",
          header: "Window",
          options: [
            { label: "First", description: "one" },
            { label: "Second", description: "two" },
          ],
        },
      ],
    });
    await app.waitFor(() => app.screen().join("\n").includes("Window owner?"));
    app.stdin.write("\x1b[27u");
    await app.waitFor(
      () => app.calls.length === 5 && app.screen().join("\n").includes("Agent View"),
    );
    expect(app.screen().join("\n")).toContain("Showing lines 401–450 of 450");
    expect(app.screen().join("\n")).toContain("source-425");
    expect(
      app.calls[4]!.context.messages.findLast((message) => message.role === "toolResult"),
    ).toMatchObject({ isError: false });
    expect(app.calls[3]!.signal!.aborted).toBe(false);
    app.stdin.write("\x1b[27u");
    await app.waitFor(() => !app.screen().join("\n").includes("Agent View"));
    click("⤢");
    await app.waitFor(() => app.screen().join("\n").includes("Agent View"));
    expect(app.screen().join("\n")).not.toContain("source-425");
    expect(app.screen().join("\n")).not.toContain("Window focused");
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});
