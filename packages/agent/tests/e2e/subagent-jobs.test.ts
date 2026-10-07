import { runRequest } from "../helpers/crashed-subagents.ts";
import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { join } from "node:path";
import { watch } from "node:fs/promises";
import { createSession, type Session, type SessionEvent } from "../../src/index.ts";
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

async function waitFile(name: string) {
  const path = join(dirs.cwd, name);
  // A real child process writes this marker; observe filesystem completion instead of a timer poll.
  const abort = new AbortController();
  const watcher = watch(dirs.cwd, {
    signal: AbortSignal.any([abort.signal, AbortSignal.timeout(2000)]),
  });
  try {
    if (await Bun.file(path).exists()) return Bun.file(path).text();
    for await (const event of watcher) {
      if (event.filename === name && (await Bun.file(path).exists())) return Bun.file(path).text();
    }
    throw new Error(`Missing process marker ${name}`);
  } finally {
    abort.abort();
  }
}

const background = (name: string) => ({
  command: `trap 'printf teardown; exit 0' TERM; printf '%s' $$ > ${name}; while [ ! -e ${name}-go ]; do sleep 0.01; done`,
  description: `Wait for ${name} release`,
  run_in_background: true,
});

function toolText(messages: Session["messages"]) {
  const result = messages.findLast((message) => message.role === "toolResult");
  return result?.content.map((item) => (item.type === "text" ? item.text : "")).join("");
}

test.each(["stop", "error"] as const)(
  "a %s child Run cleans its jobs before its result while the parent's job survives",
  async (stopReason) => {
    dirs = await tempDirs();
    let childPid = 0;
    const events: SessionEvent[] = [];
    let spillPath = "";
    const fake = fakeModel([
      call("bash", background("parent-pid")),
      call("subagent", { description: "Child jobs", prompt: "child", run_in_background: false }),
      call("bash", background("child-pid")),
      async (context) => {
        expect(
          context.messages.filter((message) => message.role !== "system").at(-1),
        ).toMatchObject({
          content: [{ type: "text", text: "started background job bash-1" }],
        });
        childPid = Number(await waitFile("child-pid"));
        expect(() => process.kill(childPid, 0)).not.toThrow();
        expect(session!.jobs().map((job) => job.label)).toEqual(["Wait for parent-pid release"]);
        return call("job_list");
      },
      (context) => {
        expect(
          context.messages.filter((message) => message.role !== "system").at(-1),
        ).toMatchObject({
          content: [{ type: "text", text: "bash-1 [bash] running — Wait for child-pid release" }],
        });
        return fauxAssistantMessage("child final", {
          stopReason,
          ...(stopReason === "error" && { errorMessage: "child failure" }),
        });
      },
      async () => {
        expect(() => process.kill(childPid, 0)).toThrow();
        expect(await Bun.file(spillPath).exists()).toBe(false);
        return call("job_list");
      },
      (context) => {
        expect(
          context.messages.filter((message) => message.role !== "system").at(-1),
        ).toMatchObject({
          content: [{ type: "text", text: "bash-1 [bash] running — Wait for parent-pid release" }],
        });
        return fauxAssistantMessage("parent final");
      },
    ]);
    session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    expect(
      (
        await runRequest(session, "delegate", {
          onEvent(event) {
            events.push(event);
            if (event.type === "subagent_event" && event.event.type === "job_event")
              spillPath = event.event.job.spillPath!;
          },
        })
      ).text,
    ).toBe("parent final");
    await session.waitForIdle();
    const parentPid = Number(await waitFile("parent-pid"));
    expect(() => process.kill(parentPid, 0)).not.toThrow();
    expect(fake.contexts).toHaveLength(7);
    expect(
      events.filter((event) => event.type === "subagent_event" && event.event.type === "run_end"),
    ).toHaveLength(1);
    const childJobs = events.flatMap((event) =>
      event.type === "subagent_event" && event.event.type === "job_event" ? [event.event] : [],
    );
    expect(childJobs.map((event) => event.kind)).toEqual(["started"]);
    expect(childJobs[0]!.sessionId).not.toBe(session.id);
    expect(JSON.stringify(fake.contexts.map((context) => context.messages))).not.toContain(
      "background job bash-1 (bash: Wait for child-pid release) finished",
    );
  },
);

