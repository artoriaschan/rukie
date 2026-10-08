import { expect, test } from "bun:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { StorageWrite } from "@earendil-works/pi-durable";
import { withAbortSignal, BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createSession, createJsonlStore } from "../../src/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { recordedNativeModel } from "../helpers/recorded-native-model.ts";

function directory(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Missing public child directory");
  return value.map((row: unknown) => {
    if (
      !row ||
      typeof row !== "object" ||
      !("id" in row) ||
      typeof row.id !== "string" ||
      !("driverTaskId" in row) ||
      typeof row.driverTaskId !== "number" ||
      !("active" in row) ||
      typeof row.active !== "boolean"
    )
      throw new Error("Invalid child identity");
    return { id: row.id, driverTaskId: row.driverTaskId, active: row.active };
  });
}

test("awaiting selected child interrupt observes native terminal while sibling remains active", async () => {
  const dirs = await tempDirs();
  const fake = recordedNativeModel();
  const latest = new Map<number, Extract<StorageWrite, { type: "task" }>["value"]>();
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
                if (write.type === "task") latest.set(Number(write.value.id), write.value);
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
    const run = session.run("INTERRUPT_ROOT_INITIAL");
    await fake.until(() => fake.calls.length === 1, bound);
    const parentId = fake.calls[0]!.providerSessionId;
    fake.calls[0]!.finish(
      fauxAssistantMessage(
        [
          fauxToolCall("subagent", {
            description: "Selected",
            prompt: "INTERRUPT_CHILD_SELECTED",
            run_in_background: true,
          }),
          fauxToolCall("subagent", {
            description: "Sibling",
            prompt: "INTERRUPT_CHILD_SIBLING",
            run_in_background: true,
          }),
        ],
        { stopReason: "toolUse" },
      ),
    );
    await fake.until(
      () =>
        fake.calls.filter((call) => call.providerSessionId !== parentId).length === 2 &&
        fake.calls.filter((call) => call.providerSessionId === parentId).length === 2,
      bound,
    );
    fake.calls
      .filter((call) => call.providerSessionId === parentId)[1]!
      .finish(fauxAssistantMessage("ordinary root settled"));
    await run;
    const requestId = session.currentRequestId;
    if (!requestId) throw new Error("Missing actual causal request");
    const selectedProvider = fake.calls.find(
      (call) =>
        call.providerSessionId !== parentId &&
        JSON.stringify(call.context.messages).includes("INTERRUPT_CHILD_SELECTED"),
    )!.providerSessionId;
    const selectedCall = fake.calls.find((call) => call.providerSessionId === selectedProvider)!;
    const selected = directory(session.toolState("subagents")).find(
      (row) =>
        latest.get(row.driverTaskId)?.input &&
        JSON.stringify(latest.get(row.driverTaskId)?.input).includes("INTERRUPT_CHILD_SELECTED"),
    );
    if (!selected) throw new Error("Selected actual driver identity missing");
    const sibling = directory(session.toolState("subagents")).find(
      (row) => row.id !== selected.id,
    )!;
    expect(selectedCall.done).toBe(false);
    const stop = session.interruptSubagent(selected.id);
    expect(stop).toBeInstanceOf(Promise);
    await fake.until(
      () => fake.calls.some((call) => !call.done && call.providerSessionId === parentId),
      bound,
    );
    const repeated = session
      .interruptSubagent(selected.id)
      .then(() => latest.get(selected.driverTaskId)?.state.status);
    let settled = false;
    const terminal = Promise.resolve(stop).then(() => {
      settled = true;
      fake.notify();
    });
    while (!settled) {
      await fake.until(
        () =>
          settled || fake.calls.some((call) => !call.done && call.providerSessionId === parentId),
        bound,
      );
      for (const report of fake.calls.filter(
        (call) => !call.done && call.providerSessionId === parentId,
      ))
        report.finish(fauxAssistantMessage("selected cancellation report processed"));
    }
    await terminal;
    expect(await repeated).toBe("terminal");
    expect(latest.get(selected.driverTaskId)?.state.status).toBe("terminal");
    expect(
      directory(session.toolState("subagents")).find((row) => row.id === selected.id)?.active,
    ).toBe(false);
    expect(
      directory(session.toolState("subagents")).find((row) => row.id === sibling.id)?.active,
    ).toBe(true);
    expect(
      fake.calls
        .filter(
          (call) =>
            call.providerSessionId !== parentId && call.providerSessionId !== selectedProvider,
        )
        .every((call) => !call.done),
    ).toBe(true);
    const siblingProvider = fake.calls.find(
      (call) => call.providerSessionId !== parentId && call.providerSessionId !== selectedProvider,
    )!.providerSessionId;
    await session.close();
    const cold = recordedNativeModel();
    const resumed = await createSession({ ...dirs, ...cold, resumeId: session.id });
    try {
      await cold.until(
        () => cold.calls.some((call) => call.providerSessionId === siblingProvider),
        bound,
      );
      expect(cold.calls.map((call) => call.providerSessionId)).not.toContain(selectedProvider);
      cold.calls
        .find((call) => call.providerSessionId === siblingProvider)!
        .finish(fauxAssistantMessage("sibling resumed once"));
      let completed = false;
      const request = resumed.waitForRequest(requestId).then((result) => {
        completed = true;
        cold.notify();
        return result;
      });
      while (!completed) {
        await cold.until(() => completed || cold.calls.some((call) => !call.done), bound);
        for (const call of cold.calls.filter((call) => !call.done)) {
          expect(call.providerSessionId).toBe(parentId);
          call.finish(fauxAssistantMessage("resumed sibling report processed"));
        }
      }
      expect((await request).success).toBe(true);
      expect(cold.calls.map((call) => call.providerSessionId)).not.toContain(selectedProvider);
      expect(
        directory(resumed.toolState("subagents")).find((row) => row.id === selected.id)?.active,
      ).toBe(false);
    } finally {
      await resumed.close();
    }
  } finally {
    await session.close();
    await dirs.cleanup();
  }
});
