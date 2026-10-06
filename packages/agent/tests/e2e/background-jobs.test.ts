import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { dirname, join } from "node:path";
import { stat } from "node:fs/promises";
import { createSession, type Session } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
let session: Session | undefined;
afterEach(async () => {
  await session?.dispose();
  session = undefined;
  await dirs?.cleanup();
});

const call = (name: string, args: Parameters<typeof fauxToolCall>[1] = {}) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
function resultText(messages: Session["messages"]) {
  const result = messages.findLast((message) => message.role === "toolResult");
  return result?.content.map((item) => (item.type === "text" ? item.text : "")).join("");
}

async function waitFile(name: string) {
  const path = join(dirs.cwd, name);
  const deadline = Date.now() + 2000;
  while (!(await Bun.file(path).exists())) {
    if (Date.now() > deadline) throw new Error(`Missing command marker ${name}`);
    await Bun.sleep(5);
  }
  return Bun.file(path).text();
}

async function expectDead(pid: number) {
  const deadline = Date.now() + 1000;
  while (true) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    if (Date.now() > deadline) throw new Error(`Process ${pid} survived termination`);
    await Bun.sleep(5);
  }
}

test("aborting a job_output wait leaves the background process alive for the next Run", async () => {
  dirs = await tempDirs();
  let fake = fakeModel([
    call("bash", {
      command: "printf '%s' $$ > pid; while [ ! -e go ]; do sleep 0.01; done; printf final",
      description: "Wait for final output",
      run_in_background: true,
    }),
    fauxAssistantMessage("started"),
    call("job_output", { job_id: "bash-1", wait: true }),
  ]);
  session = await createSession({
    ...dirs,
    model: fake.model,
    streamFn: (model, context, options) => fake.streamFn(model, context, options),
    allowRules: ["bash"],
    settings: {
      permissions: { ask: ["job_output"] },
      hooks: {
        PreToolUse: [
          {
            matcher: "job_output",
            hooks: [
              {
                type: "command",
                command: `printf '%s' '{"hookSpecificOutput":{"permissionDecision":"ask"}}'`,
              },
            ],
          },
        ],
      },
    },
  });
  await session.run("start");
  const pid = Number(await waitFile("pid"));
  const controller = new AbortController();
  const waiting = Promise.withResolvers<void>();
  const collected = Promise.withResolvers<void>();
  let collecting = false;
  const run = session.run("wait", {
    signal: controller.signal,
    onEvent(event) {
      if (event.type === "tool_execution_start" && event.toolName === "job_output")
        waiting.resolve();
      if (event.type === "result" && collecting) collected.resolve();
    },
  });
  void run.catch(() => {});
  await waiting.promise;
  controller.abort(new Error("stop waiting"));
  await expect(run).rejects.toThrow("stop waiting");
  expect(() => process.kill(pid, 0)).not.toThrow();
  fake = fakeModel([
    call("job_output", { job_id: "bash-1", wait: true }),
    fauxAssistantMessage("read"),
  ]);
  collecting = true;
  await Bun.write(join(dirs.cwd, "go"), "");
  await collected.promise;
  expect(resultText(session.messages)).toContain("final");
});

test.each(["job_kill", "dispose"])(
  "%s terminates a shell, child, and grandchild",
  async (action) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      call("bash", {
        command: `printf '%s' "$$" > parent; bash -c 'printf "%s" "$$" > child; sleep 30 & printf "%s" "$!" > grandchild; wait' & wait`,
        description: "Start nested background processes",
        run_in_background: true,
      }),
      fauxAssistantMessage("started"),
      call("job_kill", { job_id: "bash-1", reason: "test cleanup" }),
      call("job_output", { job_id: "bash-1", wait: true }),
      fauxAssistantMessage("killed"),
    ]);
    session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
    await session.run("start tree");
    const pids = await Promise.all(
      ["parent", "child", "grandchild"].map(async (name) => Number(await waitFile(name))),
    );
    for (const pid of pids) expect(() => process.kill(pid, 0)).not.toThrow();
    if (action === "dispose") await session.dispose();
    else {
      await session.run("kill tree");
      expect(resultText(session.messages)).toBe("(no new output)\n[status: killed]");
    }
    await Promise.all(pids.map(expectDead));
  },
);

