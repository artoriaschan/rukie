import { readSessionNotice, sessionNoticeFromHook, assistantThinkingDuration } from "@neant/agent";
const conversationFacts = { readSessionNotice, sessionNoticeFromHook, assistantThinkingDuration };
import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, type Session, type SessionEvent, type SessionOptions } from "@neant/agent";
import { createConversation } from "../../../src/view/conversation/conversation";
import { controlledModel } from "../../tui/helpers/model";

test("conversation retains the latest 500 observed TPS samples and wires an actual Session Run", async () => {
  const root = await mkdtemp(join(tmpdir(), "neant-tps-"));
  const fake = controlledModel();
  let now = Date.UTC(2026, 9, 2);
  const clock = spyOn(Date, "now").mockImplementation(() => now);
  let session: Session | undefined;
  let conversation: ReturnType<typeof createConversation> | undefined;
  const streamFn: NonNullable<SessionOptions["streamFn"]> = (...args) => {
    const before = fake.calls.length;
    const stream = fake.streamFn(...args);
    if (fake.calls.length > before) {
      const call = fake.calls.at(-1)!;
      call.thinking("x");
      call.finish(1, before === 0 ? 10000 : 50);
    }
    return stream;
  };
  try {
    session = await createSession({ cwd: root, homeDir: root, model: fake.model, streamFn });
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
    session.subscribe((event) => {
      events.push(event);
      if (event.type === "message_update" && event.assistantMessageEvent.type === "thinking_delta")
        now += 1000;
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
              : saved.type === "message_end" && saved.message.role === "assistant"
                ? {
                    ...saved,
                    message: {
                      ...saved.message,
                      usage: { ...saved.message.usage, output: 50, totalTokens: 51 },
                    },
                  }
                : saved;
          observe!(event);
          if (
            event.type === "message_update" &&
            event.assistantMessageEvent.type === "thinking_delta"
          )
            now += 1000;
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
      await session?.dispose();
    } finally {
      clock.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  }
});
