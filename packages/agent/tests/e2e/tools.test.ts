import { afterEach, expect, spyOn, test } from "bun:test";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type TextContent,
  type ImageContent,
} from "@earendil-works/pi-ai";
import { join } from "node:path";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test("glob from a repository subdirectory honors repository root gitignore rules", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, ".gitignore"), "*.log\n");
  await Bun.write(join(dirs.cwd, "src/main.ts"), "content");
  await Bun.write(join(dirs.cwd, "src/error.log"), "hidden");
  const git = Bun.spawn(["git", "init", "-q"], { cwd: dirs.cwd });
  expect(await git.exited).toBe(0);
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("glob", { pattern: "**/*" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake, cwd: join(dirs.cwd, "src") });
  await session.run("find files");
  expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
    role: "toolResult",
    isError: false,
    content: [{ type: "text", text: "main.ts" }],
  });
});

test("glob scoped to a subdirectory still honors parent gitignore rules", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, ".gitignore"), "*.log\nignored/\n");
  await Bun.write(join(dirs.cwd, "src/main.ts"), "content");
  await Bun.write(join(dirs.cwd, "src/error.log"), "hidden");
  await Bun.write(join(dirs.cwd, "ignored/no.ts"), "hidden");
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("glob", { pattern: "**/*", path: "src" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("glob", { pattern: "**/*", path: "ignored" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("find source");
  expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
    role: "toolResult",
    isError: false,
    content: [{ type: "text", text: "main.ts" }],
  });
  expect(fake.contexts[2]!.messages.at(-1)).toMatchObject({
    role: "toolResult",
    isError: false,
    content: [{ type: "text", text: "No matching files." }],
  });
});

test("bash times out and returns an error without ending the Run", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("bash", { description: "Run test command", command: "sleep 10", timeout: 0.05 }),
      {
        stopReason: "toolUse",
      },
    ),
    fauxAssistantMessage("recovered"),
  ]);
  const session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  expect((await session.run("slow command")).text).toBe("recovered");
  expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
    role: "toolResult",
    isError: true,
    content: [{ type: "text", text: "Command timed out after 0.05 seconds" }],
  });
});

test("aborting a Run kills bash and its child process and preserves the error in the Transcript", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall(
        "bash",
        {
          description: "Run test command",
          command: 'sleep 30 & child=$!; printf \'%s %s\\n\' "$$" "$child"; wait',
        },
        { id: "bash-abort" },
      ),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("unused"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  const controller = new AbortController();
  const started = Promise.withResolvers<number[]>();
  const run = session.run("start shell", {
    signal: controller.signal,
    onEvent(event) {
      if (event.type !== "tool_execution_update" || event.toolCallId !== "bash-abort") return;
      const content = event.partialResult.content.find(
        (item: TextContent | ImageContent) => item.type === "text",
      );
      if (content?.type === "text" && /^\d+ \d+\n/.test(content.text)) {
        started.resolve(content.text.trim().split(" ").map(Number));
      }
    },
  });
  void run.catch(() => {});
  const pids = await started.promise;
  controller.abort(new Error("cancel shell"));
  await expect(run).rejects.toThrow("cancel shell");
  for (const pid of pids) {
    // Reaping a killed child can lag behind the shell closing its streams.
    const deadline = Date.now() + 1000;
    let alive = true;
    while (alive && Date.now() < deadline) {
      try {
        process.kill(pid, 0);
        await Bun.sleep(10);
      } catch {
        alive = false;
      }
    }
    expect(alive).toBe(false);
  }
  const next = fakeModel([fauxAssistantMessage("continued")]);
  const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
  await resumed.run("continue");
  expect(
    next.contexts[0]!.messages.find(
      (message) => message.role === "toolResult" && message.toolCallId === "bash-abort",
    ),
  ).toMatchObject({ role: "toolResult", isError: true });
});

