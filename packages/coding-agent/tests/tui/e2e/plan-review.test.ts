import { withAuxiliaryRequests } from "../helpers/auxiliary-model.ts";
import { expect, test } from "bun:test";
import { createSession } from "@rukie/agent";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { startWithClock as start } from "../helpers/clock-app";
const plan = "# Storage plan\n\nAdd **SQLite** storage.\n\nValidate public behavior.";
async function review(options: Parameters<typeof start>[1] = {}, markdown = plan) {
  const app = await start([], options);
  await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
  app.stdin.write("/plan\r");
  await app.waitFor(() => app.screen().at(-2)!.includes("plan"));
  app.stdin.write("inspect\r");
  await app.waitFor(() => app.calls.length === 1);
  app.calls[0]!.tool("exit_plan_mode", { plan: markdown });
  return app;
}
test("approval leaves a plan card toggled from header whitespace", async () => {
  const app = await review();
  try {
    await app.waitFor(() => app.screen().some((line) => line.includes("计划评审")));
    expect(app.screen().join("\n")).toContain("Storage plan");
    expect(app.screen().join("\n")).not.toContain("Review plan(");
    expect(app.screen().join("\n")).not.toContain("评审计划(");
    app.stdin.write("1");
    await app.waitFor(() => app.calls.length === 2);
    await app.waitFor(() => !app.screen().at(-2)!.includes("plan"));
    expect(
      app.calls[1]!.context.messages.find((message) => message.role === "toolResult"),
    ).toMatchObject({ isError: false });
    app.calls[1]!.finish();
    await app.waitFor(
      () => app.screen().at(-1) === "" && app.screen().some((line) => line.includes("已批准计划")),
    );
    expect(app.screen().join("\n")).not.toContain("Add SQLite storage.");
    const row = app.screen().findIndex((line) => line.includes("已批准计划"));
    click(app, row, 79);
    await app.waitFor(() => app.screen().some((line) => line.includes("Add SQLite storage.")));
    click(
      app,
      app.screen().findIndex((line) => line.includes("已批准计划")),
    );
    await app.waitFor(() => !app.screen().some((line) => line.includes("Add SQLite storage.")));
  } finally {
    await app.cleanup();
  }
});

function click(app: Awaited<ReturnType<typeof start>>, row: number, x = 3) {
  app.stdin.write(`\x1b[<0;${x + 1};${row + 1}M\x1b[<0;${x + 1};${row + 1}m`);
}

