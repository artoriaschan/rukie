import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createJsonlStore } from "../../src/index.ts";
import { planState } from "../../src/tools/plan-mode/state.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

test("native reset replaces model context while preserving owner documents and original entries across reopen", async () => {
  const dirs = await tempDirs();
  const store = createJsonlStore(dirs);
  const fake = fakeModel([fauxAssistantMessage("original answer")]);
  const lease = await store.open({}, BACKGROUND_CONTEXT);
  let harness = await Harness.open(
    lease.storage,
    { models: fake.models, registry: createRegistry() },
    BACKGROUND_CONTEXT,
  );
  let release = lease.release;
  try {
    const conversation = await harness.root(BACKGROUND_CONTEXT, {
      agent: { model: { provider: fake.model.provider, modelId: fake.model.id } },
    });
    await conversation.commit(async (tx) => {
      (await tx.doc(planState.document, conversation.id)).value = { active: true };
    }, BACKGROUND_CONTEXT);
    const input = await conversation.submit(
      { type: "input", content: "original prompt" },
      BACKGROUND_CONTEXT,
    );
    expect((await input.wait(BACKGROUND_CONTEXT)).status).toBe("done");
    const old = (await conversation.context(BACKGROUND_CONTEXT)).entries;
    await conversation.reset("current handoff", BACKGROUND_CONTEXT);
    const context = await conversation.context(BACKGROUND_CONTEXT);
    expect(context.head?.kind).toBe("pi.reset");
    expect(JSON.stringify(context.messages)).toContain("current handoff");
    expect(JSON.stringify(context.messages)).not.toContain("original prompt");
    expect(JSON.stringify(context.messages)).not.toContain("original answer");
    expect(await harness.snapshot(planState.document, conversation.id, BACKGROUND_CONTEXT)).toEqual(
      { value: { active: true } },
    );
    for (const entry of old)
      expect((await lease.storage.entry(entry.id, BACKGROUND_CONTEXT))!.entry).toEqual(entry);
    await harness.close(BACKGROUND_CONTEXT);
    await release();
    const reopened = await store.open({ id: lease.id }, BACKGROUND_CONTEXT);
    release = reopened.release;
    harness = await Harness.open(
      reopened.storage,
      { models: fake.models, registry: createRegistry() },
      BACKGROUND_CONTEXT,
    );
    const restored = await harness.root(BACKGROUND_CONTEXT);
    expect(await restored.context(BACKGROUND_CONTEXT)).toEqual(context);
    expect(await harness.snapshot(planState.document, restored.id, BACKGROUND_CONTEXT)).toEqual({
      value: { active: true },
    });
    expect(fake.contexts).toHaveLength(1);
  } finally {
    await harness.close(BACKGROUND_CONTEXT);
    await release();
    await dirs.cleanup();
  }
});