test("grep returns regex matches with file and line numbers, respects ignores, and handles no matches", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, ".gitignore"), "ignored/\n");
  await Bun.write(join(dirs.cwd, "src/main.ts"), "const one = 1;\nconst two = 2;\n");
  await Bun.write(join(dirs.cwd, "ignored/no.ts"), "const hidden = 3;\n");
  const git = Bun.spawn(["git", "init", "-q"], { cwd: dirs.cwd });
  expect(await git.exited).toBe(0);
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("grep", { pattern: "const (one|two)" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("grep", { pattern: "not-present" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  expect((await session.run("search")).success).toBe(true);
  const first = fake.contexts[1]!.messages.at(-1)!;
  expect(first).toMatchObject({ role: "toolResult", isError: false });
  expect(JSON.stringify(first.content)).toContain("src/main.ts:1:const one = 1;");
  expect(JSON.stringify(first.content)).toContain("src/main.ts:2:const two = 2;");
  expect(JSON.stringify(first.content)).not.toContain("hidden");
  expect(fake.contexts[2]!.messages.at(-1)).toMatchObject({
    role: "toolResult",
    isError: false,
    content: [{ type: "text", text: "No matches." }],
  });
});

test("grep searches with bundled ripgrep when PATH contains no rg", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "file.txt"), "one\nhello bundled rg\n");
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("grep", { pattern: "bundled" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  const originalPath = process.env.PATH;
  try {
    process.env.PATH = dirs.cwd;
    expect((await session.run("search")).text).toBe("done");
  } finally {
    process.env.PATH = originalPath;
  }
  const result = fake.contexts[1]!.messages.at(-1)!;
  expect(result).toMatchObject({ role: "toolResult", isError: false });
  expect(JSON.stringify(result.content)).toContain("file.txt:2:hello bundled rg");
});

test("glob finds dotfiles and nested files while respecting nested gitignore rules", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, ".gitignore"), "ignored/\n*.log\n!keep.log\n");
  await Bun.write(join(dirs.cwd, "src/.gitignore"), "secret.ts\n!visible.log\n");
  for (const file of [
    "src/main.ts",
    "src/secret.ts",
    "src/visible.log",
    "ignored/no.ts",
    "error.log",
    "keep.log",
    ".hidden.ts",
    ".git/config",
  ]) {
    await Bun.write(join(dirs.cwd, file), "content");
  }
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("glob", { pattern: "**/*" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  expect((await session.run("find files")).success).toBe(true);
  expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
    role: "toolResult",
    isError: false,
    content: [
      {
        type: "text",
        text: ".gitignore\n.hidden.ts\n.keep\nkeep.log\nsrc/.gitignore\nsrc/main.ts\nsrc/visible.log",
      },
    ],
  });
});

