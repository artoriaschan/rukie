import { expect, test } from "bun:test";
import { start } from "../helpers/app";

test.each([
  ["ask", "询问"],
  ["auto-review", "自动评审"],
] as const)(
  "%s enters through generic approval, reviews the plan, then resumes execution",
  async (permissionMode, label) => {
    const app = await start(["--permission-mode", permissionMode, "plan this work"], {
      controlReviews: true,
    });
    try {
      await app.waitFor(() => app.calls.length === 1);
      expect(app.screen().at(-2)).not.toContain("plan");
      app.calls[0]!.tool("enter_plan_mode", {});
      await app.waitFor(() => app.screen().some((line) => line.includes("等待审批")));
      expect(app.screen().join("\n")).toContain("enter_plan_mode");
      expect(app.calls).toHaveLength(1);
      expect(app.reviews).toHaveLength(0);
      expect(app.screen().at(-2)).not.toContain("plan");
      app.stdin.write("1\r");
      await app.waitFor(() => app.calls.length === 2);
      await app.waitFor(() => app.screen().at(-2)!.includes("plan"));
      expect(app.screen().at(-2)).toContain(label);
      expect(
        app.calls[1]!.context.messages.find((message) => message.role === "toolResult"),
      ).toMatchObject({
        toolName: "enter_plan_mode",
        isError: false,
      });
      expect(JSON.stringify(app.calls[1]!.context)).toContain("You are in Plan Mode");
      expect(JSON.stringify(app.calls[1]!.context)).toContain(
        "submit the plan with exit_plan_mode",
      );
      app.calls[1]!.tool("exit_plan_mode", {
        plan: "# Execution plan\n\nInspect the implementation and validate it.",
      });
      await app.waitFor(() => app.screen().some((line) => line.includes("计划评审")));
      expect(app.screen().join("\n")).toContain("Execution plan");
      expect(app.screen().join("\n")).not.toContain("等待审批");
      expect(app.screen().at(-2)).toContain("plan");
      expect(app.reviews).toHaveLength(0);
      app.stdin.write("1");
      await app.waitFor(() => app.calls.length === 3);
      await app.waitFor(() => !app.screen().at(-2)!.includes("plan"));
      expect(app.screen().at(-2)).toContain(label);
      expect(
        app.calls[2]!.context.messages.filter((message) => message.role === "toolResult"),
      ).toMatchObject([
        { toolName: "enter_plan_mode", isError: false },
        { toolName: "exit_plan_mode", isError: false },
      ]);
      expect(JSON.stringify(app.calls[2]!.context.messages.at(-1))).toContain(
        "You have exited Plan Mode",
      );
      app.calls[2]!.tool("todo_write", {
        todos: [{ content: "Execute the approved plan", status: "completed" }],
      });
      await app.waitFor(() => app.calls.length === 4);
      expect(
        app.calls[3]!.context.messages.findLast((message) => message.role === "toolResult"),
      ).toMatchObject({
        toolName: "todo_write",
        isError: false,
      });
      app.calls[3]!.delta("Completed the approved plan.");
      app.calls[3]!.finish();
      await app.waitFor(() => !app.isWorking());
      expect(app.screen().join("\n")).toContain("Completed the approved plan.");
      expect(app.screen().at(-2)).not.toContain("plan");
      expect(app.reviews).toHaveLength(0);
    } finally {
      await app.cleanup();
    }
  },
);
