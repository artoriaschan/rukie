import { runRequest } from "../helpers/crashed-subagents.ts";
import {
  withAuxiliaryRequests,
  modelStream,
  withModelStream,
  withModelAlias,
} from "../helpers/auxiliary-model.ts";
import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test.each([false, true])(
  "explore offers only read-only tools; question callback=%s",
  async (questions) => {
    dirs = await tempDirs();
    let tools: string[] = [];
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("subagent", {
          description: "Inspect",
          prompt: "inspect",
          subagent_type: "explore",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        tools = context.messages
          .flatMap((message) =>
            message.role === "system" ? (message.toolsAdded?.map((tool) => tool.name) ?? []) : [],
          )
          .sort();
        return fauxAssistantMessage("inspected");
      },
      fauxAssistantMessage("parent"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      ...(questions ? { onQuestion: async () => ({ answers: [] }) } : {}),
    });
    const result = await runRequest(session, "delegate");
    expect(result.success).toBe(true);
    expect(tools).toEqual(
      [
        "read",
        "glob",
        "grep",
        "skill",
        "todo_write",
        "web_fetch",
        ...(questions ? ["ask_user_question"] : []),
      ].sort(),
    );
  },
);

test("project custom type overrides home and built-in types, narrows tools and adds its system prompt", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.homeDir, ".claude/agents/explore.md"),
    "---\nname: explore\ndescription: Home explorer\n---\nHome body",
  );
  const path = join(dirs.cwd, ".agents/agents/explore.md");
  await Bun.write(
    path,
    "---\nname: explore\ndescription: Project explorer\ntools: [read, unknown, subagent]\n---\nProject body",
  );
  const warnings: string[] = [];
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Inspect",
        prompt: "inspect",
        subagent_type: "explore",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("child"),
    fauxAssistantMessage("parent"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    onWarning: (warning) => warnings.push(warning),
  });
  await runRequest(session, "delegate");
  const parent = fake.contexts[0]!;
  const child = fake.contexts[1]!;
  const description = parent.messages
    .flatMap((message) => (message.role === "system" ? (message.toolsAdded ?? []) : []))
    .findLast((tool) => tool.name === "subagent")?.description;
  expect(description).toContain("explore: Project explorer");
  expect(description).not.toContain("Home explorer");
  expect(
    child.messages.flatMap((message) =>
      message.role === "system" ? (message.toolsAdded?.map((tool) => tool.name) ?? []) : [],
    ),
  ).toEqual(["read"]);
  expect(JSON.stringify(child.messages.filter((message) => message.role === "system"))).toContain(
    "Project body",
  );
  expect(warnings).toEqual([
    `${path}: unknown tool "unknown" ignored.`,
    `${path}: unknown tool "subagent" ignored.`,
  ]);
});