test.each(["cli", "settings", "full-access"])(
  "explicit permissions %s allow writes while read supports line ranges",
  async (mode) => {
    const permissions =
      mode === "cli"
        ? { allowRules: ["wri?e"] }
        : mode === "settings"
          ? { settings: { permissions: { allow: ["wri[st]e"] } } }
          : { permissionMode: "full-access" as const };
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("write", { path: "file.txt", content: "one\ntwo\nthree\n" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxToolCall("read", { path: "file.txt", offset: 2, limit: 1 }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    const session = await createSession({ ...dirs, ...fake, ...permissions });
    expect((await session.run("write and read")).success).toBe(true);
    expect(await Bun.file(join(dirs.cwd, "file.txt")).text()).toBe("one\ntwo\nthree\n");
    expect(fake.contexts[2]!.messages.at(-1)).toMatchObject({
      role: "toolResult",
      toolName: "read",
      isError: false,
    });
    expect(JSON.stringify(fake.contexts[2]!.messages.at(-1))).toContain("two");
  },
);

test("full-access permits edits and bash; tool exceptions are returned so the model can recover", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "file.txt"), "original");
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("edit", {
        path: "file.txt",
        edits: [{ oldText: "original", newText: "changed" }],
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall("bash", { description: "Run test command", command: "cat file.txt" }),
      {
        stopReason: "toolUse",
      },
    ),
    fauxAssistantMessage(fauxToolCall("read", { path: "missing.txt" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("recovered"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  expect((await session.run("edit then inspect")).text).toBe("recovered");
  expect(fake.contexts[2]!.messages.at(-1)).toMatchObject({
    role: "toolResult",
    isError: false,
    content: [{ type: "text", text: "changed" }],
  });
  expect(fake.contexts[3]!.messages.at(-1)).toMatchObject({
    role: "toolResult",
    toolName: "read",
    isError: true,
  });
});

test("default permissions reject write, edit, and bash with errors and ordered denial events", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "original.txt"), "original");
  const fake = fakeModel([
    fauxAssistantMessage(
      [
        fauxToolCall("write", { path: "new.txt", content: "changed" }, { id: "write-1" }),
        fauxToolCall(
          "edit",
          { path: "original.txt", edits: [{ oldText: "original", newText: "changed" }] },
          { id: "edit-1" },
        ),
        fauxToolCall(
          "bash",
          { description: "Run test command", command: "touch bash-ran" },
          { id: "bash-1" },
        ),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("recovered"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  const events: SessionEvent[] = [];
  const result = await session.run("try tools", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(result.text).toBe("recovered");
  expect(events.filter((event) => event.type === "permission_denied")).toEqual([
    {
      type: "permission_denied",
      by: "user",
      sessionId: session.id,
      toolCallId: "write-1",
      toolName: "write",
    },
    {
      type: "permission_denied",
      by: "user",
      sessionId: session.id,
      toolCallId: "edit-1",
      toolName: "edit",
    },
    {
      type: "permission_denied",
      by: "user",
      sessionId: session.id,
      toolCallId: "bash-1",
      toolName: "bash",
    },
  ]);
  const errors = fake.contexts[1]!.messages.filter((message) => message.role === "toolResult");
  expect(errors).toHaveLength(3);
  for (const error of errors) {
    expect(error.isError).toBe(true);
    expect(JSON.stringify(error.content)).toContain("Tool not authorized");
    expect(
      events.findIndex(
        (event) => event.type === "permission_denied" && event.toolCallId === error.toolCallId,
      ),
    ).toBeLessThan(
      events.findIndex(
        (event) => event.type === "tool_execution_end" && event.toolCallId === error.toolCallId,
      ),
    );
  }
  expect(await Bun.file(join(dirs.cwd, "original.txt")).text()).toBe("original");
  expect(await Bun.file(join(dirs.cwd, "new.txt")).exists()).toBe(false);
  expect(await Bun.file(join(dirs.cwd, "bash-ran")).exists()).toBe(false);
});

test("unavailable bundled ripgrep reports English content and coded UI details", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("grep", { pattern: "visible" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("recovered"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  const spawn = spyOn(Bun, "spawn").mockImplementation(() => {
    throw new Error("test binary unavailable");
  });
  try {
    const events: SessionEvent[] = [];
    expect(
      (
        await session.run("search", {
          onEvent: (event) => {
            events.push(event);
          },
        })
      ).text,
    ).toBe("recovered");
    expect(events.find((event) => event.type === "tool_execution_end")).toMatchObject({
      isError: true,
      result: {
        content: [
          { type: "text", text: expect.stringContaining("Bundled ripgrep is unavailable.") },
        ],
        details: { code: "ripgrep-unavailable", params: { cause: "test binary unavailable" } },
      },
    });
    const toolResult = session.messages.find((message) => message.role === "toolResult");
    expect(toolResult).toMatchObject({
      isError: true,
      details: { code: "ripgrep-unavailable", params: { cause: "test binary unavailable" } },
    });
    expect(JSON.stringify(fake.contexts)).not.toMatch(/\p{Script=Han}/u);
  } finally {
    spawn.mockRestore();
  }
});
