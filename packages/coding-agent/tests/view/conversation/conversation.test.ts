import type { Provider } from "@earendil-works/pi-ai/models";
import { auxiliaryModels } from "../../tui/helpers/auxiliary-model";
import { readSessionNotice, sessionNoticeFromHook, assistantThinkingDuration } from "@rukie/agent";
const conversationFacts = { readSessionNotice, sessionNoticeFromHook, assistantThinkingDuration };
import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSession,
  type Session,
  type SessionEvent,
  type TranscriptMessage,
} from "@rukie/agent";
import { createConversation } from "../../../src/view/conversation/conversation";
import { controlledModel } from "../../tui/helpers/model";
import { fakeModel } from "../../tui/helpers/agent-fixtures";
import { fauxAssistantMessage, fauxToolCall, getCurrentSystemMessage } from "@earendil-works/pi-ai";

test("parent committed snapshots retain a completed child's observed transcript", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-child-view-"));
  let delegated = false;
  const fake = await fakeModel(
    Array.from({ length: 16 }, () => (context) => {
      const parent = getCurrentSystemMessage(context.messages)?.toolsAdded?.some(
        (tool) => tool.name === "subagent",
      );
      if (!parent) return fauxAssistantMessage("durable child closing output");
      if (!delegated) {
        delegated = true;
        return fauxAssistantMessage(
          fauxToolCall("subagent", {
            description: "Retained history",
            prompt: "record child evidence",
          }),
          { stopReason: "toolUse" },
        );
      }
      return fauxAssistantMessage("parent observed child");
    }),
  );
  const session = await createSession({ cwd: root, homeDir: root, ...fake });
  const conversation = createConversation(session, "faux/faux-1", conversationFacts);
  let childCommitted = false;
  let laterParentSnapshots = 0;
  const off = session.subscribe((event) => {
    if (
      event.type === "subagent_event" &&
      event.event.type === "message_end" &&
      event.event.messages.some((message) => message.role === "assistant")
    )
      childCommitted = true;
    if (event.type === "snapshot" && childCommitted) laterParentSnapshots++;
  });
  try {
    await session.run("delegate evidence");
    const requestId = session.currentRequestId;
    if (!requestId) throw new Error("Accepted request identity missing");
    await session.waitForRequest(requestId);
    expect(laterParentSnapshots).toBeGreaterThan(0);
    const rows = Object.values(conversation.getSnapshot().subagents);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.runOutcome).toBe("completed");
    expect(rows[0]!.output.map((block) => block.text)).toContain("durable child closing output");
  } finally {
    off();
    await conversation.stop();
    await session.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("conversation retains the latest 500 observed TPS samples and wires an actual Session Run", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-tps-"));
  const fake = controlledModel();
  let now = Date.UTC(2026, 9, 2);
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  let session: Session | undefined;
  let conversation: ReturnType<typeof createConversation> | undefined;
  const stream: Provider["streamSimple"] = (...args) => {
    const before = fake.calls.length;
    const stream = fake.provider.streamSimple(...args);
    if (fake.calls.length > before) {
      const call = fake.calls.at(-1)!;
      call.thinking("x");
      call.finish(1, before === 0 ? 10000 : 50);
    }
    return stream;
  };
  try {
    session = await createSession({
      cwd: root,
      homeDir: root,
      model: fake.model,
      models: auxiliaryModels(stream),
    });
    let observe: ((event: SessionEvent) => void) | undefined;
    const source = new Proxy(session, {
      get(target, key) {
        if (key === "subscribe")
          return (listener: (event: SessionEvent) => void) => {
            observe = listener;
            return target.subscribe(listener);
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    conversation = createConversation(source, "faux/faux-1", conversationFacts);
    const events: SessionEvent[] = [];
    let waitingForThinking = true;
    const advance = (event: SessionEvent) => {
      if (event.type === "run_start") waitingForThinking = true;
      const message =
        event.type === "message_start" || event.type === "message_update"
          ? event.message
          : undefined;
      if (
        waitingForThinking &&
        message?.role === "assistant" &&
        message.content.some((block) => block.type === "thinking" && block.thinking.length > 0)
      ) {
        waitingForThinking = false;
        now += 1000;
      }
    };
    session.subscribe((event) => {
      events.push(event);
      advance(event);
    });
    for (let run = 0; run < 501; run++) {
      if (run === 0) await session.run("first actual Run");
      else
        for (const saved of events) {
          // Reuse the public native event sequence at the Frontend's subscribed
          // Session boundary; retention does not require 500 filesystem lifecycles.
          const event: SessionEvent =
            saved.type === "result"
              ? { ...saved, usage: { ...saved.usage, output: 50 } }
              : saved.type === "message_end"
                ? {
                    ...saved,
                    messages: saved.messages.map((message): TranscriptMessage =>
                      message.role === "assistant"
                        ? { ...message, usage: { ...message.usage, output: 50, totalTokens: 51 } }
                        : message,
                    ),
                  }
                : saved;
          observe!(event);
          advance(event);
        }
      const samples = conversation.getSnapshot().tpsSamples;
      expect(samples).toHaveLength(Math.min(run + 1, 500));
      expect(samples.at(-1)).toEqual({ at: now, value: run === 0 ? 10000 : 50 });
      if (run === 499) expect(samples[0]!.value).toBe(10000);
    }
    const samples = conversation.getSnapshot().tpsSamples;
    expect(samples.every((sample) => sample.value === 50)).toBe(true);
    expect(samples[0]!.at).toBe(Date.UTC(2026, 9, 2) + 2000);
  } finally {
    try {
      await conversation?.stop();
      await session?.close();
    } finally {
      clock.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  }
});

test.each(["block", "abort"])(
  "submitted preview is local and removed after %s admission",
  async (ending) => {
    const root = await mkdtemp(join(tmpdir(), "rukie-input-preview-"));
    const fake = controlledModel();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const abortEntered = Promise.withResolvers<void>();
    const releaseAbort = Promise.withResolvers<void>();
    const session = await createSession({
      cwd: root,
      homeDir: root,
      ...fake,
      settings:
        ending === "block"
          ? {
              hooks: {
                UserPromptSubmit: [
                  {
                    hooks: [
                      {
                        type: "command",
                        command: `cat >/dev/null; printf '{"decision":"block","reason":"rejected input"}'`,
                      },
                    ],
                  },
                ],
              },
            }
          : undefined,
    });
    const source = new Proxy(session, {
      get(target, key) {
        if (key === "abort" && ending === "abort")
          return async () => {
            abortEntered.resolve();
            await releaseAbort.promise;
            return target.abort();
          };
        if (key === "run")
          return async (...args: Parameters<Session["run"]>) => {
            entered.resolve();
            await release.promise;
            args[1]?.signal?.throwIfAborted();
            return target.run(...args);
          };
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const conversation = createConversation(source, "faux/faux-1", conversationFacts);
    const settled = Promise.withResolvers<void>();
    let submitted = false;
    const off = conversation.subscribe(() => {
      if (submitted && !conversation.isRunning()) settled.resolve();
    });
    try {
      expect(conversation.submit("pending input")).toBe(true);
      submitted = true;
      await entered.promise;
      expect(conversation.getSnapshot().completed).toContainEqual(
        expect.objectContaining({ type: "message", text: "pending input", pending: true }),
      );
      expect(session.messages.some((message) => message.role === "user")).toBe(false);
      expect(conversation.submit("rejected busy input")).toBe(false);
      if (ending === "abort") conversation.interrupt();
      release.resolve();
      await settled.promise;
      expect(
        conversation
          .getSnapshot()
          .completed.some((entry) => entry.type === "message" && entry.pending),
      ).toBe(false);
      expect(session.messages.some((message) => message.role === "user")).toBe(false);
      expect(fake.calls).toHaveLength(0);
      if (ending === "abort") {
        await abortEntered.promise;
        let stopped = false;
        const stop = conversation.stop().then(() => {
          stopped = true;
        });
        await Promise.resolve();
        expect(stopped).toBe(false);
        releaseAbort.resolve();
        await stop;
        expect(stopped).toBe(true);
      }
    } finally {
      release.resolve();
      releaseAbort.resolve();
      off();
      await conversation.stop();
      await session.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
