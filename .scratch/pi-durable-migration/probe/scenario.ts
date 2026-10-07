import { BACKGROUND_CONTEXT as ctx, awaitWithContext } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  fauxProvider,
  fauxAssistantMessage,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import {
  Harness,
  createRegistry,
  defineDoc,
  defineExtension,
  defineTool,
  hook,
  ToolTask,
  watchEvents,
  defineTask,
} from "@earendil-works/pi-durable";
import { openNodeJsonlStorage } from "@earendil-works/pi-durable/storage/jsonl/node";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { Type } from "typebox";
import type { Provider } from "@earendil-works/pi-ai/models";

export const Facts = defineDoc<{ count: number }>({
  kind: "probe.facts",
  version: 1,
  scope: "conversation",
  history: "rewindable",
  fork: "asOf",
  initial: () => ({ count: 0 }),
});
export async function open(
  dir: string,
  responses: Parameters<ReturnType<typeof fauxProvider>["setResponses"]>[0],
  extensions: ReturnType<typeof defineExtension>[] = [],
  providerOverride?: (provider: Provider) => Provider,
) {
  const faux = fauxProvider({ tokensPerSecond: Infinity });
  faux.setResponses(responses);
  const models = createModels();
  models.setProvider(providerOverride ? providerOverride(faux.provider) : faux.provider);
  const registry = createRegistry();
  registry.install(CodingTools);
  for (const ext of extensions) registry.install(ext);
  const env = new NodeExecutionEnv({ cwd: dir });
  const harness = await Harness.open(
    await openNodeJsonlStorage(dir + "/store", ctx, { fsync: true }),
    {
      models,
      registry,
      env: () => env,
      settings: { progress: { partialIntervalMs: 0, outputIntervalMs: 0 } },
      conversationCreated: async (tx, conversation) => {
        await tx.doc(Facts, conversation.id);
      },
    },
    ctx,
  );
  const root = await harness.root(ctx, {
    agent: { model: { provider: faux.getModel().provider, modelId: faux.getModel().id }, cwd: dir },
  });
  return { harness, root, faux, env };
}
export async function smoke(dir: string) {
  const first = await open(dir, [
    fauxAssistantMessage(fauxToolCall("write", { path: "hello.txt", content: "hello" }), {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage("a streamed final answer"),
  ]);
  const watch = await first.root.watch(ctx);
  let streamed = false;
  watch.start(async (view) => {
    if (JSON.stringify(view.docs["pi.live"]).includes("streamed")) streamed = true;
  });
  const sub = await first.root.submit(
    { type: "input", content: "write hello", requestId: "smoke" },
    ctx,
  );
  const result = await sub.wait(ctx);
  await first.root.commit(async (tx) => {
    (await tx.doc(Facts, first.root.id)).count = 1;
  }, ctx);
  const file = await first.env.readTextFile("hello.txt", ctx);
  if (!file.ok) throw file.error;
  const text = file.value;
  await watch.stop();
  await first.harness.close(ctx);
  await first.env.cleanup(ctx);
  const second = await open(dir, []);
  const duplicate = await second.root.submit(
    { type: "input", content: "write hello", requestId: "smoke" },
    ctx,
  );
  const doc = await second.harness.snapshot(Facts, second.root.id, ctx);
  await second.harness.close(ctx);
  await second.env.cleanup(ctx);
  return {
    status: result.status,
    text,
    doc: doc?.count,
    duplicates: duplicate.id === sub.id,
    streamed,
  };
}

export async function hookClose(dir: string) {
  let hooks = 0;
  let executed = 0;
  const entered = Promise.withResolvers<void>();
  const ext = defineExtension({
    name: "approval",
    tools: [
      defineTool({
        name: "probe",
        description: "probe",
        parameters: Type.Object({}),
        execute: async () => {
          executed++;
          return { content: [{ type: "text", text: "ok" }] };
        },
      }),
    ],
    hooks: [
      hook(ToolTask, {
        beforeTool: async (_call, _api, context) => {
          hooks++;
          if (hooks === 1) {
            entered.resolve();
            await awaitWithContext(new Promise<void>(() => {}), context);
          }
          return undefined;
        },
      }),
    ],
  });
  const h = await open(
    dir,
    [fauxAssistantMessage(fauxToolCall("probe", {}), { stopReason: "toolUse" })],
    [ext],
  );
  const sub = await h.root.submit(
    { type: "input", content: "approve", requestId: "approval" },
    ctx,
  );
  await entered.promise;
  await h.harness.close(ctx);
  await h.env.cleanup(ctx);
  const reopened = await open(dir, [fauxAssistantMessage("done")], [ext]);
  const saved = await reopened.harness.submission(sub.id, ctx);
  if (!saved) throw new Error("missing submission");
  const result = await saved.wait(ctx);
  await reopened.harness.close(ctx);
  await reopened.env.cleanup(ctx);
  return { hooks, executed, done: result.status === "done" };
}
export async function ownershipAndFork(dir: string) {
  const h = await open(dir, []);
  await h.harness.close(ctx);
  await h.env.cleanup(ctx);
  const entered = Promise.withResolvers<void>();
  const Anchor = defineTask<{}, { phase: "hold" }, void>({
    name: "probe.anchor",
    version: 1,
    initial: () => ({ phase: "hold" }),
    phases: {
      hold: async (_task, _runtime, context) => {
        entered.resolve();
        await awaitWithContext(new Promise<void>(() => {}), context);
      },
    },
    abort: async (_task, runtime, context) => {
      await runtime.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
    },
  });
  const next = await open(dir, [], [defineExtension({ name: "anchor", tasks: [Anchor] })]);
  const noWork =
    next.faux.state.callCount === 0 && (await next.harness.inspect(ctx)).tasks.length === 0;
  const at = await next.root.commit(async (tx) => {
    (await tx.doc(Facts, next.root.id)).count = 1;
    return await tx.appendEntry(next.root.id, { kind: "probe.anchor-entry", data: {} });
  }, ctx);
  await next.root.commit(async (tx) => {
    (await tx.doc(Facts, next.root.id)).count = 2;
  }, ctx);
  const asOf = await next.harness.snapshotAsOf(Facts, next.root.id, at.id, ctx);
  const fork = await next.root.fork(at.id, { ownership: { kind: "ownerless" } }, ctx);
  const forkDoc = await next.harness.snapshot(Facts, fork.id, ctx);
  const retained = (await next.harness.snapshot(Facts, next.root.id, ctx))?.count;
  const events = await watchEvents(next.harness, next.root.id, ctx);
  const snapshot = events.snapshot.type === "snapshot" && events.snapshot.entries.length > 0;
  await events.stop();
  const task = await next.root.commit(
    (tx) => tx.createTask(Anchor, {}, { ownership: { kind: "conversation" }, background: true }),
    ctx,
  );
  next.harness.resume();
  await entered.promise;
  await next.root.abort(ctx);
  await next.root.waitForIdle(ctx);
  const survives = (await next.harness.getTask(task, ctx))?.state.status !== "terminal";
  await next.root.abort(ctx, { background: true });
  const stopped = (await next.harness.getTask(task, ctx))?.state.status === "terminal";
  await next.harness.close(ctx);
  await next.env.cleanup(ctx);
  return { noWork, asOf: asOf?.count, fork: forkDoc?.count, retained, snapshot, survives, stopped };
}
