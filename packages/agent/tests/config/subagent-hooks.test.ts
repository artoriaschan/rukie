import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { discoverSubagentTypes } from "../../src/tools/subagents/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
afterEach(() => dirs?.cleanup());

test.each([".rukie", ".claude", ".agents"])(
  "home type hooks accept settings format and rename Stop: %s",
  async (namespace) => {
    dirs = await tempDirs();
    const stop = { hooks: [{ type: "command", command: "echo check" }] };
    const hooks = {
      Stop: [stop],
      SubagentStop: [{ hooks: [{ type: "command", command: "echo second" }] }],
      PreToolUse: [{ matcher: "read", hooks: [{ type: "command", command: "echo tool" }] }],
    };
    await Bun.write(
      join(dirs.homeDir, namespace, "agents/custom.md"),
      `---\n${JSON.stringify({ name: "custom", description: "Custom", hooks })}\n---\nCustom body`,
    );
    const discovered = await discoverSubagentTypes(dirs.cwd, dirs.homeDir, ["read"]);
    expect(discovered.types.get("custom")).toMatchObject({
      prompt: "Custom body",
      hooks: { SubagentStop: [stop, hooks.SubagentStop[0]], PreToolUse: hooks.PreToolUse },
    });
    expect(discovered.types.get("custom")?.hooks?.Stop).toBeUndefined();
    expect(discovered.warnings).toEqual([]);
  },
);

test.each([false, true])(
  "project type hooks require trust while the rest of the type still loads: %s",
  async (trusted) => {
    dirs = await tempDirs();
    const hooks = { Stop: [{ hooks: [{ type: "command", command: "echo project" }] }] };
    for (const namespace of [".rukie", ".claude", ".agents"]) {
      await Bun.write(
        join(dirs.cwd, namespace, "agents", `${namespace.slice(1)}.md`),
        `---\n${JSON.stringify({ name: namespace.slice(1), description: "Project type", hooks })}\n---\nProject body`,
      );
    }
    const discovered = await discoverSubagentTypes(dirs.cwd, dirs.homeDir, ["read"], { trusted });
    for (const name of ["rukie", "claude", "agents"]) {
      expect(discovered.types.get(name)).toMatchObject({
        description: "Project type",
        prompt: "Project body",
      });
      if (trusted)
        expect(discovered.types.get(name)?.hooks).toMatchObject({ SubagentStop: hooks.Stop });
      else expect(discovered.types.get(name)?.hooks).toBeUndefined();
    }
    expect(discovered.warnings).toHaveLength(trusted ? 0 : 3);
    if (!trusted)
      expect(discovered.hookWarnings).toMatchObject(
        Array.from({ length: 3 }, () => ({ error: { code: "hook-project-untrusted" } })),
      );
  },
);

test.each([
  { Unknown: [] },
  { Stop: [{ matcher: "[", hooks: [] }] },
  { Stop: [{ hooks: [{ type: "command", command: "echo", typo: true }] }] },
  { Stop: [{ hooks: [{ type: "command", command: "echo", if: "bash(" }] }] },
])("invalid home type hooks warn with their source and structured diagnostic", async (hooks) => {
  dirs = await tempDirs();
  const path = join(dirs.homeDir, ".rukie/agents/invalid.md");
  await Bun.write(
    path,
    `---\n${JSON.stringify({ name: "invalid", description: "Invalid", hooks })}\n---\nBody`,
  );
  const discovered = await discoverSubagentTypes(dirs.cwd, dirs.homeDir, []);
  expect(discovered.types.has("invalid")).toBe(false);
  expect(discovered.warnings).toEqual([expect.stringContaining(`${path}: /hooks`)]);
  expect(discovered.hookWarnings).toMatchObject([
    {
      error: {
        code: expect.stringMatching(
          /^hook-config-invalid|hook-matcher-invalid|permission-rule-invalid$/,
        ),
      },
    },
  ]);
});

test("untrusted invalid hooks are discarded before validation so they cannot hide the type", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, ".agents/agents/custom.md"),
    `---\nname: custom\ndescription: Custom\nhooks: { Unknown: broken }\n---\nBody`,
  );
  const discovered = await discoverSubagentTypes(dirs.cwd, dirs.homeDir, []);
  expect(discovered.types.get("custom")).toMatchObject({ prompt: "Body" });
  expect(discovered.warnings).toHaveLength(1);
});
