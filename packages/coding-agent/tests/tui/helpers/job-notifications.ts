import { createJsonlStore, type SessionOptions } from "@rukie/agent";
import type { Storage } from "@earendil-works/pi-durable";

/** Observe actual active-Run notification commits through the public Store seam. */
export function committedJobNotifications() {
  const session: Partial<SessionOptions> = {};
  let count = 0;
  let admitted = 0;
  const tasks = new Map<number, boolean>();
  return {
    session,
    count: () => count,
    /** Both idle reporter inputs and notifications appended to an active Run must be admitted. */
    admitted: () => admitted,
    /** Native drivers and reporter generations must actually commit their terminal state. */
    pendingTasks: () => [...tasks.values()].filter(Boolean).length,
    async prepare(root: string) {
      const store = createJsonlStore({ cwd: root, homeDir: root });
      session.store = {
        ...store,
        async open(...args) {
          const lease = await store.open(...args);
          return {
            ...lease,
            storage: new Proxy(lease.storage, {
              get(target, key) {
                if (key === "commit")
                  return async (...commit: Parameters<Storage["commit"]>) => {
                    const result = await target.commit(...commit);
                    for (const write of commit[0])
                      if (write.type === "task")
                        tasks.set(Number(write.value.id), write.value.state.status !== "terminal");
                    admitted += commit[0].filter(
                      (write) =>
                        write.type === "entry" &&
                        (write.value.kind === "pi.user" ||
                          write.value.kind === "rukie.job-notification") &&
                        JSON.stringify(write.value.model).includes("background job ") &&
                        JSON.stringify(write.value.model).includes("finished [status:"),
                    ).length;
                    count += commit[0].filter(
                      (write) =>
                        write.type === "entry" && write.value.kind === "rukie.job-notification",
                    ).length;
                    return result;
                  };
                const value = Reflect.get(target, key);
                return typeof value === "function" ? value.bind(target) : value;
              },
            }),
          };
        },
      };
    },
  };
}
