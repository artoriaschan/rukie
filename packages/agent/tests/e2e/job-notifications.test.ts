import { withModelStream, modelStream } from "../helpers/auxiliary-model.ts";
import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { createSession, type Session } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
  await dirs?.cleanup();
});

const call = (name: string, args: Parameters<typeof fauxToolCall>[1] = {}) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
const notification =
  "background job bash-1 (bash: Wait for job release) finished [status: completed, exit code: 0]. Read its output with job_output.";

async function waitFor(check: () => boolean | Promise<boolean>, description: string) {
  const deadline = Date.now() + 2000;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${description}`);
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

test("an idle Background Job completion starts a Run and retains its observer", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command: "while [ ! -e go ]; do sleep 0.01; done",
      description: "Wait for job release",
      run_in_background: true,
    }),
    fauxAssistantMessage("started"),
    fauxAssistantMessage("completion handled"),
  ]);
  let results = 0;
  session = await createSession({
    ...dirs,
    ...fake,
    allowRules: ["bash"],
    settings: {
      hooks: {
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "cat >> prompts" }] }],
      },
    },
  });
  session.subscribe((event) => {
    if (event.type === "result") results++;
  });
  await session.run("start");
  expect(results).toBe(1);
  expect(session.running).toBe(false);
  await Bun.write(join(dirs.cwd, "go"), "");
  await waitFor(() => results === 2, "completion Run");
  expect(fake.contexts).toHaveLength(3);
  expect(fake.contexts[2]!.messages.findLast((message) => message.role === "user")).toMatchObject({
    role: "user",
    content: [{ type: "text", text: notification }],
  });
  expect((await Bun.file(join(dirs.cwd, "prompts")).text()).match(/hook_event_name/g)).toHaveLength(
    1,
  );
});

test("a Background Job finishing during a Run notifies the next model request once", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command: "printf '%s' $$ > pid; while [ ! -e go ]; do sleep 0.01; done",
      description: "Wait for job release",
      run_in_background: true,
    }),
    call("bash", {
      command:
        'while [ ! -e pid ]; do sleep 0.01; done; read -r pid < pid; touch go; while kill -0 "$pid" 2>/dev/null; do sleep 0.01; done',
      description: "Release and await background shell",
    }),
    fauxAssistantMessage("completion handled"),
  ]);
  session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  let results = 0;
  const result = await session.run("start and release", {
    onEvent(event) {
      if (event.type === "result") results++;
    },
  });
  expect(result.text).toBe("completion handled");
  expect(results).toBe(1);
  expect(fake.contexts).toHaveLength(3);
  expect(fake.contexts[2]!.messages).toContainEqual(
    expect.objectContaining({
      role: "user",
      content: [{ type: "text", text: notification }],
    }),
  );
  expect(session.messages.filter((message) => message.role === "user")).toHaveLength(2);
});

test("a completion collected by a pending wait is not notified", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command: "while [ ! -e go ]; do sleep 0.01; done",
      description: "Wait for job release",
      run_in_background: true,
    }),
    call("job_output", { job_id: "bash-1", wait: true }),
    fauxAssistantMessage("collected"),
  ]);
  const waiting = Promise.withResolvers<void>();
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  let results = 0;
  const run = session.run("collect completion", {
    onEvent(event) {
      if (event.type === "tool_execution_start" && event.toolName === "job_output")
        waiting.resolve();
      if (event.type === "result") results++;
    },
  });
  await waiting.promise;
  await Bun.write(join(dirs.cwd, "go"), "");
  expect((await run).text).toBe("collected");
  await session.waitForIdle();
  expect(results).toBe(1);
  expect(fake.contexts).toHaveLength(3);
  expect(
    fake.contexts[2]!.messages.findLast((message) => message.role === "toolResult"),
  ).toMatchObject({
    role: "toolResult",
    content: [{ type: "text", text: "(no new output)\n[status: completed, exit code: 0]" }],
  });
  expect(session.messages.filter((message) => message.role === "user")).toHaveLength(1);
});

test("model job_kill suppresses completion without requiring a wait collection", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command: "printf '%s' $$ > pid; while [ ! -e go ]; do sleep 0.01; done",
      description: "Wait for job release",
      run_in_background: true,
    }),
    async () => {
      await waitFor(() => Bun.file(join(dirs.cwd, "pid")).exists(), "job pid");
      return call("job_kill", { job_id: "bash-1" });
    },
    call("bash", {
      command: 'read -r pid < pid; while kill -0 "$pid" 2>/dev/null; do sleep 0.01; done',
      description: "Await cancelled process exit",
    }),
    call("job_list"),
    fauxAssistantMessage("cancelled"),
  ]);
  session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  await session.run("cancel background job");
  await session.waitForIdle();
  expect(fake.contexts).toHaveLength(5);
  expect(
    fake.contexts[4]!.messages.findLast((message) => message.role === "toolResult"),
  ).toMatchObject({
    content: [{ type: "text", text: "bash-1 [bash] killed — Wait for job release" }],
  });
  expect(session.messages.filter((message) => message.role === "user")).toHaveLength(1);
});

test("Session teardown stops a Background Job without waking its observer", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command: "printf '%s' $$ > pid; while [ ! -e go ]; do sleep 0.01; done",
      description: "Wait for job release",
      run_in_background: true,
    }),
    fauxAssistantMessage("started"),
  ]);
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  let results = 0;
  await session.run("start", {
    onEvent(event) {
      if (event.type === "result") results++;
    },
  });
  await waitFor(() => Bun.file(join(dirs.cwd, "pid")).exists(), "job pid");
  const pid = Number(await Bun.file(join(dirs.cwd, "pid")).text());
  await session.close();
  expect(() => process.kill(pid, 0)).toThrow();
  expect(fake.contexts).toHaveLength(2);
  expect(results).toBe(1);
});

test("new output does not wake an idle Session", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command:
        "while [ ! -e output ]; do sleep 0.01; done; printf partial; touch emitted; while [ ! -e go ]; do sleep 0.01; done",
      description: "Wait for job release",
      run_in_background: true,
    }),
    fauxAssistantMessage("started"),
    call("job_output", { job_id: "bash-1" }),
    fauxAssistantMessage("output inspected"),
  ]);
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  await session.run("start");
  await Bun.write(join(dirs.cwd, "output"), "");
  await waitFor(() => Bun.file(join(dirs.cwd, "emitted")).exists(), "output marker");
  expect(session.running).toBe(false);
  await session.run("inspect output");
  expect(fake.contexts).toHaveLength(4);
  expect(
    fake.contexts[3]!.messages.findLast((message) => message.role === "toolResult"),
  ).toMatchObject({
    content: [{ type: "text", text: "partial\n[status: running]" }],
  });
  expect(session.messages.filter((message) => message.role === "user")).toHaveLength(2);
});

test("an aborted job_output wait remains eligible for a completion notification", async () => {
  dirs = await tempDirs();
  let fake = fakeModel([
    call("bash", {
      command: "while [ ! -e go ]; do sleep 0.01; done; printf final",
      description: "Wait for job release",
      run_in_background: true,
    }),
    fauxAssistantMessage("started"),
    call("job_output", { job_id: "bash-1", wait: true }),
    fauxAssistantMessage("waiting interrupted"),
  ]);
  const waiting = Promise.withResolvers<void>();
  const controller = new AbortController();
  let released = false;
  let rewoken = 0;
  session = await createSession({
    ...dirs,
    model: fake.model,
    models: withModelStream(fake.models, (model, context, options) =>
      modelStream(fake.models)(model, context, options),
    ),
    allowRules: ["bash"],
  });
  await session.run("start");
  session.subscribe((event) => {
    if (event.type === "result" && released) rewoken++;
  });
  const run = session.run("wait", {
    signal: controller.signal,
    onEvent(event) {
      if (event.type === "tool_execution_start" && event.toolName === "job_output")
        waiting.resolve();
    },
  });
  void run.catch(() => {});
  await waiting.promise;
  controller.abort(new Error("stop waiting"));
  await expect(run).rejects.toThrow("stop waiting");
  fake = fakeModel([
    call("job_output", { job_id: "bash-1", wait: true }),
    fauxAssistantMessage("completion handled"),
  ]);
  released = true;
  await Bun.write(join(dirs.cwd, "go"), "");
  await waitFor(() => rewoken === 1, "completion after cancelled wait");
  expect(fake.contexts).toHaveLength(2);
  expect(fake.contexts[0]!.messages.filter((message) => message.role === "user")).toContainEqual(
    expect.objectContaining({
      role: "user",
      content: [{ type: "text", text: notification }],
    }),
  );
  expect(
    fake.contexts[1]!.messages.findLast((message) => message.role === "toolResult"),
  ).toMatchObject({
    content: [{ type: "text", text: "final\n[status: completed, exit code: 0]" }],
  });
});
