import { expect, test } from "bun:test";
import { join } from "node:path";
import { startWithClock } from "../helpers/clock-app";

test("mixed parent, two Jobs and two Subagents preserve reading, copy and Interaction ownership across microtasks", async () => {
  const copied: string[] = [];
  const app = await startWithClock(["--yolo", "历史 parent"], {
    columns: 80,
    rows: 60,
    env: { LANG: "en" },
    prepare: (root) =>
      Bun.write(join(root, "fixture.txt"), "one\ntwo\nthree\nfour\nfive").then(() => {}),
    host: {
      writeClipboard: async (text) => {
        copied.push(text);
        return true;
      },
      openExternal: async () => {
        throw new Error("unexpected native action");
      },
      reveal: async () => {
        throw new Error("unexpected native action");
      },
    },
  });
  const screen = () => app.screen().join("\n");
  const waitFor = (predicate: () => boolean, bound = 100) => app.waitFor(predicate, bound);
  type Call = (typeof app.calls)[number];
  const hasPrompt = (call: Call, prompt: string) =>
    call.context.messages.some(
      (message) => message.role === "user" && JSON.stringify(message.content).includes(prompt),
    );
  const isChild = (call: Call) =>
    hasPrompt(call, "child-A-only") || hasPrompt(call, "child-B-only");
  const roots = () => app.calls.filter((call) => !isChild(call));
  const completed = new Set<Call>();
  const click = (x: number, y: number) =>
    app.stdin.write(`\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`);
  const startDrag = (x: number, y: number, end: number) =>
    app.stdin.write(`\x1b[<16;${x + 1};${y + 1}M\x1b[<48;${end + 1};${y + 1}M`);
  const release = (x: number, y: number) => app.stdin.write(`\x1b[<16;${x + 1};${y + 1}m`);
  try {
    await waitFor(() => app.calls.length === 1);
    const seed = app.calls[0]!;
    seed.reply(
      Array.from({ length: 80 }, (_, i) => (i === 10 ? "选取 🐋 anchor" : `history-${i}`)).join(
        "\n",
      ),
    );
    completed.add(seed);
    await waitFor(() => !app.isWorking() && screen().includes("history-79"));
    app.stdin.write("launch mixed\r");
    await waitFor(() => roots().length === 2);
    const launch = roots().at(-1)!;
    launch.tools([
      { name: "read", args: { path: "fixture.txt" } },
      ...["A", "B"].map((id) => ({
        name: "bash",
        args: {
          description: `Mixed job ${id}`,
          run_in_background: true,
          command: `printf '${id}-0\\n${id}-1\\n${id}-2\\n'; while [ ! -f step-${id} ]; do sleep 0.01; done; printf '${id}-next-1\\n${id}-next-2\\n'; while [ ! -f go-${id} ]; do sleep 0.01; done; exit ${id === "A" ? 0 : 7}`,
        },
      })),
      {
        name: "subagent",
        args: { description: "Mixed child A", prompt: "child-A-only", run_in_background: true },
      },
      {
        name: "subagent",
        args: { description: "Mixed child B", prompt: "child-B-only", run_in_background: true },
      },
    ]);
    completed.add(launch);
    await waitFor(
      () =>
        app.calls.some((call) => hasPrompt(call, "child-A-only")) &&
        app.calls.some((call) => hasPrompt(call, "child-B-only")) &&
        roots().length === 3,
    );
    const childAStart = app.calls.find((call) => hasPrompt(call, "child-A-only"))!;
    const childB = app.calls.find((call) => hasPrompt(call, "child-B-only"))!;
    childAStart.tool("read", { path: "missing-A.txt" });
    completed.add(childAStart);
    await waitFor(() => app.calls.filter((call) => hasPrompt(call, "child-A-only")).length === 2);
    const childA = app.calls.findLast((call) => hasPrompt(call, "child-A-only"))!;
    const parent = roots().at(-1)!;
    parent.thinking("first reasoning\nsecond reasoning\n最新 token 🐋");
    childA.delta("A-first\nA-second\nA-third");
    childB.delta("B-first\nB-second\n" + "界".repeat(120));
    await waitFor(
      () =>
        screen().includes("A-2") &&
        screen().includes("B-2") &&
        screen().includes("最新 token 🐋") &&
        screen().includes("✗read"),
    );
    expect(app.screen().filter((line) => line.includes("Subagent: Mixed child"))).toHaveLength(2);
    expect(app.screen().filter((line) => /● job: bash-[12] /.test(line))).toHaveLength(2);
    expect(screen()).not.toContain("│ ≡ A-0");
    expect(screen()).not.toContain("│ ≡ B-0");
    expect(screen()).toContain("+2 lines");
    expect(screen()).not.toContain("   five");
    const jobRow = app.screen().findIndex((line) => line.includes("● job: bash-1"));
    const statusX = app.screen()[jobRow]!.indexOf("running");
    expect(app.terminal.buffer.active.getLine(jobRow)?.getCell(statusX)?.getFgColor()).toBe(
      0xd8b270,
    );
    for (let i = 0; i < 16; i++) {
      parent.delta(`mixed-${i}\n`);
      childA.delta(`\nA-${i}`);
      childB.delta(`\nB-${i}`);
      await Promise.resolve();
      await Promise.resolve();
    }
    await waitFor(() => screen().includes("mixed-15") && !screen().includes("Back to bottom"));
    app.stdin.write("saved draft");
    const firstTick = app.screen().findIndex((line) => line.endsWith("━━") || line.endsWith(" ─"));
    click(78, firstTick);
    await waitFor(
      () => app.screen()[1]?.startsWith("❯ 历史 parent") === true && app.screen()[0]?.trim() === "",
    );
    app.stdin.write("\x1b[<65;10;5M");
    await waitFor(
      () =>
        app.screen()[0]?.includes("历史 parent") === true && screen().includes("选取 🐋 anchor"),
    );
    const reading = app.screen().slice(1, 6);
    const sourceRow = app.screen().findIndex((line) => line.includes("选取 🐋 anchor"));
    const sourceX = Bun.stringWidth(app.screen()[sourceRow]!.split("选取")[0]!);
    const sourceEnd = sourceX + Bun.stringWidth("选取 🐋 anchor") - 1;
    startDrag(sourceX, sourceRow, sourceEnd);
    await app.flush();
    await waitFor(
      () => !app.terminal.buffer.active.getLine(sourceRow)?.getCell(sourceX)?.isBgDefault(),
    );
    for (let i = 16; i < 64; i++) {
      parent.delta(`mixed-${i}\n`);
      childB.delta(`\nB-${i}`);
      if (i < 40) childA.delta(`\nA-${i}`);
      if (i === 24)
        await Promise.all([
          Bun.write(join(app.root, "step-A"), ""),
          Bun.write(join(app.root, "step-B"), ""),
        ]);
      if (i === 40) {
        childA.reply("A FINAL");
        completed.add(childA);
      }
      await Promise.resolve();
      await Promise.resolve();
    }
    await waitFor(() => screen().includes("New output · Back to bottom"));
    expect(app.screen().slice(1, 6)).toEqual(reading);
    release(sourceEnd, sourceRow);
    await waitFor(() => copied.length === 1);
    expect(copied).toEqual(["选取 🐋 anchor"]);
    await waitFor(
      () => app.terminal.buffer.active.getLine(sourceRow)?.getCell(sourceX)?.isBgDefault() === true,
    );
    expect(screen()).not.toContain("Agent View");
    app.resize(40, 12);
    await waitFor(
      () =>
        app.screen().every((line) => Bun.stringWidth(line) <= 40) &&
        app.screen().some((line) => /^╭─{38}╮$/u.test(line)) &&
        app.screen().at(-2)?.includes("Full access") === true,
      10,
    );
    app.resize(80, 60);
    await waitFor(
      () =>
        screen().includes("saved draft") &&
        screen().includes("New output") &&
        app.screen().some((line) => /^╭─{78}╮$/u.test(line)) &&
        app.screen().at(-2)?.includes("Full access") === true,
      10,
    );
    expect(app.screen().slice(1, 6)).toEqual(reading);
    app.stdin.write("\x1b[1;5F");
    await waitFor(() => screen().includes("mixed-63") && !screen().includes("Back to bottom"), 10);
    const replacedRow = app.screen().findIndex((line) => line.includes("mixed-32"));
    const replacedX = app.screen()[replacedRow]!.indexOf("mixed-32");
    startDrag(replacedX, replacedRow, replacedX + 7);
    await waitFor(
      () => !app.terminal.buffer.active.getLine(replacedRow)?.getCell(replacedX)?.isBgDefault(),
    );
    parent.reply(
      "## Canonical mixed\n```ts\nconst 完成 = true;\n```\n" +
        Array.from({ length: 58 }, (_, i) => `canonical-${i}`).join("\n") +
        "\nFINAL MIXED RESULT",
    );
    completed.add(parent);
    await waitFor(() => screen().includes("FINAL MIXED RESULT"), 10);
    release(replacedX + 7, replacedRow);
    await waitFor(() => screen().includes("Selected content changed"), 10);
    expect(copied).toEqual(["选取 🐋 anchor"]);
    expect(screen()).not.toContain("mixed-63");
    await waitFor(() => roots().some((call) => !completed.has(call)));
    const request = roots().find((call) => !completed.has(call))!;
    app.stdin.write("\x1b[5~");
    await waitFor(() => app.screen().some((line) => line.includes("Subagent: Mixed child B")), 10);
    const childRow = app.screen().findIndex((line) => line.includes("Subagent: Mixed child B"));
    click(app.screen()[childRow]!.indexOf("⤢"), childRow);
    await waitFor(() => screen().includes("Agent View") && screen().includes("B-63"));
    request.tool("ask_user_question", {
      questions: [
        {
          header: "Mixed",
          question: "Continue mixed fixture?",
          multiSelect: false,
          options: [
            { label: "First", description: "first" },
            { label: "Second", description: "second" },
          ],
        },
      ],
    });
    completed.add(request);
    await waitFor(() => screen().includes("Continue mixed fixture?"));
    childB.delta("\nB-during-question");
    app.stdin.write("\x1b[B\r");
    await waitFor(() => roots().some((call) => !completed.has(call)));
    const answer = roots().find((call) => !completed.has(call))!;
    expect(
      answer.context.messages.findLast(
        (message) => message.role === "toolResult" && message.toolName === "ask_user_question",
      ),
    ).toMatchObject({
      isError: false,
      content: expect.arrayContaining([
        expect.objectContaining({ type: "text", text: expect.stringContaining("Second") }),
      ]),
    });
    await waitFor(() => screen().includes("Agent View") && screen().includes("B-during-question"));
    expect(childB.signal?.aborted).toBe(false);
    app.stdin.write("\x1b[27u");
    await waitFor(() => !screen().includes("Agent View") && screen().includes("saved draft"));
    await Promise.all([
      Bun.write(join(app.root, "go-A"), ""),
      Bun.write(join(app.root, "go-B"), ""),
    ]);
    childB.finish();
    completed.add(childB);
    answer.reply("JOINED ACTIVITIES");
    completed.add(answer);
    while (app.isWorking()) {
      await waitFor(() => !app.isWorking() || roots().some((call) => !completed.has(call)));
      for (const call of roots().filter((call) => !completed.has(call))) {
        call.reply("All activities observed");
        completed.add(call);
      }
    }
    await waitFor(() => screen().includes("✓ job: bash-1") && screen().includes("✗ job: bash-2"));
    await waitFor(() => !app.isWorking() && app.screen().at(-1)?.trim() === "");
    const jobSource = app.screen().slice(1, 6);
    const failedJobRow = app.screen().findIndex((line) => line.includes("✗ job: bash-2"));
    click(app.screen()[failedJobRow]!.indexOf("bash-2"), failedJobRow);
    await waitFor(() => screen().includes("exit code: 7"));
    expect(screen()).toContain("❯ bash-2");
    app.stdin.write("\x1b[27u");
    await waitFor(() => screen().includes("saved draft") && !screen().includes("exit code: 7"));
    await waitFor(() => app.screen().slice(1, 6).join("\n") === jobSource.join("\n"));
    expect(app.screen().slice(1, 6)).toEqual(jobSource);
    expect(app.screen().filter((line) => line.includes("Subagent: Mixed child"))).toHaveLength(2);
    expect(screen()).not.toContain("Maximum update depth");
    expect(app.stderr()).toBe("");
    app.stdin.write("\x1b[1;5F");
    await waitFor(() => !screen().includes("Back to bottom"));
    app.stdin.write("\x15next verification\r");
    await waitFor(() => app.calls.some((call) => hasPrompt(call, "next verification")));
    const next = app.calls.findLast((call) => hasPrompt(call, "next verification"))!;
    expect(
      next.context.messages.filter(
        (message) =>
          message.role === "assistant" &&
          JSON.stringify(message.content).includes("FINAL MIXED RESULT"),
      ),
    ).toHaveLength(1);
    expect(JSON.stringify(next.context.messages)).not.toContain("mixed-63");
    next.reply("NEXT RUN OK");
    completed.add(next);
    await waitFor(() => !app.isWorking() && screen().includes("NEXT RUN OK"));
    expect(app.stderr()).toBe("");
    app.stdin.write("\x04");
    expect(await app.exit).toBe(0);
    await app.flush();
    expect(app.terminal.buffer.active.type).toBe("normal");
    expect(app.stdin.isRaw).toBe(false);
    expect(app.screen().filter(Boolean)).toEqual([
      "Resume this session:",
      expect.stringMatching(/^  rukie --resume [\da-f-]+$/),
    ]);
  } finally {
    // These gated bash loops exercise real process IO; the virtual clock owns only display timers.
    await Promise.all(
      ["step-A", "step-B", "go-A", "go-B"].map((file) =>
        Bun.write(join(app.root, file), "").catch(() => {}),
      ),
    );
    await app.cleanup();
  }
});
