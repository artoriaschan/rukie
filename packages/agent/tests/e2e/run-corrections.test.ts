import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession, type Session } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  await dirs?.cleanup();
});

test("length continues from the cutoff at most three times and projects automatic reminders", async () => {
  dirs = await tempDirs();
  const fake = fakeModel(
    Array.from({ length: 4 }, () => fauxAssistantMessage("partial", { stopReason: "length" })),
  );
  session = await createSession({ ...dirs, ...fake });
  await expect(session.run("answer")).rejects.toThrow("length");
  expect(fake.contexts).toHaveLength(4);
  expect(JSON.stringify(fake.contexts[1]!.messages)).toContain("Continue from the cutoff");
  expect(
    session.messages.filter(
      (message) => message.role === "system-reminder" && message.source === "output-length",
    ),
  ).toHaveLength(3);
});

test("committed repeated calls warn the next generation and a fresh Run starts at zero", async () => {
  dirs = await tempDirs();
  await Bun.write(`${dirs.cwd}/file.txt`, "hello");
  const read = () =>
    fauxAssistantMessage(fauxToolCall("read", { path: "file.txt" }), { stopReason: "toolUse" });
  const fake = fakeModel([
    read(),
    read(),
    read(),
    fauxAssistantMessage("done"),
    read(),
    read(),
    fauxAssistantMessage("done again"),
  ]);
  session = await createSession({ ...dirs, ...fake });
  await session.run("read repeatedly");
  expect(JSON.stringify(fake.contexts[2]!.messages)).not.toContain(
    "repeated the same tool call three times",
  );
  expect(JSON.stringify(fake.contexts[3]!.messages)).toContain(
    "repeated the same tool call three times",
  );
  const before = session.messages.filter(
    (message) => message.role === "system-reminder" && message.source === "run-correction",
  ).length;
  await session.run("new task");
  expect(
    session.messages.filter(
      (message) => message.role === "system-reminder" && message.source === "run-correction",
    ),
  ).toHaveLength(before);
});

test("empty visible length output asks for shorter reasoning before a successful continuation", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage([{ type: "thinking", thinking: "long reasoning" }], {
      stopReason: "length",
    }),
    fauxAssistantMessage("answer"),
  ]);
  session = await createSession({ ...dirs, ...fake });
  await session.run("answer");
  expect(JSON.stringify(fake.contexts[1]!.messages)).toContain(
    "No visible output was produced. Shorten your reasoning",
  );
});

test("Resume and Rewind do not inherit repeated-call counters", async () => {
  dirs = await tempDirs();
  await Bun.write(`${dirs.cwd}/file.txt`, "hello");
  const read = () =>
    fauxAssistantMessage(fauxToolCall("read", { path: "file.txt" }), { stopReason: "toolUse" });
  const initial = fakeModel([read(), read(), fauxAssistantMessage("done")]);
  session = await createSession({ ...dirs, ...initial });
  await session.run("first");
  const id = session.id;
  await session.close();
  const restored = fakeModel([
    read(),
    read(),
    fauxAssistantMessage("done"),
    read(),
    read(),
    fauxAssistantMessage("done"),
  ]);
  session = await createSession({ ...dirs, ...restored, resumeId: id });
  await session.run("second");
  expect(
    session.messages.filter(
      (message) => message.role === "system-reminder" && message.source === "run-correction",
    ),
  ).toHaveLength(0);
  await session.rewind(session.checkpoints()[0]!.promptEntryId, {
    code: false,
    conversation: true,
  });
  await session.run("rewound task");
  expect(
    session.messages.filter(
      (message) => message.role === "system-reminder" && message.source === "run-correction",
    ),
  ).toHaveLength(0);
});

test("child Runs use the same repeated-call correction without counting the parent's delegation", async () => {
  dirs = await tempDirs();
  await Bun.write(`${dirs.cwd}/file.txt`, "hello");
  const read = () =>
    fauxAssistantMessage(fauxToolCall("read", { path: "file.txt" }), { stopReason: "toolUse" });
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", { description: "Reader", prompt: "read", run_in_background: false }),
      { stopReason: "toolUse" },
    ),
    read(),
    read(),
    read(),
    fauxAssistantMessage("child done"),
    fauxAssistantMessage("parent done"),
  ]);
  session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await session.run("delegate");
  expect(JSON.stringify(fake.contexts[3]!.messages)).not.toContain(
    "repeated the same tool call three times",
  );
  expect(JSON.stringify(fake.contexts[4]!.messages)).toContain(
    "repeated the same tool call three times",
  );
});

test("automatic Compaction resets repeated calls inside the accepted Run", async () => {
  dirs = await tempDirs();
  await Bun.write(`${dirs.cwd}/file.txt`, "OLD_EVIDENCE contract ".repeat(4000));
  let calls = 0;
  const reply: Parameters<typeof fakeModel>[0][number] = (context) => {
    if (JSON.stringify(context.messages[0]).includes("context summarization assistant"))
      return fauxAssistantMessage("Summary of inspected file.");
    calls++;
    return calls <= 4
      ? fauxAssistantMessage(fauxToolCall("read", { path: "file.txt" }), { stopReason: "toolUse" })
      : fauxAssistantMessage("done");
  };
  const fake = fakeModel(
    Array.from({ length: 12 }, () => reply),
    { model: { contextWindow: 16000 } },
  );
  session = await createSession({ ...dirs, ...fake });
  let compactions = 0;
  session.subscribe((event) => {
    if (event.type === "compaction_end") compactions++;
  });
  await session.run("read repeatedly");
  expect(compactions).toBeGreaterThan(0);
  expect(calls).toBe(5);
  expect(
    session.messages.filter(
      (message) => message.role === "system-reminder" && message.source === "run-correction",
    ),
  ).toHaveLength(0);
});

test("a parallel tool batch counts each committed call toward no-progress guidance", async () => {
  dirs = await tempDirs();
  const calls = Array.from({ length: 15 }, (_, index) =>
    fauxToolCall("read", { path: `missing-${index}.txt` }),
  );
  const fake = fakeModel([
    fauxAssistantMessage(calls, { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  session = await createSession({ ...dirs, ...fake });
  await session.run("inspect missing files");
  expect(JSON.stringify(fake.contexts[1]!.messages)).toContain(
    "15 consecutive tool calls without a progress event",
  );
});