test("the eleventh running background job fails with a coded limit while foreground stays invisible", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    ...Array.from({ length: 11 }, () =>
      call("bash", {
        command: "while [ ! -e go ]; do sleep 0.01; done",
        description: "Wait for capacity release",
        run_in_background: true,
      }),
    ),
    call("bash", { command: "true", description: "Complete foreground command" }),
    call("job_list"),
    fauxAssistantMessage("done"),
  ]);
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  await session.run("start eleven jobs");
  const limited = fake.contexts[11]!.messages.at(-1);
  expect(limited).toMatchObject({
    role: "toolResult",
    isError: true,
    details: { code: "background-job-limit", params: { limit: 10 } },
  });
  expect(JSON.stringify(limited)).toContain(
    "background job limit reached for this owner (limit: 10)",
  );
  expect(resultText(session.messages)!.split("\n")).toHaveLength(10);
  expect(resultText(session.messages)).not.toContain("Complete foreground command");
});

test("Session Resume starts with no jobs and explains an old job id", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command: "while [ ! -e go ]; do sleep 0.01; done",
      description: "Start original session process",
      run_in_background: true,
    }),
    fauxAssistantMessage("started"),
  ]);
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  await session.run("start");
  const id = session.id;
  await session.dispose();
  const resumed = fakeModel([
    call("job_list"),
    call("job_output", { job_id: "bash-1" }),
    fauxAssistantMessage("done"),
  ]);
  session = await createSession({ ...dirs, ...resumed, resumeId: id });
  await session.run("recover");
  expect(resumed.contexts[1]!.messages.at(-1)).toMatchObject({
    content: [{ type: "text", text: "(no background jobs)" }],
  });
  expect(resultText(session.messages)).toBe(
    "unknown job bash-1; background jobs do not survive a session restart",
  );
});

test("dispose cleans a foreground descendant even after its shell closes its output", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command: "sleep 30 >/dev/null 2>&1 & printf '%s' $! > child",
      description: "Launch child with closed output",
    }),
    call("job_list"),
    fauxAssistantMessage("done"),
  ]);
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  await session.run("start foreground");
  const pid = Number(await waitFile("child"));
  try {
    expect(resultText(session.messages)).toBe("(no background jobs)");
    await session.dispose();
    await expectDead(pid);
  } finally {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* Already terminated. */
    }
  }
});

test.each(["ask", "auto-review", "full-access"] as const)(
  "job tools bypass Permission Mode %s while their hooks still execute",
  async (permissionMode) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      call("bash", {
        command: "while [ ! -e go ]; do sleep 0.01; done",
        description: "Run permitted background process",
        run_in_background: true,
      }),
      call("job_list"),
      call("job_output", { job_id: "bash-1" }),
      call("job_kill", { job_id: "bash-1" }),
      fauxAssistantMessage("done"),
    ]);
    let asks = 0;
    session = await createSession({
      ...dirs,
      ...fake,
      permissionMode,
      allowRules: ["bash"],
      onPermissionAsk: async () => {
        asks++;
        return "deny";
      },
      settings: {
        hooks: {
          PreToolUse: [
            {
              hooks: [
                { type: "command", command: "cat >> hook-inputs; printf '\\n' >> hook-inputs" },
              ],
            },
          ],
        },
      },
    });
    await session.setPlanMode(true);
    await session.run("manage process");
    expect(asks).toBe(0);
    const inputs: unknown[] = (await Bun.file(join(dirs.cwd, "hook-inputs")).text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(inputs).toMatchObject([
      { tool_name: "bash", tool_input: { run_in_background: true } },
      { tool_name: "job_list" },
      { tool_name: "job_output" },
      { tool_name: "job_kill" },
    ]);
    expect(resultText(session.messages)).toBe("requested cancellation of job bash-1");
    expect(JSON.stringify(fake.contexts[0]!.messages)).toContain(
      "Track every background job id you start.",
    );
  },
);

