import { afterEach, expect, test } from "bun:test";
import { isolateProxyEnvironment } from "../helpers/proxy-env.ts";
import { mkdir, mkdtemp, rm, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SettingsSchema } from "@neant/shared";
import { Value } from "typebox/value";
import { fakeOpenAI, type FakeOpenAIOptions } from "../helpers/fake-openai.ts";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { main as entryMain, type PrintIo } from "../../../src/index.ts";
function main(argv: string[], io: PrintIo) {
  return entryMain(
    argv.includes("--goal") || argv.includes("-p") || argv.includes("--print")
      ? argv
      : ["-p", ...argv],
    { env: { LANG: "en" }, ...io },
  );
}

import { withAuxiliaryRequests } from "../helpers/auxiliary-model.ts";

isolateProxyEnvironment();

const MAIN = join(import.meta.dir, "../../../src/main.ts");
const cleanups: (() => unknown)[] = [];

function parseEvents(stdout: string) {
  return stdout
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
}

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((f) => f()));
});

test.each([
  [[], false],
  [["--allow-tools", "web_fetch(domain:site.test)"], true],
  [["--permission-mode", "full-access"], true],
] as const)("Headless web_fetch permission flags %j: allowed=%s", async (flags, allowed) => {
  const root = await mkdtemp(join(tmpdir(), "neant-cli-web-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".neant", "file-history"), { recursive: true });
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      requests.push(request.url);
      return new Response("Public documentation");
    },
  });
  cleanups.push(() => server.stop(true));
  const url = `http://site.test:${server.port}/docs`;
  const faux = createFauxCore({ api: "faux", provider: "faux" });
  let observed = false;
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("web_fetch", { url }), { stopReason: "toolUse" }),
    (context) => {
      const result = context.messages.at(-1)!;
      expect(result).toMatchObject({
        role: "toolResult",
        toolName: "web_fetch",
        isError: !allowed,
      });
      expect(JSON.stringify(result)).toContain(
        allowed ? "Public documentation" : "Tool not authorized: web_fetch",
      );
      observed = true;
      return fauxAssistantMessage("done");
    },
  ]);
  let stderr = "";
  const exitCode = await main([...flags, "-p", "read docs"], {
    readStdin: async () => "",
    stdout: () => {},
    stderr: (text) => {
      stderr += text;
    },
    session: {
      cwd: root,
      homeDir: root,
      model: faux.getModel(),
      streamFn: withAuxiliaryRequests(faux.streamSimple),
      webFetch: {
        resolve: async () => [{ address: "127.0.0.1", family: 4 }],
        allowAddresses: ["127.0.0.1"],
      },
    },
  });
  expect(exitCode).toBe(0);
  expect(stderr).toBe("");
  expect(observed).toBe(true);
  expect(requests).toEqual(allowed ? [url] : []);
});

/** Temp home whose user settings point a custom provider `fake` at a fake server. */
async function setup(settings: object = {}, options: FakeOpenAIOptions = {}) {
  const server = fakeOpenAI("hello from fake", options);
  const root = await mkdtemp(join(tmpdir(), "neant-cli-"));
  cleanups.push(server.stop, () => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const cwd = join(root, "project");
  await mkdir(join(home, ".neant", "file-history"), { recursive: true });
  await Bun.write(join(cwd, ".keep"), "");
  await Bun.write(
    join(home, ".neant/settings.json"),
    JSON.stringify({
      model: "fake/m",
      providers: [
        {
          id: "fake",
          api: "openai-completions",
          baseUrl: server.baseUrl,
          apiKeyEnv: "FAKE_API_KEY",
          models: [{ id: "m", reasoning: true }],
        },
      ],
      ...settings,
    }),
  );
  return { server, home, cwd };
}

test.each(["untrusted", "flag", "settings"])(
  "CLI project MCP trust and server tool permission: %s",
  async (trust) => {
    const { server, ...dirs } = await setup(
      {},
      {
        toolCalls: [{ name: "mcp__project__echo", arguments: { text: "hello" } }],
      },
    );
    if (trust === "settings") {
      const path = join(dirs.home, ".neant/settings.json");
      const settings = await Bun.file(path).json();
      settings.trustedProjects = [await realpath(dirs.cwd)];
      await Bun.write(path, JSON.stringify(settings));
    }
    const pidPath = join(dirs.home, "mcp-pids");
    await Bun.write(
      join(dirs.home, "manifest.json"),
      JSON.stringify({ instructions: "CLI MCP instructions." }),
    );
    await Bun.write(
      join(dirs.cwd, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          project: {
            command: process.execPath,
            args: [
              fileURLToPath(
                new URL("../../../../agent/tests/helpers/mcp-server.ts", import.meta.url),
              ),
            ],
            env: {
              MCP_MANIFEST: join(dirs.home, "manifest.json"),
              MCP_PIDS: pidPath,
              MCP_CALLS: join(dirs.home, "mcp-calls"),
            },
          },
        },
      }),
    );
    const result = await neant(
      [
        "-p",
        "use MCP",
        "--output-format",
        "stream-json",
        "--allow-tools",
        "mcp__project__*",
        ...(trust === "flag" ? ["--trust-project-mcp"] : []),
      ],
      { ...dirs, key: "sk-test" },
    );
    expect(result.exitCode).toBe(0);
    const events = parseEvents(result.stdout);
    expect(events[0].type).toBe("session_start");
    expect(events[0].tools.includes("mcp__project__echo")).toBe(trust !== "untrusted");
    expect(events.at(-1)).toMatchObject({ type: "result", success: true });
    expect(await Bun.file(pidPath).exists()).toBe(trust !== "untrusted");
    if (trust !== "untrusted") {
      expect(JSON.stringify(server.requests[1]!.body.messages)).toContain("MCP: hello");
      for (const pid of (await Bun.file(pidPath).text()).trim().split("\n"))
        expect(() => process.kill(Number(pid), 0)).toThrow();
    }
  },
);

