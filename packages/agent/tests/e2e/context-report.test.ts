import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "bun:test";
import { createSession, type SessionEvent } from "../../src/index.ts";
import { fauxAssistantMessage, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { abortingModel } from "../helpers/aborting-model.ts";
import {
  withAuxiliaryRequests,
  withModelStream,
  withModelAlias,
} from "../helpers/auxiliary-model.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test("idle context reports configured instructions and tools without scheduling a model", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([]);
  const session = await createSession({ ...dirs, ...fake });
  try {
    const report = session.contextReport();
    const category = (name: string) => report.categories.find((item) => item.name === name)?.tokens;
    expect(category("system-prompt")).toBeGreaterThan(0);
    expect(category("system-tools")).toBeGreaterThan(0);
    expect(session.contextUsage().used).toBe(report.used);
    expect(fake.contexts).toHaveLength(0);
    expect(session.messages).toHaveLength(0);
  } finally {
    await session.close();
  }
});

async function memoryAndSkills() {
  await Bun.write(join(dirs.cwd, "AGENTS.md"), "Project policy");
  await Bun.write(join(dirs.homeDir, ".rukie/AGENTS.md"), "User policy");
  await Bun.write(
    join(dirs.cwd, ".agents/skills/review/SKILL.md"),
    "---\nname: review\ndescription: Inspect changes\n---\nReview instructions",
  );
  await Bun.write(
    join(dirs.cwd, ".agents/skills/plan/SKILL.md"),
    "---\nname: plan\ndescription: Plan work\n---\nPlan instructions",
  );
}

function countedModel(replies: string[], input: number, cacheRead = 0, cacheWrite = 0) {
  const fake = fakeModel([]);
  fake.models = withModelStream(
    fake.models,
    withAuxiliaryRequests(() => {
      const reply = fauxAssistantMessage(replies.shift()!);
      reply.usage = { ...reply.usage, input, cacheRead, cacheWrite };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message: reply });
      stream.end(reply);
      return stream;
    }),
  );
  return fake;
}

test("context report separates actual memory files and skill catalog from messages and reserves twenty percent", async () => {
  dirs = await tempDirs();
  await memoryAndSkills();
  const fake = fakeModel([fauxAssistantMessage("answer")]);
  fake.model.contextWindow = 10000;
  const session = await createSession({ ...dirs, ...fake });
  try {
    await session.run("12345678");
    const before = structuredClone(session.messages);
    const requests = fake.contexts.length;
    const report = session.contextReport();
    expect(report).toMatchObject({ model: "faux/faux-1", window: 10000 });
    expect(report.memoryFiles.map((file) => file.path).sort()).toEqual(
      [join(dirs.homeDir, ".rukie/AGENTS.md"), join(dirs.cwd, "AGENTS.md")].sort(),
    );
    expect(report.skills.map((skill) => skill.name).sort()).toEqual(["plan", "review"]);
    const memoryTokens = report.memoryFiles.reduce((sum, file) => sum + file.tokens, 0);
    expect(memoryTokens).toBeGreaterThan(0);
    expect(report.categories).toContainEqual({ name: "memory-files", tokens: memoryTokens });
    expect(report.categories.find((row) => row.name === "messages")!.tokens).toBeGreaterThan(0);
    expect(report.categories).toContainEqual({ name: "compaction-reserve", tokens: 2000 });
    expect(report.categories).toContainEqual({
      name: "free-space",
      tokens: Math.max(0, 8000 - report.used),
    });
    expect(session.messages).toEqual(before);
    expect(fake.contexts).toHaveLength(requests);
  } finally {
    await session.close();
  }
});

