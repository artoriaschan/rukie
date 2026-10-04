import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test.each([0, 2])(
  "Stop feedback continues the same run then allows completion (exit %s)",
  async (exitCode) => {
    dirs = await tempDirs();
    await Bun.write(
      join(dirs.cwd, "stop.sh"),
      `
cat >> inputs.jsonl
echo >> inputs.jsonl
if [ ! -f checked ]; then
  touch checked
  ${exitCode === 2 ? "echo verify-tests >&2" : `echo '{"decision":"block","reason":"verify-tests"}'`}
  exit ${exitCode}
fi
echo '{}'
`,
    );
    const fake = fakeModel([
      fauxAssistantMessage("first conclusion"),
      fauxAssistantMessage("verified"),
    ]);
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: {
        hooks: {
          Stop: [{ matcher: "ignored", hooks: [{ type: "command", command: "sh stop.sh" }] }],
        },
      },
    });
    const result = await session.run("finish", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(result).toMatchObject({ success: true, text: "verified" });
    expect(session.messages.filter((message) => message.role === "user")).toMatchObject([
      { content: [{ text: "finish" }] },
      { source: "stop_hook", content: [{ text: "verify-tests" }] },
    ]);
    expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
      role: "user",
      content: [{ text: "verify-tests" }],
    });
    expect(events.filter((event) => event.type === "hook_continued")).toMatchObject([
      { event: "Stop", reason: "verify-tests", sessionId: session.id },
    ]);
    expect(events.filter((event) => event.type === "result")).toHaveLength(1);
    const inputs = (await Bun.file(join(dirs.cwd, "inputs.jsonl")).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(inputs).toMatchObject([
      {
        hook_event_name: "Stop",
        stop_hook_active: false,
        last_assistant_message: "first conclusion",
        session_id: session.id,
      },
      { stop_hook_active: true, last_assistant_message: "verified", session_id: session.id },
    ]);
    const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
    expect(resumed.messages.filter((message) => message.role === "user")).toMatchObject([
      {},
      { source: "stop_hook", content: [{ text: "verify-tests" }] },
    ]);
  },
);

test("Stop waits until background children finish and their notification is delivered", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "stop.sh"),
    "cat >> inputs.jsonl\necho >> inputs.jsonl\necho '{}'\n",
  );
  const child = Promise.withResolvers<void>();
  const waiting = Promise.withResolvers<void>();
  const response: Parameters<typeof fakeModel>[0][number] = async (context) => {
    const isParent = context.messages.some(
      (message) =>
        message.role === "system" && message.toolsAdded?.some((tool) => tool.name === "subagent"),
    );
    if (!isParent) {
      await child.promise;
      return fauxAssistantMessage("child conclusion");
    }
    return fauxAssistantMessage("parent waiting");
  };
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("subagent", { description: "Inspect", prompt: "child" }), {
      stopReason: "toolUse",
    }),
    response,
    response,
    (context) => {
      expect(structuredClone(context.messages.at(-1))).toMatchObject({
        role: "user",
        content: [{ text: expect.stringContaining("child conclusion") }],
      });
      return fauxAssistantMessage("parent conclusion");
    },
  ]);
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: { hooks: { Stop: [{ hooks: [{ type: "command", command: "sh stop.sh" }] }] } },
  });
  const run = session.run("delegate", {
    onEvent: (event) => {
      events.push(event);
      if (event.type === "subagents_waiting") waiting.resolve();
    },
  });
  await waiting.promise;
  expect(await Bun.file(join(dirs.cwd, "inputs.jsonl")).exists()).toBe(false);
  child.resolve();
  expect(await run).toMatchObject({ success: true, text: "parent conclusion" });
  const inputs = (await Bun.file(join(dirs.cwd, "inputs.jsonl")).text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(inputs).toMatchObject([
    {
      session_id: session.id,
      last_assistant_message: "parent conclusion",
      stop_hook_active: false,
    },
  ]);
  expect(inputs).toHaveLength(1);
  expect(events.filter((event) => event.type === "hook_continued")).toHaveLength(0);
});

