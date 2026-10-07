import { expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createSession } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

test("a Session commits input, real file tool output and final answer before becoming idle", async () => {
  const dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("write", { path: "hello.txt", content: "hello durable" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage(fauxToolCall("read", { path: "hello.txt" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("saved and read hello durable"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  try {
    const result = await session.run("write hello.txt then read it");
    await session.waitForIdle();
    expect(result.text).toBe("saved and read hello durable");
    expect(session.running).toBe(false);
    expect(await Bun.file(`${dirs.cwd}/hello.txt`).text()).toBe("hello durable");
    expect(session.messages.filter((message) => message.role === "toolResult")).toMatchObject([
      { role: "toolResult", toolName: "write", isError: false },
      { role: "toolResult", toolName: "read", content: [{ type: "text", text: "hello durable" }] },
    ]);
  } finally {
    await session.dispose();
    await dirs.cleanup();
  }
});
