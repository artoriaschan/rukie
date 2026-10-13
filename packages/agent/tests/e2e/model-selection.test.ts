import { afterEach, expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createRegistry, Harness, defineDoc } from "@earendil-works/pi-durable";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { createJsonlStore, createSession, type Session } from "../../src/index.ts";
import { fakeModel } from "../helpers/fake-model.ts";
import {
  withAuxiliaryRequests,
  withModelAlias,
  withModelStream,
} from "../helpers/auxiliary-model.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";

let dirs: Awaited<ReturnType<typeof tempDirs>>;
const sessions: Session[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((session) => session.close()));
  await dirs?.cleanup();
});

function selectionModels(responses: Parameters<typeof fakeModel>[0]) {
  const fake = fakeModel(responses, { model: { reasoning: true } });
  const requested: { model: string; thinking: unknown }[] = [];
  const stream = fake.models.getProviders()[0]!.streamSimple;
  const models = withModelAlias(
    withModelStream(
      fake.models,
      withAuxiliaryRequests((model, context, options) => {
        requested.push({ model: model.id, thinking: options?.reasoning });
        return stream(model, context, options);
      }),
    ),
    "selection",
    ["full", "limited", "minimum", "plain"],
  );
  const provider = models.getProviders().find((entry) => entry.id === "selection")!;
  const aliases = provider.getModels();
  models.setProvider({
    ...provider,
    getModels: () =>
      aliases.map((model) => ({
        ...model,
        reasoning: model.id !== "plain",
        ...(model.id === "limited" ? { thinkingLevelMap: { medium: null, high: null } } : {}),
        ...(model.id === "minimum"
          ? { thinkingLevelMap: { off: null, minimal: null, low: null } }
          : {}),
      })),
  });
  return { models, model: models.getModel("selection", "full")!, requested };
}

test.each([
  { model: "limited", requested: "high" as const, effective: "low" },
  { model: "minimum", requested: "low" as const, effective: "medium" },
  { model: "plain", requested: "high" as const, effective: "off" },
])(
  "Model Selection clamps $model to $effective and sends the effective level",
  async ({ model, requested, effective }) => {
    dirs = await tempDirs();
    const fake = selectionModels([fauxAssistantMessage("answer")]);
    const session = await createSession({ ...dirs, ...fake });
    sessions.push(session);
    expect(
      await session.setModelSelection({ model: `selection/${model}`, thinkingLevel: requested }),
    ).toEqual({ model: `selection/${model}`, thinkingLevel: effective, clampedFrom: requested });
    expect(session.thinkingLevel).toBe(effective);
    expect(session.toolState("model")).toEqual({
      model: `selection/${model}`,
      thinkingLevel: effective,
    });
    await session.run("question");
    expect(fake.requested).toEqual([
      { model, thinking: effective === "off" ? undefined : effective },
    ]);
  },
);

test("model-only selection retains the current supported level; concurrent selection is refused", async () => {
  dirs = await tempDirs();
  const fake = selectionModels([fauxAssistantMessage("answer")]);
  const session = await createSession({ ...dirs, ...fake, settings: { thinking: "high" } });
  sessions.push(session);
  const switching = session.setModelSelection({ model: "selection/limited" });
  await expect(session.setModelSelection({ thinkingLevel: "medium" })).rejects.toThrow(
    "switching models",
  );
  expect(await switching).toEqual({
    model: "selection/limited",
    thinkingLevel: "low",
    clampedFrom: "high",
  });
  await session.run("question");
  expect(fake.requested).toEqual([{ model: "limited", thinking: "low" }]);
});