test("continue false takes priority over a Stop block and shows the stop reason", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "stop.sh"),
    `cat > input.json\necho '{"continue":false,"stopReason":"halt now","systemMessage":"halt notice","decision":"block","reason":"must not continue"}'\n`,
  );
  const fake = fakeModel([fauxAssistantMessage("conclusion")]);
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: { hooks: { Stop: [{ hooks: [{ type: "command", command: "sh stop.sh" }] }] } },
  });
  expect(
    await session.run("finish", {
      onEvent: (event) => {
        events.push(event);
      },
    }),
  ).toMatchObject({ success: true, stopReason: "hook_stopped", reason: "halt now" });
  expect(events.filter((event) => event.type === "hook_continued")).toHaveLength(0);
  expect(events.filter((event) => event.type === "hook_message")).toMatchObject([
    { event: "Stop", message: "halt notice" },
  ]);
  expect(session.messages.filter((message) => message.role === "user")).toHaveLength(1);
});

test.each(["error", "aborted"] as const)(
  "Stop does not run after an assistant %s",
  async (stopReason) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage("failed", { stopReason, errorMessage: "model failed" }),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: {
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "cat > unexpected-input; echo '{}'" }] }],
        },
      },
    });
    await expect(session.run("finish")).rejects.toThrow("model failed");
    expect(await Bun.file(join(dirs.cwd, "unexpected-input")).exists()).toBe(false);
  },
);

test("cancellation while receiving Stop feedback prevents the continuation model call", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([fauxAssistantMessage("conclusion")]);
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: {
        Stop: [
          {
            hooks: [{ type: "command", command: `echo '{"decision":"block","reason":"verify"}'` }],
          },
        ],
      },
    },
  });
  const controller = new AbortController();
  await expect(
    session.run("finish", {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "hook_continued") controller.abort(new Error("cancel feedback"));
      },
    }),
  ).rejects.toThrow("cancel feedback");
  expect(fake.contexts).toHaveLength(1);
  expect(session.messages.filter((message) => message.role === "user")).toHaveLength(1);
});

test("concurrent Stop blocks combine every reason in one feedback message", async () => {
  dirs = await tempDirs();
  for (const [name, reason] of [
    ["first", "test failures"],
    ["second", "lint failures"],
  ]) {
    await Bun.write(
      join(dirs.cwd, `${name}.sh`),
      `cat > ${name}.input\nif [ ! -f ${name}.checked ]; then\n touch ${name}.checked\n echo '{"decision":"block","reason":"${reason}"}'\nelse\n echo '{}'\nfi\n`,
    );
  }
  const fake = fakeModel([fauxAssistantMessage("conclusion"), fauxAssistantMessage("fixed")]);
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: {
      hooks: {
        Stop: [
          {
            hooks: ["first", "second"].map((name) => ({
              type: "command",
              command: `sh ${name}.sh`,
            })),
          },
        ],
      },
    },
  });
  expect(await session.run("finish")).toMatchObject({ text: "fixed", success: true });
  const feedback = session.messages.filter((message) => message.role === "user").at(-1)!;
  expect(feedback).toMatchObject({ source: "stop_hook" });
  expect(JSON.stringify(feedback)).toContain("test failures");
  expect(JSON.stringify(feedback)).toContain("lint failures");
});

test("the ninth Stop block warns and finishes; a new run resets its continuation budget", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "stop.sh"),
    `cat >> inputs.jsonl\necho >> inputs.jsonl\necho '{"decision":"block","reason":"keep checking"}'\n`,
  );
  const fake = fakeModel(Array.from({ length: 18 }, () => fauxAssistantMessage("conclusion")));
  const warnings: string[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    onWarning: (warning) => {
      warnings.push(warning);
    },
    settings: { hooks: { Stop: [{ hooks: [{ type: "command", command: "sh stop.sh" }] }] } },
  });
  for (const prompt of ["first run", "second run"]) {
    const events: SessionEvent[] = [];
    expect(
      await session.run(prompt, {
        onEvent: (event) => {
          events.push(event);
        },
      }),
    ).toMatchObject({ success: true, text: "conclusion" });
    expect(events.filter((event) => event.type === "hook_continued")).toHaveLength(8);
    expect(events.filter((event) => event.type === "hook_warning")).toMatchObject([
      {
        event: "Stop",
        error: { code: "hook-continuation-limit", params: { event: "Stop", limit: "8" } },
      },
    ]);
  }
  expect(warnings).toHaveLength(2);
  expect(
    session.messages.filter(
      (message) => message.role === "user" && "source" in message && message.source === "stop_hook",
    ),
  ).toHaveLength(16);
  const inputs = (await Bun.file(join(dirs.cwd, "inputs.jsonl")).text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(inputs).toHaveLength(18);
  expect(inputs.map((input) => input.stop_hook_active)).toEqual([
    false,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    false,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
    true,
  ]);
});
