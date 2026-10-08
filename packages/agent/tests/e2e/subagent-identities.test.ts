import { expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { withAbortSignal, BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { StorageWrite } from "@earendil-works/pi-durable";
import { createSession, createJsonlStore } from "../../src/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { recordedNativeModel } from "../helpers/recorded-native-model.ts";

const rows = (value: unknown) => {
  if (!Array.isArray(value)) throw new Error("Missing public child directory");
  return value.map((row: unknown) => {
    if (
      !row ||
      typeof row !== "object" ||
      !("id" in row) ||
      typeof row.id !== "string" ||
      !("conversationId" in row) ||
      typeof row.conversationId !== "number" ||
      !("driverTaskId" in row) ||
      typeof row.driverTaskId !== "number" ||
      !("active" in row) ||
      typeof row.active !== "boolean"
    )
      throw new Error("Invalid child identity");
    return {
      id: row.id,
      conversationId: row.conversationId,
      driverTaskId: row.driverTaskId,
      active: row.active,
    };
  });
};

test("two send_message invocations with the same provider callId preserve distinct inputs on an active child", async () => {
  const dirs = await tempDirs();
  const fake = recordedNativeModel();
  const observed: StorageWrite[] = [];
  const store = createJsonlStore(dirs);
  const open = store.open.bind(store);
  store.open = async (...args) => {
    const lease = await open(...args);
    const commit = lease.storage.commit.bind(lease.storage);
    return {
      ...lease,
      storage: new Proxy(lease.storage, {
        get(target, key) {
          if (key === "commit")
            return async (...args: Parameters<typeof commit>) => {
              const seq = await commit(...args);
              observed.push(...args[0]);
              return seq;
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    };
  };
  const session = await createSession({ ...dirs, ...fake, store, permissionMode: "full-access" });
  // Failure bound only; synchronization below is provider entry and native request completion.
  const bound = withAbortSignal(AbortSignal.timeout(5000), BACKGROUND_CONTEXT);
  try {
    const first = session.run("IDENTITY_ROOT_INITIAL");
    await fake.until(() => fake.calls.length > 0, bound);
    const rootFirst = fake.calls[0]!;
    const rootProviderId = rootFirst.providerSessionId;
    rootFirst.finish(
      fauxAssistantMessage(
        fauxToolCall("subagent", {
          description: "Held identity child",
          prompt: "IDENTITY_CHILD_INITIAL",
          run_in_background: true,
        }),
        { stopReason: "toolUse" },
      ),
    );
    await fake.until(
      () =>
        fake.calls.some((call) => call.providerSessionId !== rootProviderId) &&
        fake.calls.filter((call) => call.providerSessionId === rootProviderId).length === 2,
      bound,
    );
    // Unique first child input is checked once; NEVER classify reporters by retained old Human content.
    const childFirst = fake.calls.find((call) => call.providerSessionId !== rootProviderId)!;
    expect(JSON.stringify(childFirst.context.messages)).toContain("IDENTITY_CHILD_INITIAL");
    const childProviderId = childFirst.providerSessionId;
    fake.calls
      .filter((call) => call.providerSessionId === rootProviderId)[1]!
      .finish(fauxAssistantMessage("root receipt settled"));
    await first;
    const causalRequestId = session.currentRequestId;
    if (!causalRequestId) throw new Error("Missing root causal request ID");
    const original = rows(session.toolState("subagents"))[0]!;
    expect(original.active).toBe(true);
    expect(childFirst.done).toBe(false);
    let sendRequestId = "";
    const markers = ["DISTINCT_ACTIVE_INPUT_A", "DISTINCT_ACTIVE_INPUT_B"] as const;
    for (const marker of markers) {
      const begin = fake.calls.length;
      const run = session.run(`parent asks ${marker}`);
      await fake.until(() => fake.calls.length > begin, bound);
      const current = fake.calls[begin]!;
      expect(current.providerSessionId).toBe(rootProviderId);
      current.finish(
        fauxAssistantMessage(
          fauxToolCall(
            "send_message",
            { agent_id: original.id, message: marker },
            { id: "REUSED_PROVIDER_CALL_ID" },
          ),
          { stopReason: "toolUse" },
        ),
      );
      await fake.until(
        () => fake.calls.slice(begin + 1).some((call) => call.providerSessionId === rootProviderId),
        bound,
      );
      fake.calls
        .slice(begin + 1)
        .find((call) => call.providerSessionId === rootProviderId)!
        .finish(fauxAssistantMessage(`ack ${marker}`));
      await run;
      sendRequestId = session.currentRequestId ?? "";
      expect(rows(session.toolState("subagents"))).toEqual([original]);
      expect(childFirst.done).toBe(false);
    }
    let sentSettled = false;
    const sendReceipt = session.waitForRequest(sendRequestId).then((result) => {
      sentSettled = true;
      fake.notify();
      return result;
    });
    // Make the held child continue through a genuine allowed tool boundary so queued steer inputs enter context.
    const begin = fake.calls.length;
    childFirst.finish(
      fauxAssistantMessage(fauxToolCall("todo_write", { todos: [] }), { stopReason: "toolUse" }),
    );
    await fake.until(
      () => fake.calls.slice(begin).some((call) => call.providerSessionId === childProviderId),
      bound,
    );
    const firstSteer = fake.calls
      .slice(begin)
      .find((call) => call.providerSessionId === childProviderId)!;
    expect(JSON.stringify(firstSteer.context.messages)).toContain(markers[0]);
    const afterFirstSteer = fake.calls.length;
    // Native steer admits one queued input per continuation boundary.
    firstSteer.finish(
      fauxAssistantMessage(fauxToolCall("todo_write", { todos: [] }), { stopReason: "toolUse" }),
    );
    await fake.until(
      () =>
        fake.calls
          .slice(afterFirstSteer)
          .some((call) => call.providerSessionId === childProviderId),
      bound,
    );
    const continued = fake.calls
      .slice(afterFirstSteer)
      .find((call) => call.providerSessionId === childProviderId)!;
    const users = continued.context.messages.filter((message) => message.role === "user");
    for (const marker of markers)
      expect(
        users.filter((message) => JSON.stringify(message.content).includes(marker)),
      ).toHaveLength(1);
    expect(sentSettled).toBe(false);
    continued.finish(fauxAssistantMessage("all distinct instructions processed"));
    let settled = false;
    const receipt = session.waitForRequest(causalRequestId).then((result) => {
      settled = true;
      fake.notify();
      return result;
    });
    // Complete actual root reporter calls by stable provider ID, not root idle or retained Human classification.
    while (!settled) {
      await fake.until(
        () =>
          settled ||
          fake.calls.some((call) => !call.done && call.providerSessionId === rootProviderId),
        bound,
      );
      for (const call of fake.calls.filter(
        (call) => !call.done && call.providerSessionId === rootProviderId,
      ))
        call.finish(fauxAssistantMessage("report actually processed"));
    }
    expect((await receipt).success).toBe(true);
    expect((await sendReceipt).text).toBe("report actually processed");
    const final = rows(session.toolState("subagents"));
    expect(final).toHaveLength(1);
    expect(final[0]).toMatchObject({
      id: original.id,
      conversationId: original.conversationId,
      driverTaskId: original.driverTaskId,
      active: false,
    });
    const snapshot = await session.readSubagent(original.id);
    for (const marker of markers)
      expect(
        snapshot?.messages.filter(
          (message) => message.role === "user" && JSON.stringify(message.content).includes(marker),
        ),
      ).toHaveLength(1);
    const toolTasks = new Set(
      observed.flatMap((write) => {
        if (write.type !== "task" || write.value.kind !== "pi.tool") return [];
        const input = write.value.input;
        if (
          !input ||
          typeof input !== "object" ||
          Array.isArray(input) ||
          input.callId !== "REUSED_PROVIDER_CALL_ID"
        )
          return [];
        return [Number(write.value.id)];
      }),
    );
    expect(toolTasks.size).toBe(2);
    const submitted = new Set(
      observed.flatMap((write) =>
        write.type === "submission" &&
        write.value.type === "input" &&
        Number(write.value.conversationId) === original.conversationId &&
        write.value.requestId?.startsWith("subagent-send:")
          ? [write.value.requestId]
          : [],
      ),
    );
    expect(submitted.size).toBe(2);
    // No HTTP invocation exactly-once claim: inspect distinct committed native logical inputs.
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});

test("causal request completion includes descendants admitted by a later report and excludes unrelated held work", async () => {
  const dirs = await tempDirs();
  const fake = recordedNativeModel();
  const terminalDrivers = new Set<number>();
  const store = createJsonlStore(dirs);
  const open = store.open.bind(store);
  store.open = async (...args) => {
    const lease = await open(...args);
    const commit = lease.storage.commit.bind(lease.storage);
    return {
      ...lease,
      storage: new Proxy(lease.storage, {
        get(target, key) {
          if (key === "commit")
            return async (...args: Parameters<typeof commit>) => {
              const seq = await commit(...args);
              for (const write of args[0])
                if (
                  write.type === "task" &&
                  write.value.kind === "rukie.subagent-driver" &&
                  write.value.state.status === "terminal"
                )
                  terminalDrivers.add(Number(write.value.id));
              fake.notify();
              return seq;
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    };
  };
  const session = await createSession({ ...dirs, ...fake, store, permissionMode: "full-access" });
  const bound = withAbortSignal(AbortSignal.timeout(5000), BACKGROUND_CONTEXT);
  try {
    const unrelatedRun = session.run("CAUSAL_UNRELATED_ROOT");
    await fake.until(() => fake.calls.length === 1, bound);
    const rootId = fake.calls[0]!.providerSessionId;
    const nextRoot = async () => {
      await fake.until(
        () => fake.calls.some((call) => !call.done && call.providerSessionId === rootId),
        bound,
      );
      return fake.calls.find((call) => !call.done && call.providerSessionId === rootId)!;
    };
    fake.calls[0]!.finish(
      fauxAssistantMessage(
        fauxToolCall("subagent", {
          description: "Unrelated",
          prompt: "CAUSAL_UNRELATED_CHILD",
          run_in_background: true,
        }),
        { stopReason: "toolUse" },
      ),
    );
    await fake.until(() => fake.calls.some((call) => call.providerSessionId !== rootId), bound);
    const unrelated = fake.calls.find((call) => call.providerSessionId !== rootId)!;
    expect(JSON.stringify(unrelated.context.messages)).toContain("CAUSAL_UNRELATED_CHILD");
    (await nextRoot()).finish(fauxAssistantMessage("unrelated root idle"));
    await unrelatedRun;
    const selectedRun = session.run("CAUSAL_SELECTED_ROOT");
    (await nextRoot()).finish(
      fauxAssistantMessage(
        fauxToolCall("subagent", {
          description: "Selected",
          prompt: "CAUSAL_SELECTED_CHILD",
          run_in_background: true,
        }),
        { stopReason: "toolUse" },
      ),
    );
    await fake.until(
      () =>
        fake.calls.some(
          (call) =>
            call.providerSessionId !== rootId &&
            call.providerSessionId !== unrelated.providerSessionId,
        ),
      bound,
    );
    const selected = fake.calls.find(
      (call) =>
        call.providerSessionId !== rootId && call.providerSessionId !== unrelated.providerSessionId,
    )!;
    expect(JSON.stringify(selected.context.messages)).toContain("CAUSAL_SELECTED_CHILD");
    (await nextRoot()).finish(fauxAssistantMessage("selected ordinary root idle"));
    await selectedRun;
    const requestId = session.currentRequestId;
    if (!requestId) throw new Error("Missing selected request identity");
    const selectedDriver = rows(session.toolState("subagents")).find(
      (row) => row.id !== rows(session.toolState("subagents"))[0]?.id,
    )!;
    let settled = false;
    const receipt = session.waitForRequest(requestId).then((result) => {
      settled = true;
      fake.notify();
      return result;
    });
    selected.finish(fauxAssistantMessage("selected child closing"));
    const report = await nextRoot();
    expect(settled).toBe(false);
    report.finish(
      fauxAssistantMessage(
        fauxToolCall("subagent_fork", {
          description: "Late descendant",
          prompt: "CAUSAL_LATE_CHILD",
          run_in_background: true,
        }),
        { stopReason: "toolUse" },
      ),
    );
    const knownIds = new Set([rootId, unrelated.providerSessionId, selected.providerSessionId]);
    await fake.until(() => fake.calls.some((call) => !knownIds.has(call.providerSessionId)), bound);
    const late = fake.calls.find((call) => !knownIds.has(call.providerSessionId))!;
    expect(JSON.stringify(late.context.messages)).toContain("CAUSAL_LATE_CHILD");
    expect(JSON.stringify(late.context.messages)).toContain("CAUSAL_SELECTED_ROOT");
    (await nextRoot()).finish(fauxAssistantMessage("report admitted late child"));
    await fake.until(() => terminalDrivers.has(selectedDriver.driverTaskId), bound);
    expect(settled).toBe(false);
    expect(late.done).toBe(false);
    late.finish(fauxAssistantMessage("late child closing"));
    const finalReport = await nextRoot();
    expect(settled).toBe(false);
    expect(JSON.stringify(finalReport.context.messages)).toContain("late child closing");
    finalReport.finish(fauxAssistantMessage("all causal descendants processed"));
    expect((await receipt).text).toBe("all causal descendants processed");
    expect(unrelated.done).toBe(false);
    expect(rows(session.toolState("subagents")).filter((row) => row.active)).toHaveLength(1);
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});
