import { expect, test } from "bun:test";
import { setImmediate } from "node:timers/promises";
import { createSubagentController } from "../../../src/tools/subagents/index.ts";

test("settle waits for a reserved child creation slot before a Run promise exists", async () => {
  const creation = Promise.withResolvers<never>();
  const entered = Promise.withResolvers<void>();
  const controller = createSubagentController({
    createChild: () => {
      entered.resolve();
      return creation.promise;
    },
    persist: async () => {},
    warn: () => {},
    steer: () => {},
    emit: () => {},
    addUsage: () => {},
  });
  const delegated = controller
    .fork({ description: "pending", prompt: "work", background: true })
    .catch((error: unknown) => error);
  await entered.promise;
  controller.abort();
  let settled = false;
  const settling = controller.settle().then(() => {
    settled = true;
  });
  try {
    // A macrotask boundary drains the promise chain; no clock duration is required.
    await setImmediate();
    expect(controller.count).toBe(1);
    expect(settled).toBe(false);
  } finally {
    creation.reject(new Error("creation rejected"));
    expect(await delegated).toMatchObject({ message: "creation rejected" });
    await settling;
  }
  expect(settled).toBe(true);
  expect(controller.count).toBe(0);
  expect(controller.hasNotifications).toBe(false);
});
