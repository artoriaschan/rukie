import { createSession, createJsonlStore } from "../../src/index.ts";
import { ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import { fauxAssistantMessage } from "@earendil-works/pi-ai";
import { fakeModel } from "./fake-model.ts";

const root = process.argv[2];
const cut = process.argv[3];
if (!root || (cut !== "initial" && cut !== "later" && cut !== "placed"))
  throw new Error("Invalid Goal crash cut");
process.stdin.resume();
const store = createJsonlStore({ cwd: root, homeDir: root });
let session: Awaited<ReturnType<typeof createSession>>;
let armed = false;
function isAdmission(value: unknown, round?: number): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    "phase" in value &&
    value.phase === "admit" &&
    (round === undefined || ("round" in value && value.round === round))
  );
}
const wrapped: typeof store = {
  ...store,
  async open(...args) {
    const lease = await store.open(...args);
    return {
      ...lease,
      storage: new Proxy(lease.storage, {
        get(target, key) {
          if (key === "commit")
            return async (...args: Parameters<typeof target.commit>) => {
              const seq = await target.commit(...args);
              if (armed) {
                const record = await target.findDocument(
                  {
                    kind: "rukie.goal",
                    scope: { kind: "conversation", conversationId: ROOT_CONVERSATION_ID },
                  },
                  "current",
                  args[1],
                );
                const stored = record && (await target.document(record.id, "current", args[1]));
                const goal = stored?.value.value;
                let reservation = args[0].find(
                  (write) =>
                    write.type === "task" &&
                    write.value.kind === "rukie.goal-driver" &&
                    (write.value.state.status === "pending" ||
                      write.value.state.status === "running") &&
                    isAdmission(write.value.state.checkpoint, cut === "initial" ? 1 : 2),
                );
                if (
                  cut === "placed" &&
                  args[0].some(
                    (write) =>
                      write.type === "submission" &&
                      write.value.requestId?.startsWith("goal:") &&
                      write.value.status === "placed",
                  )
                ) {
                  const tasks = await target.scanTasks({}, 100000, undefined, args[1]);
                  const task = tasks.items.find(
                    (task) =>
                      task.kind === "rukie.goal-driver" &&
                      (task.state.status === "pending" || task.state.status === "running") &&
                      isAdmission(task.state.checkpoint),
                  );
                  if (task) reservation = { type: "task", value: task };
                }
                if (
                  goal !== null &&
                  typeof goal === "object" &&
                  !Array.isArray(goal) &&
                  reservation
                ) {
                  armed = false;
                  process.stdout.write(
                    "READY " +
                      JSON.stringify({
                        sessionId: session.id,
                        goalId: goal.id,
                        roundsStarted: goal.roundsStarted,
                        acceptedTaskId:
                          reservation?.type === "task" ? Number(reservation.value.id) : null,
                      }) +
                      "\n",
                  );
                  // Actual post-commit acknowledgement loss; the parent kills this process.
                  await new Promise<never>(() => {});
                }
              }
              return seq;
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    };
  },
};
try {
  session = await createSession({
    cwd: root,
    homeDir: root,
    ...fakeModel([fauxAssistantMessage("first round completed")]),
    store: wrapped,
    permissionMode: "full-access",
  });
  await session.rename("Goal crash fixture");
  armed = true;
  await session.createGoal("Finish exactly two rounds", { maxRounds: 2 });
  await session.waitForIdle();
  throw new Error("Expected actual Goal commit barrier");
} catch (error) {
  process.stderr.write(String(error));
  process.exit(1);
}
