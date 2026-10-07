import { auxiliaryModels } from "../../helpers/auxiliary-model";
import { expect, test } from "bun:test";
import { start } from "../../helpers/app";
import { startWithClock } from "../../helpers/clock-app";
import { testClock } from "../../helpers/test-clock";
import { createSession } from "@rukie/agent";
import { controlledModel } from "../../helpers/model";
import { dark } from "../../../../src/ink/index.ts";

function goalFixtureModel() {
  const fake = controlledModel();
  const called = Promise.withResolvers<void>();
  const continued = Promise.withResolvers<void>();
  return {
    ...fake,
    firstCall: called.promise,
    secondCall: continued.promise,
    models: auxiliaryModels((...args) => {
      const stream = fake.provider.streamSimple(...args);
      if (fake.calls.length) called.resolve();
      if (fake.calls.length >= 2) continued.resolve();
      return stream;
    }),
  };
}

const screen = (app: Awaited<ReturnType<typeof start>>) => app.screen().join("\n");
async function ready(options: Parameters<typeof start>[1] = {}) {
  const app = await start([], { env: { LANG: "en_US.UTF-8" }, ...options });
  await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
  return app;
}

test("goal starts a round, shows its root and first status chip, and hides the internal prompt", async () => {
  const app = await ready({ session: { permissionMode: "full-access" } });
  try {
    app.stdin.write("/goal migrate widgets\r");
    await app.waitFor(() => app.calls.length === 1 && screen(app).includes("● active · 1/256"));
    expect(screen(app)).toContain("🎯 migrate widgets");
    expect(
      app
        .screen()
        .find((line) => line.includes("● 1/256"))
        ?.trimStart(),
    ).toStartWith("● 1/256");
    expect(screen(app)).not.toContain("<goal_round>");
    expect(screen(app)).not.toContain("Continue working toward");
    expect(screen(app)).toContain("✓ 0/0");
    expect(screen(app)).toMatch(/1\/256 · \d+(?:m\d+)?s/);
    const chipCell = () =>
      app.terminal.buffer.active
        .getLine(
          app
            .screen()
            .findIndex(
              (line) =>
                line.trimStart().startsWith("● 1/256") || line.trimStart().startsWith("⏸ 1/256"),
            ),
        )!
        .getCell(1)!;
    expect(chipCell().getFgColor()).toBe(Number.parseInt(dark.success.slice(1), 16));
    app.calls[0]!.delta("Widget migration started.");
    app.stdin.write("/goal pause\r");
    await app.waitFor(() => screen(app).includes("⏸ paused"));
    expect(chipCell().getFgColor()).toBe(Number.parseInt(dark.warning.slice(1), 16));
    expect(app.calls[0]!.signal!.aborted).toBe(false);
    app.calls[0]!.finish();
    await app.waitFor(() => screen(app).includes("Widget migration started.") && !app.isWorking());
    expect(app.calls).toHaveLength(1);
    expect(app.stderr()).toBe("");
  } finally {
    await app.cleanup();
  }
});

test("model completion updates the live Goal and hides wrapup input while keeping the assistant conclusion", async () => {
  const app = await ready({ rows: 36, session: { permissionMode: "full-access" } });
  try {
    app.stdin.write("/goal verify release\r");
    await app.waitFor(() => app.calls.length === 1 && screen(app).includes("● active · 1/256"));
    app.calls[0]!.tool("update_goal", { action: "complete" });
    await app.waitFor(() => app.calls.length === 2 && screen(app).includes("✓ complete · 1/256"));
    expect(JSON.stringify(app.calls[1]!.context.messages)).toContain("<goal_complete>");
    expect(screen(app)).not.toContain("<goal_complete>");
    expect(screen(app)).not.toContain("<goal_round>");
    app.calls[1]!.delta("Release verified with all tests passing.");
    app.calls[1]!.finish();
    await app.waitFor(
      () => screen(app).includes("Release verified with all tests passing.") && !app.isWorking(),
    );
    expect(app.calls).toHaveLength(2);
    app.stdin.write("/goal\r");
    await app.waitFor(
      () =>
        screen(app).includes("Status: complete") && screen(app).includes("Activation: disarmed"),
    );
  } finally {
    await app.cleanup();
  }
});

