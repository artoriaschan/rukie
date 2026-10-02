import { expect, test } from "bun:test";
import { join } from "node:path";
import { start } from "../helpers/app";

const assistant = process.platform === "darwin" ? "⏺" : "●";

test("allow once executes the tool and asks again for its next call", async () => {
  const app = await start(["use bash"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", { command: "printf first-permitted" });
    await app.waitFor(() => app.screen().some((line) => line.includes("权限确认")));
    const dialog = app.screen().join("\n");
    expect(dialog).toContain('bash {"command":"printf first-permitted"}');
    expect(dialog).toContain("1. 允许一次");
    expect(dialog).toContain("2. 本 session 内一直允许这个工具");
    expect(dialog).toContain("3. 拒绝");
    app.stdin.write("1");
    await Bun.sleep(30);
    expect(app.calls).toHaveLength(1);
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      role: "toolResult",
      isError: false,
      content: [{ type: "text", text: "first-permitted" }],
    });
    app.calls[1]!.tool("bash", { command: "printf second-permitted" });
    await app.waitFor(() => app.screen().join("\n").includes("second-permitted"));
    expect(app.screen().join("\n")).toContain("权限确认");
    expect(app.calls).toHaveLength(2);
    app.stdin.write("1\r");
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.delta("finished");
    app.calls[2]!.finish();
    await app.waitFor(() => app.screen().some((line) => line.includes(" 工具 · 想")));
    expect(app.screen().join("\n")).not.toContain("权限确认");
    expect(app.allLines().join("\n")).not.toContain("权限确认");
  } finally {
    await app.cleanup();
  }
});

test.each([
  ["number", "3\r"],
  ["arrows", "\x1b[A\r"],
  ["Esc", "\x1b"],
])("%s rejects the call, returns 未获授权 to the model and continues the Run", async (_, key) => {
  const app = await start(["try bash"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", { command: "printf must-not-run" });
    await app.waitFor(() => app.screen().join("\n").includes("权限确认"));
    app.stdin.write(key!);
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.signal!.aborted).toBe(false);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({
      role: "toolResult",
      isError: true,
      content: [{ type: "text", text: "该工具未获授权: bash" }],
    });
    app.calls[1]!.delta("continuing after refusal");
    app.calls[1]!.finish();
    await app.waitFor(() => app.screen().some((line) => line.includes(" 工具 · 想")));
    expect(app.allLines()).toContain(`${assistant} continuing after refusal`);
    expect(app.screen().join("\n")).not.toContain("权限确认");
  } finally {
    await app.cleanup();
  }
});

test("Ctrl+C closes the question, cancels the Run and preserves the draft without granting", async () => {
  const app = await start(["cancel bash"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("next draft");
    await app.waitFor(() => app.screen().includes("❯ next draft"));
    app.calls[0]!.tool("bash", { command: "printf cancelled" });
    await app.waitFor(() => app.screen().join("\n").includes("权限确认"));
    app.stdin.write("2");
    await app.waitFor(() => app.screen().some((line) => line.startsWith("❯ 2.")));
    app.stdin.write("\x03");
    await app.waitFor(() => app.screen().some((line) => line.includes(" 工具 · 想")));
    expect(app.screen()).toContain("❯ next draft");
    expect(app.screen().join("\n")).not.toContain("权限确认");
    expect(app.calls.every((call) => call.signal!.aborted)).toBe(true);
    const nextCall = app.calls.length;
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === nextCall + 1);
    expect(app.calls[nextCall]!.context.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "next draft" }],
    });
    app.calls[nextCall]!.tool("bash", { command: "printf still-needs-permission" });
    await app.waitFor(() => app.screen().join("\n").includes("权限确认"));
    expect(app.screen().join("\n")).toContain("still-needs-permission");
  } finally {
    await app.cleanup();
  }
});

test.each(["flag", "settings", "yolo", "readonly"])(
  "%s permits tools without a question",
  async (mode) => {
    const app = await start(
      [
        "use tool",
        ...(mode === "flag" ? ["--allow-tools", "ba*"] : mode === "yolo" ? ["--yolo"] : []),
      ],
      {
        prepare: async (root) => {
          if (mode === "settings") {
            await Bun.write(join(root, ".neant/settings.json"), '{"allowTools":["ba*"]}');
          }
        },
      },
    );
    try {
      await app.waitFor(() => app.calls.length === 1);
      app.calls[0]!.tool(
        mode === "readonly" ? "glob" : "bash",
        mode === "readonly" ? { pattern: "*" } : { command: "printf pre-approved" },
      );
      await app.waitFor(() => app.calls.length === 2);
      expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({ isError: false });
      expect(app.screen().join("\n")).not.toContain("权限确认");
      app.calls[1]!.finish();
      await app.waitFor(() => app.screen().some((line) => line.includes(" 工具 · 想")));
      expect(app.allLines().join("\n")).not.toContain("权限确认");
    } finally {
      await app.cleanup();
    }
  },
);

