import { expect, test } from "bun:test";
import { createToolLoadout, planToolDeclarationChanges } from "../../src/session/tools.ts";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import {
  Harness,
  MemoryStorage,
  createRegistry,
  defineTool,
  type ToolRegistration,
} from "@earendil-works/pi-durable";
import { toToolDeclaration, getCurrentTools } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { createJobs } from "../../src/tools/jobs/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";

const tool = (name: string, description = "Tool") =>
  defineTool({
    name,
    description,
    parameters: Type.Object({}),
    execute: async () => ({ content: [] }),
  });
async function fixture(input: {
  mcp: ToolRegistration[];
  allowed: string[];
  mode?: "auto" | "on" | "off";
  contextWindow?: number;
}) {
  const fake = fakeModel([]);
  const harness = await Harness.open(
    new MemoryStorage(),
    { models: fake.models, registry: createRegistry() },
    BACKGROUND_CONTEXT,
  );
  const jobs = createJobs();
  const conversation = await harness.root(BACKGROUND_CONTEXT);
  const loadout = createToolLoadout({
    kind: "child",
    builtin: () => ({
      cwd: "/tmp",
      homeDir: "/tmp",
      jobs,
      getSkill: () => undefined,
      setTodo: async () => {},
    }),
    allowed: input.allowed,
    conversation: () => conversation,
    history: async () =>
      (await conversation.entries({}, 100, undefined, BACKGROUND_CONTEXT)).items.toSorted(
        (a, b) => a.id - b.id,
      ),
    context: BACKGROUND_CONTEXT,
    model: () => ({ contextWindow: input.contextWindow ?? 100 }),
    mode: input.mode ?? "off",
    mcp: () => input.mcp,
    wrap: (tools) => [...tools],
  });
  await loadout.refresh();
  return {
    loadout,
    conversation,
    async close() {
      await jobs.dispose();
      await harness.close(BACKGROUND_CONTEXT);
    },
  };
}

test("child restrictions exclude tools before deferred planning", async () => {
  const f = await fixture({
    mcp: [tool("mcp__local__echo"), tool("subagent"), tool("create_goal"), tool("exit_plan_mode")],
    allowed: ["read", "mcp__local__echo", "subagent", "create_goal", "exit_plan_mode"],
    mode: "on",
  });
  try {
    const planned = await f.loadout.plan();
    expect(planned.tools.map((tool) => tool.name)).toEqual(["read", "mcp__local__echo"]);
    expect(planned.deferred).toEqual([]);
  } finally {
    await f.close();
  }
});

test.each([0, 1])(
  "auto deferral begins strictly above ten percent: extra %s declaration characters",
  async (extra) => {
    const empty = tool("mcp__local__echo", "");
    const candidate = tool(
      "mcp__local__echo",
      "x".repeat(40000 - JSON.stringify(toToolDeclaration(empty)).length + extra),
    );
    const f = await fixture({
      mcp: [candidate],
      allowed: ["read", "mcp__local__echo", "ToolSearch"],
      mode: "auto",
      contextWindow: 100000,
    });
    try {
      const planned = await f.loadout.plan();
      expect(planned.tools.map((tool) => tool.name)).toEqual(
        extra === 0 ? ["read", "mcp__local__echo"] : ["read", "ToolSearch"],
      );
      expect(planned.deferred.map((tool) => tool.name)).toEqual(
        extra === 0 ? [] : ["mcp__local__echo"],
      );
    } finally {
      await f.close();
    }
  },
);

test("authentication remains eager while ordinary MCP tools defer", async () => {
  const f = await fixture({
    mcp: [tool("mcp__local__echo"), tool("mcp__local__authenticate")],
    allowed: ["ToolSearch", "mcp__local__echo", "mcp__local__authenticate"],
    mode: "on",
  });
  try {
    const planned = await f.loadout.plan();
    expect(planned.tools.map((tool) => tool.name)).toEqual([
      "mcp__local__authenticate",
      "ToolSearch",
    ]);
    expect(planned.deferred.map((tool) => tool.name)).toEqual(["mcp__local__echo"]);
  } finally {
    await f.close();
  }
});

