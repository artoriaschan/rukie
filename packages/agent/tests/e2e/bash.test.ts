import * as bashFactory from "../../src/tools/bash/index.ts";
import { afterEach, expect, test, spyOn } from "bun:test";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type TextContent,
  type ImageContent,
} from "@earendil-works/pi-ai";
import { dirname, join } from "node:path";
import { rm } from "node:fs/promises";
import { createSession } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test("bash resolves workdir relative to the Session cwd", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "nested/value.txt"), "nested output");
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("bash", {
        command: "cat value.txt",
        description: "Read nested file",
        workdir: "nested",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  const views: unknown[] = [];
  await session.run("inspect nested file", {
    onEvent(event) {
      if (event.type === "tool_execution_start" || event.type === "tool_execution_end")
        views.push(event);
    },
  });
  expect(views).toMatchObject([
    {
      view: {
        card: "terminal",
        kind: "execute",
        displayKey: "tool.bash",
        command: "cat value.txt",
      },
    },
    { view: { card: "terminal", kind: "execute", output: "nested output", exitCode: 0 } },
  ]);
  expect(session.messages.find((message) => message.role === "toolResult")).toMatchObject({
    view: { card: "terminal", exitCode: 0 },
  });
  expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
    role: "toolResult",
    isError: false,
    content: [{ type: "text", text: "nested output" }],
  });
});

test("bash rejects a missing description without executing the command", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("bash", { command: "touch marker" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("recovered"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  const events: unknown[] = [];
  await session.run("run command", {
    onEvent(event) {
      if (event.type === "tool_execution_start" || event.type === "tool_execution_end")
        events.push(event);
    },
  });
  expect(events).toMatchObject([{ view: undefined }, { view: undefined }]);
  const result = fake.contexts[1]!.messages.at(-1);
  expect(result).toMatchObject({ role: "toolResult", isError: true });
  expect(JSON.stringify(result)).toContain("description");
  expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
});

test.each([
  ["true", false, "(no output)"],
  ["printf out; printf err >&2", false, "outerr"],
  ["printf failure; exit 7", true, "failure\n\nCommand exited with code 7"],
  ["kill -TERM $$", true, "Command exited with code 143"],
] as const)(
  "foreground bash preserves output and exit status for %s",
  async (command, isError, text) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("bash", { command, description: "Run foreground command" }),
        {
          stopReason: "toolUse",
        },
      ),
      fauxAssistantMessage("done"),
    ]);
    const session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
    await session.run("run command");
    expect(session.messages.find((message) => message.role === "toolResult")).toMatchObject({
      details: { exitCode: command.includes("exit 7") ? 7 : command.includes("TERM") ? 143 : 0 },
      view: { card: "terminal", ...(command.includes("TERM") ? { signal: "SIGTERM" } : {}) },
    });
    expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
      role: "toolResult",
      isError,
      content: [{ type: "text", text }],
    });
  },
);

test("aborting bash terminates its shell, child, and grandchild", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall(
        "bash",
        {
          command: `bash -c 'sleep 30 & child=$!; printf "%s %s\\n" "$$" "$child"; wait' & child=$!; printf '%s\\n' "$$"; wait`,
          description: "Start nested process tree",
        },
        { id: "tree" },
      ),
      { stopReason: "toolUse" },
    ),
  ]);
  const session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  const controller = new AbortController();
  const ready = Promise.withResolvers<number[]>();
  const run = session.run("start tree", {
    signal: controller.signal,
    onEvent(event) {
      if (event.type !== "tool_execution_update" || event.toolCallId !== "tree") return;
      const text = event.partialResult.content.find(
        (item: TextContent | ImageContent) => item.type === "text",
      );
      if (text?.type !== "text") return;
      const pids: number[] = text.text.trim().split(/\s+/).map(Number);
      if (pids.length === 3 && pids.every((pid) => Number.isInteger(pid) && pid > 0))
        ready.resolve(pids);
    },
  });
  void run.catch(() => {});
  const pids = await ready.promise;
  controller.abort(new Error("stop tree"));
  await expect(run).rejects.toThrow("stop tree");
  for (const pid of pids) {
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
  expect(JSON.stringify(session.messages)).toContain("Command aborted");
});

