import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());
test.each(["new", "overwrite", "large"])(
  "write %s persists review facts and reproduces its diff on resume",
  async (mode) => {
    dirs = await tempDirs();
    const oldText =
      mode === "new"
        ? null
        : mode === "large"
          ? `${"unchanged\n".repeat(12000)}before\n`
          : "before\n";
    const content = mode === "large" ? `${"unchanged\n".repeat(12000)}after\n` : "after\n";
    if (oldText !== null) await Bun.write(join(dirs.cwd, "file.txt"), oldText);
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("write", { path: "file.txt", content }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    const events: SessionEvent[] = [];
    await session.run("write", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    const end = events.find((event) => event.type === "tool_execution_end");
    expect(end).toMatchObject({ view: { card: "diff", kind: "edit", displayKey: "tool.write" } });
    const result = session.messages.find((message) => message.role === "toolResult");
    if (mode === "large") {
      expect(result).toMatchObject({
        details: { patch: expect.stringContaining("-before\n+after") },
      });
      expect(JSON.stringify(result)).not.toContain("oldText");
      expect(JSON.stringify(result).length).toBeLessThan(3000);
    } else expect(result).toMatchObject({ details: { oldText, newText: content } });
    await session.close();
    const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
    expect(resumed.messages.find((message) => message.role === "toolResult")).toMatchObject({
      view: end?.type === "tool_execution_end" ? end.view : undefined,
    });
    await resumed.close();
  },
);
test("edit publishes pending replacements and the actual successful unified patch", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "file.txt"), "before\n");
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage(
        fauxToolCall("edit", {
          path: "file.txt",
          edits: [{ oldText: "before", newText: "after" }],
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]),
    permissionMode: "full-access",
  });
  const events: SessionEvent[] = [];
  await session.run("edit", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(events.find((event) => event.type === "tool_execution_start")).toMatchObject({
    view: {
      card: "diff",
      diffs: [{ path: join(dirs.cwd, "file.txt"), oldText: "before", newText: "after" }],
    },
  });
  expect(events.find((event) => event.type === "tool_execution_end")).toMatchObject({
    view: {
      card: "diff",
      diffs: [
        { path: join(dirs.cwd, "file.txt"), patch: expect.stringContaining("-before\n+after") },
      ],
    },
  });
  await session.close();
});

test("failed file tools preserve errors without claiming a successful diff", async () => {
  dirs = await tempDirs();
  const session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage(
        fauxToolCall("write", { path: ".", content: "cannot overwrite directory" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("edit", {
          path: "missing.txt",
          edits: [{ oldText: "before", newText: "after" }],
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("recovered"),
    ]),
    permissionMode: "full-access",
  });
  const events: SessionEvent[] = [];
  await session.run("try invalid files", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  const ends = events.filter((event) => event.type === "tool_execution_end");
  expect(ends).toHaveLength(2);
  for (const end of ends) {
    expect(end.result.isError).toBe(true);
    expect(end.view).toBeUndefined();
  }
  await session.close();
});
