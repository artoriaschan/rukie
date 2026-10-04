import { expect, test } from "bun:test";
import { start } from "../helpers/app";

function prompt(app: Awaited<ReturnType<typeof start>>) {
  const lines = app.screen();
  const top = lines.findIndex((line) => line.startsWith("╭"));
  const bottom = lines.findIndex((line, row) => row > top && line.startsWith("╰"));
  return lines.slice(top + 1, bottom).join("\n");
}

async function send(app: Awaited<ReturnType<typeof start>>, text: string) {
  const count = app.calls.length;
  app.stdin.write(`${text}\r`);
  await app.waitFor(() => app.calls.length === count + 1);
  app.calls.at(-1)!.delta("done");
  app.calls.at(-1)!.finish();
  await app.waitFor(() => !app.isWorking() && app.allLines().some((line) => line.includes("done")));
}

test("arrows recall accepted inputs, preserve the draft and submit edited recall at its end", async () => {
  const app = await start();
  try {
    await app.waitFor(() => prompt(app) === "❯");
    await send(app, "first");
    await send(app, "第二条👩‍💻");
    app.stdin.write("unfinished\x1b[A");
    await app.waitFor(() => prompt(app) === "❯ 第二条👩‍💻");
    app.stdin.write("\x1b[A\x1b[A");
    await app.waitFor(() => prompt(app) === "❯ first");
    app.stdin.write("\x1b[B\x1b[B\x1b[B");
    await app.waitFor(() => prompt(app) === "❯ unfinished");
    app.stdin.write("\x1b[A edited\r");
    await app.waitFor(() => app.calls.length === 3);
    const user = app.calls[2]!.context.messages.findLast((message) => message.role === "user");
    expect(user?.content).toEqual([{ type: "text", text: "第二条👩‍💻 edited" }]);
    app.calls[2]!.delta("done");
    app.calls[2]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("fresh draft\x1b[A\x1b[B");
    await app.waitFor(() => prompt(app) === "❯ fresh draft");
    app.stdin.write("\x1b[A\x03new draft\x1b[A\x1b[B");
    await app.waitFor(() => prompt(app) === "❯ new draft");
  } finally {
    await app.cleanup();
  }
});

test("a new TUI launch restores project history and positional prompts are remembered", async () => {
  const app = await start(["positional"]);
  let restart: Awaited<ReturnType<typeof start>> | undefined;
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.delta("done");
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    await send(app, "remember across restart");
    app.stdin.write("\x04");
    expect(await app.exit).toBe(0);
    restart = await start([], { session: { cwd: app.root, homeDir: app.root } });
    await restart.waitFor(() => prompt(restart!) === "❯");
    restart.stdin.write("\x1b[A");
    await restart.waitFor(() => prompt(restart!) === "❯ remember across restart");
    restart.stdin.write("\x1b[A");
    await restart.waitFor(() => prompt(restart!) === "❯ positional");
    expect(restart.calls).toHaveLength(0);
  } finally {
    await restart?.cleanup();
    await app.cleanup();
  }
});

test("blank and rejected busy submissions do not enter history", async () => {
  const app = await start();
  try {
    await app.waitFor(() => prompt(app) === "❯");
    app.stdin.write("  \r\x03");
    await send(app, "accepted");
    app.stdin.write("running\r");
    await app.waitFor(() => app.calls.length === 2);
    app.stdin.write("rejected\r");
    app.calls[1]!.delta("done");
    app.calls[1]!.finish();
    await app.waitFor(() => !app.isWorking());
    app.stdin.write("\x03\x1b[A");
    await app.waitFor(() => prompt(app) === "❯ running");
    app.stdin.write("\x1b[A\x1b[A");
    await app.waitFor(() => prompt(app) === "❯ accepted");
    expect(app.calls).toHaveLength(2);
  } finally {
    await app.cleanup();
  }
});

test("history browsing preserves its draft while the prompt is hidden by a small terminal", async () => {
  const app = await start();
  try {
    await app.waitFor(() => prompt(app) === "❯");
    await send(app, "remembered");
    app.stdin.write("preserved draft\x1b[A");
    await app.waitFor(() => prompt(app) === "❯ remembered");
    app.resize(30, 10);
    await app.waitFor(() => !app.screen().some((line) => line.startsWith("╭")));
    app.resize(80, 24);
    await app.waitFor(() => prompt(app) === "❯ remembered");
    app.stdin.write("\x1b[B");
    await app.waitFor(() => prompt(app) === "❯ preserved draft");
  } finally {
    await app.cleanup();
  }
});

test("permission dialog arrows leave the history walk and its draft intact", async () => {
  const app = await start(["running"]);
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.stdin.write("preserved draft\x1b[A");
    await app.waitFor(() => prompt(app) === "❯ running");
    app.calls[0]!.tool("bash", { command: "printf permitted" });
    await app.waitFor(() => app.screen().join("\n").includes("等待审批"));
    app.stdin.write("\x1b[B\x1b[A\r");
    await app.waitFor(() => app.calls.length === 2 && prompt(app) === "❯ running");
    app.stdin.write("\x1b[B");
    await app.waitFor(() => prompt(app) === "❯ preserved draft");
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});