test.each(["text", "stream-json"])(
  "CLI reports MCP server failure in %s and continues",
  async (format) => {
    const { server, ...dirs } = await setup();
    await Bun.write(
      join(dirs.home, ".neant/mcp.json"),
      JSON.stringify({ mcpServers: { missing: { command: join(dirs.cwd, "missing-command") } } }),
    );
    const result = await neant(["-p", "hi", "--output-format", format], {
      ...dirs,
      key: "sk-test",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Warning: MCP server missing:");
    if (format === "text") expect(result.stdout).toBe("hello from fake\n");
    else {
      const events = parseEvents(result.stdout);
      expect(events[0].type).toBe("session_start");
      expect(events.filter((event) => event.type === "mcp_server_error")).toMatchObject([
        { server: "missing" },
      ]);
      expect(events.at(-1)).toMatchObject({ type: "result", success: true });
    }
    expect(server.requests).toHaveLength(1);
  },
);

test.each([
  "default",
  "patterns",
  "repeated",
  "equals",
  "yolo",
  "settings",
  "ask",
  "auto-review",
  "full-access",
  "mode-settings",
  "override",
])("CLI permissions: %s", async (mode) => {
  const settings =
    mode === "settings"
      ? { permissions: { allow: ["write", "bash"] } }
      : ["mode-settings", "override"].includes(mode)
        ? { permissionMode: "full-access" }
        : {};
  const { server, ...dirs } = await setup(settings, {
    toolCalls: [
      { name: "write", arguments: { path: "new.txt", content: "written" } },
      {
        name: "bash",
        arguments: { command: "printf executed > bash-ran", description: "Run test command" },
      },
    ],
  });
  const flags =
    mode === "patterns"
      ? ["--allow-tools", "wri?e", "ba[st]h"]
      : mode === "repeated"
        ? ["--allow-tools", "write", "--allow-tools", "bash"]
        : mode === "equals"
          ? ["--allow-tools=wri?e", "bash"]
          : mode === "yolo"
            ? ["--yolo"]
            : ["ask", "auto-review", "full-access"].includes(mode)
              ? ["--permission-mode", mode]
              : mode === "override"
                ? ["--permission-mode", "ask"]
                : [];
  const result = await neant([...flags, "-p", "use tools", "--output-format", "stream-json"], {
    ...dirs,
    key: "sk-test",
  });
  expect(result.exitCode).toBe(0);
  const denied = ["default", "ask", "auto-review", "override"].includes(mode);
  expect(await Bun.file(join(dirs.cwd, "new.txt")).exists()).toBe(!denied);
  expect(await Bun.file(join(dirs.cwd, "bash-ran")).exists()).toBe(!denied);
  const events = parseEvents(result.stdout);
  expect(events.filter((event) => event.type === "permission_denied")).toHaveLength(denied ? 2 : 0);
  expect(server.requests).toHaveLength(mode === "auto-review" ? 4 : 2);
  const results = server.requests
    .at(-1)!
    .body.messages.filter((message: { role: string }) => message.role === "tool");
  expect(results).toHaveLength(2);
  if (denied)
    expect(JSON.stringify(results)).toContain(
      mode === "auto-review" ? "User denied" : "Tool not authorized",
    );
});

test.each([
  ['{"risk":"low","decision":"allow"}', true, "allow"],
  ['{"risk":"medium","decision":"deny","reason":"unapproved external target"}', false, "ask"],
  ["invalid JSON", false, "ask"],
] as const)(
  "CLI auto-review %s emits stream-json outcomes and continues after permission decisions",
  async (reviewReply, allowed, decision) => {
    const { server, ...dirs } = await setup(
      {},
      {
        toolCalls: [{ name: "write", arguments: { path: "reviewed.txt", content: "safe" } }],
        reviewReply,
      },
    );
    const result = await neant(
      ["--permission-mode", "auto-review", "-p", "write", "--output-format", "stream-json"],
      { ...dirs, key: "sk-test" },
    );
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    expect(await Bun.file(join(dirs.cwd, "reviewed.txt")).exists()).toBe(allowed);
    const events = parseEvents(result.stdout);
    expect(events.filter((event) => event.type === "permission_review")).toMatchObject([
      { phase: "start", toolCallId: "call-0", toolName: "write" },
      { phase: "end", toolCallId: "call-0", decision },
    ]);
    expect(events.at(-1)).toMatchObject({ type: "result", success: true, text: "hello from fake" });
    expect(server.requests).toHaveLength(3);
    expect(server.requests[1]!.body.temperature).toBe(0);
    expect(JSON.stringify(server.requests.at(-1)!.body)).not.toContain(
      "unapproved external target",
    );
  },
);

async function neant(
  args: string[],
  opts: { home: string; cwd: string; key?: string; input?: string; env?: Record<string, string> },
) {
  const flags =
    args.includes("--goal") || args.includes("-p") || args.includes("--print")
      ? args
      : ["-p", ...args];
  const proc = Bun.spawn([process.execPath, MAIN, ...flags], {
    cwd: opts.cwd,
    env: {
      LANG: "en",
      PATH: process.env.PATH,
      HOME: opts.home,
      FAKE_API_KEY: opts.key,
      ...opts.env,
    },
    stdin: opts.input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  if (opts.input !== undefined) {
    proc.stdin?.write(opts.input);
    proc.stdin?.end();
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

test("--goal prints its round and exits 1 when its round limit blocks continuation", async () => {
  const { server, ...dirs } = await setup();
  const result = await neant(["--goal", "finish migration", "--max-goal-rounds", "1"], {
    ...dirs,
    key: "sk-test",
  });
  expect(result.exitCode).toBe(1);
  expect(result.stdout).toBe("hello from fake\n");
  expect(result.stderr).toContain("auto-review");
  expect(server.requests).toHaveLength(1);
  expect(JSON.stringify(server.requests[0]!.body.messages)).toContain("finish migration");
});

test.each(["complete", "blocked"])(
  "--goal waits for the %s wrapup and streams Goal state through existing events",
  async (action) => {
    const { server, ...dirs } = await setup(
      {},
      {
        toolCalls: [
          {
            name: "update_goal",
            arguments: {
              action,
              ...(action === "blocked" ? { blocked_reason: "Need repository access" } : {}),
            },
          },
        ],
      },
    );
    const result = await neant(["--goal", "finish migration", "--output-format", "stream-json"], {
      ...dirs,
      key: "sk-test",
    });
    expect(result.exitCode).toBe(action === "complete" ? 0 : 1);
    const events = parseEvents(result.stdout);
    expect(
      events.filter((event) => event.type === "tool_state_changed" && event.name === "goal"),
    ).toMatchObject([
      {
        value: { objective: "finish migration", phase: "active", roundsStarted: 0, maxRounds: 256 },
      },
      { value: { phase: "active", roundsStarted: 1 } },
      { value: { phase: action } },
    ]);
    expect(events.at(-1)).toMatchObject({ type: "result", success: true, text: "hello from fake" });
    expect(server.requests).toHaveLength(2);
    expect(JSON.stringify(server.requests[1]!.body.messages)).toContain(`<goal_${action}>`);
  },
);

test("--goal prints every round in order, including its final wrapup", async () => {
  const { server, ...dirs } = await setup(
    {},
    {
      responses: [
        "first round progress",
        { toolCalls: [{ name: "update_goal", arguments: { action: "complete" } }] },
        "verified migration complete",
      ],
    },
  );
  const result = await neant(["--goal", "finish migration", "--max-goal-rounds", "2"], {
    ...dirs,
    key: "sk-test",
  });
  expect(result).toMatchObject({
    exitCode: 0,
    stdout: "first round progress\nverified migration complete\n",
  });
  expect(server.requests).toHaveLength(3);
  expect(JSON.stringify(server.requests[1]!.body.messages)).toContain("Round: 2/2");
});

test.each([
  [["--goal", "objective", "-p", "prompt"], "conflicts"],
  [["--goal", "objective", "--print"], "conflicts"],
  [["--goal", " "], "objective cannot be empty"],
  [["--max-goal-rounds", "1"], "requires --goal"],
  ...["0", "-1", "1.5", "NaN", "Infinity", "1e2", "9007199254740992", ""].map(
    (value) => [["--goal", "objective", `--max-goal-rounds=${value}`], "positive integer"] as const,
  ),
] as const)("invalid Goal flags %j exit 2 before model requests", async (flags, message) => {
  const { server, ...dirs } = await setup();
  const result = await neant([...flags], { ...dirs, key: "sk-test", input: "unused stdin" });
  expect(result.exitCode).toBe(2);
  expect(result.stderr).toContain(message);
  expect(result.stdout).toBe("");
  expect(server.requests).toHaveLength(0);
});

test("--goal exits 1 on a model error and reports the failure", async () => {
  const { server, ...dirs } = await setup({}, { error: "Goal provider failed" });
  const result = await neant(["--goal", "finish migration", "--output-format", "stream-json"], {
    ...dirs,
    key: "sk-test",
  });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Goal provider failed");
  expect(parseEvents(result.stdout).at(-1)).toMatchObject({ type: "result", success: false });
  expect(server.requests).toHaveLength(1);
});

test("--resume --goal rejects an unfinished Goal without invoking the model", async () => {
  const { server, ...dirs } = await setup();
  const opts = { ...dirs, key: "sk-test" };
  const seed = await neant(
    ["--goal", "old objective", "--max-goal-rounds", "1", "--output-format", "stream-json"],
    opts,
  );
  expect(seed.exitCode).toBe(1);
  const id = parseEvents(seed.stdout)[0].sessionId;
  const result = await neant(["--resume", id, "--goal", "new objective"], opts);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("unfinished Goal");
  expect(result.stderr).toContain("TUI");
  expect(result.stdout).toBe("");
  expect(server.requests).toHaveLength(1);
});

test.each(["none", "complete"])("--resume --goal creates a Goal after %s", async (previous) => {
  const { server, ...dirs } = await setup(
    {},
    {
      responses: [
        ...(previous === "complete"
          ? [
              { toolCalls: [{ name: "update_goal", arguments: { action: "complete" } }] },
              "old wrapup",
            ]
          : ["old answer"]),
        { toolCalls: [{ name: "update_goal", arguments: { action: "complete" } }] },
        "new wrapup",
      ],
    },
  );
  const opts = { ...dirs, key: "sk-test" };
  const seed = await neant(
    [previous === "none" ? "-p" : "--goal", "old objective", "--output-format", "stream-json"],
    opts,
  );
  expect(seed.exitCode).toBe(0);
  const events = parseEvents(seed.stdout);
  const oldGoal = events.find(
    (event) => event.type === "tool_state_changed" && event.name === "goal",
  )?.value;
  const result = await neant(
    ["--resume", events[0].sessionId, "--goal", "new objective", "--output-format", "stream-json"],
    opts,
  );
  expect(result.exitCode).toBe(0);
  const resumed = parseEvents(result.stdout);
  const created = resumed.find(
    (event) => event.type === "tool_state_changed" && event.name === "goal",
  ).value;
  expect(created).toMatchObject({ objective: "new objective", phase: "active", roundsStarted: 0 });
  if (oldGoal) expect(created.id).not.toBe(oldGoal.id);
  expect(resumed.at(-1)).toMatchObject({ type: "result", text: "new wrapup" });
  expect(server.requests).toHaveLength(previous === "complete" ? 4 : 3);
});

test("--goal denies headless interactions and still reaches completion", async () => {
  const { server, ...dirs } = await setup(
    {},
    {
      responses: [
        { toolCalls: [{ name: "write", arguments: { path: "forbidden.txt", content: "denied" } }] },
        { toolCalls: [{ name: "update_goal", arguments: { action: "complete" } }] },
        "denial handled",
      ],
    },
  );
  const result = await neant(["--goal", "finish safely", "--output-format", "stream-json"], {
    ...dirs,
    key: "sk-test",
  });
  expect(result.exitCode).toBe(0);
  const events = parseEvents(result.stdout);
  const start = events.find((event) => event.type === "session_start");
  expect(start.tools).not.toContain("ask_user_question");
  expect(start.tools).not.toContain("exit_plan_mode");
  expect(
    events.some((event) => event.type === "permission_denied" && event.toolName === "write"),
  ).toBe(true);
  expect(await Bun.file(join(dirs.cwd, "forbidden.txt")).exists()).toBe(false);
  expect(JSON.stringify(server.requests[1]!.body.messages)).toContain("Tool not authorized");
});

test.each(["text", "stream-json"])(
  "%s loads skills while malformed skill warnings go only to stderr",
  async (format) => {
    const { server, ...dirs } = await setup(
      {},
      {
        toolCalls: [{ name: "skill", arguments: { name: "review" } }],
      },
    );
    await Bun.write(
      join(dirs.cwd, ".agents/skills/review/SKILL.md"),
      "---\nname: review\ndescription: Review changes\n---\nCheck the changed behavior.",
    );
    const broken = join(dirs.home, ".neant/skills/broken/SKILL.md");
    await Bun.write(broken, "---\nname: broken\ndescription: [invalid\n---\nBad YAML");
    const result = await neant(["-p", "/review original prompt", "--output-format", format], {
      ...dirs,
      key: "sk-test",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Warning:");
    expect(result.stderr).toContain(broken);
    expect(result.stdout).not.toContain("Warning:");
    expect(server.requests).toHaveLength(2);
    expect(JSON.stringify(server.requests[0]!.body.messages)).toContain("/review original prompt");
    expect(JSON.stringify(server.requests[0]!.body.messages)).toContain(
      "Check the changed behavior.",
    );
    const tool = server.requests[1]!.body.messages.find(
      (message: { role: string }) => message.role === "tool",
    );
    expect(JSON.stringify(tool)).toContain("Check the changed behavior.");
    if (format === "text") expect(result.stdout).toBe("hello from fake\n");
    else {
      const events = parseEvents(result.stdout);
      expect(events[0].type).toBe("session_start");
      expect(
        events.find((event) => event.type === "tool_execution_end" && event.toolName === "skill"),
      ).toMatchObject({ isError: false });
      expect(events.at(-1)).toMatchObject({ type: "result", success: true });
    }
  },
);

test("CLI grep uses bundled ripgrep when the child process PATH is empty", async () => {
  const { server, ...dirs } = await setup(
    {},
    { toolCalls: [{ name: "grep", arguments: { pattern: "hello (Bun|rg)", path: "file.txt" } }] },
  );
  await Bun.write(join(dirs.cwd, "file.txt"), "hello Bun\nhello rg\n");
  const result = await neant(["-p", "search", "--output-format", "stream-json"], {
    ...dirs,
    key: "sk-test",
    env: { PATH: "" },
  });
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  const events = parseEvents(result.stdout);
  expect(
    events.find((event) => event.type === "tool_execution_end" && event.toolName === "grep"),
  ).toMatchObject({
    isError: false,
    result: { content: [{ type: "text", text: "file.txt:1:hello Bun\nfile.txt:2:hello rg" }] },
  });
  expect(events.at(-1)).toMatchObject({ type: "result", success: true });
  expect(server.requests).toHaveLength(2);
  expect(JSON.stringify(server.requests[1]!.body.messages)).toContain("file.txt:1:hello Bun");
});

test("an unavailable bundled ripgrep returns a tool error while read and the Run still succeed", async () => {
  const { server, ...dirs } = await setup(
    {},
    {
      toolCalls: [
        { name: "grep", arguments: { pattern: "available", path: "file.txt" } },
        { name: "read", arguments: { path: "file.txt" } },
      ],
    },
  );
  await Bun.write(join(dirs.cwd, "file.txt"), "available text\n");
  const result = await neant(["-p", "search and read", "--output-format", "stream-json"], {
    ...dirs,
    key: "sk-test",
    env: { npm_config_arch: "neant-test-unsupported" },
  });
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  const events = parseEvents(result.stdout);
  const grep = events.find(
    (event) => event.type === "tool_execution_end" && event.toolName === "grep",
  );
  expect(grep).toMatchObject({ isError: true });
  expect(JSON.stringify(grep.result.content)).toContain("Bundled ripgrep is unavailable");
  expect(JSON.stringify(grep.result.content)).toContain("neant-test-unsupported");
  expect(JSON.stringify(grep.result.content)).not.toContain("brew install ripgrep");
  expect(
    events.find((event) => event.type === "tool_execution_end" && event.toolName === "read"),
  ).toMatchObject({
    isError: false,
    result: { content: [{ type: "text", text: "available text\n" }] },
  });
  expect(events.at(-1)).toMatchObject({ type: "result", success: true, text: "hello from fake" });
  expect(server.requests).toHaveLength(2);
  const toolResults = server.requests[1]!.body.messages.filter(
    (message: { role: string }) => message.role === "tool",
  );
  expect(JSON.stringify(toolResults)).toContain("Bundled ripgrep is unavailable");
  expect(JSON.stringify(toolResults)).toContain("available text");
});

test("prints the model's reply using the configured custom provider", async () => {
  const { server, ...dirs } = await setup();

  const result = await neant(["-p", "hi"], { ...dirs, key: "sk-test" });

  expect(result).toMatchObject({ exitCode: 0, stdout: "hello from fake\n" });
  expect(server.requests).toHaveLength(1);
  expect(server.requests[0]!.authorization).toBe("Bearer sk-test");
  expect(server.requests[0]!.body.model).toBe("m");
  expect(JSON.stringify(server.requests[0]!.body.messages)).toContain("hi");
});

test("stream-json emits session metadata, verbatim pi events, and the Run result in order", async () => {
  const { server, ...dirs } = await setup();
  const result = await neant(["-p", "hi", "--output-format", "stream-json"], {
    ...dirs,
    key: "sk-test",
  });

  expect(result.exitCode).toBe(0);
  expect(result.stderr).toBe("");
  expect(result.stdout.endsWith("\n")).toBe(true);
  const events = parseEvents(result.stdout);
  const sessionId = events[0].sessionId;
  expect(sessionId).toBeString();
  expect(sessionId).not.toBe("");
  expect(events.every((event) => event.sessionId === sessionId)).toBe(true);
  expect(events[0]).toEqual({
    type: "session_start",
    sessionId,
    model: "fake/m",
    cwd: await realpath(dirs.cwd),
    tools: [
      "read",
      "write",
      "edit",
      "bash",
      "job_output",
      "job_list",
      "job_kill",
      "glob",
      "grep",
      "skill",
      "todo_write",
      "web_fetch",
      "create_goal",
      "update_goal",
      "subagent",
      "subagent_fork",
      "send_message",
      "list_agents",
    ],
  });
  expect(
    events.filter((event) => event.type !== "session_title_changed").map((event) => event.type),
  ).toEqual([
    "session_start",
    "context_usage",
    "mcp_servers_changed",
    "agent_start",
    "turn_start",
    "message_start",
    "reminder_injected",
    "message_end",
    "message_start",
    "reminder_injected",
    "message_end",
    "message_start",
    "reminder_injected",
    "message_end",
    "message_start",
    "tool_state_changed",
    "message_end",
    "message_start",
    "message_update",
    "message_update",
    "message_update",
    "message_end",
    "context_usage",
    "turn_end",
    "agent_end",
    "result",
  ]);
  expect(events.filter((event) => event.type === "mcp_servers_changed")).toEqual([
    { type: "mcp_servers_changed", sessionId },
  ]);
  const usage = events.filter((event) => event.type === "context_usage");
  expect(usage).toHaveLength(2);
  expect(usage[0]).toEqual({
    type: "context_usage",
    sessionId,
    used: usage[0].segments.system,
    window: expect.any(Number),
    segments: { system: expect.any(Number), prompt: 0, assistant: 0, thinking: 0, tools: 0 },
  });
  expect(usage[0].used).toBeGreaterThan(0);
  expect(usage[0].window).toBeGreaterThan(0);
  expect(usage[1]).toEqual({
    type: "context_usage",
    sessionId,
    used: 12, // Provider input 8 + cacheRead 4, excluding output 5.
    window: usage[0].window,
    segments: {
      system: usage[0].segments.system,
      prompt: expect.any(Number),
      assistant: 4,
      thinking: 0,
      tools: 0,
    },
  });
  expect(events.find((event) => event.assistantMessageEvent?.type === "text_delta")).toMatchObject({
    type: "message_update",
    message: { role: "assistant", model: "m" },
    assistantMessageEvent: { type: "text_delta", delta: "hello from fake" },
  });
  expect(events.at(-1)).toEqual({
    type: "result",
    sessionId,
    text: "hello from fake",
    success: true,
    usage: { input: 8, output: 5, cacheRead: 4, cacheWrite: 0, totalTokens: 17 },
    durationMs: expect.any(Number),
  });
  expect(events.at(-1).durationMs).toBeGreaterThanOrEqual(0);
  expect(events.filter((event) => event.type === "reminder_injected")).toMatchObject([
    { source: "environment", content: expect.stringContaining(`cwd: ${await realpath(dirs.cwd)}`) },
    { source: "date", content: expect.stringContaining("Current date:") },
    { source: "skills", content: "Available skills: none." },
  ]);
  expect(server.requests).toHaveLength(1);

  const resumed = await neant(
    ["-p", "continue", "--resume", sessionId, "--output-format", "stream-json"],
    {
      ...dirs,
      key: "sk-test",
    },
  );
  expect(resumed.exitCode).toBe(0);
  const next = parseEvents(resumed.stdout);
  expect(next.filter((event) => event.type === "reminder_injected")).toEqual([]);
  expect(next.every((event) => event.sessionId === sessionId)).toBe(true);
  expect(next.at(-1)).toMatchObject({
    type: "result",
    success: true,
    text: "hello from fake",
    usage: { input: 8, output: 5, cacheRead: 4, cacheWrite: 0, totalTokens: 17 },
  });
});

test("stream-json reports compaction start and end around a large tool result", async () => {
  const { server, ...dirs } = await setup(
    {},
    {
      toolCalls: [{ name: "read", arguments: { path: "large.txt" } }],
    },
  );
  await Bun.write(join(dirs.cwd, "large.txt"), "tool output ".repeat(2500));
  const settingsPath = join(dirs.home, ".neant/settings.json");
  const settings = await Bun.file(settingsPath).json();
  settings.providers[0].models[0].contextWindow = 4000;
  await Bun.write(settingsPath, JSON.stringify(settings));
  const result = await neant(["-p", "read the file", "--output-format", "stream-json"], {
    ...dirs,
    key: "sk-test",
  });
  expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  const events = parseEvents(result.stdout);
  const compactions = events.filter(
    (event) => event.type === "compaction_start" || event.type === "compaction_end",
  );
  expect(compactions).toEqual([
    {
      type: "compaction_start",
      trigger: "auto",
      sessionId: events[0].sessionId,
      tokensBefore: expect.any(Number),
    },
    {
      type: "compaction_end",
      trigger: "auto",
      sessionId: events[0].sessionId,
      summary: expect.stringContaining("hello from fake"),
      tokensBefore: compactions[0].tokensBefore,
      tokensAfter: expect.any(Number),
    },
  ]);
  expect(compactions[1].tokensAfter).toBeLessThan(compactions[1].tokensBefore);
  expect(events.filter((event) => event.type === "compaction")).toEqual([]);
  expect(events.at(-1)).toMatchObject({ type: "result", success: true });
  expect(server.requests).toHaveLength(3);
});

test("a failed stream-json Run emits a failure result and exits 1", async () => {
  const { server, ...dirs } = await setup({}, { error: "model unavailable" });
  const result = await neant(["-p", "hi", "--output-format", "stream-json"], {
    ...dirs,
    key: "sk-test",
  });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("model unavailable");
  const events = parseEvents(result.stdout);
  expect(events[0].type).toBe("session_start");
  expect(events.filter((event) => event.type !== "session_title_changed").at(-2).type).toBe(
    "agent_end",
  );
  expect(events.at(-1)).toMatchObject({
    type: "result",
    sessionId: events[0].sessionId,
    success: false,
    text: "",
    error: expect.stringContaining("model unavailable"),
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    durationMs: expect.any(Number),
  });
  expect(events.every((event) => event.sessionId === events[0].sessionId)).toBe(true);
  expect(events.filter((event) => event.type === "result")).toHaveLength(1);
  expect(server.requests).toHaveLength(1);
});

test.each(["text", "stream-json"])(
  "%s sends configuration warnings only to stderr",
  async (format) => {
    const { server, ...dirs } = await setup();
    await Bun.write(join(dirs.cwd, ".neant/settings.json"), JSON.stringify({ providers: [] }));
    const result = await neant(["-p", "hi", "--output-format", format], {
      ...dirs,
      key: "sk-test",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Warning:");
    if (format === "text") {
      expect(result.stdout).toBe("hello from fake\n");
    } else {
      const events = parseEvents(result.stdout);
      expect(events[0].type).toBe("session_start");
      expect(events.at(-1)).toMatchObject({ type: "result", success: true });
    }
    expect(server.requests).toHaveLength(1);
  },
);

test("reads a piped prompt and completes normally", async () => {
  const { server, ...dirs } = await setup();
  const result = await neant([], { ...dirs, key: "sk-test", input: "from pipe\n" });
  expect(result).toMatchObject({ exitCode: 0, stdout: "hello from fake\n", stderr: "" });
  expect(server.requests[0]!.body.messages).toEqual([
    { role: "developer", content: expect.stringContaining("You are Neant") },
    {
      role: "user",
      content: [{ type: "text", text: expect.stringContaining("<system-reminder>\ncwd:") }],
    },
    {
      role: "user",
      content: [
        { type: "text", text: expect.stringContaining("<system-reminder>\nCurrent date:") },
      ],
    },
    {
      role: "user",
      content: [
        { type: "text", text: "<system-reminder>\nAvailable skills: none.\n</system-reminder>" },
      ],
    },
    { role: "user", content: [{ type: "text", text: "from pipe" }] },
  ]);
});

test("--resume continues the persisted session in another CLI process", async () => {
  const { server, ...dirs } = await setup();
  const opts = { ...dirs, key: "sk-test" };
  expect((await neant(["-p", "first prompt"], opts)).exitCode).toBe(0);
  const root = join(dirs.home, ".neant/sessions");
  const [slug] = await readdir(root);
  const directory = join(root, slug!);
  const [file] = await readdir(directory);
  const path = join(directory, file!);
  const before = await Bun.file(path).text();
  const header = JSON.parse(before.split("\n")[0]!);

  const result = await neant(["--resume", header.id, "-p", "second prompt"], opts);

  expect(result).toMatchObject({ exitCode: 0, stdout: "hello from fake\n", stderr: "" });
  expect(server.requests[1]!.body.messages).toEqual([
    ...server.requests[0]!.body.messages,
    { role: "assistant", content: "hello from fake" },
    { role: "user", content: [{ type: "text", text: "second prompt" }] },
  ]);
  expect(header).toMatchObject({ v: 4, kind: "header", cwd: await realpath(dirs.cwd) });
  expect(await readdir(directory)).toEqual([file!]);
  const after = await Bun.file(path).text();
  expect(after.startsWith(before)).toBe(true);
  expect(after.length).toBeGreaterThan(before.length);
});

test("an unknown --resume id exits 1 with a clear error", async () => {
  const { server, ...dirs } = await setup();
  const result = await neant(["--resume", "missing", "-p", "hi"], { ...dirs, key: "sk-test" });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("Session not found: missing");
  expect(server.requests).toHaveLength(0);
});

test.each(["prompt", "goal"])(
  "SIGINT in %s exits 130 after saving the interrupted Run's messages",
  async (source) => {
    const { server, ...dirs } = await setup({}, { holdOpen: true });
    const proc = Bun.spawn(
      ["bun", MAIN, source === "goal" ? "--goal" : "-p", "interrupted prompt"],
      {
        cwd: dirs.cwd,
        env: { PATH: process.env.PATH, HOME: dirs.home, FAKE_API_KEY: "sk-test" },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    cleanups.push(() => {
      if (proc.exitCode === null) proc.kill("SIGKILL");
    });
    const output = new Response(proc.stdout).text();
    const errors = new Response(proc.stderr).text();
    await server.received;
    proc.kill("SIGINT");
    expect(await proc.exited).toBe(130);
    expect(await output).toBe("");
    expect(await errors).toContain("Interrupted");

    const root = join(dirs.home, ".neant/sessions");
    const [slug] = await readdir(root);
    const directory = join(root, slug!);
    const [file] = await readdir(directory);
    const lines = (await Bun.file(join(directory, file!)).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const entries = lines
      .flatMap((line) => (Array.isArray(line) ? line : [line]))
      .filter((write) => write.kind === "entry" && write.type === "message")
      .map((write) => write.message);
    expect(entries).toMatchObject([
      { role: "system", content: expect.stringContaining("You are Neant") },
      { role: "system-reminder", source: "environment" },
      { role: "system-reminder", source: "date" },
      { role: "system-reminder", source: "skills" },
      ...(source === "goal" ? [{ role: "system-reminder", source: "goal" }] : []),
      {
        role: "user",
        ...(source === "goal"
          ? {
              source: "goal",
              content: [{ type: "text", text: expect.stringContaining("interrupted prompt") }],
            }
          : { content: [{ type: "text", text: "interrupted prompt" }] }),
      },
      { role: "assistant", stopReason: "aborted" },
    ]);
  },
);

test.each(["prompt", "goal-wrapup"])(
  "stream-json delivers live deltas and ends interrupted %s with a failure result",
  async (source) => {
    const { server, ...dirs } = await setup(
      {},
      {
        holdOpen: true,
        ...(source === "goal-wrapup"
          ? { toolCalls: [{ name: "update_goal", arguments: { action: "complete" } }] }
          : {}),
      },
    );
    const proc = Bun.spawn(
      [
        "bun",
        MAIN,
        source === "goal-wrapup" ? "--goal" : "-p",
        "hi",
        "--output-format",
        "stream-json",
      ],
      {
        cwd: dirs.cwd,
        env: { PATH: process.env.PATH, HOME: dirs.home, FAKE_API_KEY: "sk-test" },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    cleanups.push(() => {
      if (proc.exitCode === null) proc.kill("SIGKILL");
    });
    const errors = new Response(proc.stderr).text();
    const reader = proc.stdout.getReader();
    const decoder = new TextDecoder();
    let output = "";
    let pending = "";
    let delta;
    while (!delta) {
      const { value, done } = await reader.read();
      if (done) throw new Error("CLI exited before emitting a live delta");
      const chunk = decoder.decode(value, { stream: true });
      output += chunk;
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop()!;
      delta = lines
        .map((line) => JSON.parse(line))
        .find((event) => event.assistantMessageEvent?.type === "text_delta");
    }
    expect(delta.assistantMessageEvent.delta).toBe("hello from fake");
    expect(proc.exitCode).toBeNull();
    proc.kill("SIGINT");
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    }
    output += decoder.decode();
    expect(await proc.exited).toBe(130);
    expect(await errors).toContain("Interrupted");
    const events = parseEvents(output);
    expect(events.some((event) => event.type === "session_start")).toBe(true);
    if (source === "goal-wrapup")
      expect(
        events.some(
          (event) =>
            event.type === "tool_state_changed" &&
            event.name === "goal" &&
            event.value.phase === "complete",
        ),
      ).toBe(true);
    expect(events.at(-1)).toMatchObject({
      type: "result",
      sessionId: events[0].sessionId,
      success: false,
      text: "hello from fake",
      error: expect.any(String),
      durationMs: expect.any(Number),
    });
    expect(events.every((event) => event.sessionId === events[0].sessionId)).toBe(true);
    expect(events.filter((event) => event.type === "result")).toHaveLength(1);
    expect(server.requests).toHaveLength(source === "goal-wrapup" ? 2 : 1);
  },
);

test("SIGINT exits 130 while stdin is still open", async () => {
  const { server, ...dirs } = await setup();
  const proc = Bun.spawn(["bun", MAIN, "-p"], {
    cwd: dirs.cwd,
    env: { PATH: process.env.PATH, HOME: dirs.home, FAKE_API_KEY: "sk-test" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  cleanups.push(() => {
    if (proc.exitCode === null) proc.kill("SIGKILL");
  });
  const output = new Response(proc.stdout).text();
  const errors = new Response(proc.stderr).text();
  // Session creation is an observable readiness point before stdin acquisition.
  const root = join(dirs.home, ".neant/sessions");
  const deadline = Date.now() + 2000;
  let ready = false;
  while (!ready && Date.now() < deadline) {
    try {
      ready = (await readdir(root, { recursive: true })).some((file) => file.endsWith(".jsonl"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!ready) await Bun.sleep(10);
  }
  expect(ready).toBe(true);
  proc.kill("SIGINT");
  expect(await proc.exited).toBe(130);
  expect(await output).toBe("");
  expect(await errors).toContain("Interrupted");
  expect(server.requests).toHaveLength(0);
});

test("--model and --thinking override settings", async () => {
  const { server, ...dirs } = await setup({ model: "fake/missing" });

  const result = await neant(["-p", "hi", "--model", "fake/m", "--thinking", "high"], {
    ...dirs,
    key: "sk-test",
  });

  expect(result.exitCode).toBe(0);
  expect(server.requests[0]!.body.reasoning_effort).toBe("high");
});

test("no model configured exits 1 with a clear error", async () => {
  const { server, ...dirs } = await setup({ model: undefined });

  const result = await neant(["-p", "hi"], { ...dirs, key: "sk-test" });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("No model configured");
  expect(result.stderr).toContain(join(dirs.home, ".neant/settings.json"));
  // The printed example is valid settings the user can paste as-is.
  const example = JSON.parse(
    result.stderr.slice(result.stderr.indexOf("{"), result.stderr.lastIndexOf("}") + 1),
  );
  expect(Value.Check(SettingsSchema, example)).toBe(true);
  expect(example.providers[0].apiKeyEnv).toBeString();
  expect(server.requests).toHaveLength(0);
});

test("apiKeyEnv never falls back to sending its value as a literal key", async () => {
  const dirs = await setup();
  const server = dirs.server;
  const settings = await Bun.file(join(dirs.home, ".neant/settings.json")).json();
  settings.providers[0].apiKeyEnv = "sk-literal-1";
  await Bun.write(join(dirs.home, ".neant/settings.json"), JSON.stringify(settings));

  const result = await neant(["-p", "hi"], dirs);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("No API key");
  expect(server.requests).toHaveLength(0);
});

test("missing API key exits 1 naming the env var", async () => {
  const { server, ...dirs } = await setup();

  const result = await neant(["-p", "hi"], dirs);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("FAKE_API_KEY");
  expect(server.requests).toHaveLength(0);
});

test("built-in providers resolve without settings and need their standard key", async () => {
  const dirs = await setup();

  const result = await neant(["-p", "hi", "--model", "openai/gpt-4.1"], dirs);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('No API key for provider "openai"');
});

test("invalid settings exit 1 naming the file and field", async () => {
  const dirs = await setup({ thinking: "extreme" });

  const result = await neant(["-p", "hi"], { ...dirs, key: "sk-test" });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain(join(dirs.home, ".neant/settings.json"));
  expect(result.stderr).toContain("/thinking");
});

test.each([
  [["--nope"]],
  [["--allow-tools"]],
  [["--allow-tools="]],
  [["unexpected", "extra"]],
  [["-p", "hi", "--thinking", "extreme"]],
  [["-p", "hi", "--model", "m"]],
  [["-p", "hi", "--output-format", "json"]],
])("bad arguments %j exit 2", async (args) => {
  const { server, ...dirs } = await setup();

  const result = await neant(args, { ...dirs, key: "sk-test" });

  expect(result.exitCode).toBe(2);
  expect(result.stderr).not.toBe("");
  expect(server.requests).toHaveLength(0);
});

test.each(["ask", "deny"])(
  "headless stream-json carries %s rule denial provenance in full-access",
  async (decision) => {
    const { server, ...dirs } = await setup(
      { permissions: { [decision]: ["bash(printf blocked*)"] } },
      {
        toolCalls: [
          {
            name: "bash",
            arguments: { command: "printf blocked > marker", description: "Run test command" },
          },
        ],
      },
    );
    const result = await neant(
      ["--permission-mode", "full-access", "-p", "try", "--output-format", "stream-json"],
      { ...dirs, key: "sk-test" },
    );
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    const events = parseEvents(result.stdout);
    expect(events.filter((event) => event.type === "permission_denied")).toMatchObject([
      { toolName: "bash", by: "rule", rule: "bash(printf blocked*)" },
    ]);
    expect(events.filter((event) => event.type === "permission_review")).toEqual([]);
    expect(await Bun.file(join(dirs.cwd, "marker")).exists()).toBe(false);
    expect(JSON.stringify(server.requests[1]!.body)).toContain(
      "Denied by permission rule: bash(printf blocked*)",
    );
  },
);

test.each(["text", "stream-json"])(
  "CLI %s preserves text output and exposes terminal Tool Views in events",
  async (format) => {
    const { server, ...dirs } = await setup(
      { permissionMode: "full-access" },
      {
        toolCalls: [
          {
            name: "bash",
            arguments: { command: "printf cli-view", description: "Print CLI output" },
          },
        ],
      },
    );
    expect(server.requests).toHaveLength(0);
    const result = await neant(["-p", "run", "--output-format", format], {
      ...dirs,
      key: "sk-test",
    });
    expect(result.exitCode).toBe(0);
    if (format === "text") expect(result.stdout).toBe("hello from fake\n");
    else {
      const events = parseEvents(result.stdout);
      expect(events.find((event) => event.type === "tool_execution_start")).toMatchObject({
        view: { card: "terminal", kind: "execute", command: "printf cli-view" },
      });
      expect(events.find((event) => event.type === "tool_execution_end")).toMatchObject({
        view: { card: "terminal", output: "cli-view", exitCode: 0 },
      });
    }
  },
);
