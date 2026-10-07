import { auxiliaryModels } from "./helpers/auxiliary-model.ts";
import { expect, test } from "bun:test";
import { fauxProvider, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { watch } from "node:fs";
import { join } from "node:path";
import { createSession } from "@rukie/agent";
import { main as entryMain, type PrintIo } from "../../src/index.ts";
function main(argv: string[], io: PrintIo) {
  return entryMain(
    argv.includes("--goal") || argv.includes("-p") || argv.includes("--print")
      ? argv
      : ["-p", ...argv],
    { env: { LANG: "en" }, ...io },
  );
}

// Load the owned HTTP fixture at runtime: CLI's composite TypeScript project excludes agent tests.
const {
  mcpOAuthServer,
}: {
  mcpOAuthServer: () => { url: string; stop: () => Promise<void> };
} = await import(new URL("../../../agent/tests/helpers/mcp-oauth-server.ts", import.meta.url).href);
import { echoModel } from "./helpers/echo-model.ts";

async function run(argv: string[], stdin = "") {
  const root = await mkdtemp(join(tmpdir(), "rukie-main-"));
  await mkdir(join(root, ".rukie", "file-history"), { recursive: true });
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

test.each([
  ["prompt", "text"],
  ["prompt", "stream-json"],
  ["goal", "text"],
  ["goal", "stream-json"],
])("CLI %s %s observes jobs and terminates them at completion", async (source, format) => {
  const root = await mkdtemp(join(tmpdir(), "rukie-cli-jobs-"));
  await mkdir(join(root, ".rukie", "file-history"), { recursive: true });
  const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall("bash", {
        command:
          "printf '%s' $$ > pid; printf background-only; touch ready; while [ ! -e go ]; do sleep 0.01; done",
        description: "Keep controlled background process",
        run_in_background: true,
      }),
      { stopReason: "toolUse" },
    ),
    async () => {
      // This readiness file belongs to a real child process; a parent virtual clock cannot drive it.
      const ready = Promise.withResolvers<void>();
      const deadline = AbortSignal.timeout(2000);
      const fail = () => ready.reject(new Error("Background process did not start"));
      const watcher = watch(root, (_event, filename) => {
        if (filename !== null && filename !== "ready") return;
        void Bun.file(join(root, "ready"))
          .exists()
          .then((exists) => {
            if (exists) ready.resolve();
          })
          .catch(ready.reject);
      });
      watcher.once("error", ready.reject);
      deadline.addEventListener("abort", fail, { once: true });
      try {
        if (!(await Bun.file(join(root, "ready")).exists())) await ready.promise;
      } finally {
        watcher.close();
        deadline.removeEventListener("abort", fail);
      }
      return source === "goal"
        ? fauxAssistantMessage(fauxToolCall("update_goal", { action: "complete" }), {
            stopReason: "toolUse",
          })
        : fauxAssistantMessage("parent-only final");
    },
    fauxAssistantMessage("parent-only final"),
  ]);
  let stdout = "";
  let stderr = "";
  try {
    const exitCode = await main(
      [source === "goal" ? "--goal" : "-p", "start background task", "--output-format", format!],
      {
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
          models: auxiliaryModels(faux.provider.streamSimple),
          allowRules: ["bash"],
        },
      },
    );
    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("Background process did not start");
    const pid = Number(await Bun.file(join(root, "pid")).text());
    expect(() => process.kill(pid, 0)).toThrow();
    if (format === "text") expect(stdout).toBe("parent-only final\n");
    else {
      const events = stdout
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      const jobs = events.filter((event) => event.type === "job_event");
      expect(jobs[0]).toMatchObject({ kind: "started", job: { id: "bash-1", status: "running" } });
      expect(jobs.at(-1)).toMatchObject({
        kind: "settled",
        job: { id: "bash-1", status: "killed" },
      });
      expect(jobs.every((event) => event.sessionId === jobs[0].sessionId)).toBe(true);
      expect(events.filter((event) => event.type === "snapshot").length).toBeGreaterThanOrEqual(1);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("-p prints the final assistant text", async () => {
  const { exitCode, stdout } = await run(["-p", "hi"]);
  expect(exitCode).toBe(0);
  expect(stdout).toBe('echo: [{"type":"text","text":"hi"}]\n');
});

test.each([false, true])("CLI disposes its Session after success or failure: %s", async (fail) => {
  const root = await mkdtemp(join(tmpdir(), "rukie-cli-dispose-"));
  try {
    const exitCode = await main(fail ? [] : ["-p", "hi"], {
      readStdin: async () => {
        throw new Error("stdin failed");
      },
      stdout: () => {},
      stderr: () => {},
      session: {
        cwd: root,
        homeDir: root,
        ...echoModel(),
        settings: {
          hooks: {
            SessionEnd: [{ matcher: "exit", hooks: [{ type: "command", command: "cat > ended" }] }],
          },
        },
      },
    });
    expect(exitCode).toBe(fail ? 1 : 0);
    expect((await Bun.file(join(root, "ended")).json()).reason).toBe("exit");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.each(["text", "stream-json"])(
  "%s exposes hook warnings, headless ask denial, and user messages",
  async (format) => {
    const root = await mkdtemp(join(tmpdir(), "rukie-cli-hooks-"));
    const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("bash", { description: "Run test command", command: "touch forbidden" }),
        {
          stopReason: "toolUse",
        },
      ),
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
          models: auxiliaryModels(faux.provider.streamSimple),
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

test("print reads stdin when the positional prompt is absent", async () => {
  const { exitCode, stdout } = await run([], "from pipe\n");
  expect(exitCode).toBe(0);
  expect(stdout).toBe('echo: [{"type":"text","text":"from pipe"}]\n');
});

test.each(["text", "stream-json"])(
  "%s reports hook_blocked without invoking the model",
  async (format) => {
    const root = await mkdtemp(join(tmpdir(), "rukie-cli-prompt-hook-"));
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
          models: auxiliaryModels((...args) => {
            modelCalls++;
            return fake.models.streamSimple(...args);
          }),
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
        expect(events.findLast((event) => event.type === "request_settled")).toMatchObject({
          type: "request_settled",
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
  const root = await mkdtemp(join(tmpdir(), "rukie-cli-rules-"));
  await mkdir(join(root, ".rukie", "file-history"), { recursive: true });
  const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
  faux.setResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("bash", { description: "Run test command", command }, { id: "allowed" }),
        fauxToolCall(
          "bash",
          { description: "Run test command", command: "printf unauthorized > forbidden" },
          { id: "denied" },
        ),
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
        session: {
          cwd: root,
          homeDir: root,
          model: faux.getModel(),
          models: auxiliaryModels(faux.provider.streamSimple),
        },
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
    const root = await mkdtemp(join(tmpdir(), "rukie-cli-subagent-"));
    await mkdir(join(root, ".rukie", "file-history"), { recursive: true });
    const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    const reply: Parameters<typeof faux.setResponses>[0][number] = (context) => {
      const last = context.messages.findLast(
        (message) =>
          message.role === "user" && !JSON.stringify(message.content).includes("<system-reminder>"),
      );
      if (last?.role === "user" && JSON.stringify(last.content).includes("child-prompt"))
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
            models: auxiliaryModels(faux.provider.streamSimple),
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
              event.event.messages.some(
                (message: { role: string }) => message.role === "assistant",
              ) &&
              event.event.messages.some(
                (message: { role: string; content: { type: string; text?: string }[] }) =>
                  message.role === "assistant" &&
                  message.content.some(
                    (block: { type: string; text?: string }) => block.text === "child-only text",
                  ),
              ),
          ),
        ).toBe(true);
        expect(
          wrapped.every(
            (event) =>
              event.sessionId !== event.event.sessionId && event.agentId === event.event.sessionId,
          ),
        ).toBe(true);
        expect(events.findLast((event) => event.type === "request_settled")).toMatchObject({
          type: "request_settled",
          text: "parent-only text",
        });
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
              models: auxiliaryModels(faux.provider.streamSimple),
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
  const root = await mkdtemp(join(tmpdir(), "rukie-cli-plan-"));
  try {
    const seed = await createSession({ cwd: root, homeDir: root, ...echoModel() });
    await seed.setPlanMode(true);
    await seed.close();
    const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
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
        session: {
          cwd: root,
          homeDir: root,
          model: faux.getModel(),
          models: auxiliaryModels(faux.provider.streamSimple),
        },
      }),
    ).toBe(0);
    const events = stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const start = events.find((event) => event.type === "snapshot");
    expect(start.agent.tools).not.toContain("exit_plan_mode");
    expect(start.agent.tools).not.toContain("enter_plan_mode");
    expect(events.findLast((event) => event.type === "request_settled")).toMatchObject({
      type: "request_settled",
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

test.each([false, true])(
  "Goal output and exit belong to the parent even when a child fails: %s",
  async (fail) => {
    const root = await mkdtemp(join(tmpdir(), "rukie-cli-goal-child-"));
    const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    let childResponded = false;
    const reply: Parameters<typeof faux.setResponses>[0][number] = (context) => {
      const last = context.messages.findLast(
        (message) =>
          message.role === "user" && !JSON.stringify(message.content).includes("<system-reminder>"),
      );
      if (last?.role === "user" && JSON.stringify(last.content).includes("child-prompt")) {
        childResponded = true;
        return fauxAssistantMessage(
          "child-only text",
          fail ? { stopReason: "error", errorMessage: "child failed" } : {},
        );
      }
      if (!JSON.stringify(context.messages).includes("<goal_complete>"))
        return fauxAssistantMessage(fauxToolCall("update_goal", { action: "complete" }), {
          stopReason: "toolUse",
        });
      return fauxAssistantMessage("parent-only text");
    };
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("subagent", { description: "Inspect", prompt: "child-prompt" }),
        { stopReason: "toolUse" },
      ),
      ...Array.from({ length: 8 }, () => reply),
    ]);
    let stdout = "";
    let stderr = "";
    try {
      const exitCode = await main(["--goal", "delegate and finish"], {
        readStdin: async () => {
          throw new Error("Goal must not read stdin");
        },
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
          models: auxiliaryModels(faux.provider.streamSimple),
        },
      });
      expect({ exitCode, stderr, stdout }).toMatchObject({ exitCode: 0 });
      expect(stdout).toBe("parent-only text\n");
      expect(childResponded).toBe(true);
      expect(stderr).not.toContain("child failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.each(["error", "length"] as const)(
  "Goal exits 1 after a Run ends with %s",
  async (stopReason) => {
    const root = await mkdtemp(join(tmpdir(), "rukie-cli-goal-outcome-"));
    const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage("partial work", {
        stopReason,
        ...(stopReason === "error" ? { errorMessage: "Goal failed" } : {}),
      }),
    ]);
    let stdout = "";
    let stderr = "";
    try {
      expect(
        await main(["--goal", "finish work"], {
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
            models: auxiliaryModels(faux.provider.streamSimple),
          },
        }),
      ).toBe(1);
      expect(stdout).toBe("partial work\n");
      if (stopReason === "error") expect(stderr).toContain("Goal failed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("Goal preserves SIGINT received while creation is still settling", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-cli-goal-create-abort-"));
  const controller = new AbortController();
  const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
  let modelCalled = false;
  faux.setResponses([
    () => {
      modelCalled = true;
      return fauxAssistantMessage("should not start", { stopReason: "length" });
    },
  ]);
  let stderr = "";
  try {
    const exitCode = await main(["--goal", "finish work"], {
      signal: controller.signal,
      readStdin: async () => "",
      stdout: () => {},
      stderr: (value) => {
        stderr += value;
        if (value.includes("auto-review")) controller.abort();
      },
      session: {
        cwd: root,
        homeDir: root,
        model: faux.getModel(),
        models: auxiliaryModels(faux.provider.streamSimple),
      },
    });
    expect(exitCode).toBe(130);
    expect(stderr).toContain("Interrupted");
    expect(modelCalled).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.each(["prompt", "stdin", "stdin-stream-json", "goal", "goal-interrupted"])(
  "CLI %s retains a user task while a startup hook autorun is active",
  async (source) => {
    const root = await mkdtemp(join(tmpdir(), "rukie-cli-async-hook-"));
    const controller = new AbortController();
    const firstCall = Promise.withResolvers<void>();
    const firstReply = Promise.withResolvers<void>();
    const contexts: string[] = [];
    const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([
      async (context) => {
        contexts.push(JSON.stringify(context.messages));
        firstCall.resolve();
        await firstReply.promise;
        return fauxAssistantMessage("autorun done");
      },
      (context) => {
        contexts.push(JSON.stringify(context.messages));
        if (source === "goal")
          return fauxAssistantMessage(fauxToolCall("update_goal", { action: "complete" }), {
            stopReason: "toolUse",
          });
        return fauxAssistantMessage("human done");
      },
      fauxAssistantMessage("goal wrapup"),
    ]);
    let stdout = "";
    let stderr = "";
    try {
      await Bun.write(
        join(root, "rewake.sh"),
        "cat >/dev/null\necho startup-background-failure >&2\ntouch background-exit\nexit 2\n",
      );
      const running = main(
        source === "prompt"
          ? ["-p", "actual human task"]
          : source.startsWith("goal")
            ? ["--goal", "actual human task"]
            : source === "stdin-stream-json"
              ? ["--output-format", "stream-json"]
              : [],
        {
          signal: controller.signal,
          readStdin: async () => {
            await firstCall.promise;
            return "actual human task";
          },
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
            models: auxiliaryModels(faux.provider.streamSimple),
            settings: {
              hooks: {
                SessionStart: [
                  {
                    hooks: [
                      { type: "command", command: "sh rewake.sh", asyncRewake: true },
                      {
                        type: "command",
                        command: "while [ ! -f background-exit ]; do sleep 0.01; done",
                      },
                    ],
                  },
                ],
                UserPromptSubmit: [
                  { hooks: [{ type: "command", command: "cat >> human-prompts" }] },
                ],
              },
            },
          },
        },
      );
      await firstCall.promise;
      expect(contexts[0]).toContain("startup-background-failure");
      expect(contexts[0]).not.toContain("actual human task");
      if (source === "goal-interrupted") {
        controller.abort();
        firstReply.resolve();
        expect(await running).toBe(130);
        expect(contexts).toHaveLength(1);
        expect(stderr).toContain("Interrupted");
        expect(await Bun.file(join(root, "human-prompts")).exists()).toBe(false);
        return;
      }
      firstReply.resolve();
      expect(await running).toBe(0);
      expect(contexts).toHaveLength(2);
      expect(contexts[1]).toContain("actual human task");
      if (source === "goal")
        expect(await Bun.file(join(root, "human-prompts")).exists()).toBe(false);
      else
        expect(
          (await Bun.file(join(root, "human-prompts")).text()).match(/hook_event_name/g),
        ).toHaveLength(1);
      if (source === "stdin-stream-json") {
        const events = stdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        const human = events.filter(
          (event) => event.type === "request_settled" && event.text === "human done",
        );
        expect(human).toHaveLength(1);
        const startup = events.filter(
          (event) => event.type === "request_settled" && event.text === "autorun done",
        );
        expect(startup.length).toBeLessThanOrEqual(1);
        if (startup.length) expect(startup[0].requestId).not.toBe(human[0].requestId);
        else
          // Startup may commit before createSession returns; the initial snapshot owns that history.
          expect(JSON.stringify(events[0].messages)).toContain("autorun done");
        expect(
          events.filter(
            (event) =>
              event.type === "message_end" &&
              event.messages.some((message: { role: string }) => message.role === "user"),
          ),
        ).toHaveLength(1);
        expect(JSON.stringify(events[0].messages)).toContain("startup-background-failure");
      } else expect(stdout).toBe(source === "goal" ? "goal wrapup\n" : "human done\n");
      expect(stderr).not.toContain("Session already has an active Run");
    } finally {
      firstReply.resolve();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test.each(["text", "stream-json"])(
  "Headless %s reports OAuth login requirements and completes without auth tools",
  async (format) => {
    const root = await mkdtemp(join(tmpdir(), "rukie-cli-mcp-oauth-"));
    const server = mcpOAuthServer();
    let stdout = "";
    let stderr = "";
    try {
      await Bun.write(
        join(root, ".rukie/mcp.json"),
        JSON.stringify({ mcpServers: { srv: { type: "http", url: server.url } } }),
      );
      const exitCode = await main(["-p", "continue", "--output-format", format], {
        readStdin: async () => "",
        stdout: (text) => {
          stdout += text;
        },
        stderr: (text) => {
          stderr += text;
        },
        session: { cwd: root, homeDir: root, ...echoModel() },
      });
      expect(exitCode).toBe(0);
      expect(stderr).toContain("needs authentication; run /mcp login srv in the TUI");
      if (format === "stream-json") {
        const events: unknown[] = stdout
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        expect(
          events.filter(
            (event) =>
              typeof event === "object" &&
              event !== null &&
              "type" in event &&
              event.type === "mcp_auth_required",
          ),
        ).toMatchObject([{ server: "srv" }]);
        expect(
          events.filter(
            (event) =>
              typeof event === "object" &&
              event !== null &&
              "type" in event &&
              event.type === "mcp_server_error",
          ),
        ).toHaveLength(0);
        expect(stdout).not.toContain("mcp__srv__authenticate");
        expect(
          events.findLast(
            (event) =>
              typeof event === "object" &&
              event !== null &&
              "type" in event &&
              event.type === "request_settled",
          ),
        ).toMatchObject({
          type: "request_settled",
          success: true,
        });
      } else expect(stdout).toContain("echo:");
    } finally {
      await server.stop();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("Headless calls real MCP tools using credentials written by an earlier Session login", async () => {
  const root = await mkdtemp(join(tmpdir(), "rukie-cli-mcp-credentials-"));
  const server = mcpOAuthServer();
  try {
    await Bun.write(
      join(root, ".rukie/mcp.json"),
      JSON.stringify({ mcpServers: { srv: { url: server.url } } }),
    );
    const seed = await createSession({
      cwd: root,
      homeDir: root,
      ...echoModel(),
      onMcpAuth: async ({ authorizationUrl }) => {
        const response = await fetch(authorizationUrl, { redirect: "manual" });
        const url = response.headers.get("location");
        if (!url) throw new Error("Missing callback");
        return { type: "callback-url", url };
      },
    });
    try {
      await seed.authenticateMcp("srv");
    } finally {
      await seed.close();
    }
    expect(await Bun.file(join(root, ".rukie/credentials.json")).exists()).toBe(true);
    const faux = fauxProvider({ api: "faux", provider: "faux", tokensPerSecond: 0 });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("mcp__srv__echo", { text: "hello" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("authorized"),
    ]);
    let stdout = "";
    let stderr = "";
    const exitCode = await main(["-p", "call MCP", "--yolo", "--output-format", "stream-json"], {
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
        models: auxiliaryModels(faux.provider.streamSimple),
      },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("OAuth MCP: called");
    expect(stdout).not.toContain("mcp__srv__authenticate");
    expect(stderr).toBe("");
  } finally {
    await server.stop();
    await rm(root, { recursive: true, force: true });
  }
});