test("always allow remembers only this tool across Runs and leaves settings unchanged", async () => {
  let root = "";
  const settings = '{"allowTools":["read"]}\n';
  const app = await start(["use bash"], {
    prepare: async (directory) => {
      root = directory;
      await Bun.write(join(root, ".neant/settings.json"), settings);
    },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tool("bash", { command: "printf first-allowed" });
    await app.waitFor(() => app.screen().join("\n").includes("权限确认"));
    app.stdin.write("\x1b[B\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(app.calls[1]!.context.messages.at(-1)).toMatchObject({ isError: false });
    app.calls[1]!.delta("first done");
    app.calls[1]!.finish();
    await app.waitFor(() => app.screen().some((line) => line.includes(" 工具 · 想")));
    app.stdin.write("again\r");
    await app.waitFor(() => app.calls.length === 3);
    app.calls[2]!.tool("bash", { command: "printf still-allowed" });
    await app.waitFor(() => app.calls.length === 4);
    expect(app.calls[3]!.context.messages.at(-1)).toMatchObject({
      isError: false,
      content: [{ type: "text", text: "still-allowed" }],
    });
    expect(app.screen().join("\n")).not.toContain("权限确认");
    app.calls[3]!.tool("write", { path: "other.txt", content: "other tool" });
    await app.waitFor(() => app.screen().join("\n").includes("权限确认"));
    expect(app.screen().join("\n")).toContain("write ");
    app.stdin.write("\x1b");
    await app.waitFor(() => app.calls.length === 5);
    app.calls[4]!.finish();
    await app.waitFor(() => app.screen().some((line) => line.includes(" 工具 · 想")));
    expect(await Bun.file(join(root, ".neant/settings.json")).text()).toBe(settings);
  } finally {
    await app.cleanup();
  }

  const next = await start(["new Session"]);
  try {
    await next.waitFor(() => next.calls.length === 1);
    next.calls[0]!.tool("bash", { command: "printf needs-permission" });
    await next.waitFor(() => next.screen().join("\n").includes("权限确认"));
  } finally {
    await next.cleanup();
  }
});

test("concurrent questions are answered individually and dialog keys do not edit the draft", async () => {
  const app = await start(["two calls"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("next draft");
    await app.waitFor(() => app.screen().includes("❯ next draft"));
    app.calls[0]!.tools([
      { name: "bash", args: { command: "printf allowed-parallel" } },
      { name: "write", args: { path: "refused.txt", content: "refused" } },
    ]);
    await app.waitFor(() => app.screen().join("\n").includes("权限确认"));
    expect(app.screen().join("\n")).toContain("allowed-parallel");
    app.stdin.write("ignored\x1b[200~pasted\x1b[201~1\r");
    await app.waitFor(() => app.screen().join("\n").includes("refused.txt"));
    expect(app.screen().join("\n")).toContain("权限确认");
    app.stdin.write("3\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(
      app.calls[1]!.context.messages.filter((message) => message.role === "toolResult"),
    ).toMatchObject([
      { toolName: "bash", isError: false, content: [{ type: "text", text: "allowed-parallel" }] },
      {
        toolName: "write",
        isError: true,
        content: [{ type: "text", text: "该工具未获授权: write" }],
      },
    ]);
    app.calls[1]!.finish();
    await app.waitFor(() => app.screen().some((line) => line.includes(" 工具 · 想")));
    expect(app.screen()).toContain("❯ next draft");
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === 3);
    expect(app.calls[2]!.context.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: "next draft" }],
    });
  } finally {
    await app.cleanup();
  }
});

test("the question stays visible above a multiline draft and restores the draft after cancellation", async () => {
  const app = await start(["ask while drafting"]);
  const draft = Array.from({ length: 10 }, (_, index) => `draft-line-${index}`).join("\n");
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write(`\x1b[200~${draft}\x1b[201~`);
    await app.waitFor(() => app.screen().some((line) => line.trim() === "draft-line-9"));
    app.calls[0]!.tool("bash", { command: "printf visible-request" });
    await app.waitFor(() => app.screen().join("\n").includes("权限确认"));
    const dialog = app.screen().join("\n");
    expect(dialog).toContain('bash {"command":"printf visible-request"}');
    expect(dialog).toContain("1. 允许一次");
    expect(dialog).toContain("2. 本 session 内一直允许这个工具");
    expect(dialog).toContain("3. 拒绝");
    app.stdin.write("\x03");
    await app.waitFor(() => !app.screen().join("\n").includes("权限确认"));
    expect(app.screen().some((line) => line.trim() === "draft-line-9")).toBe(true);
    const nextCall = app.calls.length;
    app.stdin.write("\r");
    await app.waitFor(() => app.calls.length === nextCall + 1);
    expect(app.calls[nextCall]!.context.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ type: "text", text: draft }],
    });
  } finally {
    await app.cleanup();
  }
});

test("always allow also releases queued calls of the same tool", async () => {
  const app = await start(["two bash calls"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.tools([
      { name: "bash", args: { command: "printf first-parallel" } },
      { name: "bash", args: { command: "printf second-parallel" } },
    ]);
    await app.waitFor(() => app.screen().join("\n").includes("权限确认"));
    app.stdin.write("2\r");
    await app.waitFor(() => app.calls.length === 2);
    expect(
      app.calls[1]!.context.messages.filter((message) => message.role === "toolResult"),
    ).toMatchObject([
      { isError: false, content: [{ type: "text", text: "first-parallel" }] },
      { isError: false, content: [{ type: "text", text: "second-parallel" }] },
    ]);
    app.calls[1]!.finish();
    await app.waitFor(() => app.screen().some((line) => line.includes(" 工具 · 想")));
    expect(app.screen().join("\n")).not.toContain("权限确认");
  } finally {
    await app.cleanup();
  }
});