test("send_message reuses the child Session with no old jobs, output or reused ids", async () => {
  dirs = await tempDirs();
  let childId = "";
  let childPid = 0;
  let nextPid = 0;
  let childResults = 0;
  const childJobs: SessionEvent[] = [];
  const reply: Parameters<typeof fakeModel>[0][number] = async (context) => {
    const last = context.messages.filter((message) => message.role !== "system").at(-1)!;
    if (last.role === "user" && JSON.stringify(last.content).includes("continue child"))
      return call("job_list");
    if (last.role === "toolResult") {
      switch (last.toolName) {
        case "send_message":
          return fauxAssistantMessage("parent waiting");
        case "job_list":
          expect(toolText(context.messages)).toBe("(no background jobs)");
          return call("job_output", { job_id: "bash-1" });
        case "job_output":
          expect(last.isError).toBe(true);
          expect(toolText(context.messages)).toContain(
            "unknown job bash-1; background jobs do not survive a session restart",
          );
          return call("job_kill", { job_id: "bash-1" });
        case "job_kill":
          expect(last.isError).toBe(true);
          expect(toolText(context.messages)).toContain(
            "unknown job bash-1; background jobs do not survive a session restart",
          );
          return call("bash", background("next-pid"));
        case "bash":
          expect(toolText(context.messages)).toBe("started background job bash-2");
          nextPid = Number(await waitFile("next-pid"));
          expect(() => process.kill(nextPid, 0)).not.toThrow();
          return fauxAssistantMessage("continued child final");
      }
    }
    expect(JSON.stringify(last)).toContain("continued child final");
    return fauxAssistantMessage("parent final");
  };
  const fake = fakeModel([
    call("subagent", { description: "Reusable child", prompt: "child", run_in_background: false }),
    call("bash", background("child-pid")),
    async () => {
      childPid = Number(await waitFile("child-pid"));
      return fauxAssistantMessage("first child final");
    },
    () => {
      expect(() => process.kill(childPid, 0)).toThrow();
      return call("send_message", { agent_id: childId, message: "continue child" });
    },
    ...Array.from({ length: 8 }, () => reply),
  ]);
  session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  const result = await runRequest(session, "delegate", {
    onEvent(event) {
      if (event.type !== "subagent_event") return;
      if (childId) expect(event.agentId).toBe(childId);
      childId = event.agentId;
      if (event.event.type === "job_event") childJobs.push(event.event);
      if (event.event.type === "run_end") {
        childResults++;
        // Native child completion precedes the driver's resource settlement; the parent receipt below verifies cleanup.
      }
    },
  });
  expect((await session.readSubagent(childId))?.run?.error).toBe(undefined);
  expect(result.text).toBe("parent final");
  await session.waitForIdle();
  expect(childResults).toBe(2);
  expect(childJobs).toMatchObject([
    { kind: "started", job: { id: "bash-1" } },
    { kind: "started", job: { id: "bash-2" } },
  ]);
  expect(fake.contexts).toHaveLength(11);
  expect(session.jobs()).toEqual([]);
});

test.each(["child", "parent", "dispose"] as const)(
  "%s cancellation settles owned process resources without child job teardown notifications",
  async (cancellation) => {
    dirs = await tempDirs();
    const started = Promise.withResolvers<void>();
    const waiting = Promise.withResolvers<void>();
    let childId = "";
    let childPid = 0;
    let childRequests = 0;
    const events: SessionEvent[] = [];
    const reply: Parameters<typeof fakeModel>[0][number] = async (context, options) => {
      const last = context.messages.filter((message) => message.role !== "system").at(-1)!;
      if (last.role === "user" && JSON.stringify(last.content).includes("child-prompt")) {
        childRequests++;
        return call("bash", background("child-pid"));
      }
      if (last.role === "toolResult" && last.toolName === "bash") {
        childRequests++;
        childPid = Number(await waitFile("child-pid"));
        started.resolve();
        await new Promise<void>((done) => {
          if (options?.signal?.aborted) done();
          else options?.signal?.addEventListener("abort", () => done(), { once: true });
        });
        return fauxAssistantMessage("", { stopReason: "aborted" });
      }
      return fauxAssistantMessage("parent final");
    };
    const fake = fakeModel([
      call("bash", background("parent-pid")),
      call("subagent", { description: "Cancellable child", prompt: "child-prompt" }),
      ...Array.from({ length: 6 }, () => reply),
    ]);
    session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
    const run = runRequest(session, "delegate", {
      onEvent(event) {
        events.push(event);
        if (event.type === "run_end") waiting.resolve();
        if (event.type === "subagent_event") {
          childId = event.agentId;
        }
      },
    });
    const settled = run.catch((error: unknown) => error);
    await Promise.all([started.promise, waiting.promise]);
    const parentPid = Number(await waitFile("parent-pid"));
    if (cancellation === "dispose") {
      await session.close();
      expect(await settled).toBeInstanceOf(Error);
    } else {
      if (cancellation === "parent") {
        await session.abort();
        expect(() => process.kill(childPid, 0)).not.toThrow();
        expect((session.toolState("subagents") as { active: boolean }[])[0]?.active).toBe(true);
      }
      session.interruptSubagent(childId);
      expect((await run).text).toBe("parent final");
      await session.waitForIdle();
    }
    expect(() => process.kill(childPid, 0)).toThrow();
    expect(childRequests).toBe(2);
    expect(
      events.filter((event) => event.type === "subagent_event" && event.event.type === "run_end"),
    ).toHaveLength(cancellation === "dispose" ? 0 : 1);
    expect(
      events.flatMap((event) =>
        event.type === "subagent_event" && event.event.type === "job_event"
          ? [event.event.kind]
          : [],
      ),
    ).toEqual(["started"]);
    expect(session.jobs().map((job) => job.label)).toEqual(
      cancellation === "dispose" ? [] : ["Wait for parent-pid release"],
    );
    if (cancellation === "dispose") expect(() => process.kill(parentPid, 0)).toThrow();
    else expect(() => process.kill(parentPid, 0)).not.toThrow();
    expect(JSON.stringify(fake.contexts.map((context) => context.messages))).not.toContain(
      "background job bash-1 (bash: Wait for child-pid release) finished",
    );
  },
);

