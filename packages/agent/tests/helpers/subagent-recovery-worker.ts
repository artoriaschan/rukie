import { createSession, createJsonlStore } from "../../src/index.ts";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { recordedNativeModel } from "./recorded-native-model.ts";
import { crashBarrier, isCut, type CrashIdentity } from "./subagent-crash-barrier.ts";

const [mode, cwd, homeDir, argument] = process.argv.slice(2);
if (!cwd || !homeDir || !argument) throw new Error("Missing worker arguments");
const fake = recordedNativeModel();
const bound = withAbortSignal(AbortSignal.timeout(5000), BACKGROUND_CONTEXT);
if (mode === "crash") {
  process.stdin.resume();
  if (!["child-done", "report-admitted", "report-processing", "report-answered"].includes(argument))
    throw new Error("Invalid crash cut");
  const cut =
    argument === "child-done" || argument === "report-admitted" || argument === "report-answered"
      ? argument
      : undefined;
  const store = createJsonlStore({ cwd, homeDir });
  const open = store.open.bind(store);
  let facts: CrashIdentity | undefined;
  const ready = () => {
    if (!facts) throw new Error("Crash boundary preceded captured identities");
    process.stdout.write(`READY ${JSON.stringify(facts)}\n`);
  };
  store.open = async (...args) => {
    const lease = await open(...args);
    return {
      ...lease,
      storage: crashBarrier(
        lease.storage,
        (writes) => cut !== undefined && isCut(writes, cut, facts?.driverId),
        ready,
      ),
    };
  };
  const session = await createSession({
    cwd,
    homeDir,
    ...fake,
    store,
    permissionMode: "full-access",
  });
  const running = session.run("PROCESS_ROOT_INITIAL");
  await fake.until(() => fake.calls.length === 1, bound);
  const root = fake.calls[0]!;
  root.finish(
    fauxAssistantMessage(
      fauxToolCall("subagent", {
        description: "Crash reporter",
        prompt: "PROCESS_CHILD_INITIAL",
        run_in_background: true,
      }),
      { stopReason: "toolUse" },
    ),
  );
  await fake.until(
    () =>
      fake.calls.some((call) => call.providerSessionId !== root.providerSessionId) &&
      fake.calls.filter((call) => call.providerSessionId === root.providerSessionId).length === 2,
    bound,
  );
  const child = fake.calls.find((call) => call.providerSessionId !== root.providerSessionId)!;
  if (!JSON.stringify(child.context.messages).includes("PROCESS_CHILD_INITIAL"))
    throw new Error("Unexpected initial child model context");
  fake.calls
    .filter((call) => call.providerSessionId === root.providerSessionId)[1]!
    .finish(fauxAssistantMessage("root idle before child"));
  await running;
  const directory: unknown = session.toolState("subagents");
  const row: unknown = Array.isArray(directory) ? directory[0] : undefined;
  if (
    !row ||
    typeof row !== "object" ||
    !("id" in row) ||
    typeof row.id !== "string" ||
    !("driverTaskId" in row) ||
    typeof row.driverTaskId !== "number" ||
    !session.currentRequestId
  )
    throw new Error("Missing actual child/request identity");
  facts = {
    sessionId: session.id,
    childId: row.id,
    driverId: row.driverTaskId,
    requestId: session.currentRequestId,
    parentProviderId: root.providerSessionId,
    childProviderId: child.providerSessionId,
  };
  const index = fake.calls.length;
  child.finish(fauxAssistantMessage("committed child closing fact"));
  await fake.until(
    () =>
      fake.calls.slice(index).some((call) => call.providerSessionId === facts!.parentProviderId),
    bound,
  );
  const report = fake.calls
    .slice(index)
    .find((call) => call.providerSessionId === facts!.parentProviderId)!;
  if (!JSON.stringify(report.context.messages).includes("committed child closing fact"))
    throw new Error("Missing real report input");
  if (argument === "report-processing") ready();
  else report.finish(fauxAssistantMessage("warm report processed"));
  await new Promise<never>(() => {});
} else if (mode === "cold") {
  const value: unknown = JSON.parse(argument);
  if (
    !value ||
    typeof value !== "object" ||
    !("sessionId" in value) ||
    typeof value.sessionId !== "string" ||
    !("childId" in value) ||
    typeof value.childId !== "string" ||
    !("requestId" in value) ||
    typeof value.requestId !== "string"
  )
    throw new Error("Invalid cold identity input");
  const session = await createSession({
    cwd,
    homeDir,
    ...fake,
    resumeId: value.sessionId,
    permissionMode: "full-access",
  });
  try {
    let settled = false;
    const pending = session.waitForRequest(value.requestId).then((result) => {
      settled = true;
      fake.notify();
      return result;
    });
    while (!settled) {
      await fake.until(() => settled || fake.calls.some((call) => !call.done), bound);
      for (const call of fake.calls.filter((call) => !call.done))
        call.finish(fauxAssistantMessage("cold report processed"));
    }
    const result = await pending;
    const child = await session.readSubagent(value.childId);
    const facts = {
      result,
      calls: fake.calls.map((call) => call.providerSessionId),
      directory: session.toolState("subagents"),
      child: child?.messages,
      reportInputs: session.messages.filter(
        (message) =>
          message.role === "user" &&
          JSON.stringify(message.content).includes("Its closing message:"),
      ),
    };
    await session.close();
    const secondFake = recordedNativeModel();
    const second = await createSession({ cwd, homeDir, ...secondFake, resumeId: value.sessionId });
    try {
      await second.waitForRequest(value.requestId);
      process.stdout.write(
        `COLD ${JSON.stringify({ ...facts, idleCalls: secondFake.calls.length })}\n`,
      );
    } finally {
      await second.close();
    }
  } finally {
    await session.close();
  }
} else throw new Error("Invalid worker mode");
