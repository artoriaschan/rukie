import {
  createSession as createNativeSession,
  ROOT_CONVERSATION_ID,
} from "@earendil-works/pi-durable";
import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { join } from "node:path";
import { createSession, createJsonlStore, type Session, type JobEvent } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
  await dirs?.cleanup();
});

test("job events cover background output while idle and flush final output before settlement", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command: "printf alpha; while [ ! -e go ]; do sleep 0.01; done; printf tail",
      description: "Observe controlled background output",
      run_in_background: true,
    }),
    fauxAssistantMessage("started"),
    fauxAssistantMessage("finished"),
  ]);
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  const events: JobEvent[] = [];
  const runEvents: JobEvent[] = [];
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "job_event") {
      expect(event.sessionId).toBe(session!.id);
      events.push(event);
      if (event.kind === "settled")
        expect(session!.readJob(event.job.id, 0).stdout).toBe("alphatail");
    }
  });
  await session.run("start", {
    onEvent(event) {
      if (event.type === "job_event") runEvents.push(event);
    },
  });
  expect(runEvents.map((event) => event.kind)).toEqual(["started"]);
  await waitUntil(() => events.some((event) => event.kind === "output"));
  expect(session.running).toBe(false);
  await Bun.write(join(dirs.cwd, "go"), "");
  await waitUntil(() => events.some((event) => event.kind === "settled"));
  await session.waitForIdle();
  expect(events.map((event) => event.kind)).toEqual(["started", "output", "output", "settled"]);
  expect(events.at(-1)?.job).toMatchObject({ status: "completed", exitCode: 0 });
  unsubscribe();
  expect(session.jobs()[0]?.status).toBe("completed");
});

test("foreground commands remain absent from job views and events", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command: "printf foreground",
      description: "Complete ordinary foreground command",
    }),
    fauxAssistantMessage("done"),
  ]);
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  const events: JobEvent[] = [];
  session.subscribe((event) => {
    if (event.type === "job_event") events.push(event);
  });
  await session.run("foreground");
  expect(session.jobs()).toEqual([]);
  expect(events).toEqual([]);
});

const call = (name: string, args: Parameters<typeof fauxToolCall>[1]) =>
  fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });

async function waitUntil(predicate: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 2000;
  while (!(await predicate())) {
    if (Date.now() > deadline) throw new Error("Job condition did not become observable");
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

test.each([false, true])(
  "user stopping a job informs the model without an idle Run: active=%s",
  async (active) => {
    dirs = await tempDirs();
    const responding = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const stopped = "User stopped background job bash-1 (Wait for user cancellation).";
    const fake = fakeModel([
      call("bash", {
        command: "printf '%s' $$ > pid; while [ ! -e go ]; do sleep 0.01; done",
        description: "Wait for user cancellation",
        run_in_background: true,
      }),
      async () => {
        responding.resolve();
        if (active) await release.promise;
        return fauxAssistantMessage("started");
      },
      (context) => {
        expect(JSON.stringify(context.messages)).toContain(stopped);
        expect(JSON.stringify(context.messages)).not.toContain("finished [status:");
        return fauxAssistantMessage("acknowledged");
      },
    ]);
    session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
    const running = session.run("start");
    await responding.promise;
    const initiatingRequestId = session.currentRequestId!;
    if (!active) await running;
    await waitUntil(() => Bun.file(join(dirs.cwd, "pid")).exists());
    const pid = Number(await Bun.file(join(dirs.cwd, "pid")).text());
    try {
      await session.killJob("bash-1");
      await session.killJob("bash-1");
      await waitUntil(() => session!.jobs()[0]?.status === "killed");
      expect(() => process.kill(pid, 0)).toThrow();
      if (!active) {
        expect(session.running).toBe(false);
        expect(fake.contexts).toHaveLength(2);
        await session.run("next human prompt");
        const latest = fake.contexts.at(-1)!.messages;
        const userTexts = latest
          .filter((message) => message.role === "user")
          .map((message) => JSON.stringify(message.content));
        expect(userTexts.at(-2)).toContain(stopped);
        expect(userTexts.at(-1)).toContain("next human prompt");
      } else {
        release.resolve();
        await running;
        await session.waitForRequest(initiatingRequestId);
      }
      expect(fake.contexts).toHaveLength(3);
      expect(JSON.stringify(session.messages).split(stopped)).toHaveLength(2);
      await session.killJob("bash-1");
      expect(session.running).toBe(false);
    } finally {
      release.resolve();
      await running;
      await session.waitForRequest(initiatingRequestId);
    }
  },
);

test("frontend reads use absolute offsets without consuming the model output", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command:
        "printf alpha; printf error >&2; touch ready; while [ ! -e go ]; do sleep 0.01; done",
      description: "Produce separate output streams",
      run_in_background: true,
    }),
    fauxAssistantMessage("started"),
    call("job_output", { job_id: "bash-1" }),
    (context) => {
      expect(
        JSON.stringify(context.messages.findLast((message) => message.role === "toolResult")),
      ).toContain("alpha\\n[stderr]\\nerror");
      return fauxAssistantMessage("read");
    },
  ]);
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  await session.run("start");
  await waitUntil(() => Bun.file(join(dirs.cwd, "ready")).exists());
  expect(session.jobs()).toMatchObject([{ id: "bash-1", status: "running", kind: "bash" }]);
  const output = session.readJob("bash-1", 0);
  expect(output).toMatchObject({
    stdout: "alpha",
    stderr: "error",
    nextOffset: 10,
    dropped: false,
  });
  expect(session.readJob("bash-1", output.nextOffset)).toMatchObject({
    stdout: "",
    stderr: "",
    nextOffset: 10,
    dropped: false,
  });
  await session.run("collect");
});

test.each([false, true])(
  "Session Resume keeps old job ids unknown after starting new background work: rewind=%s",
  async (rewind) => {
    dirs = await tempDirs();
    const launch = call("bash", {
      command: "while [ ! -e go ]; do sleep 0.01; done",
      description: "Wait across separate sessions",
      run_in_background: true,
    });
    session = await createSession({
      ...dirs,
      ...fakeModel([launch, fauxAssistantMessage("started")]),
      allowRules: ["bash"],
    });
    await session.run("start");
    const oldId = session.jobs()[0]!.id;
    const id = session.id;
    if (rewind)
      await session.rewind(session.checkpoints()[0]!.promptEntryId, {
        code: false,
        conversation: true,
      });
    await session.close();
    session = await createSession({
      ...dirs,
      ...fakeModel([launch, fauxAssistantMessage("restarted")]),
      resumeId: id,
      allowRules: ["bash"],
    });
    expect(session.jobs()).toEqual([]);
    await session.run("new work");
    expect(session.jobs()[0]!.id).toBe("bash-2");
    expect(() => session!.readJob(oldId, 0)).toThrow(
      "background jobs do not survive a session restart",
    );
    await expect(session.killJob(oldId)).rejects.toThrow(`unknown job ${oldId}`);
  },
);