test("a naturally completed child job notifies only the child and forwards its job events", async () => {
  dirs = await tempDirs();
  const events: SessionEvent[] = [];
  const notification =
    "background job bash-1 (bash: Wait for child-pid release) finished [status: completed, exit code: 0]. Read its output with job_output.";
  const fake = fakeModel([
    call("bash", background("parent-pid")),
    call("subagent", { description: "Notified child", prompt: "child", run_in_background: false }),
    call("bash", background("child-pid")),
    async () => {
      await waitFile("child-pid");
      return call("bash", {
        command:
          'read -r pid < child-pid; touch child-pid-go; while kill -0 "$pid" 2>/dev/null; do sleep 0.01; done',
        description: "Release child background process",
      });
    },
    (context) => {
      expect(context.messages).toContainEqual(
        expect.objectContaining({
          role: "user",
          content: [
            { type: "text", text: `<system-reminder>\n${notification}\n</system-reminder>` },
          ],
        }),
      );
      return call("job_output", { job_id: "bash-1", wait: true });
    },
    (context) => {
      expect(toolText(context.messages)).toBe("(no new output)\n[status: completed, exit code: 0]");
      return fauxAssistantMessage("child final");
    },
    (context) => {
      expect(JSON.stringify(context.messages)).not.toContain(notification);
      return fauxAssistantMessage("parent final");
    },
  ]);
  session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  expect(
    (
      await runRequest(session, "delegate", {
        onEvent: (event) => {
          events.push(event);
        },
      })
    ).text,
  ).toBe("parent final");
  await session.waitForIdle();
  expect(fake.contexts).toHaveLength(7);
  expect(
    events.filter((event) => event.type === "job_event").map((event) => event.job.label),
  ).toEqual(["Wait for parent-pid release"]);
  const childEvents = events.flatMap((event) =>
    event.type === "subagent_event" && event.event.type === "job_event" ? [event.event] : [],
  );
  expect(childEvents.map((event) => event.kind)).toEqual(["started", "settled"]);
  expect(childEvents.every((event) => event.sessionId !== session!.id)).toBe(true);
});

test("parent and child each own ten job slots and the child can list and kill only its own jobs", async () => {
  dirs = await tempDirs();
  const batch = (owner: string) =>
    fauxAssistantMessage(
      Array.from({ length: 10 }, (_, index) =>
        fauxToolCall("bash", background(`${owner}-${index + 1}`)),
      ),
      { stopReason: "toolUse" },
    );
  const pids: number[] = [];
  const fake = fakeModel([
    batch("parent"),
    call("subagent", {
      description: "Independent capacity",
      prompt: "child",
      run_in_background: false,
    }),
    batch("child"),
    async (context) => {
      const results = context.messages.filter(
        (message) => message.role === "toolResult" && message.toolName === "bash",
      );
      expect(results).toHaveLength(10);
      expect(results.every((message) => message.role === "toolResult" && !message.isError)).toBe(
        true,
      );
      pids.push(
        ...(await Promise.all(
          Array.from({ length: 10 }, async (_, index) =>
            Number(await waitFile(`child-${index + 1}`)),
          ),
        )),
      );
      return call("bash", background("overflow"));
    },
    (context) => {
      expect(toolText(context.messages)).toContain(
        "background job limit reached for this owner (limit: 10)",
      );
      expect(context.messages.filter((message) => message.role !== "system").at(-1)).toMatchObject({
        isError: true,
      });
      return call("job_list");
    },
    (context) => {
      const text = toolText(context.messages)!;
      expect(text.split("\n")).toHaveLength(10);
      expect(text).toContain("bash-10 [bash] running — Wait for child-10 release");
      expect(text).not.toContain("parent");
      return call("job_kill", { job_id: "bash-1" });
    },
    (context) => {
      expect(toolText(context.messages)).toBe("requested cancellation of job bash-1");
      return fauxAssistantMessage("child final");
    },
    () => {
      for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
      return call("job_list");
    },
    (context) => {
      const text = toolText(context.messages)!;
      expect(text.split("\n")).toHaveLength(10);
      expect(text).not.toContain("child");
      return fauxAssistantMessage("parent final");
    },
  ]);
  session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  expect((await runRequest(session, "delegate")).text).toBe("parent final");
  expect(session.jobs()).toHaveLength(10);
  for (const pid of await Promise.all(
    Array.from({ length: 10 }, async (_, index) => Number(await waitFile(`parent-${index + 1}`))),
  ))
    expect(() => process.kill(pid, 0)).not.toThrow();
});
