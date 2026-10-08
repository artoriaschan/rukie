import { join } from "node:path";
import {
  awaitWithContext,
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";

/** Independent process interruption after an acknowledged Goal round fact. */
export async function crashGoalRound(root: string, cut: "initial" | "later" | "placed") {
  const child = Bun.spawn(
    [process.execPath, join(import.meta.dir, "goal-crash-worker.ts"), root, cut],
    { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  );
  const errors = new Response(child.stderr).text();
  const reader = child.stdout.getReader();
  // Bounds an actual separate process; parent virtual time cannot advance this transport.
  const context = withAbortSignal(AbortSignal.timeout(5000), BACKGROUND_CONTEXT);
  let output = "";
  try {
    for (;;) {
      const ready = output
        .split("\n")
        .slice(0, -1)
        .find((line) => line.startsWith("READY "));
      if (ready) {
        const facts: unknown = JSON.parse(ready.slice(6));
        if (
          facts === null ||
          typeof facts !== "object" ||
          !("sessionId" in facts) ||
          typeof facts.sessionId !== "string" ||
          !("goalId" in facts) ||
          typeof facts.goalId !== "string" ||
          !("acceptedTaskId" in facts) ||
          typeof facts.acceptedTaskId !== "number" ||
          !Number.isSafeInteger(facts.acceptedTaskId) ||
          facts.acceptedTaskId < 1 ||
          !("roundsStarted" in facts) ||
          facts.roundsStarted !== (cut === "later" ? 1 : 0)
        )
          throw new Error("Invalid Goal crash facts");
        child.kill("SIGKILL");
        await awaitWithContext(child.exited, context);
        const stderr = await errors;
        if (stderr) throw new Error(stderr);
        return { sessionId: facts.sessionId, goalId: facts.goalId };
      }
      const next = await awaitWithContext(reader.read(), context);
      if (next.done)
        throw new Error(`Goal worker exited before accepted boundary: ${await errors}`);
      output += new TextDecoder().decode(next.value);
    }
  } finally {
    child.kill("SIGKILL");
    child.stdin.end();
    await child.exited;
    reader.releaseLock();
  }
}
