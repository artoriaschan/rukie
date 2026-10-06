import { afterEach, expect, test } from "bun:test";
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
  await session.run("inspect nested file");
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
  await session.run("run command");
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