test("goal chip preserves permission and plan labels in a 40-column status line", async () => {
  const app = await ready({ columns: 40, rows: 12 });
  try {
    app.stdin.write("/plan\r");
    await app.waitFor(() => screen(app).includes("plan"));
    app.stdin.write("/goal migrate\r");
    await app.waitFor(() => app.calls.length === 1 && screen(app).includes("● active · 1/256"));
    const status = app.screen().find((line) => line.trimStart().startsWith("● 1/256"));
    expect(status).toContain("Ask");
    expect(status).toContain("plan");
    expect(app.screen().filter((line) => line.includes("🎯"))).toHaveLength(1);
    app.stdin.write("/goal pause\r");
    await app.waitFor(() => screen(app).includes("⏸ paused"));
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("a persisted complete goal freezes elapsed time and edit starts a fresh goal", async () => {
  const argv: string[] = [];
  const app = await startWithClock(argv, {
    env: { LANG: "en_US.UTF-8" },
    rows: 36,
    prepare: async (root) => {
      const fake = goalFixtureModel();
      const session = await createSession({
        cwd: root,
        homeDir: root,
        permissionMode: "full-access",
        ...fake,
      });
      const goal = await session.createGoal("finished migration");
      await fake.firstCall;
      fake.calls[0]!.tool("update_goal", { action: "complete" });
      await fake.secondCall;
      fake.calls[1]!.reply("Migration complete.");
      await session.waitForRequest(goal.requestId);
      await session.close();
      argv.push("--resume", session.id);
    },
  });
  try {
    await app.waitFor(() => screen(app).includes("✓ complete · 1/256 · 0s"));
    expect(app.calls).toHaveLength(0);
    testClock.advanceTimersByTime(72_000);
    app.resize(80, 40);
    await app.waitFor(() => app.screen().length === 40);
    expect(screen(app)).toContain("✓ complete · 1/256 · 0s");
    app.stdin.write("/goal\r");
    await app.waitFor(() => screen(app).includes("/goal <objective>, /goal clear"));
    app.stdin.write("/goal edit next migration\r");
    await app.waitFor(() => app.calls.length === 1 && screen(app).includes("🎯 next migration"));
    expect(screen(app)).toContain("● active · 1/256 · 0s");
    app.stdin.write("/goal pause\r");
    await app.waitFor(() => screen(app).includes("⏸ paused"));
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("an errored goal refreshes activation and resumed active goals stay disarmed until requested", async () => {
  const argv: string[] = [];
  const app = await start(argv, {
    rows: 36,
    env: { LANG: "en_US.UTF-8" },
    prepare: async (root) => {
      const fake = goalFixtureModel();
      const session = await createSession({
        cwd: root,
        homeDir: root,
        permissionMode: "full-access",
        ...fake,
      });
      const goal = await session.createGoal("repair widgets");
      await fake.firstCall;
      fake.calls[0]!.fail("provider unavailable");
      await session.waitForRequest(goal.requestId);
      argv.push("--resume", session.id);
      await session.close();
    },
  });
  try {
    await app.waitFor(() => screen(app).includes("● active · 1/256"));
    expect(app.calls).toHaveLength(0);
    app.stdin.write("/goal\r");
    await app.waitFor(() => screen(app).includes("Activation: disarmed"));
    app.stdin.write("/goal resume\r");
    await app.waitFor(() => app.calls.length === 1 && screen(app).includes("● active · 2/256"));
    app.calls[0]!.fail("live provider unavailable");
    await app.waitFor(() => screen(app).includes("live provider unavailable") && !app.isWorking());
    app.stdin.write("/goal\r");
    await app.waitFor(() => screen(app).includes("Rounds: 2/256\nActivation: disarmed"));
    expect(screen(app)).toContain("/goal edit <objective>, /goal resume, /goal clear");
  } finally {
    await app.cleanup();
  }
});

test("goal keeps the Todo section with all completed idle rows and its elapsed clock ticks locally", async () => {
  const app = await startWithClock([], {
    rows: 36,
    env: { LANG: "en_US.UTF-8" },
    session: { permissionMode: "full-access" },
  });
  try {
    await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
    app.stdin.write("/goal migrate\r");
    await app.waitFor(() => app.calls.length === 1 && screen(app).includes("● active · 1/256"));
    testClock.advanceTimersByTime(72_000);
    await app.waitFor(() => screen(app).includes("1m12s"));
    app.calls[0]!.tool("todo_write", { todos: [{ content: "done", status: "completed" }] });
    await app.waitFor(() => app.calls.length === 2 && screen(app).includes("✓ 1/1"));
    app.stdin.write("/goal pause\r");
    await app.waitFor(() => screen(app).includes("⏸ paused"));
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(screen(app)).toContain("✓ 1/1");
    expect(app.screen()).not.toContain("  └─ ✓ done");
    app.stdin.write("\x11");
    await app.waitFor(() => screen(app).includes("▸ ✓ 1/1"));
    expect(screen(app)).toContain("🎯 migrate");
  } finally {
    await app.cleanup();
  }
});

test.each(["question", "permission"])(
  "a goal keeps fixed root, Todo and Subagent headers, %s and draft visible at 40×12",
  async (kind) => {
    const app = await ready({ columns: 40, rows: 12 });
    try {
      app.stdin.write("/goal long migration objective\r");
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("subagent", { description: "Live child", prompt: "child task" });
      await app.waitFor(() => app.calls.length === 3);
      const parent = app.calls.find(
        (call, index) =>
          index > 0 &&
          !call.context.messages.some(
            (message) =>
              message.role === "user" && JSON.stringify(message.content).includes("child task"),
          ),
      )!;
      app.stdin.write("retained draft");
      if (kind === "question")
        parent.tool("ask_user_question", {
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
        });
      else parent.tool("bash", { command: "printf approved", description: "Run test command" });
      await app.waitFor(() =>
        screen(app).includes(kind === "question" ? "Which storage?" : "Waiting"),
      );
      const lines = app.screen();
      expect(lines.some((line) => line.includes("🎯"))).toBe(true);
      expect(lines.some((line) => line.includes("✓ 0/0"))).toBe(true);
      expect(lines.some((line) => line.includes("Subagents 1/1"))).toBe(true);
      expect(lines.some((line) => line.includes("retained draft"))).toBe(true);
      expect(lines.at(-2)).toContain("● 1/256");
      expect(lines.at(-1)).toContain("esc");
      expect(app.calls[0]!.signal!.aborted).toBe(false);
    } finally {
      await app.cleanup();
    }
  },
);

test.each([
  ["zh_CN.UTF-8", "当前没有 goal。", "修改 Goal 需要新的目标内容。", "建议切换到 auto-review"],
  [
    "en_US.UTF-8",
    "No goal is currently set.",
    "replacement objective",
    "Consider switching to auto-review",
  ],
])(
  "goal command copy and permission warning follow locale %s",
  async (lang, empty, invalid, warning) => {
    const app = await ready({ rows: 36, env: { LANG: lang } });
    try {
      app.stdin.write("/goal\r");
      await app.waitFor(() => screen(app).includes(empty));
      app.stdin.write("/goal edit\r");
      await app.waitFor(() => screen(app).includes(invalid));
      app.stdin.write("/goal migrate\r");
      await app.waitFor(() => app.calls.length === 1);
      expect(app.stderr()).toContain(warning);
      app.stdin.write("/goal pause\r");
      await app.waitFor(() => screen(app).includes("⏸ paused"));
      app.calls[0]!.finish();
      await app.waitFor(() => !app.isWorking());
      app.stdin.write("/goal pause\r");
      await app.waitFor(() =>
        screen(app).includes(
          lang.startsWith("zh") ? "只有 active Goal 可以暂停" : "Only an active Goal can be paused",
        ),
      );
      app.stdin.write("/goal\r");
      await app.waitFor(() =>
        screen(app).includes(lang.startsWith("zh") ? "续跑：已停用" : "Activation: disarmed"),
      );
    } finally {
      await app.cleanup();
    }
  },
);

test.each(["question", "permission"])(
  "resume shows a blocked goal without running, and retains its reason alongside a child and %s at 40×12",
  async (kind) => {
    const argv: string[] = [];
    const app = await start(argv, {
      columns: 40,
      rows: 12,
      env: { LANG: "en_US.UTF-8" },
      prepare: async (root) => {
        const fake = goalFixtureModel();
        const session = await createSession({
          cwd: root,
          homeDir: root,
          permissionMode: "full-access",
          ...fake,
        });
        const blocked = new Promise<void>((resolve) =>
          session.subscribe((event) => {
            if (
              event.type === "tool_state_changed" &&
              event.name === "goal" &&
              session.goal?.phase === "blocked"
            )
              resolve();
          }),
        );
        await session.createGoal("migrate " + "界".repeat(50), { maxRounds: 1 });
        await fake.firstCall;
        fake.calls[0]!.delta("Saved progress.");
        fake.calls[0]!.finish();
        await blocked;
        argv.push("--resume", session.id);
        await session.close();
      },
    });
    try {
      await app.waitFor(() => screen(app).includes("⛔ blocked · 1/1"));
      expect(app.calls).toHaveLength(0);
      expect(screen(app)).toContain("│ Goal reached its 1 round limit");
      expect(screen(app)).toContain("⛔ 1/1");
      expect(screen(app)).not.toContain("<goal_round>");
      expect(screen(app)).toContain("Saved progress.");
      expect(app.screen().filter((line) => line.includes("🎯"))).toHaveLength(1);
      app.stdin.write("\x11");
      await app.waitFor(() => screen(app).includes("▸ ✓ 0/0"));
      expect(screen(app)).toContain("⛔ blocked · 1/1");
      expect(screen(app)).toContain("│ Goal reached its 1 round limit");
      app.resize(80, 30);
      app.stdin.write("/goal\r");
      await app.waitFor(() => screen(app).includes("Blocker: Goal reached its 1 round limit"));
      expect(screen(app)).toContain("Activation: disarmed");
      app.resize(40, 12);
      app.stdin.write("inspect blocker\r");
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("subagent", { description: "Live child", prompt: "child task" });
      await app.waitFor(() => app.calls.length === 3);
      const parent = app.calls.find(
        (call, index) =>
          index > 0 &&
          !call.context.messages.some(
            (message) =>
              message.role === "user" && JSON.stringify(message.content).includes("child task"),
          ),
      )!;
      app.stdin.write("retained draft");
      if (kind === "question")
        parent.tool("ask_user_question", {
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
        });
      else parent.tool("bash", { command: "printf approved", description: "Run test command" });
      await app.waitFor(() =>
        screen(app).includes(kind === "question" ? "Which storage?" : "Waiting"),
      );
      expect(screen(app)).toContain("│ Goal reached its 1 round limit");
      expect(screen(app)).toContain("⛔ blocked · 1/1");
      expect(screen(app)).toContain("✓ 0/0");
      expect(screen(app)).toContain("Subagents 1/1");
      expect(screen(app)).toContain("retained draft");
      expect(app.screen().at(-2)).toContain("⛔ 1/1");
      expect(screen(app)).toContain("Esc");
      expect(parent.signal!.aborted).toBe(false);
      app.stdin.write("\x1b");
      await app.waitFor(() => app.calls.length === 4);
      expect(screen(app)).toContain("⛔ blocked · 1/1");
      expect(screen(app)).toContain("retained draft");
    } finally {
      await app.cleanup();
    }
  },
);

test("goal grammar, state notices, errors and completion hints stay local to the screen", async () => {
  const app = await ready({ rows: 48 });
  try {
    app.stdin.write("/goal\r");
    await app.waitFor(() => screen(app).includes("No goal is currently set"));
    expect(screen(app)).toContain("[<objective>|edit <objective>|pause|resume|clear]");
    app.stdin.write("/goal edit\r");
    await app.waitFor(() => screen(app).includes("replacement objective"));
    expect(app.calls).toHaveLength(0);
    app.stdin.write("/goal pause migration\r");
    await app.waitFor(() => app.calls.length === 1 && screen(app).includes("🎯 pause migration"));
    app.stdin.write("/goal\r");
    await app.waitFor(() => screen(app).includes("Activation: armed"));
    expect(screen(app)).toContain("Status: active\nObjective: pause migration\nRounds: 1/256");
    expect(screen(app)).toContain("/goal edit <objective>, /goal pause, /goal clear");
    app.stdin.write("/goal edit replacement\r");
    await app.waitFor(() => screen(app).includes("after the run finishes"));
    expect(screen(app)).toContain("🎯 pause migration");
    app.stdin.write("/goal PAUSE\r");
    await app.waitFor(() => screen(app).includes("⏸ paused"));
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("/goal EDIT replacement\r");
    await app.waitFor(() => screen(app).includes("🎯 replacement"));
    app.stdin.write("/goal\r");
    await app.waitFor(() => screen(app).includes("Activation: disarmed"));
    expect(screen(app)).toContain("/goal edit <objective>, /goal resume, /goal clear");
    app.stdin.write("/goal another\r");
    await app.waitFor(() => screen(app).includes("unfinished Goal"));
    app.stdin.write("/goal RESUME\r");
    await app.waitFor(() => app.calls.length === 2 && screen(app).includes("● active · 2/256"));
    app.stdin.write("/goal CLEAR\r");
    await app.waitFor(() => !screen(app).includes("🎯 replacement"));
    expect(app.calls[1]!.signal!.aborted).toBe(false);
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("/go");
    await app.waitFor(() =>
      screen(app).includes("/goal [<objective>|edit <objective>|pause|resume|clear]"),
    );
  } finally {
    await app.cleanup();
  }
});
