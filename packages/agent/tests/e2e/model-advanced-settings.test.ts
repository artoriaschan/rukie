import { expect, onTestFinished, test } from "bun:test";
import { createApplicationModels, createSession, type Session } from "../../src/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { wireResponse } from "../helpers/model-wire.ts";
import { join } from "node:path";

test("model advanced defaults reach requests, prices and Run tool iteration boundaries", async () => {
  const dirs = await tempDirs();
  const bodies: Record<string, unknown>[] = [];
  const endpoint = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body: unknown = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new Error("Invalid request");
      bodies.push({ ...body });
      // One allowed read batch, a summary, then a new Run's read and malicious extra read.
      return wireResponse("openai-completions", bodies.length !== 2, "read", { path: "test.txt" });
    },
  });
  let session: Session | undefined;
  let cleanupPromise: Promise<void> | undefined;
  const cleanup = () =>
    (cleanupPromise ??= (async () => {
      await session?.close();
      await endpoint.stop(true);
      await dirs.cleanup();
    })());
  onTestFinished(cleanup);
  try {
    await Bun.write(join(dirs.cwd, "test.txt"), "isolated read");
    const models = createApplicationModels({
      providers: [
        {
          id: "local",
          name: "Local",
          api: "openai-completions",
          baseUrl: `http://127.0.0.1:${endpoint.port}`,
          models: [
            {
              id: "m",
              temperature: 0.7,
              maxToolIterations: 1,
              inputPrice: 1.5,
              outputPrice: 2.5,
              cacheReadPrice: 0.5,
              cacheWritePrice: 0.75,
            },
          ],
        },
      ],
      credential: async () => "fixture-key",
      hasCredential: async () => true,
      capabilityStore: { read: async () => undefined, save: async () => {} },
      homeDir: dirs.homeDir,
    });
    const model = models.getModel("local", "m")!;
    expect(model.cost).toEqual({ input: 1.5, output: 2.5, cacheRead: 0.5, cacheWrite: 0.75 });
    session = await createSession({ ...dirs, models, model, permissionMode: "full-access" });
    await session.rename("Fixed title");
    await session.run("read once and summarize");
    expect(bodies).toHaveLength(2);
    expect(bodies[0]!.temperature).toBe(0.7);
    expect(bodies[0]!.tools).toBeDefined();
    expect(bodies[1]!.tools).toBeUndefined();
    const id = session.id;
    await session.close();
    session = await createSession({
      ...dirs,
      models,
      model,
      resumeId: id,
      permissionMode: "full-access",
    });
    let allowed = 0;
    await session
      .run("new Run gets its own allowance", {
        onEvent(event) {
          if (event.type === "tool_execution_end") allowed++;
        },
      })
      .catch(() => {});
    expect(bodies).toHaveLength(4);
    expect(bodies[2]!.tools).toBeDefined();
    expect(bodies[3]!.tools).toBeUndefined();
    expect(allowed).toBe(1);
  } finally {
    await cleanup();
  }
});

test.each([10, 99, 100])(
  "root model %s percent compression preserves a separate summary budget",
  async (threshold) => {
    const dirs = await tempDirs();
    const summaryBudgets: number[] = [];
    const endpoint = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body: unknown = await request.json();
        if (!body || typeof body !== "object" || Array.isArray(body))
          throw new Error("Invalid request");
        if (JSON.stringify(body).includes("context summarization assistant")) {
          const budget: unknown =
            Reflect.get(body, "max_tokens") ?? Reflect.get(body, "max_completion_tokens");
          if (typeof budget !== "number") throw new Error("Missing summary budget");
          summaryBudgets.push(budget);
        }
        return wireResponse("openai-completions", false);
      },
    });
    let session: Session | undefined;
    let cleanupPromise: Promise<void> | undefined;
    const cleanup = () =>
      (cleanupPromise ??= (async () => {
        await session?.close();
        await endpoint.stop(true);
        await dirs.cleanup();
      })());
    onTestFinished(cleanup);
    try {
      const models = createApplicationModels({
        providers: [
          {
            id: "local",
            name: "Local",
            api: "openai-completions",
            baseUrl: `http://127.0.0.1:${endpoint.port}`,
            models: [
              { id: "large", contextWindow: 128000 },
              { id: "small", contextWindow: 16000, compressionThreshold: threshold },
            ],
          },
        ],
        credential: async () => "fixture-key",
        hasCredential: async () => true,
        capabilityStore: { read: async () => undefined, save: async () => {} },
        homeDir: dirs.homeDir,
      });
      session = await createSession({ ...dirs, models, model: models.getModel("local", "large")! });
      await session.rename("Fixed title");
      await session.run("OLD_EVIDENCE ".repeat(12000));
      await session.run("recent protected reply");
      await session.setModelSelection({ model: "local/small" });
      const reasons: string[] = [];
      await session.run("compress according to the selected threshold", {
        onEvent(event) {
          if (event.type === "compaction_start") reasons.push(event.reason);
        },
      });
      expect(reasons).toContain("threshold");
      expect(summaryBudgets.length).toBeGreaterThan(0);
      expect(summaryBudgets.every((budget) => budget === 2560)).toBe(true);
    } finally {
      await cleanup();
    }
  },
);
