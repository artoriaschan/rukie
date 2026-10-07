import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { stat } from "node:fs/promises";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createSession as createNativeSession } from "@earendil-works/pi-durable";
import { fauxAssistantMessage, fauxToolCall, getCurrentTools } from "@earendil-works/pi-ai";
import {
  createJsonlStore,
  createSession as createSessionImpl,
  type Session,
} from "../../src/index.ts";
import { SessionMetadataDoc } from "../../src/store/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { crashUnsafeEffect, crashSafeDelegation } from "../helpers/native-recovery.ts";
import { runRequest } from "../helpers/crashed-subagents.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const sessions: Session[] = [];
async function createSession(options: Parameters<typeof createSessionImpl>[0]) {
  const session = await createSessionImpl(options);
  sessions.push(session);
  return session;
}
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await dirs?.cleanup();
});
const resultMessages = (session: Session) =>
  session.messages.filter((message) => message.role === "toolResult");
function resumeOptions(id: string) {
  return { ...dirs, homeDir: dirs.cwd, resumeId: id, permissionMode: "full-access" as const };
}
async function settle(session: Session) {
  const id = session.currentRequestId;
  if (!id) throw new Error("Accepted native request missing");
  return session.waitForRequest(id);
}
async function rawResults(id: string, fullHistory = false) {
  const store = createJsonlStore({ ...dirs, homeDir: dirs.cwd });
  const lease = await store.open({ id }, BACKGROUND_CONTEXT);
  const native = createNativeSession(lease.storage);
  try {
    const metadata = await native.snapshot(SessionMetadataDoc, BACKGROUND_CONTEXT);
    if (!metadata) throw new Error("Native Session metadata missing");
    const conversations = await lease.storage.scanConversations(
      {},
      10000,
      undefined,
      BACKGROUND_CONTEXT,
    );
    const active = conversations.items.find(
      (conversation) => conversation.id === metadata.activeConversationId,
    );
    if (!active) throw new Error("Active native conversation missing");
    const entries = new Map<number, import("@earendil-works/pi-durable").EntryRecord>();
    for (const conversation of fullHistory ? conversations.items : [active]) {
      const page = await lease.storage.scanEntries(
        { conversationId: conversation.id },
        10000,
        undefined,
        BACKGROUND_CONTEXT,
      );
      for (const entry of page.items) entries.set(entry.id, entry);
    }
    return [...entries.values()].flatMap((entry) =>
      (entry.model ?? []).filter((message) => message.role === "toolResult"),
    );
  } finally {
    await native.close(BACKGROUND_CONTEXT);
    await lease.release();
  }
}

test("a real unsafe effect with a lost native receipt resumes as unknown without replay or another recovery Checkpoint", async () => {
  dirs = await tempDirs();
  const saved = await crashUnsafeEffect(dirs.cwd);
  const fake = fakeModel([
    (context) => {
      expect(
        context.messages.findLast(
          (message) => message.role === "toolResult" && message.toolName === "write",
        ),
      ).toMatchObject({
        isError: true,
        content: [{ type: "text", text: expect.stringContaining("may have partially run") }],
      });
      return fauxAssistantMessage("verify real state before retrying");
    },
  ]);
  const resumed = await createSession({ ...resumeOptions(saved.sessionId), ...fake });
  await settle(resumed);
  expect(resultMessages(resumed)).toMatchObject([
    { toolName: "write", isError: true, outcomeUnknown: true },
  ]);
  expect(resumed.checkpoints()).toHaveLength(1);
  expect(await Bun.file(join(dirs.cwd, "uncertain-effect.txt")).text()).toBe("saved effect");
  expect((await stat(join(dirs.cwd, "uncertain-effect.txt"))).mtimeMs).toBe(saved.effectModifiedAt);
  const snapshot = structuredClone([...resumed.messages]);
  await resumed.close();
  const raw = await rawResults(saved.sessionId);
  expect(raw).toHaveLength(1);
  expect(raw[0]).toMatchObject({ toolName: "write", isError: true });
  expect(Object.hasOwn(raw[0]!, "view")).toBe(false);
  const next = fakeModel([fauxAssistantMessage("checked")]);
  const again = await createSession({ ...resumeOptions(saved.sessionId), ...next });
  expect([...again.messages]).toEqual(snapshot);
  await runRequest(again, "check what happened");
  expect(resultMessages(again)).toHaveLength(1);
  expect(again.checkpoints()).toHaveLength(2);
  expect((await stat(join(dirs.cwd, "uncertain-effect.txt"))).mtimeMs).toBe(saved.effectModifiedAt);
});

