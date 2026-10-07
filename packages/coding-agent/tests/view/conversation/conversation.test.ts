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