test("output events coalesce bursts and unsubscribe stops idle observation", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command:
        'i=0; while [ "$i" -lt 18 ]; do printf x; i=$((i+1)); done; while [ ! -e next ]; do sleep 0.01; done; while [ "$i" -lt 35 ]; do printf x; i=$((i+1)); done; touch ready; while [ ! -e go ]; do sleep 0.01; done',
      description: "Observe repeated output writes",
      run_in_background: true,
    }),
    fauxAssistantMessage("started"),
  ]);
  session = await createSession({ ...dirs, ...fake, permissionMode: "full-access" });
  const outputs: number[] = [];
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "job_event" && event.kind === "output") outputs.push(performance.now());
  });
  await session.run("start");
  // Real child-process pipes can combine all writes in one read. Acknowledge the
  // first throttled event before releasing the second burst; shell polling only
  // crosses the process boundary and does not determine notification timing.
  await waitUntil(() => outputs.length >= 1);
  await Bun.write(join(dirs.cwd, "next"), "");
  await waitUntil(() => Bun.file(join(dirs.cwd, "ready")).exists());
  await waitUntil(() => outputs.length >= 2);
  // Real child-process writes exercise the transport as well as the parent throttle.
  // Each burst is controlled by an observed event; the contract is event spacing.
  expect(outputs.length).toBeLessThan(35);
  for (let index = 1; index < outputs.length; index++)
    expect(outputs[index]! - outputs[index - 1]!).toBeGreaterThanOrEqual(125);
  const before = outputs.length;
  unsubscribe();
  await session.killJob("bash-1");
  await waitUntil(() => session!.jobs()[0]?.status === "killed");
  expect(outputs).toHaveLength(before);
  expect(session.readJob("bash-1", 0).stdout).toBe("x".repeat(35));
});

test("a job observer can await Session disposal without blocking process drain", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command: "while [ ! -e go ]; do sleep 0.01; done",
      description: "Dispose from job observer",
      run_in_background: true,
    }),
    fauxAssistantMessage("started"),
  ]);
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  const disposed = Promise.withResolvers<void>();
  const running = session.run("start", {
    async onEvent(event) {
      if (event.type === "job_event" && event.kind === "started") {
        await session!.close();
        disposed.resolve();
      }
    },
  });
  void running.catch(() => {});
  await disposed.promise;
  await running.catch(() => {});
  await expect(session.waitForIdle()).rejects.toThrow("Harness is closed");
  expect(session.jobs()).toEqual([]);
  expect(fake.contexts.length).toBeLessThanOrEqual(2);
});

test("frontend read reports dropped output and points to the complete spill file", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command:
        "head -c 300000 /dev/zero | tr '\\0' x; touch ready; while [ ! -e go ]; do sleep 0.01; done",
      description: "Produce more than retained output",
      run_in_background: true,
    }),
    fauxAssistantMessage("started"),
  ]);
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  await session.run("start");
  await waitUntil(() => Bun.file(join(dirs.cwd, "ready")).exists());
  const output = session.readJob("bash-1", 0);
  expect(output.dropped).toBe(true);
  expect(output.nextOffset).toBe(300000);
  expect(output.stdout.length).toBe(256 * 1024);
  expect(await Bun.file(session.jobs()[0]!.spillPath!).text()).toBe("x".repeat(300000));
});