test("real successful, failed and uncertain ToolResults and reconstructed views survive repeated cold opens unchanged", async () => {
  dirs = await tempDirs();
  const saved = await crashUnsafeEffect(dirs.cwd, false, { completedReads: true });
  const first = await createSession({
    ...resumeOptions(saved.sessionId),
    ...fakeModel([fauxAssistantMessage("verified")]),
  });
  await settle(first);
  const results = structuredClone(resultMessages(first));
  expect(results).toHaveLength(3);
  const success = results.find((result) => result.toolCallId === "real-success")!;
  const failure = results.find((result) => result.toolCallId === "real-failure")!;
  expect(success).toMatchObject({
    toolCallId: "real-success",
    toolName: "read",
    isError: false,
    content: [{ type: "text", text: "saved output" }],
    view: { card: "read", content: "saved output" },
  });
  expect(failure).toMatchObject({
    toolCallId: "real-failure",
    toolName: "read",
    isError: true,
    view: { card: "read" },
  });
  expect(success.outcomeUnknown).not.toBe(true);
  expect(failure.outcomeUnknown).not.toBe(true);
  expect(results[2]).toMatchObject({ toolName: "write", isError: true, outcomeUnknown: true });
  await first.close();
  const raw = await rawResults(saved.sessionId);
  expect(raw).toHaveLength(3);
  for (const result of raw) expect(Object.hasOwn(result, "view")).toBe(false);
  const again = await createSession({ ...resumeOptions(saved.sessionId), ...fakeModel([]) });
  expect(resultMessages(again)).toEqual(results);
  await again.close();
  expect(await rawResults(saved.sessionId)).toEqual(raw);
});

test("a pending native child resumes its identity without replaying an unsafe effect and explicit send preserves the old outcome", async () => {
  dirs = await tempDirs();
  const saved = await crashUnsafeEffect(dirs.cwd, true);
  if (!saved.childId) throw new Error("Expected native child identity");
  const childId = saved.childId;
  let send = false;
  const reply: Parameters<typeof fakeModel>[0][number] = (context) => {
    if (!getCurrentTools(context.messages).some((tool) => tool.name === "subagent"))
      return fauxAssistantMessage("child continued safely");
    if (
      !send &&
      JSON.stringify(
        context.messages.findLast((message) => message.role === "user")?.content,
      ).includes("send a follow up")
    ) {
      send = true;
      return fauxAssistantMessage(
        fauxToolCall("send_message", { agent_id: childId, message: "continue after inspection" }),
        { stopReason: "toolUse" },
      );
    }
    return fauxAssistantMessage("parent observed child");
  };
  const fake = fakeModel(Array.from({ length: 12 }, () => reply));
  const parent = await createSession({ ...resumeOptions(saved.sessionId), ...fake });
  await settle(parent);
  const child = await parent.readSubagent(childId);
  expect(child?.messages.filter((message) => message.role === "toolResult")).toMatchObject([
    { toolName: "write", outcomeUnknown: true, isError: true },
  ]);
  await Bun.write(join(dirs.cwd, "uncertain-effect.txt"), "externally reconciled");
  await runRequest(parent, "send a follow up");
  const continued = await parent.readSubagent(childId);
  expect(
    continued?.historyMessages?.filter((message) => message.role === "toolResult"),
  ).toMatchObject([{ toolName: "write", outcomeUnknown: true, isError: true }]);
  expect(continued?.run?.outcome).toBe("completed");
  expect(parent.toolState("subagents")).toMatchObject([{ id: childId, active: false }]);
  expect(await Bun.file(join(dirs.cwd, "uncertain-effect.txt")).text()).toBe(
    "externally reconciled",
  );
});