test("bash deny rules and job hook denials still block background operations", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command: "touch denied",
      description: "Attempt denied background command",
      run_in_background: true,
    }),
    call("job_list"),
    fauxAssistantMessage("done"),
  ]);
  session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: {
      permissions: { deny: ["bash"] },
      hooks: {
        PreToolUse: [
          {
            matcher: "job_list",
            hooks: [
              {
                type: "command",
                command:
                  'printf \'%s\' \'{"hookSpecificOutput":{"permissionDecision":"deny","permissionDecisionReason":"protected roster"}}\'',
              },
            ],
          },
        ],
      },
    },
  });
  await session.run("try denied operations");
  expect(JSON.stringify(fake.contexts[1]!.messages.at(-1))).toContain(
    "Denied by permission rule: bash",
  );
  expect(resultText(session.messages)).toContain("Denied by hook: protected roster");
  expect(await Bun.file(join(dirs.cwd, "denied")).exists()).toBe(false);
});

for (const source of ["rule", "hook"] as const) {
  for (const permissionMode of ["ask", "auto-review", "full-access"] as const) {
    for (const callback of [true, false]) {
      test(`job tools skip ${source} approval in ${permissionMode} with callback ${callback}`, async () => {
        dirs = await tempDirs();
        const fake = fakeModel([
          call("bash", {
            command: "while [ ! -e go ]; do sleep 0.01; done",
            description: "Run permitted background process",
            run_in_background: true,
          }),
          call("job_list"),
          call("job_output", { job_id: "bash-1" }),
          call("job_kill", { job_id: "bash-1" }),
          fauxAssistantMessage("done"),
        ]);
        const asks: string[] = [];
        session = await createSession({
          ...dirs,
          ...fake,
          permissionMode,
          allowRules: ["bash"],
          ...(callback && {
            onPermissionAsk: async (request) => {
              asks.push(request.toolName);
              return "deny" as const;
            },
          }),
          settings: {
            permissions: source === "rule" ? { ask: ["job_list", "job_output", "job_kill"] } : {},
            hooks: {
              PreToolUse: [
                {
                  matcher: "job_.*",
                  hooks: [
                    {
                      type: "command",
                      command: `cat >> pre-inputs; printf '\\n' >> pre-inputs; printf '%s' '${JSON.stringify({ hookSpecificOutput: { ...(source === "hook" && { permissionDecision: "ask" }) } })}'`,
                    },
                  ],
                },
              ],
              PostToolUse: [
                {
                  matcher: "job_.*",
                  hooks: [
                    { type: "command", command: "cat >> post-inputs; printf '\\n' >> post-inputs" },
                  ],
                },
              ],
              PermissionRequest: [
                {
                  matcher: "job_.*",
                  hooks: [{ type: "command", command: "touch requested; exit 2" }],
                },
              ],
              Notification: [{ hooks: [{ type: "command", command: "touch notified" }] }],
            },
          },
        });
        await session.setPlanMode(true);
        await session.run("manage process without approval");
        expect(asks).toEqual([]);
        const results = session.messages.filter(
          (message) => message.role === "toolResult" && message.toolName.startsWith("job_"),
        );
        expect(results).toHaveLength(3);
        expect(results.every((message) => message.role === "toolResult" && !message.isError)).toBe(
          true,
        );
        expect(resultText(session.messages)).toBe("requested cancellation of job bash-1");
        for (const name of ["pre-inputs", "post-inputs"]) {
          const inputs: unknown[] = (await Bun.file(join(dirs.cwd, name)).text())
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line));
          expect(inputs).toMatchObject([
            { tool_name: "job_list" },
            { tool_name: "job_output" },
            { tool_name: "job_kill" },
          ]);
        }
        expect(await Bun.file(join(dirs.cwd, "requested")).exists()).toBe(false);
        expect(await Bun.file(join(dirs.cwd, "notified")).exists()).toBe(false);
      });
    }
  }
}

