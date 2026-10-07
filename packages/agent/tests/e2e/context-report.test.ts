import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "bun:test";
import { MemorySessionRepo } from "@earendil-works/pi-agent-core/harness/session";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fauxAssistantMessage, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { abortingModel } from "../helpers/aborting-model.ts";
import { withAuxiliaryRequests } from "../helpers/auxiliary-model.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

async function seed(messages: AgentMessage[]) {
  const store = new MemorySessionRepo();
  const stored = await store.create({}, BACKGROUND_CONTEXT);
  const branch = await stored.createBranch("main", null, BACKGROUND_CONTEXT);
  for (const message of messages) await branch.appendMessage(message, BACKGROUND_CONTEXT);
  await stored.close(BACKGROUND_CONTEXT);
  return { store, resumeId: stored.metadata.id };
}

test("context report separates current memory files and skill catalog from messages and reserves twenty percent", async () => {
  dirs = await tempDirs();
  const history: AgentMessage[] = [
    { role: "system", content: "abcdefgh", timestamp: 0 },
    {
      role: "system-reminder",
      source: "project-instructions",
      content: "Project Instructions (/project/AGENTS.md):\nabcd",
      timestamp: 1,
    },
    {
      role: "system-reminder",
      source: "user-instructions",
      content: "Project Instructions (/home/.rukie/AGENTS.md):\nefghijkl",
      timestamp: 2,
    },
    {
      role: "system-reminder",
      source: "skills",
      content: "Available skills:\n- review: Inspect\n- plan: Plan",
      timestamp: 3,
    },
    { role: "user", content: "12345678", timestamp: 4 },
    { role: "system-reminder", source: "fixture", content: "1234", timestamp: 5 },
  ];
  const fake = fakeModel([]);
  fake.model.contextWindow = 1000;
  const session = await createSession({ ...dirs, ...fake, ...(await seed(history)) });
  const before = structuredClone(session.messages);
  const report = session.contextReport();
  expect(report).toMatchObject({ model: "faux/faux-1", window: 1000, used: 43 });
  expect(report.memoryFiles).toEqual([
    { path: "/home/.rukie/AGENTS.md", tokens: 14 },
    { path: "/project/AGENTS.md", tokens: 12 },
  ]);
  expect(report.skills).toEqual([
    { name: "review", tokens: 5 },
    { name: "plan", tokens: 3 },
  ]);
  expect(report.categories).toContainEqual({ name: "memory-files", tokens: 26 });
  expect(report.categories).toContainEqual({ name: "messages", tokens: 3 });
  expect(report.categories).toContainEqual({ name: "compaction-reserve", tokens: 200 });
  expect(report.categories).toContainEqual({ name: "free-space", tokens: 757 });
  expect(session.messages).toEqual(before);
  expect(fake.contexts).toHaveLength(0);
});

test("context reports and context_usage share the latest response input including cache on resume", async () => {
  dirs = await tempDirs();
  const reply = fauxAssistantMessage("small reply");
  reply.usage = { ...reply.usage, input: 1234, cacheRead: 9, cacheWrite: 1, output: 5000 };
  const fake = abortingModel();
  fake.model.contextWindow = 1000;
  const session = await createSession({
    ...dirs,
    ...fake,
    ...(await seed([{ role: "system", content: "abcd", timestamp: 0 }, reply])),
  });
  expect(session.contextReport().used).toBe(1244);
  expect(session.contextReport().categories).toContainEqual({ name: "free-space", tokens: 0 });
  const events: SessionEvent[] = [];
  const run = session.run("next", {
    onEvent: (event) => {
      events.push(event);
    },
  });
  void run.catch(() => {});
  await fake.started;
  const before = structuredClone(session.messages);
  const count = events.length;
  expect(session.contextReport().used).toBe(1244);
  expect(session.messages).toEqual(before);
  expect(events).toHaveLength(count);
  const firstUsage = events.find((event) => event.type === "context_usage");
  expect(firstUsage?.used).toBe(1244);
  session.interruptRun();
  await expect(run).rejects.toThrow();
});

test("context reports replay current tool declarations and keep MCP servers containing separators intact", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([]);
  const session = await createSession({
    ...dirs,
    ...fake,
    ...(await seed([
      {
        role: "system",
        content: "",
        timestamp: 0,
        toolsAdded: [
          { name: "mcp__team__docs__old", description: "old tool", parameters: {} },
          {
            name: "subagent",
            description: "Available types:\nexplore: Read-only\nbuilder: Build",
            parameters: {},
          },
        ],
      },
      {
        role: "system",
        content: "",
        timestamp: 1,
        toolsRemoved: [{ name: "mcp__team__docs__old" }],
        toolsAdded: [
          { name: "mcp__team__docs__find__item", description: "current tool", parameters: {} },
        ],
      },
      {
        role: "system-reminder",
        source: "mcp",
        content: "MCP servers:\nteam__docs:\nTools: mcp__team__docs__find__item",
        timestamp: 2,
      },
    ])),
  });
  const report = session.contextReport();
  expect(report.mcpTools).toEqual([{ server: "team__docs", name: "find__item", tokens: 21 }]);
  expect(report.agentTypes).toEqual([
    { name: "explore", tokens: 5 },
    { name: "builder", tokens: 4 },
  ]);
  expect(report.categories).toContainEqual({ name: "system-prompt", tokens: 0 });
  expect(report.categories).toContainEqual({ name: "mcp-tools", tokens: 21 });
  expect(
    report.categories.find((category) => category.name === "system-tools")!.tokens,
  ).toBeGreaterThan(0);
});

