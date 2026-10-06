import { expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession, type Session, type SessionOptions } from "@neant/agent";
import { createConversation } from "../../../src/screens/chat/conversation";
import { controlledModel } from "../../helpers/model";

test("conversation retains the latest 500 TPS samples across real Session Runs", async () => {
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
    conversation = createConversation(session, "faux/faux-1");
    session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "thinking_delta")
        now += 1000;
    });
    for (let run = 0; run < 501; run++) {
      await session.run(`run ${run}`);
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