test.each(["rewrite", "invalid", "deny", "exit2", "stop"] as const)(
  "job approval exception retains PreToolUse %s behavior",
  async (behavior) => {
    dirs = await tempDirs();
    const fake = fakeModel([
      call("bash", {
        command: "while :; do sleep 0.01; done",
        description: "First job",
        run_in_background: true,
      }),
      call("bash", {
        command: "while :; do sleep 0.01; done",
        description: "Second job",
        run_in_background: true,
      }),
      call("job_kill", { job_id: "bash-1" }),
      fauxAssistantMessage("done"),
    ]);
    const payload =
      behavior === "stop"
        ? { continue: false, stopReason: "Keep both jobs" }
        : {
            hookSpecificOutput: {
              permissionDecision: behavior === "deny" ? "deny" : "ask",
              permissionDecisionReason: "Keep both jobs",
              ...(behavior === "rewrite" && { updatedInput: { job_id: "bash-2" } }),
              ...(behavior === "invalid" && { updatedInput: { job_id: 2 } }),
            },
            reason: "Keep both jobs",
          };
    session = await createSession({
      ...dirs,
      ...fake,
      allowRules: ["bash"],
      settings: {
        permissions: { ask: ["job_kill"] },
        hooks: {
          PreToolUse: [
            {
              matcher: "job_kill",
              hooks: [
                {
                  type: "command",
                  command: `printf '%s' '${JSON.stringify(payload)}'${behavior === "exit2" ? "; exit 2" : ""}`,
                },
              ],
            },
          ],
        },
      },
    });
    const outcome = await session.run("manage jobs with a hook");
    const jobs = session.jobs();
    expect(jobs[0]!.status).toBe("running");
    if (behavior === "rewrite") {
      expect(resultText(session.messages)).toBe("requested cancellation of job bash-2");
      expect(["stopping", "killed"]).toContain(jobs[1]!.status);
    } else {
      expect(jobs[1]!.status).toBe("running");
      if (behavior === "stop") expect(outcome.stopReason).toBe("hook_stopped");
      else
        expect(session.messages.findLast((message) => message.role === "toolResult")).toMatchObject(
          { isError: true },
        );
    }
  },
);

test("explicit job deny rules and background bash ask remain effective", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("job_list"),
    call("job_output", { job_id: "bash-1" }),
    call("job_kill", { job_id: "bash-1" }),
    call("bash", {
      command: "touch denied",
      description: "Ask for background launch",
      run_in_background: true,
    }),
    fauxAssistantMessage("done"),
  ]);
  const asks: string[] = [];
  session = await createSession({
    ...dirs,
    ...fake,
    permissionMode: "full-access",
    settings: { permissions: { deny: ["job_list", "job_output", "job_kill"], ask: ["bash"] } },
    onPermissionAsk: async (request) => {
      asks.push(request.toolName);
      return "deny";
    },
  });
  await session.run("try blocked operations");
  expect(asks).toEqual(["bash"]);
  for (const toolName of ["job_list", "job_output", "job_kill"]) {
    expect(
      session.messages.find(
        (message) => message.role === "toolResult" && message.toolName === toolName,
      ),
    ).toMatchObject({
      isError: true,
      content: [{ type: "text", text: `Denied by permission rule: ${toolName}` }],
    });
  }
  expect(session.jobs()).toEqual([]);
  expect(await Bun.file(join(dirs.cwd, "denied")).exists()).toBe(false);
});

test("dispose bounds output draining when a descendant leaves the process group", async () => {
  dirs = await tempDirs();
  await Bun.write(
    join(dirs.cwd, "escape.ts"),
    `import { spawn } from "node:child_process";
spawn("bash", ["-c", "printf '%s' $$ > escaped; while [ ! -e go ]; do sleep 0.01; done"], {
  detached: true, stdio: ["ignore", "inherit", "inherit"],
}).unref();
`,
  );
  const fake = fakeModel([
    call("bash", {
      command: `${process.execPath} escape.ts`,
      description: "Start escaped process group",
      run_in_background: true,
    }),
    fauxAssistantMessage("started"),
  ]);
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  await session.run("start");
  const pid = Number(await waitFile("escaped"));
  try {
    const start = Date.now();
    await session.dispose();
    expect(Date.now() - start).toBeLessThan(4500);
    // Detached groups are outside Neant's process-group termination contract.
    expect(() => process.kill(pid, 0)).not.toThrow();
  } finally {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      /* Already terminated. */
    }
    await expectDead(pid);
  }
});