test("each Run refreshes available types and bad files warn without preventing delegation", async () => {
  dirs = await tempDirs();
  const warnings: string[] = [];
  const fake = fakeModel([
    fauxAssistantMessage("first"),
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Custom",
        prompt: "work",
        subagent_type: "added",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("child"),
    fauxAssistantMessage("second"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    onWarning: (warning) => warnings.push(warning),
  });
  await runRequest(session, "first");
  const bad = join(dirs.cwd, ".rukie/agents/bad.md");
  await Bun.write(bad, "---\nname: bad\ntools: [read]\n---\nMissing description");
  await Bun.write(
    join(dirs.cwd, ".rukie/agents/added.md"),
    "---\nname: added\ndescription: Newly added\n---\nNew body",
  );
  const result = await runRequest(session, "second");
  expect(result.text).toBe("second");
  expect(fake.contexts).toHaveLength(4);
  const description = fake.contexts[1]!.messages.flatMap((message) =>
    message.role === "system" ? (message.toolsAdded ?? []) : [],
  ).findLast((tool) => tool.name === "subagent")?.description;
  expect(description).toContain("added: Newly added");
  expect(description).not.toContain("bad:");
  expect(warnings).toEqual([expect.stringContaining(`${bad}:`)]);
});

test("unknown subagent type reports its name and the available types", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Unknown",
        prompt: "work",
        subagent_type: "missing",
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("parent"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  await runRequest(session, "delegate");
  const result = fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult");
  expect(result).toMatchObject({
    isError: true,
    content: [
      {
        type: "text",
        text: expect.stringContaining(
          'Unknown subagent type "missing". Available types: general-purpose, explore.',
        ),
      },
    ],
  });
});

test.each(["parent", "settings", "type"])(
  "child model comes from %s at the configured priority",
  async (source) => {
    dirs = await tempDirs();
    const previous = process.env.RUKIE_SUBAGENT_MODEL_TEST_KEY;
    process.env.RUKIE_SUBAGENT_MODEL_TEST_KEY = "fake-key";
    try {
      await Bun.write(
        join(dirs.cwd, ".rukie/agents/custom.md"),
        `---\nname: custom\ndescription: Custom\n${source === "type" ? "model: local/type\n" : ""}---\nCustom body`,
      );
      const fake = fakeModel([
        fauxAssistantMessage(
          fauxToolCall("subagent", {
            description: "Custom",
            prompt: "work",
            subagent_type: "custom",
            run_in_background: false,
          }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("child"),
        fauxAssistantMessage("parent"),
      ]);
      const models: string[] = [];
      const session = await createSession({
        ...dirs,
        ...fake,
        settings: {
          ...(source !== "parent" ? { subagentModel: "local/settings" } : {}),
          providers: [
            {
              id: "local",
              api: "openai-completions",
              baseUrl: "http://127.0.0.1:1/v1",
              apiKeyEnv: "RUKIE_SUBAGENT_MODEL_TEST_KEY",
              models: [{ id: "settings" }, { id: "type" }],
            },
          ],
          thinking: "low",
        },
        models: withModelStream(
          withModelAlias(fake.models, "local", ["settings", "type"]),
          withAuxiliaryRequests((model, context, options) => {
            models.push(`${model.provider}/${model.id}`);
            return modelStream(fake.models)(fake.model, context, options);
          }),
        ),
      });
      await runRequest(session, "delegate");
      expect(models).toEqual([
        `${fake.model.provider}/${fake.model.id}`,
        source === "parent" ? `${fake.model.provider}/${fake.model.id}` : `local/${source}`,
        `${fake.model.provider}/${fake.model.id}`,
      ]);
    } finally {
      if (previous === undefined) delete process.env.RUKIE_SUBAGENT_MODEL_TEST_KEY;
      else process.env.RUKIE_SUBAGENT_MODEL_TEST_KEY = previous;
    }
  },
);

test.each(["type", "settings"])(
  "invalid %s model errors without a child request or model fallback",
  async (source) => {
    dirs = await tempDirs();
    await Bun.write(
      join(dirs.cwd, ".rukie/agents/custom.md"),
      `---\nname: custom\ndescription: Custom\n${source === "type" ? "model: missing/type\n" : ""}---\nBody`,
    );
    const fake = fakeModel([
      fauxAssistantMessage(
        fauxToolCall("subagent", {
          description: "Custom",
          prompt: "work",
          subagent_type: "custom",
          run_in_background: false,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("parent"),
    ]);
    const session = await createSession({
      ...dirs,
      ...fake,
      settings: { subagentModel: "missing/settings" },
    });
    await runRequest(session, "delegate");
    expect(fake.contexts).toHaveLength(2);
    expect(
      fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
    ).toMatchObject({
      isError: true,
      content: [{ type: "text", text: expect.stringContaining(`missing/${source}`) }],
    });
  },
);

test.each([
  "Body without frontmatter",
  "---\nname: [invalid]\ndescription: Bad\n---\nBody",
  "---\nname: bad\ndescription: Bad\ntools: read\n---\nBody",
  "---\nname: bad\ndescription: Bad\nmodel: 42\n---\nBody",
  "---\nname: [broken\n---\nBody",
])("malformed custom type is skipped with a path warning: %j", async (raw) => {
  dirs = await tempDirs();
  const path = join(dirs.homeDir, ".rukie/agents/bad.md");
  await Bun.write(path, raw);
  const warnings: string[] = [];
  const fake = fakeModel([fauxAssistantMessage("parent")]);
  const session = await createSession({
    ...dirs,
    ...fake,
    onWarning: (warning) => warnings.push(warning),
  });
  expect((await runRequest(session, "hello")).success).toBe(true);
  expect(warnings).toEqual([expect.stringContaining(`${path}:`)]);
  const description = fake.contexts[0]!.messages.flatMap((message) =>
    message.role === "system" ? (message.toolsAdded ?? []) : [],
  ).findLast((tool) => tool.name === "subagent")?.description;
  expect(description).toContain("general-purpose:");
  expect(description).not.toContain("bad:");
});

test("custom tools include connected parent MCP tools without initial false warnings", async () => {
  dirs = await tempDirs();
  const manifest = join(dirs.homeDir, "manifest.json");
  await Bun.write(manifest, JSON.stringify({ tools: ["echo"] }));
  await Bun.write(
    join(dirs.homeDir, ".rukie/mcp.json"),
    JSON.stringify({
      mcpServers: {
        local: {
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
  await Bun.write(
    join(dirs.cwd, ".rukie/agents/custom.md"),
    "---\nname: custom\ndescription: MCP explorer\ntools: [mcp__local__echo]\n---\nInspect MCP",
  );
  const warnings: string[] = [];
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "MCP",
        prompt: "inspect",
        subagent_type: "custom",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("child"),
    fauxAssistantMessage("parent"),
  ]);
  const childTools: string[][] = [];
  const session = await createSession({
    ...dirs,
    ...fake,
    onWarning: (warning) => warnings.push(warning),
  });
  await runRequest(session, "delegate", {
    onEvent(event) {
      if (
        event.type === "subagent_event" &&
        event.event.type === "agent_changed" &&
        Array.isArray(event.event.agent.tools)
      )
        childTools.push(event.event.agent.tools);
    },
  });
  expect(warnings).toEqual([]);
  expect(childTools).toEqual([["mcp__local__echo"]]);
});

test("fork is reserved for subagent_fork and a custom definition cannot create a restricted ordinary child", async () => {
  dirs = await tempDirs();
  const path = join(dirs.cwd, ".rukie/agents/fork.md");
  await Bun.write(
    path,
    "---\nname: fork\ndescription: Restricted custom fork\ntools: [read]\n---\nCustom fork body",
  );
  const warnings: string[] = [];
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Restricted",
        prompt: "inspect",
        subagent_type: "fork",
        run_in_background: false,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("parent answer"),
    fauxAssistantMessage("unexpected child accepted"),
  ]);
  const session = await createSession({
    ...dirs,
    ...fake,
    onWarning: (warning) => warnings.push(warning),
  });
  await runRequest(session, "delegate");
  expect(session.messages.findLast((message) => message.role === "toolResult")).toMatchObject({
    isError: true,
    content: [
      {
        type: "text",
        text: expect.stringContaining(
          'Unknown subagent type "fork". Available types: general-purpose, explore.',
        ),
      },
    ],
  });
  expect(session.toolState("subagents")).toBeUndefined();
  expect(warnings).toEqual([`${path}: name "fork" is reserved for subagent_fork.`]);
  const description = fake.contexts[0]!.messages.flatMap((message) =>
    message.role === "system" ? (message.toolsAdded ?? []) : [],
  ).find((tool) => tool.name === "subagent")?.description;
  expect(description).not.toContain("fork: Restricted custom fork");
});