test("context report counts inline skill invocations and superseded memory snapshots once", async () => {
  dirs = await tempDirs();
  const invocation = {
    role: "user" as const,
    content: "abcdefgh",
    timestamp: 3,
    skillInvocation: "12345678",
  };
  const session = await createSession({
    ...dirs,
    ...fakeModel([]),
    ...(await seed([
      { role: "system", content: "", timestamp: 0 },
      {
        role: "system-reminder",
        source: "project-instructions",
        content: "Project Instructions (/project/AGENTS.md):\nold!",
        timestamp: 1,
      },
      {
        role: "system-reminder",
        source: "project-instructions",
        content: "Project Instructions (/project/AGENTS.md):\nnew!",
        timestamp: 2,
      },
      invocation,
    ])),
  });
  const report = session.contextReport();
  expect(report.memoryFiles).toEqual([{ path: "/project/AGENTS.md", tokens: 12 }]);
  // Old file snapshot 12 + user text 2 + wrapped invocation 12.
  expect(report.categories).toContainEqual({ name: "messages", tokens: 26 });
});

test("context reports use live response input and invalidate that count after manual compaction", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([]);
  let calls = 0;
  fake.streamFn = withAuxiliaryRequests(() => {
    const reply = fauxAssistantMessage(calls++ === 0 ? "reply" : "summary");
    reply.usage = { ...reply.usage, input: 700, cacheRead: 30, cacheWrite: 20, output: 9000 };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: "stop", message: reply });
    stream.end(reply);
    return stream;
  });
  const session = await createSession({ ...dirs, ...fake });
  let observed: number | undefined;
  await session.run("work", {
    onEvent: (event) => {
      if (event.type === "message_end" && event.message.role === "assistant")
        observed = session.contextReport().used;
    },
  });
  expect(observed).toBe(750);
  expect(session.contextReport().used).toBe(750);
  await session.compact();
  expect(session.contextReport().used).not.toBe(750);
  expect(session.contextReport().used).toBe(
    session
      .contextReport()
      .categories.filter(
        (category) => !["free-space", "compaction-reserve"].includes(category.name),
      )
      .reduce((sum, category) => sum + category.tokens, 0),
  );
});

test("context reports use the newly selected model window and clear counts from the previous model", async () => {
  dirs = await tempDirs();
  const previousKey = process.env.RUKIE_CONTEXT_REPORT_KEY;
  process.env.RUKIE_CONTEXT_REPORT_KEY = "test-key";
  try {
    const session = await createSession({
      ...dirs,
      ...fakeModel([]),
      settings: {
        providers: [
          {
            id: "report",
            api: "openai-completions",
            baseUrl: "http://localhost:1/v1",
            apiKeyEnv: "RUKIE_CONTEXT_REPORT_KEY",
            models: [{ id: "large", contextWindow: 1000000 }],
          },
        ],
      },
      ...(await seed([
        { role: "system", content: "abcd", timestamp: 0 },
        {
          ...fauxAssistantMessage("old"),
          usage: {
            input: 1234,
            cacheRead: 0,
            cacheWrite: 0,
            output: 1,
            totalTokens: 1235,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
        },
      ])),
    });
    expect(session.contextReport().used).toBe(1234);
    await session.setModel("report/large");
    expect(session.contextReport()).toMatchObject({
      model: "report/large",
      window: 1000000,
      used: 2,
    });
    expect(session.contextReport().categories).toContainEqual({
      name: "compaction-reserve",
      tokens: 200000,
    });
  } finally {
    if (previousKey === undefined) delete process.env.RUKIE_CONTEXT_REPORT_KEY;
    else process.env.RUKIE_CONTEXT_REPORT_KEY = previousKey;
  }
});

test("context reports rediscovered MCP definitions and restores exact server identities after resume", async () => {
  dirs = await tempDirs();
  const manifest = join(dirs.homeDir, "manifest.json");
  await Bun.write(manifest, JSON.stringify({ tools: ["old"], instructions: "Inspect widgets." }));
  await Bun.write(
    join(dirs.homeDir, ".rukie/mcp.json"),
    JSON.stringify({
      mcpServers: {
        team__docs: {
          command: process.execPath,
          args: [fileURLToPath(new URL("../helpers/mcp-server.ts", import.meta.url))],
          env: {
            MCP_MANIFEST: manifest,
            MCP_PIDS: join(dirs.homeDir, "pids"),
            MCP_CALLS: join(dirs.homeDir, "calls"),
          },
        },
      },
    }),
  );
  const session = await createSession({
    ...dirs,
    ...fakeModel([fauxAssistantMessage("first"), fauxAssistantMessage("second")]),
  });
  await session.run("inspect");
  expect(session.contextReport().mcpTools).toMatchObject([{ server: "team__docs", name: "old" }]);
  await Bun.write(
    manifest,
    JSON.stringify({ tools: ["find__item"], instructions: "Inspect widgets." }),
  );
  await session.run("refresh");
  const current = session.contextReport().mcpTools;
  expect(current).toMatchObject([{ server: "team__docs", name: "find__item" }]);
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.contextReport().mcpTools).toEqual(current);
});