test.each([
  "2",
  "\x1b[B\r",
  "\x1b[B\x1b[Bchange 12\r",
  "change 12\r",
  "\x1b[B\x1b[B\x1b[A\x1b[A\r",
])("review keyboard %j submits the selected decision", async (keys) => {
  const app = await review();
  try {
    await app.waitFor(() => app.screen().some((line) => line.includes("计划评审")));
    app.stdin.write(keys);
    await app.waitFor(() => app.calls.length === 2);
    const approval = keys.endsWith("\x1b[A\x1b[A\r");
    const result = app.calls[1]!.context.messages.find((message) => message.role === "toolResult");
    expect(result).toMatchObject({ isError: !approval });
    if (keys.includes("change 12")) expect(JSON.stringify(result)).toContain("change 12");
    if (!approval) {
      await app.waitFor(() => app.screen().some((line) => line.includes("继续规划 ·")));
      expect(app.screen().join("\n")).not.toContain("Storage plan");
      app.stdin.write("\x0f");
      await app.waitFor(() => app.screen().join("\n").includes("Storage plan"));
      expect(app.screen().at(-2)).toContain("plan");
    }
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("Escape hands control back without another model call; Control-C aborts pending review", async () => {
  for (const key of ["\x1b", "\x03"]) {
    const app = await review();
    try {
      await app.waitFor(() => app.screen().some((line) => line.includes("计划评审")));
      app.stdin.write(key);
      await app.waitFor(
        () => !app.screen().some((line) => line.includes("计划评审")) && !app.isWorking(),
      );
      if (key === "\x1b") expect(app.calls).toHaveLength(1);
      else expect(app.calls.at(-1)!.signal!.aborted).toBe(true);
      expect(app.screen().at(-2)).toContain("plan");
      if (key === "\x1b") expect(app.screen().join("\n")).toContain("用户接手");
    } finally {
      await app.cleanup();
    }
  }
});

test("mouse selects feedback and preserves its digits; mouse approval works", async () => {
  for (const selected of ["feedback", "approve"]) {
    const app = await review();
    try {
      await app.waitFor(() => app.screen().some((line) => line.includes("计划评审")));
      click(
        app,
        app
          .screen()
          .findIndex((line) => line.includes(selected === "feedback" ? "反馈:" : "1 批准")),
      );
      if (selected === "feedback") app.stdin.write("use 21\r");
      await app.waitFor(() => app.calls.length === 2);
      const result = app.calls[1]!.context.messages.find(
        (message) => message.role === "toolResult",
      );
      expect(result).toMatchObject({ isError: selected === "feedback" });
      if (selected === "feedback") expect(JSON.stringify(result)).toContain("use 21");
      app.calls[1]!.finish();
    } finally {
      await app.cleanup();
    }
  }
});

test.each([40, 80])(
  "long plan scrolls through complete markdown at %i columns",
  async (columns) => {
    const longPlan =
      "# First heading\n\n" +
      Array.from(
        { length: 12 },
        (_, index) => `Paragraph ${index + 1} describes implementation.\n\n`,
      ).join("") +
      "# Final validation";
    const app = await review({ columns, rows: columns === 40 ? 12 : 24 }, longPlan);
    try {
      await app.waitFor(() => app.screen().some((line) => line.includes("First heading")));
      expect(app.screen().join("\n")).not.toContain("Final validation");
      app.stdin.write("\x1b[6~".repeat(80));
      await app.waitFor(() => app.screen().some((line) => line.includes("Final validation")));
      app.stdin.write("\x1b[5~".repeat(80));
      await app.waitFor(() => app.screen().some((line) => line.includes("First heading")));
      const top = app.screen().findIndex((line) => line.includes("First heading"));
      app.stdin.write(`\x1b[<65;8;${top + 1}M`.repeat(80));
      await app.waitFor(() => app.screen().some((line) => line.includes("Final validation")));
      expect(app.screen().every((line) => Bun.stringWidth(line) <= columns)).toBe(true);
      expect(app.screen().at(-2)).toContain("plan");
      expect(app.screen().at(-1)).toContain("esc");
      app.stdin.write("\x1b");
      await app.waitFor(() => !app.isWorking());
    } finally {
      await app.cleanup();
    }
  },
);

test.each([
  [40, 12],
  [60, 24],
] as const)(
  "review at %i by %i preserves Todo, subagent, draft and footer in fixed order",
  async (columns, rows) => {
    const app = await start([], { columns, rows });
    try {
      await app.waitFor(() => app.screen().some((line) => line.startsWith("╭")));
      app.stdin.write("/plan\r");
      await app.waitFor(() => app.screen().at(-2)!.includes("plan"));
      app.stdin.write("inspect\r");
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool("todo_write", {
        todos: [{ content: "parent task", status: "in_progress" }],
      });
      await app.waitFor(() => app.calls.length === 2);
      app.calls[1]!.tool("subagent", {
        description: "Child inspection",
        prompt: "child inspect",
        subagent_type: "explore",
      });
      await app.waitFor(() => app.calls.length === 4);
      const child = app.calls.find((call) =>
        call.context.messages.some(
          (message) =>
            message.role === "user" && JSON.stringify(message.content).includes("child inspect"),
        ),
      )!;
      const parent = app.calls.find((call, index) => index > 1 && call !== child)!;
      app.stdin.write("draft preserved");
      await app.waitFor(() => app.screen().some((line) => line.includes("draft preserved")));
      parent.tool("exit_plan_mode", {
        plan: "# Reviewable plan\n\nInspect the child result before executing.",
      });
      await app.waitFor(() => app.screen().some((line) => line.includes("计划评审")));
      const lines = app.screen();
      const todo = lines.findIndex((line) => line.includes("✓ 0/1"));
      const subagent = lines.findIndex((line) => line.includes("子代理 1/1"));
      const dialog = lines.findIndex((line) => line.includes("计划评审"));
      const draft = lines.findIndex((line) => line.includes("draft preserved"));
      expect(todo).toBeGreaterThanOrEqual(0);
      expect(subagent).toBeGreaterThan(todo);
      expect(dialog).toBeGreaterThan(subagent);
      expect(draft).toBeGreaterThan(dialog);
      expect(lines.join("\n")).toContain("Reviewable plan");
      expect(lines.at(-2)).toContain("plan");
      expect(lines.at(-1)).toContain("esc");
      expect(lines.every((line) => Bun.stringWidth(line) <= columns)).toBe(true);
      app.stdin.write("\x03");
      await app.waitFor(
        () => !app.screen().some((line) => line.includes("计划评审")) && !app.isWorking(),
      );
      expect(child.signal!.aborted).toBe(true);
      expect(app.screen().join("\n")).toContain("draft preserved");
    } finally {
      await app.cleanup();
    }
  },
);

test("English plan review and approved card use frontend copy", async () => {
  const app = await review({ env: { LANG: "en_US.UTF-8" } });
  try {
    await app.waitFor(() => app.screen().some((line) => line.includes("Plan review")));
    expect(app.screen().join("\n")).toContain("Continue planning");
    expect(app.screen().join("\n")).not.toMatch(/\p{Script=Han}/u);
    app.stdin.write("1");
    await app.waitFor(() => app.calls.length === 2);
    app.calls[1]!.finish();
    await app.waitFor(() => app.screen().some((line) => line.includes("Approved plan")));
    expect(app.screen().join("\n")).not.toMatch(/\p{Script=Han}/u);
  } finally {
    await app.cleanup();
  }
});

test("resume renders the persisted approved plan as a collapsible card", async () => {
  const argv: string[] = [];
  const app = await start(argv, {
    prepare: async (root) => {
      const faux = createFauxCore({ api: "faux", provider: "faux" });
      faux.setResponses([
        fauxAssistantMessage(fauxToolCall("exit_plan_mode", { plan }), { stopReason: "toolUse" }),
        fauxAssistantMessage("Executed."),
      ]);
      const session = await createSession({
        cwd: root,
        homeDir: root,
        model: faux.getModel(),
        streamFn: withAuxiliaryRequests(faux.streamSimple),
        onPlanReview: async () => ({ kind: "approve" }),
      });
      await session.setPlanMode(true);
      await session.run("inspect");
      argv.push("--resume", session.id);
    },
  });
  try {
    await app.waitFor(() => app.screen().some((line) => line.includes("已批准计划")));
    expect(app.calls).toHaveLength(0);
    expect(app.screen().join("\n")).not.toContain("Add SQLite storage.");
    click(
      app,
      app.screen().findIndex((line) => line.includes("已批准计划")),
    );
    await app.waitFor(() => app.screen().some((line) => line.includes("Add SQLite storage.")));
  } finally {
    await app.cleanup();
  }
});
