import { expect, test } from "bun:test";
import { createJsonlStore, type SessionOptions } from "@rukie/agent";
import { startWithClock } from "../helpers/clock-app";

test("logo has one empty row before the first message", async () => {
  const app = await startWithClock(["first message marker"], {
    rows: 40,
    columns: 60,
    env: { LANG: "en" },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    const row = app.screen().findIndex((line) => line.includes("❯ first message marker"));
    expect(app.screen()[row - 1]?.trim()).toBe("");
    app.calls[0]!.finish();
  } finally {
    await app.cleanup();
  }
});

test("settled thinking is adjacent to the tool search card", async () => {
  const app = await startWithClock(["search marker"], {
    rows: 40,
    env: { LANG: "en" },
    session: { settings: { toolSearch: "on" } },
  });
  try {
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.thinking("search reasoning");
    app.calls[0]!.tool("ToolSearch", { query: "missing tool" });
    await app.waitFor(() => app.calls.length === 2);
    const reasoning = app.screen().findIndex((line) => line.includes("🧠 Thinking"));
    const tool = app.screen().findIndex((line) => line.includes("ToolSearch"));
    expect(reasoning).toBeGreaterThanOrEqual(0);
    expect(tool).toBe(reasoning + 1);
    app.calls[1]!.finish();
  } finally {
    await app.cleanup();
  }
});

test.each([40, 12])("%i-row chat paints submitted input before storage admission", async (rows) => {
  const blocked = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let hold = false;
  const session: Partial<SessionOptions> = {};
  const app = await startWithClock([], {
    rows,
    columns: 60,
    env: { LANG: "en" },
    session,
    prepare: async (root) => {
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
                  return async (...args: Parameters<typeof target.commit>) => {
                    if (hold) {
                      blocked.resolve();
                      await release.promise;
                    }
                    return target.commit(...args);
                  };
                const value = Reflect.get(target, key);
                return typeof value === "function" ? value.bind(target) : value;
              },
            }),
          };
        },
      };
    },
  });
  try {
    await app.waitFor(() => app.screen().some((line) => line.includes("❯")));
    hold = true;
    app.stdin.write("queued input marker\r");
    await blocked.promise;
    await app.waitFor(() => app.screen().some((line) => line.includes("❯ queued input marker")));
    const inputRow = app.screen().findIndex((line) => line.includes("❯ queued input marker"));
    expect(inputRow).toBeGreaterThanOrEqual(0);
    expect(app.screen()[inputRow - 1]?.trim()).toBe("");
    expect(app.calls).toHaveLength(0);
    hold = false;
    release.resolve();
    await app.waitFor(() => app.calls.length === 1);
    app.calls[0]!.finish();
    await app.waitFor(() => !app.isWorking());
    expect(app.screen().filter((line) => line.includes("❯ queued input marker"))).toHaveLength(1);
  } finally {
    hold = false;
    release.resolve();
    await app.cleanup();
  }
});
