import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { realpath, symlink } from "node:fs/promises";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test.each(["ask", "full-access"] as const)(
  "read path deny blocks sensitive content and symlink aliases in %s",
  async (permissionMode) => {
    dirs = await tempDirs();
    dirs.cwd = await realpath(dirs.cwd);
    dirs.homeDir = await realpath(dirs.homeDir);
    const secret = join(dirs.homeDir, ".ssh", "key");
    await Bun.write(secret, "private-key-do-not-expose");
    await symlink(join(dirs.homeDir, ".ssh"), join(dirs.cwd, "linked"));
    const fake = fakeModel([
      fauxAssistantMessage(
        [
          fauxToolCall("read", { path: secret }, { id: "direct" }),
          fauxToolCall("read", { path: "linked/key" }, { id: "linked" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    const events: SessionEvent[] = [];
    let asks = 0;
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode,
      settings: { permissions: { deny: ["read(~/.ssh/**)"], allow: ["read"] } },
      onPermissionAsk: async () => {
        asks++;
        return "allow";
      },
    });
    await session.run("read", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(asks).toBe(0);
    expect(events.filter((event) => event.type === "permission_denied")).toMatchObject([
      { toolCallId: "direct", by: "rule", rule: "read(~/.ssh/**)" },
      { toolCallId: "linked", by: "rule", rule: "read(~/.ssh/**)" },
    ]);
    expect(
      fake.contexts[1]!.messages.filter((message) => message.role === "toolResult"),
    ).toMatchObject([
      {
        isError: true,
        content: [{ type: "text", text: "Denied by permission rule: read(~/.ssh/**)" }],
      },
      {
        isError: true,
        content: [{ type: "text", text: "Denied by permission rule: read(~/.ssh/**)" }],
      },
    ]);
    expect(JSON.stringify(fake.contexts[1]!.messages)).not.toContain("private-key-do-not-expose");
  },
);

test("project write allow grants local paths but still asks before an external symlink target", async () => {
  dirs = await tempDirs();
  dirs.cwd = await realpath(dirs.cwd);
  dirs.homeDir = await realpath(dirs.homeDir);
  await symlink(dirs.homeDir, join(dirs.cwd, "external"));
  const fake = fakeModel([
    fauxAssistantMessage(
      [
        fauxToolCall("write", { path: "local/new.txt", content: "allowed" }, { id: "local" }),
        fauxToolCall(
          "write",
          { path: "external/missing/deep/no.txt", content: "blocked" },
          { id: "external" },
        ),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  const asks: string[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: { permissions: { allow: [`write(${dirs.cwd}/**)`] } },
    onPermissionAsk: async (request) => {
      asks.push(request.toolCallId);
      return "deny";
    },
  });
  await session.run("write");
  expect(asks).toEqual(["external"]);
  expect(await Bun.file(join(dirs.cwd, "local/new.txt")).text()).toBe("allowed");
  expect(await Bun.file(join(dirs.homeDir, "missing/deep/no.txt")).exists()).toBe(false);
  expect(
    fake.contexts[1]!.messages.filter((message) => message.role === "toolResult"),
  ).toMatchObject([
    { toolCallId: "local", isError: false },
    { toolCallId: "external", isError: true },
  ]);
});

test.each(["glob", "grep"])("%s path denial applies to its omitted cwd path", async (toolName) => {
  dirs = await tempDirs();
  const rule = `${toolName}(.)`;
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall(toolName, { pattern: "*" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: { permissions: { deny: [rule] } },
  });
  await session.run("search", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(events.filter((event) => event.type === "permission_denied")).toMatchObject([
    { toolName, by: "rule", rule },
  ]);
  expect(
    fake.contexts[1]!.messages.filter((message) => message.role === "toolResult"),
  ).toMatchObject([
    { isError: true, content: [{ type: "text", text: `Denied by permission rule: ${rule}` }] },
  ]);
});

test("path ask sees the project alias even in full-access and does not expose read contents", async () => {
  dirs = await tempDirs();
  await Bun.write(join(dirs.homeDir, "outside.txt"), "unapproved-content");
  await symlink(dirs.homeDir, join(dirs.cwd, "external"));
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("read", { path: "external/outside.txt" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  let asks = 0;
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: { permissions: { ask: ["read(external/**)"] } },
    onPermissionAsk: async (request) => {
      asks++;
      expect(request.reason).toBe("Permission rule: read(external/**)");
      return "deny";
    },
  });
  await session.run("read");
  expect(asks).toBe(1);
  expect(JSON.stringify(fake.contexts[1]!.messages)).not.toContain("unapproved-content");
});