test("a settled job retains only a 16 KiB tail but spills its complete stdout and stderr", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command:
        "printf '%s' $$ > pid; for ((i=0; i<20000; i++)); do printf o; done; printf error >&2; touch ready; while [ ! -e go ]; do sleep 0.01; done",
      description: "Print output before completion",
      run_in_background: true,
    }),
    fauxAssistantMessage("started"),
    call("job_output", { job_id: "bash-1", wait: true }),
    fauxAssistantMessage("collected"),
  ]);
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  const collected = Promise.withResolvers<void>();
  let results = 0;
  await session.run("start", {
    onEvent(event) {
      if (event.type === "result" && ++results === 2) collected.resolve();
    },
  });
  const pid = Number(await waitFile("pid"));
  await waitFile("ready");
  await Bun.write(join(dirs.cwd, "go"), "");
  await expectDead(pid);
  await collected.promise;
  const text = resultText(session.messages)!;
  expect(text).toContain("[stderr]\nerror");
  expect(text).toEndWith("[status: completed, exit code: 0]");
  expect(text.split("\n")[0]!.length).toBe(16379);
  const spill = /full output: (.+)\]/.exec(text)?.[1];
  if (!spill) throw new Error("Missing full output path");
  expect(await Bun.file(spill).text()).toBe("o".repeat(20000) + "error");
});

test("large background output keeps a valid UTF-8 tail and its full private spill", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command: `for ((i=0; i<100000; i++)); do printf 前; done; touch ready; while [ ! -e go ]; do sleep 0.01; done`,
      description: "Print large Unicode output",
      run_in_background: true,
    }),
    fauxAssistantMessage("started"),
    call("job_output", { job_id: "bash-1", wait: true, timeout_ms: 100 }),
    fauxAssistantMessage("read"),
  ]);
  session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await session.run("start");
  await waitFile("ready");
  await session.run("read");
  const text = resultText(session.messages)!;
  expect(text).not.toContain("�");
  expect(text).toContain("some output was dropped from memory");
  const spill = /full output: (.+)\]/.exec(text)?.[1];
  if (!spill) throw new Error("Missing spill path");
  expect(await Bun.file(spill).text()).toBe("前".repeat(100000));
  expect((await stat(dirname(spill))).mode & 0o777).toBe(0o700);
  await session.dispose();
  expect(await Bun.file(spill).exists()).toBe(false);
});

test("background bash returns immediately and remains listed after its Run", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command: "while [ ! -e go ]; do sleep 0.01; done",
      description: "Wait for release file",
      run_in_background: true,
      timeout: 0.001,
    }),
    call("job_list"),
    fauxAssistantMessage("done"),
    call("job_list"),
    call("job_kill", { job_id: "bash-1" }),
    fauxAssistantMessage("stopped"),
  ]);
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  expect((await session.run("start job")).text).toBe("done");
  expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
    role: "toolResult",
    isError: false,
    content: [{ type: "text", text: "started background job bash-1" }],
    details: { jobId: "bash-1" },
  });
  expect(resultText(session.messages)).toBe("bash-1 [bash] running — Wait for release file");
  await session.run("stop job");
  expect(resultText(session.messages)).toBe("requested cancellation of job bash-1");
  expect(await Bun.file(join(dirs.cwd, "go")).exists()).toBe(false);
});

