import { createJsonlStore, type SessionOptions } from "@rukie/agent";
import type { Storage } from "@earendil-works/pi-durable";

/** Observe actual active-Run notification commits through the public Store seam. */
export function committedJobNotifications() {
  const session: Partial<SessionOptions> = {};
  let count = 0;
  return {
    session,
    count: () => count,
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