test("Transcript order survives refresh and changed declarations append a replacement", async () => {
  const input = { mcp: [tool("mcp__a"), tool("mcp__b")], allowed: ["read", "mcp__a", "mcp__b"] };
  const f = await fixture(input);
  try {
    await f.conversation.commit(
      (tx) =>
        tx.appendEntry(f.conversation.id, {
          kind: "baseline",
          model: [
            {
              role: "system",
              content: "",
              timestamp: 0,
              toolsAdded: [
                toToolDeclaration(input.mcp[1]!),
                toToolDeclaration(f.loadout.registrations[0]!),
                toToolDeclaration(input.mcp[0]!),
              ],
            },
          ],
        }),
      BACKGROUND_CONTEXT,
    );
    expect((await f.loadout.plan()).tools.map((tool) => tool.name)).toEqual([
      "mcp__b",
      "read",
      "mcp__a",
    ]);
    input.mcp[1] = tool("mcp__b", "Changed description");
    await f.loadout.refresh();
    expect((await f.loadout.plan()).tools.map((tool) => tool.name)).toEqual([
      "read",
      "mcp__a",
      "mcp__b",
    ]);
    await f.loadout.publish();
    const context = await f.conversation.context(BACKGROUND_CONTEXT);
    expect(getCurrentTools(context.messages).map((tool) => tool.name)).toEqual([
      "read",
      "mcp__a",
      "mcp__b",
    ]);
    expect(context.messages.findLast((message) => message.role === "system")).toMatchObject({
      toolsRemoved: [{ name: "mcp__b" }],
      toolsAdded: [{ name: "mcp__b", description: "Changed description" }],
    });
  } finally {
    await f.close();
  }
});

test("planning a new context reconstructs its baseline from complete branch history without retaining a discovery cache", async () => {
  const input = {
    mcp: [tool("mcp__a"), tool("mcp__b")],
    allowed: ["read", "mcp__a", "mcp__b", "ToolSearch"],
    mode: "on" as const,
  };
  const f = await fixture(input);
  try {
    await f.conversation.commit(
      (tx) =>
        tx.appendEntry(f.conversation.id, {
          kind: "discovered",
          model: [
            {
              role: "system",
              content: "",
              timestamp: 0,
              toolsAdded: [toToolDeclaration(input.mcp[1]!)],
            },
          ],
        }),
      BACKGROUND_CONTEXT,
    );
    await f.conversation.reset(undefined, BACKGROUND_CONTEXT);
    expect((await f.conversation.context(BACKGROUND_CONTEXT)).messages).toEqual([]);
    expect((await f.loadout.plan()).tools.map((tool) => tool.name)).toEqual([
      "mcp__b",
      "read",
      "ToolSearch",
    ]);
    expect((await f.loadout.plan(true)).tools.map((tool) => tool.name)).toEqual([
      "read",
      "ToolSearch",
    ]);
    input.mcp = [tool("mcp__a")];
    expect(f.loadout.hasMcpDrift()).toBe(true);
    await f.loadout.refresh();
    expect(f.loadout.hasMcpDrift()).toBe(false);
    expect((await f.loadout.plan()).deferred.map((tool) => tool.name)).toEqual(["mcp__a"]);
  } finally {
    await f.close();
  }
});

test("declaration deltas replace the complete baseline when append-only replay would change the requested order", () => {
  const a = toToolDeclaration(tool("a"));
  const b = toToolDeclaration(tool("b"));
  const c = toToolDeclaration(tool("c"));
  expect(planToolDeclarationChanges([a, b], [c, a])).toEqual({
    toolsRemoved: [{ name: "a" }, { name: "b" }],
    toolsAdded: [c, a],
  });
  expect(planToolDeclarationChanges([a, b], [a, c])).toEqual({
    toolsRemoved: [{ name: "b" }],
    toolsAdded: [c],
  });
  expect(planToolDeclarationChanges([a, b], [a, b])).toEqual({ toolsRemoved: [], toolsAdded: [] });
});
