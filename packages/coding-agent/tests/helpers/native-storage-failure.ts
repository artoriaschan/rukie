import { createJsonlStore } from "@rukie/agent";
import type { Storage } from "@earendil-works/pi-durable";

/** Reject one selected native commit before effects, without changing execution APIs. */
export function failingStorage(
  root: string,
  reject: (writes: Parameters<Storage["commit"]>[0]) => Error | undefined,
) {
  const store = createJsonlStore({ cwd: root, homeDir: root });
  return {
    ...store,
    async open(...args: Parameters<typeof store.open>) {
      const lease = await store.open(...args);
      return {
        ...lease,
        storage: new Proxy(lease.storage, {
          get(target, key) {
            if (key === "commit")
              return async (...commit: Parameters<Storage["commit"]>) => {
                const error = reject(commit[0]);
                if (error) throw error;
                return target.commit(...commit);
              };
            const value = Reflect.get(target, key);
            return typeof value === "function" ? value.bind(target) : value;
          },
        }),
      };
    },
  };
}
