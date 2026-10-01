import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { createSession, type PermissionAskRequest, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test("frontend can allow a tool call using its id, name, arguments and signal", async () => {
  dirs = await tempDirs();
  const args = { path: "allowed.txt", content: "approved content" };
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("write", args, { id: "write-ask" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    async onPermissionAsk(request) {
      expect(request).toEqual({
        toolCallId: "write-ask",
        toolName: "write",
        args,
        signal: expect.any(AbortSignal),
      });
      expect(request.signal.aborted).toBe(false);
      return "allow";
    },
  });
  expect(
    (
      await session.run("write a file", {
        onEvent: (event) => {
          events.push(event);
        },
      })
    ).text,
  ).toBe("done");
  expect(await Bun.file(join(dirs.cwd, "allowed.txt")).text()).toBe("approved content");
  expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
    role: "toolResult",
    toolCallId: "write-ask",
    isError: false,
  });
  expect(events.some((event) => event.type === "permission_denied")).toBe(false);
});

test("frontend denial blocks the tool, reports the denial and lets the model continue", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("write", { path: "denied.txt", content: "blocked" }, { id: "write-denied" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("recovered"),
  ]);
  const requests: PermissionAskRequest[] = [];
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    allowTools: ["bash"],
    async onPermissionAsk(request) {
      requests.push(request);
      return "deny";
    },
  });
  expect(
    (
      await session.run("try writing", {
        onEvent(event) {
          events.push(event);
        },
      })
    ).text,
  ).toBe("recovered");
  expect(requests.map((request) => request.toolName)).toEqual(["write"]);
  expect(events.filter((event) => event.type === "permission_denied")).toEqual([
    {
      type: "permission_denied",
      sessionId: session.id,
      toolCallId: "write-denied",
      toolName: "write",
    },
  ]);
  expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
    role: "toolResult",
    toolCallId: "write-denied",
    isError: true,
    content: [{ type: "text", text: "该工具未获授权: write" }],
  });
  expect(await Bun.file(join(dirs.cwd, "denied.txt")).exists()).toBe(false);
});

test.each(["pending", "allow", "reject"] as const)(
  "aborting a Run denies the pending question when the frontend response is %s",
  async (response) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("write", { path: "cancelled.txt", content: "blocked" }, { id: "write-abort" }),
        { stopReason: "toolUse" },
      ),
    ]);
    const asked = Promise.withResolvers<PermissionAskRequest>();
    const answer = Promise.withResolvers<"allow" | "deny">();
    const session = await createSession({
      ...dirs,
      ...fake,
      onPermissionAsk(request) {
        asked.resolve(request);
        if (response === "pending") return answer.promise;
        return new Promise<"allow" | "deny">((resolve, reject) => {
          request.signal.addEventListener(
            "abort",
            () => {
              if (response === "allow") resolve("allow");
              else reject(request.signal.reason);
            },
            { once: true },
          );
        });
      },
    });
    const controller = new AbortController();
    const events: SessionEvent[] = [];
    const run = session.run("try writing", {
      signal: controller.signal,
      onEvent(event) {
        events.push(event);
      },
    });
    void run.catch(() => {});
    const request = await asked.promise;
    controller.abort(new Error("cancel permission wait"));
    expect(request.signal.aborted).toBe(true);
    await expect(run).rejects.toThrow("cancel permission wait");
    expect(events.filter((event) => event.type === "permission_denied")).toEqual([
      {
        type: "permission_denied",
        sessionId: session.id,
        toolCallId: "write-abort",
        toolName: "write",
      },
    ]);
    expect(events.at(-1)).toMatchObject({ type: "result", success: false });
    answer.resolve("allow");
    expect(await Bun.file(join(dirs.cwd, "cancelled.txt")).exists()).toBe(false);
    const next = fakeModel([fauxAssistantMessage("continued")]);
    const resumed = await createSession({ ...dirs, ...next, resumeId: session.id });
    await resumed.run("continue");
    expect(
      next.contexts[0]!.messages.find(
        (message) => message.role === "toolResult" && message.toolCallId === "write-abort",
      ),
    ).toMatchObject({ role: "toolResult", isError: true });
  },
);

test.each(["options", "settings", "yolo"] as const)(
  "tools allowed through %s do not ask the frontend",
  async (mode) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("write", { path: "allowed.txt", content: "allowed" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    const permissions =
      mode === "options"
        ? { allowTools: ["wri?e"] }
        : mode === "settings"
          ? { settings: { allowTools: ["wri[st]e"] } }
          : { yolo: true };
    const requests: PermissionAskRequest[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      ...permissions,
      async onPermissionAsk(request) {
        requests.push(request);
        return "deny";
      },
    });
    await session.run("write");
    expect(await Bun.file(join(dirs.cwd, "allowed.txt")).text()).toBe("allowed");
    expect(requests).toEqual([]);
  },
);

test("read-only tools do not ask the frontend", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.cwd, "file.txt"), "visible content");
  await Bun.write(
    join(dirs.cwd, ".agents/skills/review/SKILL.md"),
    "---\nname: review\ndescription: Review changes\n---\nInspect the diff.\n",
  );
  const fake = fakeModel([
    fauxAssistantMessage(
      [
        fauxToolCall("read", { path: "file.txt" }),
        fauxToolCall("glob", { pattern: "*.txt" }),
        fauxToolCall("grep", { pattern: "visible", path: "file.txt" }),
        fauxToolCall("skill", { name: "review" }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  const requests: PermissionAskRequest[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    async onPermissionAsk(request) {
      requests.push(request);
      return "deny";
    },
  });
  await session.run("inspect");
  expect(
    fake.contexts[1]!.messages.filter((message) => message.role === "toolResult"),
  ).toMatchObject([
    { toolName: "read", isError: false },
    { toolName: "glob", isError: false },
    { toolName: "grep", isError: false },
    { toolName: "skill", isError: false },
  ]);
  expect(requests).toEqual([]);
});

test("allowing one call does not authorize later calls to the same tool", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall(
        "write",
        { path: "first.txt", content: "first" },
        {
          id: "first-write",
        },
      ),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(
      fauxToolCall(
        "write",
        { path: "second.txt", content: "second" },
        {
          id: "second-write",
        },
      ),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  const requests: PermissionAskRequest[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    async onPermissionAsk(request) {
      requests.push(request);
      return request.toolCallId === "first-write" ? "allow" : "deny";
    },
  });
  await session.run("write twice");
  expect(requests.map((request) => request.toolCallId)).toEqual(["first-write", "second-write"]);
  expect(await Bun.file(join(dirs.cwd, "first.txt")).text()).toBe("first");
  expect(await Bun.file(join(dirs.cwd, "second.txt")).exists()).toBe(false);
});
