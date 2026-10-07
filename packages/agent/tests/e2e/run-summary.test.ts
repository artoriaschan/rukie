import { expect, test } from "bun:test";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createSession } from "../../src";
import { fakeModel } from "../helpers/fake-model";
import { tempDirs } from "../helpers/temp-dirs";

test("Run summaries preserve completion facts and message boundaries across resume", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage("first reply"),
    fauxAssistantMessage("second reply"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  try {
    const first = await session.run("first prompt");
    const second = await session.run("second prompt");
    const summaries = session.runSummaries();
    expect(summaries).toHaveLength(2);
    for (const [index, result] of [first, second].entries()) {
      expect(summaries[index]).toMatchObject({
        durationMs: result.durationMs,
        endedAt: result.endedAt,
        success: true,
      });
      expect(session.messages[summaries[index]!.afterMessage - 1]!.role).toBe("assistant");
    }
    await session.dispose();
    const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
    try {
      expect(resumed.runSummaries()).toEqual(summaries);
      expect(JSON.stringify(resumed.messages)).not.toContain("run-summary");
      expect(fake.contexts).toHaveLength(2);
      await resumed.rewind(resumed.checkpoints()[1]!.promptEntryId, {
        code: false,
        conversation: true,
      });
      expect(resumed.runSummaries()).toEqual([summaries[0]!]);
    } finally {
      await resumed.dispose();
    }
  } finally {
    await session.dispose();
    await dirs.cleanup();
  }
});
