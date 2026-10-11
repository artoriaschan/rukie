import { expect, onTestFinished, test } from "bun:test";
import { createApplicationModels, createSession, type Session } from "../../src/index.ts";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { wireResponse } from "../helpers/model-wire.ts";
import { runRequest } from "../helpers/crashed-subagents.ts";

// Each protocol builds different reasoning fields; real loopback payloads verify the adapter boundary.
test.each(["anthropic-messages", "openai-completions", "openai-responses"] as const)(
  "automatic leaves %s provider reasoning unspecified, including native compaction",
  async (api) => {
    const dirs = await tempDirs();
    const bodies: Record<string, unknown>[] = [];
    const endpoint = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body: unknown = await request.json();
        if (typeof body !== "object" || body === null || Array.isArray(body))
          throw new Error("Invalid request");
        bodies.push({ ...body });
        return wireResponse(api, false);
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
            api,
            baseUrl: `http://127.0.0.1:${endpoint.port}`,
            models: [
              {
                id: "m",
                name: "Independent",
                reasoning: true,
                contextWindow: 128000,
                maxTokens: 1024,
                thinkingLevelMap: { off: "none" },
              },
            ],
          },
        ],
        credential: async () => "isolated-test-key",
        hasCredential: async () => true,
        capabilityStore: { read: async () => undefined, save: async () => {} },
        homeDir: dirs.homeDir,
      });
      session = await createSession({
        ...dirs,
        models,
        model: models.getModel("local", "m")!,
        settings: { thinking: "automatic" },
      });
      await session.rename("Fixed test title");
      // More than the native 16k recent-token budget makes a manual summary request observable.
      await session.run("OLD_EVIDENCE ".repeat(12000));
      await session.run("recent question");
      const before = bodies.length;
      if (api === "openai-completions") {
        await session.compact();
        expect(bodies.length).toBeGreaterThan(before);
      }
      const automaticBodies = bodies.slice();
      for (const body of automaticBodies) {
        expect(body.model).toBe("m");
        expect(body).not.toHaveProperty("thinking");
        expect(body).not.toHaveProperty("reasoning_effort");
        expect(body).not.toHaveProperty("reasoning");
        expect(body).not.toHaveProperty("enable_thinking");
      }
      await session.setModelSelection({ thinkingLevel: "off" });
      await session.run("disable explicitly");
      if (api === "anthropic-messages")
        expect(bodies.at(-1)!.thinking).toEqual({ type: "disabled" });
      if (api === "openai-completions") expect(bodies.at(-1)!.reasoning_effort).toBe("none");
      expect(session.thinkingLevel).toBe("off");
    } finally {
      await cleanup();
    }
  },
);

// Fork configuration can differ from the parent's live choice; retained children keep their own choice.
test.each([
  {
    tool: "subagent_fork",
    configured: "automatic" as const,
    parent: "high" as const,
    childEffort: undefined,
  },
  {
    tool: "subagent_fork",
    configured: "high" as const,
    parent: "automatic" as const,
    childEffort: "deep",
  },
  {
    tool: "subagent",
    configured: "automatic" as const,
    parent: "high" as const,
    childEffort: "deep",
  },
])(
  "$tool and retained reasoning follow their committed choice with $configured settings",
  async ({ tool, configured, parent, childEffort }) => {
    const dirs = await tempDirs();
    const bodies: Record<string, unknown>[] = [];
    let childId = "";
    const endpoint = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body: unknown = await request.json();
        if (typeof body !== "object" || body === null || Array.isArray(body))
          throw new Error("Invalid request");
        bodies.push({ ...body });
        if (bodies.length === 1)
          return wireResponse("openai-completions", true, tool, {
            description: "Fork",
            prompt: "child prompt",
            run_in_background: false,
          });
        if (bodies.length === 4)
          return wireResponse("openai-completions", true, "send_message", {
            agent_id: childId,
            message: "continue child",
          });
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
              {
                id: "m",
                reasoning: true,
                thinkingLevelMap: { off: "none", high: "deep", low: "light" },
              },
            ],
          },
        ],
        credential: async () => "isolated-test-key",
        hasCredential: async () => true,
        capabilityStore: { read: async () => undefined, save: async () => {} },
        homeDir: dirs.homeDir,
      });
      session = await createSession({
        ...dirs,
        models,
        model: models.getModel("local", "m")!,
        settings: { thinking: configured },
        permissionMode: "full-access",
      });
      await session.rename("Fixed test title");
      await session.setModelSelection({ thinkingLevel: parent });
      await session.run("delegate", {
        onEvent: (event) => {
          if (event.type === "subagent_event") childId ||= event.agentId;
        },
      });
      expect(childId).not.toBe("");
      expect(bodies[1]!.reasoning_effort).toBe(childEffort);
      await session.setModelSelection({ thinkingLevel: "low" });
      await runRequest(session, "continue retained child");
      const retainedChild = bodies.slice(4).find((body) => {
        const tools = JSON.stringify(body.tools);
        return (
          !tools.includes("subagent_fork") &&
          JSON.stringify(body.messages).includes("continue child")
        );
      });
      expect(retainedChild).toBeDefined();
      expect(retainedChild!.reasoning_effort).toBe(childEffort);
      const parentRequests = bodies
        .slice(3)
        .filter((body) => JSON.stringify(body.tools).includes("subagent_fork"));
      expect(parentRequests.length).toBeGreaterThan(0);
      expect(parentRequests.every((body) => body.reasoning_effort === "light")).toBe(true);
    } finally {
      await cleanup();
    }
  },
);
