import {
  BACKGROUND_CONTEXT as ctx,
  awaitWithContext,
  withAbortSignal,
} from "@earendil-works/chord/context";
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

function deadline() {
  return withAbortSignal(AbortSignal.timeout(3000), ctx);
}
async function cleanup(resources: Awaited<ReturnType<typeof open>>[]) {
  const results = await Promise.allSettled(resources.map((resource) => resource.close()));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length)
    throw new AggregateError(
      failures.map((result) => result.reason),
      "probe cleanup failed",
    );
}

const Facts = defineDoc<{ count: number }>({
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
  let closed = false;
  const close = async () => {
    if (closed) return;
    try {
      await harness.close(deadline());
    } finally {
      await env.cleanup(deadline());
    }
    closed = true;
  };
  try {
    const root = await harness.root(ctx, {
      agent: {
        model: { provider: faux.getModel().provider, modelId: faux.getModel().id },
        cwd: dir,
      },
    });
    return { harness, root, faux, env, close };
  } catch (error) {
    await close();
    throw error;
  }
}
export async function smoke(dir: string) {
  const ctx = deadline();
  const resources: Awaited<ReturnType<typeof open>>[] = [];
  const acquire: typeof open = async (...args) => {
    const resource = await open(...args);
    resources.push(resource);
    return resource;
  };
  try {
    const first = await acquire(dir, [
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
    await first.close();
    const second = await acquire(dir, []);
    const duplicate = await second.root.submit(
      { type: "input", content: "write hello", requestId: "smoke" },
      ctx,
    );
    const doc = await second.harness.snapshot(Facts, second.root.id, ctx);
    await second.close();
    return {
      status: result.status,
      text,
      doc: doc?.count,
      duplicates: duplicate.id === sub.id,
      streamed,
    };
  } finally {
    await cleanup(resources);
  }
}

export async function hookClose(dir: string) {
  const ctx = deadline();
  const resources: Awaited<ReturnType<typeof open>>[] = [];
  const acquire: typeof open = async (...args) => {
    const resource = await open(...args);
    resources.push(resource);
    return resource;
  };
  try {
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
    const h = await acquire(
      dir,
      [fauxAssistantMessage(fauxToolCall("probe", {}), { stopReason: "toolUse" })],
      [ext],
    );
    const sub = await h.root.submit(
      { type: "input", content: "approve", requestId: "approval" },
      ctx,
    );
    await awaitWithContext(entered.promise, ctx);
    await h.close();
    const reopened = await acquire(dir, [fauxAssistantMessage("done")], [ext]);
    const saved = await reopened.harness.submission(sub.id, ctx);
    if (!saved) throw new Error("missing submission");
    const result = await saved.wait(ctx);
    await reopened.close();
    return { hooks, executed, done: result.status === "done" };
  } finally {
    await cleanup(resources);
  }
}
export async function ownershipAndFork(dir: string) {
  const ctx = deadline();
  const resources: Awaited<ReturnType<typeof open>>[] = [];
  const acquire: typeof open = async (...args) => {
    const resource = await open(...args);
    resources.push(resource);
    return resource;
  };
  try {
    const h = await acquire(dir, []);
    await h.close();
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
        await runtime.commit(
          () => ({ status: "terminal", outcome: { status: "aborted" } }),
          context,
        );
      },
    });
    const next = await acquire(dir, [], [defineExtension({ name: "anchor", tasks: [Anchor] })]);
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
    await awaitWithContext(entered.promise, ctx);
    await next.root.abort(ctx);
    await next.root.waitForIdle(ctx);
    const survives = (await next.harness.getTask(task, ctx))?.state.status !== "terminal";
    await next.root.abort(ctx, { background: true });
    const stopped = (await next.harness.getTask(task, ctx))?.state.status === "terminal";
    await next.close();
    return {
      noWork,
      asOf: asOf?.count,
      fork: forkDoc?.count,
      retained,
      snapshot,
      survives,
      stopped,
    };
  } finally {
    await cleanup(resources);
  }
}
