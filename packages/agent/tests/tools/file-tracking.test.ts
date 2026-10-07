import { expect, test } from "bun:test";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Harness, MemoryStorage, createRegistry } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { createFileTracking } from "../../src/file-tracking/index.ts";
import { createImageReadTool } from "../../src/tools/read.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

test.each([false, true])(
  "cold tracking learns only a successful committed native receipt (failed=%s)",
  async (failed) => {
    const dirs = await tempDirs();
    const path = join(dirs.cwd, "file.txt");
    await Bun.write(path, "before\n");
    let writes = 0;
    const tracking = createFileTracking(dirs.cwd, {
      persist: async () => {
        writes++;
        throw new Error("tracking storage failed");
      },
    });
    const read = tracking.wrapTool(createImageReadTool(dirs.cwd, dirs.homeDir));
    const admittedRead: typeof read = {
      ...read,
      async execute(...args) {
        const result = await read.execute(...args);
        if (failed) throw new Error("read failed after staging its candidate");
        return result;
      },
    };
    const registry = createRegistry();
    registry.install({
      name: "file-tracking-test",
      tools: [admittedRead],
    });
    const fake = fakeModel([
      fauxAssistantMessage(fauxToolCall("read", { path: "file.txt" }), { stopReason: "toolUse" }),
      fauxAssistantMessage("done"),
    ]);
    const harness = await Harness.open(
      new MemoryStorage(),
      { models: fake.models, registry, env: () => new NodeExecutionEnv({ cwd: dirs.cwd }) },
      BACKGROUND_CONTEXT,
    );
    try {
      const conversation = await harness.root(BACKGROUND_CONTEXT, {
        agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
      });
      const request = await conversation.submit(
        { type: "input", content: "read file" },
        BACKGROUND_CONTEXT,
      );
      expect((await request.wait(BACKGROUND_CONTEXT)).status).toBe("done");
      const entries = (await conversation.context(BACKGROUND_CONTEXT)).entries;
      const candidate = entries.findIndex((entry) => entry.kind === "rukie.file-baseline");
      const receipt = entries.findIndex((entry) =>
        entry.model?.some((message) => message.role === "toolResult"),
      );
      expect(candidate).toBeGreaterThanOrEqual(0);
      expect(receipt).toBeGreaterThan(candidate);
      expect(writes).toBe(0);
      if (failed) await tracking.commitResults(entries);
      else await expect(tracking.commitResults(entries)).rejects.toThrow("tracking storage failed");
      expect(writes).toBe(failed ? 0 : 1);

      await Bun.write(path, "external changed contents\n");
      const learned: unknown[] = [];
      const cold = createFileTracking(dirs.cwd, {
        persist: async (snapshot) => {
          learned.push(structuredClone(snapshot));
        },
      });
      await cold.restoreCommitted(entries);
      if (failed) {
        expect(learned).toEqual([]);
        expect(await cold.reminderSource.currentContent()).toBeUndefined();
      } else {
        expect(learned).toHaveLength(1);
        expect(learned[0]).toMatchObject({
          lastResultEntryId: Number(entries[receipt]!.id),
          files: [{ path, size: 7, stale: false }],
        });
        // Exact receipt replay cannot replace a newer reported external-file baseline.
        expect(await cold.reminderSource.currentContent()).toContain(
          "Read it again before editing",
        );
        const persistedWrites = learned.length;
        await cold.restoreCommitted(entries);
        expect(learned).toHaveLength(persistedWrites);
      }
      const beforeInvalid = learned.length;
      await conversation.commit(
        (tx) =>
          tx.appendEntry(conversation.id, {
            kind: "rukie.file-baseline",
            data: { callId: "malformed" },
          }),
        BACKGROUND_CONTEXT,
      );
      await expect(
        cold.restoreCommitted((await conversation.context(BACKGROUND_CONTEXT)).entries),
      ).rejects.toThrow("Invalid committed file baseline candidate");
      expect(learned).toHaveLength(beforeInvalid);
    } finally {
      await harness.close(BACKGROUND_CONTEXT);
      await dirs.cleanup();
    }
  },
);
