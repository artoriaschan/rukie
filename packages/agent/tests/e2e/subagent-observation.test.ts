import { expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession } from "../../src";
import { fakeModel } from "../helpers/fake-model";
import { tempDirs } from "../helpers/temp-dirs";

test("read-only child snapshots preserve actual model, usage, outcome and ordered tools after parent resume without running", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Reader",
        prompt: "child",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("read", { path: "missing.txt" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("child result"),
    fauxAssistantMessage("parent result"),
  ]);
  const parent = await createSession({ ...dirs, ...fake });
  let id = "";
  try {
    await parent.run("delegate", {
      onEvent(event) {
        if (event.type === "subagent_event") id = event.agentId;
      },
    });
    const live = await parent.readSubagent(id);
    expect(live?.model).toBe("faux/faux-1");
    expect(live?.run?.outcome).toBe("completed");
    expect(live?.run?.tokens).toBeGreaterThan(0);
    expect(live?.run?.durationMs).toBeGreaterThanOrEqual(0);
    expect(
      live?.messages.some(
        (message) => message.role === "toolResult" && message.toolName === "read",
      ),
    ).toBe(true);
    await parent.dispose();
    const resumed = await createSession({ ...dirs, ...fake, resumeId: parent.id });
    try {
      const snapshot = await resumed.readSubagent(id);
      expect(snapshot?.messages).toEqual(live?.messages);
      expect(snapshot?.run).toEqual(live?.run);
      expect(resumed.running).toBe(false);
      expect(await resumed.readSubagent("unrelated-id")).toBeUndefined();
    } finally {
      await resumed.dispose();
    }
  } finally {
    await parent.dispose();
    await dirs.cleanup();
  }
});