test("job_output consumes stdout and stderr once, waits for completion, and reports empty reads", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command:
        "printf first; touch ready; while [ ! -e next ]; do sleep 0.01; done; printf second >&2; touch second-ready; while [ ! -e go ]; do sleep 0.01; done; exit 7",
      description: "Produce controlled output phases",
      run_in_background: true,
    }),
    fauxAssistantMessage("started"),
    call("job_output", { job_id: "bash-1", wait: true }),
    fauxAssistantMessage("first"),
    call("job_output", { job_id: "bash-1", wait: true, timeout_ms: 10 }),
    fauxAssistantMessage("quiet"),
    call("job_output", { job_id: "bash-1", wait: true }),
    fauxAssistantMessage("second"),
    call("job_output", { job_id: "bash-1", wait: true }),
    fauxAssistantMessage("finished"),
    call("job_kill", { job_id: "bash-1" }),
    fauxAssistantMessage("collected"),
  ]);
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  await session.run("start");
  await waitFile("ready");
  await session.run("read first");
  expect(resultText(session.messages)).toBe("first\n[status: running]");
  await session.run("wait briefly");
  expect(resultText(session.messages)).toBe("(no new output)\n[status: running]");
  await Bun.write(join(dirs.cwd, "next"), "");
  await waitFile("second-ready");
  await session.run("read second");
  expect(resultText(session.messages)).toBe("[stderr]\nsecond\n[status: running]");
  await Bun.write(join(dirs.cwd, "go"), "");
  await session.run("collect");
  expect(resultText(session.messages)).toBe("(no new output)\n[status: failed, exit code: 7]");
  await session.run("kill finished");
  expect(resultText(session.messages)).toBe(
    "job bash-1 had already finished [status: failed, exit code: 7]",
  );
  expect(fake.contexts).toHaveLength(12);
});

test("timeout promotion hands off newer output and job_kill terminates the continuing process", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command:
        "printf '%s' $$ > pid; printf before; while [ ! -e next ]; do sleep 0.01; done; printf after; printf error >&2; touch ready; while [ ! -e go ]; do sleep 0.01; done",
      description: "Produce output across timeout",
      timeout: 0.2,
    }),
    call("job_list"),
    fauxAssistantMessage("promoted"),
    call("job_output", { job_id: "bash-1", wait: true }),
    call("job_kill", { job_id: "bash-1" }),
    call("job_output", { job_id: "bash-1", wait: true }),
    fauxAssistantMessage("stopped"),
  ]);
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  await session.run("start slow command");
  expect(fake.contexts[1]!.messages.at(-1)).toMatchObject({
    isError: false,
    details: { jobId: "bash-1" },
  });
  expect(resultText(fake.contexts[1]!.messages)).toStartWith(
    "before\n[still running after 0.2s; moved to background job bash-1]",
  );
  expect(resultText(session.messages)).toBe(
    "bash-1 [bash] running — Produce output across timeout",
  );
  const pid = Number(await waitFile("pid"));
  expect(() => process.kill(pid, 0)).not.toThrow();
  await Bun.write(join(dirs.cwd, "next"), "");
  await waitFile("ready");
  await session.run("read newer output and stop");
  expect(resultText(fake.contexts[4]!.messages)).toBe("after\n[stderr]\nerror\n[status: running]");
  expect(resultText(session.messages)).toBe("(no new output)\n[status: killed]");
  await expectDead(pid);
});

test("timeout promotion exceeds ten running background jobs without applying the explicit-start limit", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    ...Array.from({ length: 10 }, () =>
      call("bash", {
        command: "while [ ! -e go ]; do sleep 0.01; done",
        description: "Keep explicit job running",
        run_in_background: true,
      }),
    ),
    call("bash", {
      command: "while [ ! -e go ]; do sleep 0.01; done",
      description: "Promote beyond background limit",
      timeout: 0.05,
    }),
    call("job_list"),
    fauxAssistantMessage("done"),
  ]);
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  await session.run("start full quota then foreground command");
  expect(fake.contexts[11]!.messages.at(-1)).toMatchObject({
    isError: false,
    details: { jobId: "bash-11" },
  });
  expect(resultText(session.messages)!.split("\n")).toHaveLength(11);
  expect(resultText(session.messages)).toContain(
    "bash-11 [bash] running — Promote beyond background limit",
  );
});

