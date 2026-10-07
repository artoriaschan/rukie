import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall, type JsonObject } from "@earendil-works/pi-ai";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { realpath, symlink, mkdir } from "node:fs/promises";
import {
  createSession as createSessionImpl,
  type Session,
  type SessionEvent,
} from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const sessions: Session[] = [];
async function createSession(options: Parameters<typeof createSessionImpl>[0]) {
  const session = await createSessionImpl(options);
  sessions.push(session);
  return session;
}
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await dirs?.cleanup();
});

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
        content: [
          {
            type: "text",
            text: "<harness>\n[error] Tool call blocked: Denied by permission rule: read(~/.ssh/**)\n</harness>",
          },
        ],
      },
      {
        isError: true,
        content: [
          {
            type: "text",
            text: "<harness>\n[error] Tool call blocked: Denied by permission rule: read(~/.ssh/**)\n</harness>",
          },
        ],
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
    {
      isError: true,
      content: [
        {
          type: "text",
          text: `<harness>\n[error] Tool call blocked: Denied by permission rule: ${rule}\n</harness>`,
        },
      ],
    },
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

test.each(["ask", "full-access"] as const)(
  "write cannot borrow a project allow through dangling symlink parent traversal in %s",
  async (permissionMode) => {
    dirs = await tempDirs();
    dirs.cwd = await realpath(dirs.cwd);
    dirs.homeDir = await realpath(dirs.homeDir);
    await mkdir(join(dirs.homeDir, "deep"));
    await symlink(join(dirs.homeDir, "deep"), join(dirs.cwd, "through"));
    await symlink("through/../leaf", join(dirs.cwd, "linked"));
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("write", { path: "linked", content: "unauthorized" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    const events: SessionEvent[] = [];
    const rule = "write(~/leaf)";
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode,
      settings: { permissions: { allow: ["write(./**)"], deny: [rule] } },
    });
    await session.run("write", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(events.filter((event) => event.type === "permission_denied")).toMatchObject([
      { toolName: "write", by: "rule", rule },
    ]);
    expect(await Bun.file(join(dirs.homeDir, "leaf")).exists()).toBe(false);
    expect(
      fake.contexts[1]!.messages.filter((message) => message.role === "toolResult"),
    ).toMatchObject([
      {
        isError: true,
        content: [
          {
            type: "text",
            text: `<harness>\n[error] Tool call blocked: Denied by permission rule: ${rule}\n</harness>`,
          },
        ],
      },
    ]);
  },
);

test("read @ absolute alias is denied before the actual secret is exposed", async () => {
  dirs = await tempDirs();
  const secret = join(dirs.homeDir, "private.txt");
  await Bun.write(secret, "alias-secret-content");
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("read", { path: `@${secret}` }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  const rule = `read(${secret})`;
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: { permissions: { deny: [rule] } },
  });
  await session.run("read", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(events.filter((event) => event.type === "permission_denied")).toMatchObject([
    { toolName: "read", by: "rule", rule },
  ]);
  expect(JSON.stringify(fake.contexts[1]!.messages)).not.toContain("alias-secret-content");
});

test.each(["glob", "grep"] as const)(
  "%s literal tilde target is denied at its real cwd location",
  async (tool) => {
    dirs = await tempDirs();
    const literal = join(dirs.cwd, "~/search");
    await Bun.write(join(literal, "secret.txt"), "literal-tilde-secret");
    await Bun.write(join(dirs.cwd, "public/visible.txt"), "public-content");
    const fake = fakeModel([
      fauxAssistantMessage(
        [
          fauxToolCall(
            tool,
            { path: "~/search", pattern: tool === "glob" ? "*" : "secret" },
            { id: "literal" },
          ),
          fauxToolCall(
            tool,
            { path: "public", pattern: tool === "glob" ? "*" : "public" },
            { id: "ordinary" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    const rule = `${tool}(${literal})`;
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: { permissions: { deny: [rule] } },
    });
    await session.run("search", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(events.filter((event) => event.type === "permission_denied")).toMatchObject([
      { toolCallId: "literal", by: "rule", rule },
    ]);
    expect(
      fake.contexts[1]!.messages.filter((message) => message.role === "toolResult"),
    ).toMatchObject([{ isError: true }, { isError: false }]);
  },
);

test("read selected file URL preserves encoded Unicode spaces during execution", async () => {
  dirs = await tempDirs();
  const selected = join(dirs.cwd, "name\u00A0key");
  const other = join(dirs.cwd, "name key");
  await Bun.write(selected, "selected-url-target");
  await Bun.write(other, "different-plain-target");
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("read", { path: pathToFileURL(selected).href }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("read");
  const result = fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult");
  expect(result).toMatchObject({
    isError: false,
    content: [{ type: "text", text: "selected-url-target" }],
  });
});

test.each(["read", "write", "edit"] as const)(
  "%s aliases cannot bypass a deny on the actual target",
  async (tool) => {
    dirs = await tempDirs();
    const secret = join(dirs.homeDir, "private/name key");
    await Bun.write(secret, "protected-file-content");
    const aliases = [
      `@${secret}`,
      pathToFileURL(secret).href,
      secret.replace("name key", "name\u00A0key"),
      "~/private/name key",
      secret,
    ];
    const args = (path: string): JsonObject =>
      tool === "read"
        ? { path }
        : tool === "write"
          ? { path, content: "changed" }
          : { path, edits: [{ oldText: "protected-file-content", newText: "changed" }] };
    const fake = fakeModel([
      fauxAssistantMessage(
        aliases.map((path, index) => fauxToolCall(tool, args(path), { id: `alias-${index}` })),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    const rule = `${tool}(~/private/**)`;
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      settings: { permissions: { deny: [rule] } },
    });
    await session.run("try", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(events.filter((event) => event.type === "permission_denied")).toHaveLength(5);
    expect(
      fake.contexts[1]!.messages.filter((message) => message.role === "toolResult"),
    ).toMatchObject(
      aliases.map(() => ({
        isError: true,
        content: [
          {
            type: "text",
            text: `<harness>\n[error] Tool call blocked: Denied by permission rule: ${rule}\n</harness>`,
          },
        ],
      })),
    );
    expect(await Bun.file(secret).text()).toBe("protected-file-content");
  },
);

test.each(["at", "file-url", "unicode-space", "home", "ordinary"] as const)(
  "%s file paths execute at the same target checked by permissions",
  async (spelling) => {
    dirs = await tempDirs();
    dirs.cwd = await realpath(dirs.cwd);
    dirs.homeDir = await realpath(dirs.homeDir);
    const target = join(dirs.homeDir, "public/name key");
    await Bun.write(target, "original");
    const path =
      spelling === "at"
        ? `@${target}`
        : spelling === "file-url"
          ? pathToFileURL(target).href
          : spelling === "unicode-space"
            ? target.replace("name key", "name\u202Fkey")
            : spelling === "home"
              ? "~/public/name key"
              : target;
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("read", { path }), { stopReason: "toolUse" }),
      fauxAssistantMessage(fauxToolCall("write", { path, content: "written" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(
        fauxToolCall("edit", { path, edits: [{ oldText: "written", newText: "edited" }] }),
        {
          stopReason: "toolUse",
        },
      ),
      fauxAssistantMessage("done"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: { permissions: { allow: ["write(~/public/**)", "edit(~/public/**)"] } },
    });
    await session.run("perform");
    expect(
      fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
    ).toMatchObject({
      isError: false,
      content: [{ type: "text", text: "original" }],
    });
    expect(
      fake.contexts[3]!.messages.filter((message) => message.role === "toolResult"),
    ).toMatchObject([{ isError: false }, { isError: false }, { isError: false }]);
    expect(await Bun.file(target).text()).toBe("edited");
  },
);

test("write selected file URL preserves encoded Unicode spaces during execution", async () => {
  dirs = await tempDirs();
  const selected = join(dirs.cwd, "name\u00A0key");
  const other = join(dirs.cwd, "name key");
  await Bun.write(selected, "selected-original");
  await Bun.write(other, "different-original");
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("write", { path: pathToFileURL(selected).href, content: "selected-written" }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await session.run("write");
  expect(await Bun.file(selected).text()).toBe("selected-written");
  expect(await Bun.file(other).text()).toBe("different-original");
});

test("read filename fallback resolves a symlink before project allow and external deny", async () => {
  dirs = await tempDirs();
  dirs.cwd = await realpath(dirs.cwd);
  dirs.homeDir = await realpath(dirs.homeDir);
  const secret = join(dirs.homeDir, "secret");
  await Bun.write(secret, "fallback-secret-content");
  await symlink(secret, join(dirs.cwd, "link\u2019file"));
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("read", { path: "link'file" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);
  const rule = "read(~/secret)";
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    settings: { permissions: { allow: ["read(./**)"], deny: [rule] } },
  });
  await session.run("read", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(events.filter((event) => event.type === "permission_denied")).toMatchObject([
    { by: "rule", rule },
  ]);
  expect(JSON.stringify(fake.contexts[1]!.messages)).not.toContain("fallback-secret-content");
});

test.each(["nfd", "curly", "ampm"] as const)(
  "read %s filename fallback selects and authorizes the actual file",
  async (spelling) => {
    dirs = await tempDirs();
    const requested =
      spelling === "nfd"
        ? "caf\u00E9.txt"
        : spelling === "curly"
          ? "name'file"
          : "capture 1 PM.png.txt";
    const actual =
      spelling === "nfd"
        ? requested.normalize("NFD")
        : spelling === "curly"
          ? requested.replace("'", "\u2019")
          : requested.replace(" PM.", "\u202FPM.");
    await Bun.write(join(dirs.cwd, actual), "fallback-selected");
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("read", { path: requested }), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);
    const session = await createSession({ ...dirs, ...fake });
    await session.run("read");
    expect(
      fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
    ).toMatchObject({
      isError: false,
      content: [{ type: "text", text: "fallback-selected" }],
    });
  },
);

test("missing reads and dangling primary symlinks keep errors instead of selecting another variant", async () => {
  dirs = await tempDirs();
  await symlink(join(dirs.cwd, "missing-target"), join(dirs.cwd, "link'file"));
  await Bun.write(join(dirs.cwd, "link\u2019file"), "must-not-use-fallback");
  const fake = fakeModel([
    fauxAssistantMessage(
      [fauxToolCall("read", { path: "missing" }), fauxToolCall("read", { path: "link'file" })],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await session.run("read");
  expect(
    fake.contexts[1]!.messages.filter((message) => message.role === "toolResult"),
  ).toMatchObject([{ isError: true }, { isError: true }]);
  expect(JSON.stringify(fake.contexts[1]!.messages)).not.toContain("must-not-use-fallback");
});
