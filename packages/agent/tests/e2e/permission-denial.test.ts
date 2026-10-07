import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createSession, type Session, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const sessions: Session[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await dirs?.cleanup();
});

test("permission denial retains typed rule facts live and cold despite repeated provider call IDs", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall(
        "bash",
        { description: "Denied command", command: "printf denied" },
        { id: "repeated" },
      ),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("first done"),
    fauxAssistantMessage(
      fauxToolCall(
        "bash",
        { description: "Allowed command", command: "printf allowed" },
        { id: "repeated" },
      ),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("second done"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: { permissions: { deny: ["bash(printf denied)"] } },
  });
  sessions.push(session);
  const events: SessionEvent[] = [];
  await session.run("denied", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  await session.run("allowed");
  const results = session.messages.filter((message) => message.role === "toolResult");
  expect(results).toHaveLength(2);
  expect(results[0]).toMatchObject({
    isError: true,
    permissionDenial: { by: "rule", rule: "bash(printf denied)" },
  });
  expect(results[1]).toMatchObject({ isError: false });
  expect(results[1] && "permissionDenial" in results[1]).toBe(false);
  expect(events.find((event) => event.type === "tool_execution_end")?.result).toMatchObject({
    permissionDenial: { by: "rule", rule: "bash(printf denied)" },
  });
  await session.close();
  const restored = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  sessions.push(restored);
  expect(restored.messages.filter((message) => message.role === "toolResult")).toEqual(results);
});

test("permission denial retains exact Hook provenance without parsing native error text", async () => {
  dirs = await tempDirs();
  const response = {
    hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason: "protected bytes" },
  };
  await Bun.write(
    `${dirs.cwd}/deny.sh`,
    `cat >/dev/null\nprintf '%s' '${JSON.stringify(response)}'\n`,
  );
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("bash", { description: "Denied command", command: "printf denied" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: { hooks: { PreToolUse: [{ hooks: [{ type: "command", command: "sh deny.sh" }] }] } },
  });
  sessions.push(session);
  const events: SessionEvent[] = [];
  await session.run("inspect", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  const denial = events.find((event) => event.type === "permission_denied");
  if (!denial || denial.type !== "permission_denied")
    throw new Error("Missing actual Hook denial.");
  expect(session.messages.find((message) => message.role === "toolResult")).toMatchObject({
    permissionDenial: { by: "hook", hook: denial.hook, reason: denial.reason },
  });
});
