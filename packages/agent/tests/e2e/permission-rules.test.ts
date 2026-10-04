import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { PERMISSION_MODES } from "@neant/shared";
import { join } from "node:path";
import { createSession, loadSettings, type SessionEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test.each([...PERMISSION_MODES])(
  "deny rules override %s, read-only defaults and allowRules",
  async (permissionMode) => {
    dirs = await tempDirs();
    await Bun.write(join(dirs.cwd, "secret.txt"), "secret");
    const fake = fakeModel([
      fauxAssistantMessage(
        [
          fauxToolCall("read", { path: "secret.txt" }, { id: "read" }),
          fauxToolCall("bash", { command: "printf blocked > marker" }, { id: "bash" }),
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
      allowRules: ["*"],
      settings: { permissions: { deny: ["read", "bash(printf blocked*)"], allow: ["*"] } },
      onPermissionAsk: async () => {
        asks++;
        return "allow";
      },
    });
    await session.run("try", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(asks).toBe(0);
    expect(events.filter((event) => event.type === "permission_review")).toEqual([]);
    expect(events.filter((event) => event.type === "permission_denied")).toMatchObject([
      { toolCallId: "read", by: "rule", rule: "read" },
      { toolCallId: "bash", by: "rule", rule: "bash(printf blocked*)" },
    ]);
    expect(
      fake.contexts[1]!.messages.filter((message) => message.role === "toolResult"),
    ).toMatchObject([
      { isError: true, content: [{ type: "text", text: "Denied by permission rule: read" }] },
      {
        isError: true,
        content: [{ type: "text", text: "Denied by permission rule: bash(printf blocked*)" }],
      },
    ]);
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
  },
);

test.each([...PERMISSION_MODES])(
  "explicit ask overrides %s without review and accepts user permission",
  async (permissionMode) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("write", { path: "asked.txt", content: "approved" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    let asks = 0;
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode,
      settings: { permissions: { ask: ["write"], allow: ["*"] } },
      onPermissionAsk: async (request) => {
        asks++;
        expect(request.reason).toBe("Permission rule: write");
        return "allow";
      },
    });
    await session.run("write", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(asks).toBe(1);
    expect(events.filter((event) => event.type === "permission_review")).toEqual([]);
    expect(await Bun.file(join(dirs.cwd, "asked.txt")).text()).toBe("approved");
  },
);

test.each(["ask", "auto-review"] as const)(
  "allow bash rules skip interaction and review in %s",
  async (permissionMode) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("bash", { command: " printf approved > marker " }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    const events: SessionEvent[] = [];
    let asks = 0;
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode,
      settings: { permissions: { allow: ["bash(printf approved*)"] } },
      onPermissionAsk: async () => {
        asks++;
        return "deny";
      },
    });
    await session.run("write", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(asks).toBe(0);
    expect(events.filter((event) => event.type === "permission_review")).toEqual([]);
    expect(await Bun.file(join(dirs.cwd, "marker")).text()).toBe("approved");
  },
);

test.each([false, true])(
  "explicit rule ask denial records its source; frontend=%s",
  async (frontend) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("write", { path: "no.txt", content: "no" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      permissionMode: "full-access",
      settings: { permissions: { ask: ["write"] } },
      ...(frontend && { onPermissionAsk: async () => "deny" as const }),
    });
    await session.run("write", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(events.filter((event) => event.type === "permission_denied")).toMatchObject([
      { by: frontend ? "user" : "rule", ...(!frontend && { rule: "write" }) },
    ]);
    expect(await Bun.file(join(dirs.cwd, "no.txt")).exists()).toBe(false);
  },
);

test("batched reviews skip rule allow, ask, deny and invalid calls", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      [
        fauxToolCall("write", { path: "reviewed.txt", content: "reviewed" }, { id: "reviewed" }),
        fauxToolCall("bash", { command: "printf allowed > allowed" }, { id: "allowed" }),
        fauxToolCall("bash", { command: "printf asked > asked" }, { id: "asked" }),
        fauxToolCall("bash", { command: "printf denied > denied" }, { id: "denied" }),
        fauxToolCall("bash", {}, { id: "invalid" }),
        fauxToolCall("bash", { command: 42 }, { id: "coerced" }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("done"),
  ]);
  const main = fake.streamFn;
  let reviews = 0;
  fake.streamFn = (model, context, options) => {
    if (
      context.messages.some(
        (message) => message.role === "system" && JSON.stringify(message).includes("REVIEW_POLICY"),
      )
    ) {
      reviews++;
      return fakeModel([fauxAssistantMessage('{"risk":"low","decision":"allow"}')]).streamFn(
        model,
        context,
        options,
      );
    }
    return main(model, context, options);
  };
  const events: SessionEvent[] = [];
  const asks: string[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "auto-review",
    settings: {
      permissions: {
        allow: ["bash(printf allowed*)"],
        ask: ["bash(printf asked*)"],
        deny: ["bash(printf denied*)", "bash(42)"],
      },
    },
    onPermissionAsk: async (request) => {
      asks.push(request.toolCallId);
      return "allow";
    },
  });
  await session.run("write", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(reviews).toBe(1);
  expect(asks).toEqual(["asked"]);
  expect(events.filter((event) => event.type === "permission_review")).toMatchObject([
    { phase: "start", toolCallId: "reviewed" },
    { phase: "end", toolCallId: "reviewed" },
  ]);
  expect(await Bun.file(join(dirs.cwd, "allowed")).text()).toBe("allowed");
  expect(await Bun.file(join(dirs.cwd, "asked")).text()).toBe("asked");
  expect(await Bun.file(join(dirs.cwd, "denied")).exists()).toBe(false);
  expect(
    fake.contexts[1]!.messages.filter((message) => message.role === "toolResult"),
  ).toMatchObject([
    { toolCallId: "reviewed", isError: false },
    { toolCallId: "allowed", isError: false },
    { toolCallId: "asked", isError: false },
    { toolCallId: "denied", isError: true },
    { toolCallId: "invalid", isError: true },
    { toolCallId: "coerced", isError: true },
  ]);
});

test.each([
  [false, '{"risk":"high","decision":"deny"}', "review"],
  [false, "invalid JSON", "review"],
  [true, '{"risk":"high","decision":"deny"}', "user"],
  [true, "invalid JSON", "user"],
] as const)("review outcome %s %s retains denial source %s", async (frontend, response, by) => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("write", { path: "no.txt", content: "no" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  const main = fake.streamFn;
  fake.streamFn = (model, context, options) =>
    context.messages.some(
      (message) => message.role === "system" && JSON.stringify(message).includes("REVIEW_POLICY"),
    )
      ? fakeModel([fauxAssistantMessage(response)]).streamFn(model, context, options)
      : main(model, context, options);
  const events: SessionEvent[] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "auto-review",
    ...(frontend && { onPermissionAsk: async () => "deny" as const }),
  });
  await session.run("write", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  expect(events.filter((event) => event.type === "permission_denied")).toMatchObject([{ by }]);
  expect(
    events
      .filter((event) => event.type === "permission_denied")
      .some((event) => event.rule !== undefined),
  ).toBe(false);
  expect(await Bun.file(join(dirs.cwd, "no.txt")).exists()).toBe(false);
});

test("session allowRules accepts bash specifiers without asking", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(fauxToolCall("bash", { command: "printf comma,a > marker" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("done"),
  ]);
  let asks = 0;
  const session = await createSession({
    ...dirs,
    ...fake,
    allowRules: ["bash(printf comma,a*)"],
    onPermissionAsk: async () => {
      asks++;
      return "deny";
    },
  });
  await session.run("do it");
  expect(asks).toBe(0);
  expect(await Bun.file(join(dirs.cwd, "marker")).text()).toBe("comma,a");
});

test("invalid session allowRules fail at startup with the --allow-tools source", async () => {
  dirs = await tempDirs();
  await expect(createSession({ ...dirs, allowRules: ["unknown(pattern)"] })).rejects.toMatchObject({
    code: "permission-rule-invalid",
    params: { source: "--allow-tools", rule: "unknown(pattern)" },
  });
});

test.each([
  [false, false],
  [false, true],
  [true, false],
])(
  "project allow and MCP share exact user trust; trusted=%s MCP override=%s",
  async (trusted, trustProjectMcp) => {
    dirs = await tempDirs();
    await Bun.write(
      join(dirs.homeDir, ".neant/settings.json"),
      JSON.stringify({ trustedProjects: trusted ? [dirs.cwd] : [] }),
    );
    await Bun.write(
      join(dirs.cwd, ".neant/settings.json"),
      JSON.stringify({
        trustedProjects: [dirs.cwd],
        permissions: { allow: ["bash(printf allowed*)"] },
      }),
    );
    await Bun.write(join(dirs.cwd, ".mcp.json"), JSON.stringify({ mcpServers: { project: {} } }));
    const { settings } = await loadSettings(dirs);
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("bash", { command: "printf allowed > marker" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    const events: SessionEvent[] = [];
    const session = await createSession({
      ...dirs,
      ...fake,
      settings,
      trustProjectMcp,
      onWarning: () => {},
    });
    await session.run("run", {
      onEvent: (event) => {
        events.push(event);
      },
    });
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(trusted);
    expect(events.filter((event) => event.type === "mcp_server_error")).toHaveLength(
      trusted || trustProjectMcp ? 1 : 0,
    );
  },
);