test("a restored high job id and an uncertain native bash effect reserve retired cursors", async () => {
  dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const seed = await createSession({ ...dirs, ...fakeModel([]), store });
  await seed.close();
  const args = {
    command: "while [ ! -e go ]; do sleep 0.01; done",
    description: "Recover without old process",
    run_in_background: true,
  };
  const lease = await store.open({ id: seed.id }, BACKGROUND_CONTEXT);
  const kernel = createNativeSession(lease.storage);
  try {
    await kernel.commit(
      (tx) =>
        tx.appendEntry(ROOT_CONVERSATION_ID, {
          kind: "test.historical-job",
          data: {},
          model: [
            fauxAssistantMessage(fauxToolCall("bash", args, { id: "known" }), {
              stopReason: "toolUse",
            }),
            {
              role: "toolResult",
              toolCallId: "known",
              toolName: "bash",
              content: [{ type: "text", text: "started background job bash-10" }],
              details: { jobId: "bash-10" },
              isError: false,
              timestamp: Date.now(),
            },
          ],
        }),
      BACKGROUND_CONTEXT,
    );
  } finally {
    await kernel.close(BACKGROUND_CONTEXT);
    await lease.release();
  }
  let rejected = false;
  const faultStore: typeof store = {
    ...store,
    async open(options, context) {
      const owned = await store.open(options, context);
      const commit = owned.storage.commit.bind(owned.storage);
      owned.storage.commit = async (writes, commitContext) => {
        if (
          !rejected &&
          writes.some(
            (write) =>
              write.type === "entry" &&
              write.value.model?.some(
                (message) => message.role === "toolResult" && message.toolCallId === "lost",
              ),
          )
        ) {
          rejected = true;
          throw new Error("lost bash receipt");
        }
        return commit(writes, commitContext);
      };
      return owned;
    },
  };
  session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage(fauxToolCall("bash", args, { id: "lost" }), { stopReason: "toolUse" }),
    ]),
    store: faultStore,
    resumeId: seed.id,
    allowRules: ["bash"],
  });
  await expect(session.run("start uncertain job")).rejects.toThrow("lost bash receipt");
  expect(rejected).toBe(true);
  await session.close();
  session = await createSession({
    ...dirs,
    ...fakeModel([
      fauxAssistantMessage("recovered prior request"),
      call("bash", args),
      fauxAssistantMessage("new work"),
    ]),
    store,
    resumeId: seed.id,
    allowRules: ["bash"],
  });
  await session.waitForIdle();
  await session.run("new work");
  expect(session.jobs()[0]?.id).toBe("bash-12");
  expect(() => session!.readJob("bash-11", 0)).toThrow("unknown job bash-11");
  expect(
    session.messages.find(
      (message) => message.role === "toolResult" && message.toolCallId === "lost",
    ),
  ).toMatchObject({ outcomeUnknown: true });
});

test("foreground timeout publishes a started event with the originating bash result id", async () => {
  dirs = await tempDirs();
  const fake = fakeModel([
    call("bash", {
      command: "printf early; while [ ! -e go ]; do sleep 0.01; done",
      description: "Promote controlled foreground work",
      timeout: 0.05,
    }),
    fauxAssistantMessage("promoted"),
  ]);
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  const events: JobEvent[] = [];
  session.subscribe((event) => {
    if (event.type === "job_event") events.push(event);
  });
  await session.run("promote");
  expect(events.map((event) => event.kind)).toEqual(["started"]);
  expect(session.messages.findLast((message) => message.role === "toolResult")).toMatchObject({
    details: { jobId: events[0]!.job.id },
  });
  expect(session.readJob(events[0]!.job.id, 0).stdout).toBe("early");
  await session.killJob(events[0]!.job.id);
});

test("a stopped job's undelivered steer survives Run cancellation for the next human prompt", async () => {
  dirs = await tempDirs();
  const replying = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const controller = new AbortController();
  const fake = fakeModel([
    call("bash", {
      command: "while [ ! -e go ]; do sleep 0.01; done",
      description: "Stop before cancelled reply",
      run_in_background: true,
    }),
    async () => {
      replying.resolve();
      await release.promise;
      return fauxAssistantMessage("cancelled", { stopReason: "aborted" });
    },
    (context) => {
      const userTexts = context.messages
        .filter((message) => message.role === "user")
        .map((message) => JSON.stringify(message.content));
      expect(userTexts.at(-2)).toContain(
        "User stopped background job bash-1 (Stop before cancelled reply).",
      );
      expect(userTexts.at(-1)).toContain("next human prompt");
      return fauxAssistantMessage("acknowledged");
    },
  ]);
  session = await createSession({ ...dirs, ...fake, allowRules: ["bash"] });
  const run = session.run("start", { signal: controller.signal });
  void run.catch(() => {});
  await replying.promise;
  await session.killJob("bash-1");
  controller.abort(new Error("cancel reply"));
  release.resolve();
  await expect(run).rejects.toThrow("cancel reply");
  expect(session.running).toBe(false);
  await session.run("next human prompt");
  expect(fake.contexts).toHaveLength(3);
});