test("Rewind excludes an uncertain call from the active branch while preserving its real effect and original durable facts", async () => {
  dirs = await tempDirs();
  const saved = await crashUnsafeEffect(dirs.cwd);
  const session = await createSession({
    ...resumeOptions(saved.sessionId),
    ...fakeModel([fauxAssistantMessage("verify first"), fauxAssistantMessage("new branch answer")]),
  });
  await settle(session);
  expect(resultMessages(session)).toMatchObject([{ outcomeUnknown: true }]);
  const anchor = session.checkpoints()[0]!.promptEntryId;
  await session.rewind(anchor, { code: false, conversation: true });
  expect(resultMessages(session)).toEqual([]);
  await runRequest(session, "new branch prompt");
  expect(JSON.stringify(session.messages)).not.toContain("may have partially run");
  expect(await Bun.file(join(dirs.cwd, "uncertain-effect.txt")).text()).toBe("saved effect");
  await session.close();
  expect(await rawResults(saved.sessionId, true)).toMatchObject([
    { toolName: "write", isError: true },
  ]);
  const again = await createSession({ ...resumeOptions(saved.sessionId), ...fakeModel([]) });
  expect(resultMessages(again)).toEqual([]);
});

test("real Compaction retains full uncertain history without reviving compacted context or duplicating its result", async () => {
  dirs = await tempDirs();
  const saved = await crashUnsafeEffect(dirs.cwd, false, {
    completedReads: true,
    priorTurns: [{ prompt: "retained large turn ".repeat(9000), reply: "large reply" }],
  });
  const fake = fakeModel([
    fauxAssistantMessage("inspected uncertain effect"),
    fauxAssistantMessage("Prior history summarized; preserve uncertain effect for inspection."),
    fauxAssistantMessage("continued"),
  ]);
  const session = await createSession({ ...resumeOptions(saved.sessionId), ...fake });
  await settle(session);
  await session.compact();
  expect(resultMessages(session).find((result) => result.toolName === "write")).toMatchObject({
    outcomeUnknown: true,
  });
  // The chronological Transcript retains every real receipt; only the provider context is compacted.
  expect(resultMessages(session)).toHaveLength(3);
  await runRequest(session, "check current state");
  expect(JSON.stringify(fake.contexts.at(-1)!.messages)).toContain("Prior history summarized");
  expect(JSON.stringify(fake.contexts.at(-1)!.messages)).not.toContain("real-success");
  expect(JSON.stringify(fake.contexts.at(-1)!.messages)).not.toContain("real-failure");
  expect(
    fake.contexts
      .at(-1)!
      .messages.filter((message) => message.role === "toolResult" && message.toolName === "write"),
  ).toHaveLength(1);
  const snapshot = structuredClone([...session.messages]);
  await session.close();
  const stored = await rawResults(saved.sessionId, true);
  expect(stored).toHaveLength(3);
  expect(stored.map((message) => message.toolName).sort()).toEqual(["read", "read", "write"]);
  const again = await createSession({ ...resumeOptions(saved.sessionId), ...fakeModel([]) });
  expect([...again.messages]).toEqual(snapshot);
  expect(resultMessages(again)).toHaveLength(1);
});

test("replayed safe delegation uses current authorization and never creates a second child after its receipt was lost", async () => {
  dirs = await tempDirs();
  const saved = await crashSafeDelegation(dirs.cwd);
  if (!saved.childId) throw new Error("Accepted child identity missing");
  const reply = () => fauxAssistantMessage("finish accepted work");
  const fake = fakeModel(Array.from({ length: 8 }, () => reply));
  const events: import("../../src/index.ts").SessionEvent[] = [];
  const session = await createSession({
    ...resumeOptions(saved.sessionId),
    ...fake,
    settings: { permissions: { deny: ["subagent"] } },
    onPermissionAsk: async () => {
      throw new Error("Explicit denial must never ask");
    },
  });
  session.subscribe((event) => events.push(event));
  await settle(session);
  expect(
    session.messages.find(
      (message) => message.role === "toolResult" && message.toolName === "subagent",
    ),
  ).toMatchObject({
    isError: true,
    content: [{ type: "text", text: expect.stringContaining("Denied by permission rule") }],
  });
  expect(session.toolState("subagents")).toMatchObject([{ id: saved.childId, active: false }]);
  expect(events.filter((event) => event.type === "permission_denied")).toMatchObject([
    { by: "rule", rule: "subagent" },
  ]);
  expect(
    session.messages.filter(
      (message) => message.role === "toolResult" && message.toolName === "subagent",
    ),
  ).toHaveLength(1);
});
