import { afterEach, expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { Database } from "bun:sqlite";
import { crashUnsafeEffect } from "../helpers/native-recovery.ts";
import { join } from "node:path";
import {
  createSession,
  readSessionSnapshot,
  readSessionToolOutput,
  type Session,
} from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
let session: Session | undefined;
afterEach(async () => {
  await session?.close();
  session = undefined;
  await dirs?.cleanup();
});

test("desktop Bash retains full output after truncation and restart by byte cursor", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "desktop-data") };
  session = await createSession({
    ...options,
    permissionMode: "full-access",
    ...fakeModel([
      fauxAssistantMessage(
        fauxToolCall("bash", {
          command: "printf 'first\\n'; head -c 300000 /dev/zero | tr '\\0' x; printf 'last\\n'",
          description: "large output",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]),
  });
  await session.run("capture output");
  const result = session.messages.find(
    (message) => message.role === "toolResult" && message.toolName === "bash",
  );
  if (!result || result.role !== "toolResult") throw new Error("Missing Bash result");
  expect(result.isError).toBe(false);
  const details = result.details as { outputRef: { id: string }; fullOutputPath?: string };
  expect(details.fullOutputPath).toBeUndefined();
  expect(details.outputRef).toBeDefined();
  const id = session.id;
  const initial = await session.readToolOutput(details.outputRef, 0, 6);
  expect(initial).toMatchObject({ stdout: "first\n", stderr: "", nextOffset: 6, dropped: false });
  await session.close();
  session = undefined;
  const readonly = await readSessionSnapshot({ ...options, id });
  expect(readonly.messages.find((message) => message.role === "toolResult")).toMatchObject({
    view: { outputRef: details.outputRef },
  });
  const rest = await readSessionToolOutput(
    { ...options, id },
    details.outputRef,
    initial.nextOffset,
    400000,
  );
  expect(rest.stdout).toBe("x".repeat(300000) + "last\n");
  expect(rest.nextOffset).toBe(300011);
  await expect(
    readSessionToolOutput({ ...options, cwd: dirs.homeDir, id }, details.outputRef),
  ).rejects.toMatchObject({ code: "session-not-found" });
});

function outputRef(message: unknown): { id: string } {
  if (typeof message !== "object" || message === null || !("details" in message))
    throw new Error("Missing output details");
  const details = message.details;
  if (typeof details !== "object" || details === null || !("outputRef" in details))
    throw new Error("Missing output reference");
  const ref = details.outputRef;
  if (typeof ref !== "object" || ref === null || !("id" in ref) || typeof ref.id !== "string")
    throw new Error("Invalid output reference");
  return { id: ref.id };
}

test("desktop read stores selected text before native truncation and call ID reuse preserves ownership", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "desktop-data") };
  await Bun.write(join(dirs.cwd, "large.txt"), "first\n" + "z".repeat(100000) + "\nlast");
  const calls = [
    fauxAssistantMessage(fauxToolCall("read", { path: "large.txt" }, { id: "same" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("read done"),
    fauxAssistantMessage(
      fauxToolCall(
        "bash",
        { command: "printf second", description: "second output" },
        { id: "same" },
      ),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage("bash done"),
  ];
  session = await createSession({ ...options, permissionMode: "full-access", ...fakeModel(calls) });
  await session.run("read");
  await session.run("bash");
  const results = session.messages.filter((message) => message.role === "toolResult");
  const readRef = outputRef(results[0]);
  const bashRef = outputRef(results[1]);
  expect(readRef).not.toEqual(bashRef);
  expect((await session.readToolOutput(readRef)).stdout).toBe(
    "first\n" + "z".repeat(100000) + "\nlast",
  );
  expect((await session.readToolOutput(bashRef)).stdout).toBe("second");
});

test("SQLite output cursor preserves Unicode characters at a requested page boundary", async () => {
  dirs = await tempDirs();
  session = await createSession({
    ...dirs,
    dataRoot: join(dirs.homeDir, "desktop-data"),
    permissionMode: "full-access",
    ...fakeModel([
      fauxAssistantMessage(
        fauxToolCall("bash", { command: "printf '界界x'", description: "unicode output" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]),
  });
  await session.run("unicode");
  const ref = outputRef(session.messages.find((message) => message.role === "toolResult"));
  expect(await session.readToolOutput(ref, 0, 4)).toMatchObject({ stdout: "界", nextOffset: 3 });
  expect(await session.readToolOutput(ref, 3, 4)).toMatchObject({ stdout: "界x", nextOffset: 7 });
  expect(await session.readToolOutput(ref, 1, 5)).toMatchObject({ stdout: "界", nextOffset: 6 });
});

test("SQLite output write rejection cannot produce a successful Bash receipt", async () => {
  dirs = await tempDirs();
  const dataRoot = join(dirs.homeDir, "desktop-data");
  session = await createSession({
    ...dirs,
    dataRoot,
    permissionMode: "full-access",
    ...fakeModel([
      fauxAssistantMessage(
        fauxToolCall("bash", { command: "printf unavailable", description: "output failure" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]),
  });
  // Real SQLite fault only at the output persistence boundary; native commits remain writable.
  const db = new Database(join(dataRoot, "sessions", session.id, "session.sqlite"));
  db.exec(
    "CREATE TRIGGER reject_output BEFORE INSERT ON rukie_output_chunks BEGIN SELECT RAISE(ABORT, 'output disk failure'); END",
  );
  db.close();
  await session.run("fault");
  expect(session.messages.filter((message) => message.role === "toolResult")).toMatchObject([
    { isError: true },
  ]);
});

test("committed Bash chunks remain readable after process crash without repeating the command", async () => {
  dirs = await tempDirs();
  const dataRoot = join(dirs.homeDir, "desktop-data");
  const crashed = await crashUnsafeEffect(dirs.cwd, false, {
    dataRoot,
    unsafeCall: {
      name: "bash",
      args: { command: "printf saved; printf once >> command-count", description: "crash receipt" },
    },
  });
  session = await createSession({
    cwd: dirs.cwd,
    homeDir: dirs.cwd,
    dataRoot,
    resumeId: crashed.sessionId,
    permissionMode: "full-access",
    ...fakeModel([fauxAssistantMessage("recovered")]),
  });
  await session.waitForRequest(session.currentRequestId!);
  const result = session.messages.find(
    (message) => message.role === "toolResult" && message.toolName === "bash",
  );
  expect(result).toMatchObject({ isError: true, outcomeUnknown: true });
  expect((await session.readToolOutput(outputRef(result))).stdout).toBe("saved");
  expect(await Bun.file(join(dirs.cwd, "command-count")).text()).toBe("once");
});

test("desktop background job_output retains both streams after model memory drops them", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "desktop-data") };
  const pipe = Bun.spawn(["mkfifo", join(dirs.cwd, "gate")], { stdout: "ignore", stderr: "pipe" });
  expect(await pipe.exited).toBe(0);
  const waiting = Promise.withResolvers<void>();
  const fake = fakeModel([
    fauxAssistantMessage(
      fauxToolCall("bash", {
        command:
          "cat gate >/dev/null; head -c 300000 /dev/zero | tr '\\0' b; printf diagnostic >&2",
        description: "background streams",
        run_in_background: true,
      }),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxToolCall("job_output", { job_id: "bash-1", wait: true }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("job handled"),
  ]);
  session = await createSession({ ...options, ...fake, permissionMode: "full-access" });
  const run = session.run("start job", {
    onEvent(event) {
      if (event.type === "tool_execution_start" && event.toolName === "job_output")
        waiting.resolve();
    },
  });
  await waiting.promise;
  const release = Bun.spawn(["sh", "-c", "printf release > gate"], {
    cwd: dirs.cwd,
    stdout: "ignore",
    stderr: "pipe",
  });
  expect(await release.exited).toBe(0);
  await run;
  await session.waitForIdle();
  const job = session.jobs()[0];
  if (!job?.outputRef) throw new Error("Missing job output reference");
  expect(job.spillPath).toBeUndefined();
  const all = await session.readToolOutput(job.outputRef, 0, 400000);
  expect(all.stdout).toBe("b".repeat(300000));
  expect(all.stderr).toBe("diagnostic");
  const id = session.id;
  await session.close();
  session = undefined;
  expect(await readSessionToolOutput({ ...options, id }, job.outputRef, 0, 400000)).toEqual(all);
});

test("abort drains committed foreground stdout before preserving its interrupted receipt", async () => {
  dirs = await tempDirs();
  const pipe = Bun.spawn(["mkfifo", join(dirs.cwd, "gate")], { stdout: "ignore", stderr: "pipe" });
  expect(await pipe.exited).toBe(0);
  session = await createSession({
    ...dirs,
    dataRoot: join(dirs.homeDir, "desktop-data"),
    permissionMode: "full-access",
    ...fakeModel([
      fauxAssistantMessage(
        fauxToolCall("bash", {
          command: "printf before; cat gate",
          description: "abort blocked command",
        }),
        { stopReason: "toolUse" },
      ),
    ]),
  });
  const controller = new AbortController();
  const received = Promise.withResolvers<void>();
  const run = session.run("abort", {
    signal: controller.signal,
    onEvent(event) {
      if (event.type === "tool_execution_update" && JSON.stringify(event).includes("before"))
        received.resolve();
    },
  });
  void run.catch(() => {});
  await received.promise;
  controller.abort(new Error("test interruption"));
  await expect(run).rejects.toThrow("test interruption");
  const result = session.messages.find((message) => message.role === "toolResult");
  expect(result).toMatchObject({ isError: true });
  expect((await session.readToolOutput(outputRef(result))).stdout).toBe("before");
});

test("Session close drains final background bytes before its Harness database closes", async () => {
  dirs = await tempDirs();
  const options = { ...dirs, dataRoot: join(dirs.homeDir, "desktop-data") };
  const pipe = Bun.spawn(["mkfifo", join(dirs.cwd, "gate")], { stdout: "ignore", stderr: "pipe" });
  expect(await pipe.exited).toBe(0);
  const output = Promise.withResolvers<void>();
  session = await createSession({
    ...options,
    permissionMode: "full-access",
    ...fakeModel([
      fauxAssistantMessage(
        fauxToolCall("bash", {
          command: "trap 'printf stopped' TERM; printf before; cat gate",
          description: "close output drain",
          run_in_background: true,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("started"),
    ]),
  });
  session.subscribe((event) => {
    if (event.type === "job_event" && event.kind === "output") output.resolve();
  });
  await session.run("start");
  await output.promise;
  const ref = session.jobs()[0]?.outputRef;
  if (!ref) throw new Error("Missing background reference");
  const id = session.id;
  await session.close();
  session = undefined;
  expect((await readSessionToolOutput({ ...options, id }, ref)).stdout).toBe("beforestopped");
});

test("SQLite pending job_output collection suppresses the committed completion notification", async () => {
  dirs = await tempDirs();
  const pipe = Bun.spawn(["mkfifo", join(dirs.cwd, "gate")], { stdout: "ignore", stderr: "pipe" });
  expect(await pipe.exited).toBe(0);
  const waiting = Promise.withResolvers<void>();
  session = await createSession({
    ...dirs,
    dataRoot: join(dirs.homeDir, "desktop-data"),
    permissionMode: "full-access",
    ...fakeModel([
      fauxAssistantMessage(
        fauxToolCall("bash", {
          command: "cat gate >/dev/null",
          description: "wait completion",
          run_in_background: true,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxToolCall("job_output", { job_id: "bash-1", wait: true }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("collected"),
    ]),
  });
  const run = session.run("collect", {
    onEvent(event) {
      if (event.type === "tool_execution_start" && event.toolName === "job_output")
        waiting.resolve();
    },
  });
  await waiting.promise;
  const writer = Bun.spawn(["bash", "-c", "printf go > gate"], {
    cwd: dirs.cwd,
    stdout: "ignore",
    stderr: "pipe",
  });
  expect(await writer.exited).toBe(0);
  await run;
  await session.waitForIdle();
  expect(session.messages.filter((message) => message.role === "user")).toHaveLength(1);
  expect(session.messages.filter((message) => message.role === "toolResult").at(-1)).toMatchObject({
    isError: false,
  });
});