test("Rewind and cold resume restore both fields and the actual request independently of settings", async () => {
  dirs = await tempDirs();
  const fake = selectionModels([
    fauxAssistantMessage("first"),
    fauxAssistantMessage("second"),
    fauxAssistantMessage("replacement"),
    fauxAssistantMessage("resumed"),
  ]);
  const session = await createSession({ ...dirs, ...fake });
  sessions.push(session);
  await session.setModelSelection({ thinkingLevel: "high" });
  await session.run("first question");
  await session.setModelSelection({ model: "selection/limited" });
  await session.run("second question");
  await session.rewind(session.checkpoints()[0]!.promptEntryId, {
    code: false,
    conversation: true,
  });
  expect(session.model).toBe("selection/full");
  expect(session.thinkingLevel).toBe("high");
  expect(session.toolState("model")).toEqual({ model: "selection/full", thinkingLevel: "high" });
  await session.run("replacement question");
  await session.close();
  const resumed = await createSession({
    ...dirs,
    ...fake,
    settings: { thinking: "low" },
    resumeId: session.id,
  });
  sessions.push(resumed);
  expect(resumed.model).toBe("selection/full");
  expect(resumed.thinkingLevel).toBe("high");
  await resumed.run("resumed question");
  expect(fake.requested).toEqual([
    { model: "full", thinking: "high" },
    { model: "limited", thinking: "low" },
    { model: "full", thinking: "high" },
    { model: "full", thinking: "high" },
  ]);
});

test("resume reads v1 model facts and migrates the mirror from native Model Selection", async () => {
  dirs = await tempDirs();
  const fake = selectionModels([fauxAssistantMessage("answer")]);
  const lease = await createJsonlStore(dirs).open({}, BACKGROUND_CONTEXT);
  try {
    const native = await Harness.open(
      lease.storage,
      { models: fake.models, registry: createRegistry() },
      BACKGROUND_CONTEXT,
    );
    try {
      const legacy = defineDoc({
        kind: "rukie.model",
        version: 1,
        scope: "conversation",
        history: "rewindable",
        fork: "asOf",
        initial: () => ({ value: "selection/plain" }),
      });
      // Seed a genuine v1 mirror before the current Session initializer creates v2.
      await native.root(BACKGROUND_CONTEXT, {
        agent: { model: { provider: "selection", modelId: "full" }, thinkingLevel: "high" },
        init: async (tx, id) => {
          await tx.doc(legacy, id);
        },
      });
    } finally {
      await native.close(BACKGROUND_CONTEXT);
    }
  } finally {
    await lease.release();
  }
  const resumed = await createSession({
    ...dirs,
    ...fake,
    settings: { thinking: "low" },
    resumeId: lease.id,
  });
  sessions.push(resumed);
  expect(resumed.model).toBe("selection/full");
  expect(resumed.thinkingLevel).toBe("high");
  expect(resumed.toolState("model")).toEqual({ model: "selection/full", thinkingLevel: "high" });
  await resumed.run("question");
  expect(fake.requested).toEqual([{ model: "full", thinking: "high" }]);
});

test("automatic Model Selection survives rewind and cold resume without adopting global settings", async () => {
  dirs = await tempDirs();
  const fake = selectionModels([
    fauxAssistantMessage("first"),
    fauxAssistantMessage("second"),
    fauxAssistantMessage("resumed"),
  ]);
  const session = await createSession({ ...dirs, ...fake, settings: { thinking: "automatic" } });
  sessions.push(session);
  expect(session.thinkingLevel).toBe("automatic");
  await session.run("first");
  await session.setModelSelection({ thinkingLevel: "high" });
  await session.run("second");
  await session.rewind(session.checkpoints()[0]!.promptEntryId, {
    code: false,
    conversation: true,
  });
  expect(session.thinkingLevel).toBe("automatic");
  await session.close();
  const resumed = await createSession({
    ...dirs,
    ...fake,
    settings: { thinking: "low" },
    resumeId: session.id,
  });
  sessions.push(resumed);
  expect(resumed.thinkingLevel).toBe("automatic");
  expect(resumed.toolState("model")).toEqual({
    model: "selection/full",
    thinkingLevel: "automatic",
  });
  await resumed.run("resumed");
  expect(fake.requested.map((request) => request.thinking)).toEqual([undefined, "high", undefined]);
});
