import { awaitWithContext } from "@earendil-works/chord/context";
import {
  LiveDoc,
  type ConversationId,
  type Harness,
  type TaskId,
  type ToolHooks,
} from "@earendil-works/pi-durable";

type Round = {
  key: string;
  settled: Set<TaskId>;
  listeners: Set<() => void>;
};

/** Coordinates policy decisions only; the native tool task still owns intent and execution. */
export function createPermissionBatch(harness: Harness) {
  const rounds = new Map<ConversationId, Round>();
  const cancellations = new Set<() => void>();
  let closed = false;

  function wrap(check: ToolHooks["beforeTool"]): ToolHooks["beforeTool"] {
    return async (call, api, context) => {
      if (closed) throw new Error("Permission batch is closed.");
      const watch = await harness.watchDoc(LiveDoc, api.conversationId, context);
      if (!watch) throw new Error("Native permission round is missing.");
      let live = watch.value;
      const slots = live?.tools;
      if (!slots?.some((slot) => slot.taskId === api.taskId)) {
        await watch.stop();
        throw new Error("Tool task is absent from its native permission round.");
      }
      // The first admitted task persists in the native slots until the round ends,
      // including sequential rounds. Task IDs are unique across recovery and later runs.
      const key = String(slots.find((slot) => slot.taskId !== undefined)!.taskId);
      let round = rounds.get(api.conversationId);
      if (!round || round.key !== key) {
        round = { key, settled: new Set(), listeners: new Set() };
        rounds.set(api.conversationId, round);
      }
      const current = round;
      const ready = Promise.withResolvers<void>();
      // Cancellation may arrive while the policy itself is still awaiting an
      // Interaction; observe this wait immediately even before an allow uses it.
      void ready.promise.catch(() => {});
      const update = () => {
        if (!live?.tools?.some((slot) => slot.taskId === api.taskId)) {
          ready.reject(new Error("Native permission round ended before admission."));
          return;
        }
        if (
          live.tools.every(
            (slot) =>
              slot.taskId === undefined ||
              slot.status === "done" ||
              current.settled.has(slot.taskId),
          )
        )
          ready.resolve();
      };
      const cancel = () => ready.reject(new Error("Permission batch is closed."));
      current.listeners.add(update);
      cancellations.add(cancel);
      watch.start(async (value) => {
        live = value;
        update();
      });
      void watch.closed.then((end) =>
        ready.reject(new Error(`Native permission watch ${end.reason}.`)),
      );
      try {
        let result: Awaited<ReturnType<typeof check>>;
        try {
          result = await check(call, api, context);
        } finally {
          current.settled.add(api.taskId);
          for (const listener of current.listeners) listener();
        }
        // A block has no effects to hold back. A stop cancels the native Context,
        // releasing permitted siblings without waiting for their task completion.
        if (result?.block === undefined) await awaitWithContext(ready.promise, context);
        return result;
      } finally {
        current.listeners.delete(update);
        cancellations.delete(cancel);
        await watch.stop();
      }
    };
  }

  return {
    wrap,
    close() {
      closed = true;
      for (const cancel of cancellations) cancel();
      rounds.clear();
    },
  };
}