test("bash preserves the tail truncation notice and full spill output", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("bash", {
        command: 'for ((i=1; i<=2100; i++)); do printf "line-%s\\n" "$i"; done',
        description: "Print many output lines",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  await session.run("produce large output");
  const result = fake.contexts[1]!.messages.at(-1);
  expect(result).toMatchObject({ role: "toolResult", isError: false });
  if (result?.role !== "toolResult") throw new Error("Missing tool result");
  const content = result.content.find((item) => item.type === "text");
  if (content?.type !== "text") throw new Error("Missing output text");
  expect(content.text).toStartWith("line-101\n");
  expect(content.text).toContain("line-2100\n\n[Showing lines 101-2100 of 2100. Full output:");
  const spill = /Full output: (.+)\]$/.exec(content.text)?.[1];
  expect(spill).toBeDefined();
  if (!spill) throw new Error("Missing spill path");
  try {
    const full = await Bun.file(spill).text();
    expect(full).toStartWith("line-1\nline-2\n");
    expect(full).toEndWith("line-2100\n");
    expect(full.split("\n")).toHaveLength(2101);
  } finally {
    await rm(dirname(spill), { recursive: true });
  }
});

test("bash escalates cancellation when a process handles SIGTERM without exiting", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall(
        "bash",
        {
          command: `trap 'printf received > term-marker' TERM; printf '%s\\n' "$$"; while :; do sleep 0.01; done`,
          description: "Start stubborn foreground command",
        },
        { id: "stubborn" },
      ),
      { stopReason: "toolUse" },
    ),
  ]);
  const session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  const controller = new AbortController();
  const ready = Promise.withResolvers<number>();
  const run = session.run("start process", {
    signal: controller.signal,
    onEvent(event) {
      if (event.type !== "tool_execution_update" || event.toolCallId !== "stubborn") return;
      const content = event.partialResult.content.find(
        (item: TextContent | ImageContent) => item.type === "text",
      );
      if (content?.type === "text" && /^\d+\n$/.test(content.text))
        ready.resolve(Number(content.text));
    },
  });
  void run.catch(() => {});
  const pid = await ready.promise;
  controller.abort(new Error("stop stubborn process"));
  await expect(run).rejects.toThrow("stop stubborn process");
  expect(await Bun.file(join(dirs.cwd, "term-marker")).text()).toBe("received");
  expect(() => process.kill(pid, 0)).toThrow();
});

test("Tool Views are recomputed from persisted facts after Session resume", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("bash", { command: "printf replay; exit 7", description: "Print replay" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  await session.run("run command");
  const before = session.messages;
  await session.dispose();
  const resumed = await createSession({ ...dirs, ...fake, resumeId: session.id });
  try {
    expect(resumed.messages).toEqual(before);
    expect(resumed.messages.find((message) => message.role === "toolResult")).toMatchObject({
      view: { card: "terminal", exitCode: 7, output: "replay\n\nCommand exited with code 7" },
    });
    const files = new Bun.Glob("**/*.jsonl");
    for await (const path of files.scan({ cwd: dirs.homeDir, absolute: true })) {
      const stored = await Bun.file(path).text();
      expect(stored).not.toContain('"view":');
    }
  } finally {
    await resumed.dispose();
  }
});

test("unknown tools produce no Tool View and retain their normal error result", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("removed_tool", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  const events: unknown[] = [];
  try {
    await session.run("run", {
      onEvent(event) {
        if (event.type === "tool_execution_start" || event.type === "tool_execution_end")
          events.push(event);
      },
    });
    expect(events).toMatchObject([{ view: undefined }, { view: undefined, isError: true }]);
    expect(session.messages.find((message) => message.role === "toolResult")).toMatchObject({
      isError: true,
      view: undefined,
    });
  } finally {
    await session.dispose();
  }
});

test("a tool author's throwing presenters cannot fail a Session Run", async () => {
  dirs = await tempDirs();
  const create = bashFactory.createBashTool;
  // Inject an author-supplied presenter at the existing tool factory; execute remains real.
  const factory = spyOn(bashFactory, "createBashTool").mockImplementation((cwd, jobs) => ({
    ...create(cwd, jobs),
    presentCall() {
      throw new Error("broken call presenter");
    },
    presentResult() {
      throw new Error("broken result presenter");
    },
  }));
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("bash", { command: "printf survived", description: "Print" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  try {
    const events: unknown[] = [];
    expect(
      (
        await session.run("run", {
          onEvent(event) {
            if (event.type === "tool_execution_start" || event.type === "tool_execution_end")
              events.push(event);
          },
        })
      ).success,
    ).toBe(true);
    expect(events).toMatchObject([{ view: undefined }, { view: undefined, isError: false }]);
    expect(session.messages.find((message) => message.role === "toolResult")).toMatchObject({
      content: [{ text: "survived" }],
      view: undefined,
    });
  } finally {
    factory.mockRestore();
    await session.dispose();
  }
});
