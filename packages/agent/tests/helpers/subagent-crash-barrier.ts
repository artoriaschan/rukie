import type { Storage, StorageWrite } from "@earendil-works/pi-durable";
import {
  awaitWithContext,
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";

export type Cut = "child-done" | "report-admitted" | "report-answered";
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Match typed writes, never JSONL substrings or a fabricated task receipt. */
export function isCut(writes: readonly StorageWrite[], cut: Cut, driverId?: number) {
  if (cut === "report-admitted" || cut === "report-answered")
    return writes.some(
      (write) =>
        write.type === "submission" &&
        write.value.type === "input" &&
        write.value.requestId === `subagent:${driverId}:report` &&
        (cut === "report-admitted"
          ? write.value.status === "queued" || write.value.status === "placed"
          : write.value.status === "done"),
    );
  return writes.some((write) => {
    if (
      write.type !== "task" ||
      write.value.kind !== "rukie.subagent-driver" ||
      (driverId !== undefined && Number(write.value.id) !== driverId)
    )
      return false;
    const state = write.value.state;
    if (state.status !== "running" || !object(state.checkpoint)) return false;
    return state.checkpoint.phase === "report" && state.checkpoint.submissionId === undefined;
  });
}

/** Worker-only: ACK loss AFTER an actual committed boundary; parent must SIGKILL this process.
 * child-done/report-admitted cuts stop after commit; report-answered stops on the report Submission
 * done settlement, before its waiting driver can receive this acknowledgement and commit terminal.
 * Assert actual report answer entry ID from that same native Submission, not a simulated receipt.
 */
export function crashBarrier(
  storage: Storage,
  matches: (writes: readonly StorageWrite[]) => boolean,
  ready: (writes: readonly StorageWrite[]) => void,
) {
  let armed = true;
  return new Proxy(storage, {
    get(target, key) {
      if (key === "commit")
        return async (...args: Parameters<Storage["commit"]>) => {
          const seq = await target.commit(...args);
          if (armed && matches(args[0])) {
            armed = false;
            ready(args[0]);
            // Deliberate held acknowledgement is killed by the bounded parent process driver.
            await new Promise<never>(() => {});
          }
          return seq;
        };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

export interface CrashIdentity {
  sessionId: string;
  childId: string;
  driverId: number;
  requestId: string;
  parentProviderId: string;
  childProviderId: string;
}
function identity(value: unknown): CrashIdentity {
  if (
    !object(value) ||
    typeof value.sessionId !== "string" ||
    typeof value.childId !== "string" ||
    !Number.isSafeInteger(value.driverId) ||
    typeof value.driverId !== "number" ||
    typeof value.requestId !== "string" ||
    typeof value.parentProviderId !== "string" ||
    typeof value.childProviderId !== "string"
  )
    throw new Error("Invalid worker identities");
  return {
    sessionId: value.sessionId,
    childId: value.childId,
    driverId: value.driverId,
    requestId: value.requestId,
    parentProviderId: value.parentProviderId,
    childProviderId: value.childProviderId,
  };
}

/** Actual subprocess transport bound; no timer synchronization and no parent fake clock. */
export async function killAtReady(worker: string, args: string[], cwd: string) {
  const child = Bun.spawn([process.execPath, worker, ...args], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const errors = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  const context = withAbortSignal(AbortSignal.timeout(5000), BACKGROUND_CONTEXT);
  let output = "";
  try {
    for (;;) {
      const lines = output.split("\n");
      const ready = lines.slice(0, -1).find((line) => line.startsWith("READY "));
      if (ready) {
        const parsed: unknown = JSON.parse(ready.slice(6));
        const facts = identity(parsed);
        child.kill("SIGKILL");
        await awaitWithContext(child.exited, context);
        const stderr = await errors;
        if (stderr) throw new Error(stderr);
        return facts;
      }
      const next = await awaitWithContext(reader.read(), context);
      if (next.done) throw new Error(`Worker exited before barrier: ${await errors}`);
      output += new TextDecoder().decode(next.value);
    }
  } finally {
    child.kill("SIGKILL");
    child.stdin.end();
    await awaitWithContext(
      child.exited,
      withAbortSignal(AbortSignal.timeout(5000), BACKGROUND_CONTEXT),
    );
    reader.releaseLock();
  }
}
