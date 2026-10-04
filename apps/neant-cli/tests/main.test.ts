import { expect, test } from "bun:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSession } from "@neant/agent";
import { main } from "../src/main.ts";
import { echoModel } from "./helpers/echo-model.ts";

async function run(argv: string[], stdin = "") {
  const root = await mkdtemp(join(tmpdir(), "neant-main-"));
  let stdout = "";
  let stderr = "";
  try {
    const exitCode = await main(argv, {
      readStdin: async () => stdin,
      stdout: (s) => (stdout += s),
      stderr: (s) => (stderr += s),
      session: { cwd: root, homeDir: root, ...echoModel() },
    });
    return { exitCode, stdout, stderr };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("-p prints the final assistant text", async () => {
  const { exitCode, stdout } = await run(["-p", "hi"]);
  expect(exitCode).toBe(0);
  expect(stdout).toBe('echo: [{"type":"text","text":"hi"}]\n');
});

test.each(["text", "stream-json"])(
  "%s exposes hook warnings, headless ask denial, and user messages",
  async (format) => {
    const root = await mkdtemp(join(tmpdir(), "neant-cli-hooks-"));
    const faux = createFauxCore({ api: "faux", provider: "faux" });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("bash", { command: "touch forbidden" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("done"),
    ]);
    let stdout = "";
    let stderr = "";
    try {
      const exitCode = await main(["-p", "try", "--yolo", "--output-format", format], {
        readStdin: async () => "",
        stdout: (text) => {
          stdout += text;
        },
        stderr: (text) => {
          stderr += text;
        },
        session: {
          cwd: root,
          homeDir: root,
          model: faux.getModel(),
          streamFn: faux.streamSimple,
          settings: {
            hooks: {
              PreToolUse: [
                {
                  hooks: [
                    { type: "command", command: "echo '{bad}'" },
                    {
                      type: "command",
                      command: `echo '{"systemMessage":"user-notice","hookSpecificOutput":{"permissionDecision":"ask"}}'`,
                    },
                  ],
                },
              ],
            },
          },
        },
      });
      expect(exitCode).toBe(0);
      expect(await Bun.file(join(root, "forbidden")).exists()).toBe(false);
      expect(stderr).toContain("Invalid hook JSON");
      if (format === "stream-json") {
        const events = stdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        expect(events.some((event) => event.type === "hook_warning")).toBe(true);
        expect(
          events.some((event) => event.type === "permission_denied" && event.by === "hook"),
        ).toBe(true);
        expect(
          events.some((event) => event.type === "hook_message" && event.message === "user-notice"),
        ).toBe(true);
      } else expect(stderr).toContain("user-notice");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("reads the prompt from stdin when -p is absent", async () => {
  const { exitCode, stdout } = await run([], "from pipe\n");
  expect(exitCode).toBe(0);
  expect(stdout).toBe('echo: [{"type":"text","text":"from pipe"}]\n');
});

test.each(["text", "stream-json"])(
  "%s reports hook_blocked without invoking the model",
  async (format) => {
    const root = await mkdtemp(join(tmpdir(), "neant-cli-prompt-hook-"));
    let stdout = "";
    let stderr = "";
    let modelCalls = 0;
    const fake = echoModel();
    try {
      const exitCode = await main(["-p", "private prompt", "--output-format", format], {
        readStdin: async () => "",
        stdout: (text) => {
          stdout += text;
        },
        stderr: (text) => {
          stderr += text;
        },
        session: {
          cwd: root,
          homeDir: root,
          ...fake,
          streamFn: (...args) => {
            modelCalls++;
            return fake.streamFn(...args);
          },
          settings: {
            hooks: {
              UserPromptSubmit: [
                {
                  hooks: [
                    {
                      type: "command",
                      command: `echo '{"decision":"block","reason":"private prompt rejected"}'`,
                    },
                  ],
                },
              ],
            },
          },
        },
      });
      expect(exitCode).toBe(0);
      expect(modelCalls).toBe(0);
      if (format === "stream-json") {
        const events = stdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        expect(events.at(-1)).toMatchObject({
          type: "result",
          stopReason: "hook_blocked",
          reason: "private prompt rejected",
        });
      } else expect(stderr).toContain("private prompt rejected");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("unknown arguments exit with 2", async () => {
  const { exitCode, stderr } = await run(["--nope"]);
  expect(exitCode).toBe(2);
  expect(stderr).not.toBe("");
});

for (const flags of [
  ["--permission-mode", "ask"],
  ["--permission-mode=auto-review"],
  ["--permission-mode", "full-access"],
  ["--yolo", "--permission-mode", "full-access"],
  ["--permission-mode", "full-access", "--yolo"],
]) {
  test(`valid permission flags ${flags.join(" ")} run successfully`, async () => {
    const { exitCode, stdout, stderr } = await run([...flags, "-p", "hi"]);
    expect(exitCode).toBe(0);
    expect(stdout).toBe('echo: [{"type":"text","text":"hi"}]\n');
    expect(stderr).toBe("");
  });
}

test.each([
  [["--permission-mode"], "argument missing"],
  [["--permission-mode", "invalid"], "--permission-mode must be one of"],
  [["--permission-mode", ""], "--permission-mode must be one of"],
  [["--yolo", "--permission-mode", "ask"], "--yolo conflicts with --permission-mode"],
  [["--permission-mode", "auto-review", "--yolo"], "--yolo conflicts with --permission-mode"],
] as const)("invalid permission flags %j exit before reading stdin", async (flags, message) => {
  let read = false;
  let stderr = "";
  let stdout = "";
  const exitCode = await main([...flags], {
    readStdin: async () => {
      read = true;
      return "hi";
    },
    stdout: (text) => (stdout += text),
    stderr: (text) => (stderr += text),
  });
  expect(exitCode).toBe(2);
  expect(stderr).toContain(message);
  expect(stdout).toBe("");
  expect(read).toBe(false);
});

test.each(["", "bash(git status", "unknown(pattern)"])(
  "invalid --allow-tools rule %j fails before stdin",
  async (rule) => {
    let read = false;
    let stderr = "";
    let stdout = "";
    const exitCode = await main(["--allow-tools", rule], {
      readStdin: async () => {
        read = true;
        return "hi";
      },
      stdout: (text) => (stdout += text),
      stderr: (text) => (stderr += text),
    });
    expect(exitCode).toBe(2);
    expect(stderr).toContain(`--allow-tools: invalid permission rule ${JSON.stringify(rule)}`);
    expect(read).toBe(false);
    expect(stdout).toBe("");
  },
);

test.each([
  ["bash(git status*)", "git status --short"],
  ["bash(printf a,b*)", "printf a,b > marker"],
  ["bash(printf {alpha,beta}*)", "printf alpha > marker"],
])("--allow-tools %s grants the matching command only", async (rule, command) => {
  const root = await mkdtemp(join(tmpdir(), "neant-cli-rules-"));
  const faux = createFauxCore({ api: "faux", provider: "faux" });
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("bash", { command }, { id: "allowed" }),
        fauxToolCall("bash", { command: "printf unauthorized > forbidden" }, { id: "denied" }),
      ],
      { stopReason: "toolUse" },
    ),
    (context) => {
      expect(context.messages.filter((message) => message.role === "toolResult")).toMatchObject([
        { toolCallId: "allowed", isError: false },
        { toolCallId: "denied", isError: true },
      ]);
      return fauxAssistantMessage("done");
    },
  ]);
  let stderr = "";
  try {
    expect(
      await Bun.spawn(["git", "init", "--quiet", root], { stdout: "ignore", stderr: "ignore" })
        .exited,
    ).toBe(0);
    expect(
      await main(["--allow-tools", rule!, "-p", "run"], {
        readStdin: async () => "",
        stdout: () => {},
        stderr: (text) => {
          stderr += text;
        },
        session: { cwd: root, homeDir: root, model: faux.getModel(), streamFn: faux.streamSimple },
      }),
    ).toBe(0);
    expect(stderr).toBe("");
    expect(await Bun.file(join(root, "forbidden")).exists()).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.each(["text", "stream-json"])(
  "%s output keeps child events distinct from the parent closing text",
  async (format) => {
    const root = await mkdtemp(join(tmpdir(), "neant-cli-subagent-"));
    const faux = createFauxCore({ api: "faux", provider: "faux" });
    const reply: Parameters<typeof faux.setResponses>[0][number] = (context) => {
      const last = context.messages.at(-1)!;
      if (last.role === "user" && JSON.stringify(last.content).includes("child-prompt"))
        return fauxAssistantMessage("child-only text");
      return fauxAssistantMessage("parent-only text");
    };
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("subagent", { description: "Inspect", prompt: "child-prompt" }),
        { stopReason: "toolUse" },
      ),
      ...Array.from({ length: 5 }, () => reply),
    ]);
    let stdout = "";
    let stderr = "";
    try {
      expect(
        await main(["-p", "delegate", "--output-format", format], {
          readStdin: async () => "",
          stdout: (value) => {
            stdout += value;
          },
          stderr: (value) => {
            stderr += value;
          },
          session: {
            cwd: root,
            homeDir: root,
            model: faux.getModel(),
            streamFn: faux.streamSimple,
          },
        }),
      ).toBe(0);
      expect(stderr).toBe("");
      if (format === "text") expect(stdout).toBe("parent-only text\n");
      else {
        const events = stdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        const wrapped = events.filter((event) => event.type === "subagent_event");
        expect(wrapped.length).toBeGreaterThan(0);
        expect(
          wrapped.some(
            (event) =>
              event.event.type === "message_end" &&
              event.event.message.role === "assistant" &&
              event.event.message.content.some(
                (block: { type: string; text?: string }) => block.text === "child-only text",
              ),
          ),
        ).toBe(true);
        expect(
          wrapped.every(
            (event) =>
              event.sessionId !== event.event.sessionId && event.agentId === event.event.sessionId,
          ),
        ).toBe(true);
        expect(events.at(-1)).toMatchObject({ type: "result", text: "parent-only text" });
      }
      if (format === "stream-json") {
        const childId = stdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line))
          .find((event) => event.type === "subagent_event").agentId;
        let resumeError = "";
        expect(
          await main(["-p", "resume", "--resume", childId], {
            readStdin: async () => "",
            stdout: () => {},
            stderr: (value) => {
              resumeError += value;
            },
            session: {
              cwd: root,
              homeDir: root,
              model: faux.getModel(),
              streamFn: faux.streamSimple,
            },
          }),
        ).toBe(1);
        expect(resumeError).toContain("Session not found");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("Headless resume emits a text plan and never registers interactive plan tools", async () => {
  const root = await mkdtemp(join(tmpdir(), "neant-cli-plan-"));
  try {
    const seed = await createSession({ cwd: root, homeDir: root, ...echoModel() });
    await seed.setPlanMode(true);
    const faux = createFauxCore({ api: "faux", provider: "faux" });
    faux.setResponses([
      (context) => {
        expect(JSON.stringify(context)).toContain(
          "give the plan directly as text in your final response",
        );
        return fauxAssistantMessage("# Text plan\n\nInspect, implement and verify.");
      },
    ]);
    let stdout = "";
    expect(
      await main(["--resume", seed.id, "-p", "continue", "--output-format", "stream-json"], {
        readStdin: async () => "",
        stdout: (text) => {
          stdout += text;
        },
        stderr: () => {},
        session: { cwd: root, homeDir: root, model: faux.getModel(), streamFn: faux.streamSimple },
      }),
    ).toBe(0);
    const events = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const start = events.find((event) => event.type === "session_start");
    expect(start.tools).not.toContain("exit_plan_mode");
    expect(start.tools).not.toContain("enter_plan_mode");
    expect(events.at(-1)).toMatchObject({
      type: "result",
      text: "# Text plan\n\nInspect, implement and verify.",
    });
    const resumed = await createSession({
      cwd: root,
      homeDir: root,
      ...echoModel(),
      resumeId: seed.id,
    });
    expect(resumed.planMode).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