test("aborting the Run after timeout promotion leaves the job available to the next Run", async () => {
  dirs = await tempDirs();
  let fake = fakeModel([
    call("bash", {
      command: "printf '%s' $$ > pid; while [ ! -e go ]; do sleep 0.01; done",
      description: "Continue after Run interruption",
      timeout: 0.05,
    }),
    call("job_output", { job_id: "bash-1", wait: true }),
  ]);
  session = await createSession({
    ...dirs,
    model: fake.model,
    streamFn: (model, context, options) => fake.streamFn(model, context, options),
    allowRules: ["bash"],
  });
  const controller = new AbortController();
  const waiting = Promise.withResolvers<void>();
  const run = session.run("start then wait", {
    signal: controller.signal,
    onEvent(event) {
      if (event.type === "tool_execution_start" && event.toolName === "job_output")
        waiting.resolve();
    },
  });
  void run.catch(() => {});
  await waiting.promise;
  const pid = Number(await waitFile("pid"));
  controller.abort(new Error("interrupt promoted Run"));
  await expect(run).rejects.toThrow("interrupt promoted Run");
  expect(() => process.kill(pid, 0)).not.toThrow();
  fake = fakeModel([
    call("job_list"),
    call("job_kill", { job_id: "bash-1" }),
    call("job_output", { job_id: "bash-1", wait: true }),
    fauxAssistantMessage("stopped"),
  ]);
  await session.run("stop surviving job");
  expect(
    session.messages.findLast(
      (message) => message.role === "toolResult" && message.toolName === "job_list",
    ),
  ).toMatchObject({
    content: [{ type: "text", text: "bash-1 [bash] running — Continue after Run interruption" }],
  });
  expect(resultText(session.messages)).toBe("(no new output)\n[status: killed]");
  await expectDead(pid);
});

test("foreground bash stays absent from job_list while running and after finishing before timeout", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    fauxAssistantMessage(
      [
        fauxToolCall("bash", {
          command: "while [ ! -e go ]; do sleep 0.01; done; printf complete",
          description: "Finish controlled foreground command",
        }),
        fauxToolCall("job_list", {}),
      ],
      { stopReason: "toolUse" },
    ),
    call("job_list"),
    fauxAssistantMessage("done"),
  ]);
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  await session.run("inspect foreground visibility", {
    async onEvent(event) {
      if (event.type === "tool_execution_end" && event.toolName === "job_list")
        await Bun.write(join(dirs.cwd, "go"), "");
    },
  });
  const first = fake.contexts[1]!.messages.filter((message) => message.role === "toolResult");
  expect(first.find((message) => message.toolName === "bash")).toMatchObject({
    isError: false,
    content: [{ type: "text", text: "complete" }],
  });
  expect(first.find((message) => message.toolName === "job_list")).toMatchObject({
    content: [{ type: "text", text: "(no background jobs)" }],
  });
  expect(resultText(session.messages)).toBe("(no background jobs)");
});

test("a timeout-promoted job completing while idle notifies a new Run and preserves its final output", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command: "printf '%s' $$ > pid; while [ ! -e go ]; do sleep 0.01; done; printf final",
      description: "Finish timeout promoted command",
      timeout: 0.05,
    }),
    fauxAssistantMessage("promoted"),
    call("job_output", { job_id: "bash-1", wait: true }),
    fauxAssistantMessage("completion handled"),
  ]);
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  const notified = Promise.withResolvers<void>();
  let results = 0;
  await session.run("start slow command", {
    onEvent(event) {
      if (event.type === "result" && ++results === 2) notified.resolve();
    },
  });
  expect(results).toBe(1);
  const pid = Number(await waitFile("pid"));
  expect(() => process.kill(pid, 0)).not.toThrow();
  await Bun.write(join(dirs.cwd, "go"), "");
  await notified.promise;
  await session.waitForIdle();
  expect(fake.contexts).toHaveLength(4);
  expect(fake.contexts[2]!.messages.at(-1)).toMatchObject({
    role: "user",
    content: [
      {
        type: "text",
        text: "background job bash-1 (bash: Finish timeout promoted command) finished [status: completed, exit code: 0]. Read its output with job_output.",
      },
    ],
  });
  expect(resultText(session.messages)).toBe("final\n[status: completed, exit code: 0]");
  expect(results).toBe(2);
  await expectDead(pid);
});