test("context reports and context_usage share the latest response input including cache on resume", async () => {
  dirs = await tempDirs();
  const initial = await createSession({ ...dirs, ...countedModel(["small reply"], 1234, 9, 1) });
  await initial.run("first");
  await initial.close();
  const fake = abortingModel();
  fake.model.contextWindow = 8000;
  const session = await createSession({ ...dirs, ...fake, resumeId: initial.id });
  try {
    expect(session.contextReport().used).toBe(1244);
    expect(
      session.contextReport().categories.find((category) => category.name === "free-space")?.tokens,
    ).toBeGreaterThanOrEqual(0);
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
    expect(events.find((event) => event.type === "context_usage")?.used).toBe(1244);
    await session.abort();
    await expect(run).rejects.toThrow();
  } finally {
    await session.close();
  }
});

test("context report counts inline skill invocations and superseded memory snapshots once", async () => {
  dirs = await tempDirs();
  await memoryAndSkills();
  const session = await createSession({
    ...dirs,
    ...fakeModel([fauxAssistantMessage("first"), fauxAssistantMessage("second")]),
  });
  try {
    await session.run("/review inspect");
    const first = session.contextReport();
    await Bun.write(join(dirs.cwd, "AGENTS.md"), "Updated project policy");
    await session.run("next");
    const report = session.contextReport();
    expect(report.memoryFiles).toHaveLength(2);
    expect(
      report.memoryFiles.find((file) => file.path === join(dirs.cwd, "AGENTS.md"))!.tokens,
    ).toBeGreaterThan(
      first.memoryFiles.find((file) => file.path === join(dirs.cwd, "AGENTS.md"))!.tokens,
    );
    expect(report.categories.find((row) => row.name === "messages")!.tokens).toBeGreaterThan(
      first.categories.find((row) => row.name === "messages")!.tokens,
    );
    expect(report.skills).toEqual(first.skills);
    expect(JSON.stringify(session.messages)).toContain("Review instructions");
  } finally {
    await session.close();
  }
});

test("context reports use live response input and invalidate that count after manual compaction", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([]);
  let calls = 0;
  fake.models = withModelStream(
    fake.models,
    withAuxiliaryRequests(() => {
      const reply = fauxAssistantMessage(calls++ === 0 ? "reply" : "summary");
      reply.usage = { ...reply.usage, input: 700, cacheRead: 30, cacheWrite: 20, output: 5 };
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message: reply });
      stream.end(reply);
      return stream;
    }),
  );
  const session = await createSession({ ...dirs, ...fake });
  let observed: number | undefined;
  await session.run("work", {
    onEvent: (event) => {
      if (
        event.type === "message_end" &&
        event.entry.model?.some((message) => message.role === "assistant")
      )
        observed = session.contextReport().used;
    },
  });
  expect(observed).toBe(750);
  expect(session.contextReport().used).toBe(750);
  await session.run("recent retained task " + "retained fact ".repeat(6000));
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
  await session.close();
});

test("context reports use the newly selected model window and clear counts from the previous model", async () => {
  dirs = await tempDirs();
  const previousKey = process.env.RUKIE_CONTEXT_REPORT_KEY;
  process.env.RUKIE_CONTEXT_REPORT_KEY = "test-key";
  try {
    const fake = countedModel(["old"], 1234);
    fake.models = withModelAlias(fake.models, "report", ["large"], { contextWindow: 1000000 });
    const session = await createSession({ ...dirs, ...fake });
    await session.run("work");
    expect(session.contextReport().used).toBe(1234);
    await session.setModelSelection({ model: "report/large" });
    expect(session.contextReport()).toMatchObject({
      model: "report/large",
      window: 1000000,
    });
    expect(session.contextReport().used).not.toBe(1234);
    expect(session.contextReport().categories).toContainEqual({
      name: "compaction-reserve",
      tokens: 200000,
    });
    await session.close();
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
  await session.reconnectMcp("team__docs");
  await session.run("refresh");
  const current = session.contextReport().mcpTools;
  expect(current).toMatchObject([{ server: "team__docs", name: "find__item" }]);
  await session.close();
  const resumed = await createSession({ ...dirs, ...fakeModel([]), resumeId: session.id });
  expect(resumed.contextReport().mcpTools).toEqual(current);
  expect(resumed.contextReport().mcpTools[0]?.server).toBe("team__docs");
  await resumed.close();
});
