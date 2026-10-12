import { expect, test } from "bun:test";
import type { FetchFunction } from "@earendil-works/pi-ai";
import { createApplicationModels } from "../../src/index.ts";
import { withAutomaticReasoning } from "../../src/config/automatic-reasoning.ts";
import { deepseekServices } from "../helpers/deepseek-presets.ts";
import { wireResponse } from "../helpers/model-wire.ts";

for (const service of deepseekServices) {
  for (const configured of service.models) {
    test.each(["automatic", "high"] as const)(
      `${service.api}/${configured.id} sends %s reasoning according to the preset`,
      async (level) => {
        const bodies: Record<string, unknown>[] = [];
        const fakeFetch: FetchFunction = Object.assign(
          async (input: string | URL | Request, init?: RequestInit) => {
            const request =
              input instanceof Request
                ? new Request(input, init)
                : new Request(typeof input === "string" ? input : input.href, init);
            const body: unknown = await request.json();
            if (typeof body !== "object" || body === null || Array.isArray(body))
              throw new Error("Expected object payload");
            bodies.push({ ...body });
            return wireResponse(service.api, false);
          },
          { preconnect: () => {} },
        );
        const registry = createApplicationModels({
          providers: [service],
          homeDir: "/unused-home",
          hasCredential: async () => true,
          credential: async () => "isolated-test-key",
          capabilityStore: { read: async () => undefined, save: async () => {} },
        });
        const models = withAutomaticReasoning(registry, async () => level === "automatic");
        const model = models.getModel(service.id, configured.id);
        if (!model) throw new Error("Preset model missing");
        const result = await models.completeSimple(
          model,
          { messages: [{ role: "user", content: "Hello", timestamp: 0 }] },
          {
            sessionId: "preset-payload-test",
            // The simple API carries native off by omitting reasoning; Session policy removes its mapped wire fields.
            reasoning: level === "automatic" ? undefined : level,
            fetch: fakeFetch,
          },
        );
        expect(result.stopReason).toBe("stop");
        expect(bodies).toHaveLength(1);
        const body = bodies[0]!;
        expect(body.model).toBe(configured.id);
        if (level === "automatic") {
          for (const field of [
            "thinking",
            "reasoning_effort",
            "reasoning",
            "enable_thinking",
            "output_config",
          ])
            expect(body).not.toHaveProperty(field);
        } else if (service.api === "anthropic-messages") {
          expect(body.thinking).toMatchObject({ type: "adaptive" });
          expect(body.thinking).not.toHaveProperty("budget_tokens");
          expect(body.output_config).toMatchObject({ effort: "high" });
        } else if (service.api === "openai-completions") {
          expect(body.thinking).toEqual({ type: "enabled" });
          expect(body.reasoning_effort).toBe("high");
        } else {
          expect(body.reasoning).toMatchObject({ effort: "high" });
        }
      },
    );
  }
}
