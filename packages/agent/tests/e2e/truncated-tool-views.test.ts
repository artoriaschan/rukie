import { expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

const reads = [
  {
    mode: "lines",
    content: "line\n".repeat(2200),
    facts: { outputUnavailable: true, nextOffset: 2001 },
  },
  { mode: "oversized first line", content: "x".repeat(60000), facts: { outputUnavailable: true } },
  {
    mode: "notice-like file text",
    content: "[Showing lines 1-2000 of 2200. Use offset=2001 to continue.]",
    facts: {},
  },
];
test.each(reads)(
  "read $mode derives durable notices only from pi metadata",
  async ({ content, facts }) => {
    const dirs = await tempDirs();
    await Bun.write(`${dirs.cwd}/input.txt`, content);
    const session = await createSession({
      ...dirs,
      ...fakeModel([
        fauxAssistantMessage(fauxToolCall("read", { path: "input.txt" }), {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage("done"),
      ]),
    });
    let resumed: Awaited<ReturnType<typeof createSession>> | undefined;
    try {
      const events: SessionEvent[] = [];
      await session.run("read", {
        onEvent: (event) => {
          events.push(event);
        },
      });
      const end = events.find((event) => event.type === "tool_execution_end");
      expect(end).toMatchObject({ view: { card: "read", ...facts } });
      if (end?.type !== "tool_execution_end" || end.view?.card !== "read")
        throw new Error("Missing read view");
      if (!("nextOffset" in facts)) expect(end.view.nextOffset).toBeUndefined();
      if (!("outputUnavailable" in facts)) expect(end.view.outputUnavailable).toBeUndefined();
      const message = session.messages.find((item) => item.role === "toolResult");
      if (message?.role !== "toolResult") throw new Error("Missing committed tool result");
      expect(
        message.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n"),
      ).toBe(end.view.content);
      await session.close();
      await Bun.write(`${dirs.cwd}/input.txt`, "changed after read");
      resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
      expect(resumed.messages.find((item) => item.role === "toolResult")).toMatchObject({
        view: end.view,
      });
    } finally {
      await resumed?.close();
      await session.close();
      await dirs.cleanup();
    }
  },
);

test("bash preserves recovery path and model-visible text through Session Resume", async () => {
  const dirs = await tempDirs();
  const session = await createSession({
    ...dirs,
    permissionMode: "full-access",
    ...fakeModel([
      fauxAssistantMessage(
        fauxToolCall("bash", { command: "seq 1 2200", description: "Long output" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]),
  });
  let resumed: Awaited<ReturnType<typeof createSession>> | undefined;
  try {
    const events: SessionEvent[] = [];
    await session.run("run", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    const end = events.find((event) => event.type === "tool_execution_end");
    if (end?.type !== "tool_execution_end" || end.view?.card !== "terminal")
      throw new Error("Missing terminal view");
    expect(end.view.outputUnavailable).toBe(true);
    expect(end.view.fullOutputPath).toBeString();
    expect(end.view.output).toContain(`Full output: ${end.view.fullOutputPath}`);
    await session.close();
    resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
    expect(resumed.messages.find((item) => item.role === "toolResult")).toMatchObject({
      view: end.view,
    });
  } finally {
    await resumed?.close();
    await session.close();
    await dirs.cleanup();
  }
});
