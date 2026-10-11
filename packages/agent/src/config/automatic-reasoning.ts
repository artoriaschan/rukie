import type { Api, Model, Models, ModelsSimpleStreamOptions } from "@earendil-works/pi-ai";

/** Session-owned model request policy: native off carries automatic, persisted facts control reasoning/tool omission.
 * completeSimple is the locked Harness compaction seam; its independent summary budget must not inherit threshold reserve.
 */
export function withAutomaticReasoning(
  models: Models,
  automatic: (sessionId: string) => Promise<boolean>,
  toolLimitReached?: (sessionId: string) => Promise<boolean>,
  compactionMaxTokens?: (model: Model<Api>) => number | undefined,
): Models {
  return new Proxy(models, {
    get(target, key) {
      if (key === "streamSimple" || key === "completeSimple") {
        const requestOptions = (
          options?: ModelsSimpleStreamOptions,
        ): ModelsSimpleStreamOptions => ({
          ...options,
          onPayload: async (payload, selected) => {
            const replaced = (await options?.onPayload?.(payload, selected)) ?? payload;
            const limit = Boolean(
              options?.sessionId && (await toolLimitReached?.(options.sessionId)),
            );
            const omitReasoning = Boolean(
              options?.sessionId && (await automatic(options.sessionId)),
            );
            if (!limit && !omitReasoning) return replaced;
            if (typeof replaced !== "object" || replaced === null || Array.isArray(replaced))
              throw new Error("Automatic reasoning requires an object request payload");
            const result = { ...replaced };
            if (limit) {
              Reflect.deleteProperty(result, "tools");
              Reflect.deleteProperty(result, "tool_choice");
              Reflect.deleteProperty(result, "parallel_tool_calls");
            }
            if (!omitReasoning) return result;
            for (const field of [
              "reasoning",
              "reasoning_effort",
              "thinking",
              "enable_thinking",
              "reasoning_budget",
              "thinking_budget",
              "reasoning_budget_tokens",
              "thinking_token_budget",
              "thinking_budget_tokens",
            ])
              Reflect.deleteProperty(result, field);
            const compat: unknown = selected.compat;
            if (typeof compat === "object" && compat !== null) {
              for (const [mapping, field] of [
                ["chatTemplateArgs", "chat_template_args"],
                ["chatTemplateKwargs", "chat_template_kwargs"],
              ] as const) {
                const template: unknown = Reflect.get(compat, mapping);
                const nested: unknown = Reflect.get(result, field);
                if (
                  typeof template !== "object" ||
                  template === null ||
                  typeof nested !== "object" ||
                  nested === null
                )
                  continue;
                const remaining = { ...nested };
                for (const [name, value] of Object.entries(template)) {
                  if (
                    typeof value === "object" &&
                    value !== null &&
                    "$var" in value &&
                    typeof value.$var === "string" &&
                    value.$var.startsWith("thinking.")
                  )
                    Reflect.deleteProperty(remaining, name);
                }
                Reflect.set(result, field, remaining);
              }
            }
            for (const field of [
              "chat_template_args",
              "chat_template_kwargs",
              "output_config",
              "config",
            ]) {
              const nested: unknown = Reflect.get(result, field);
              if (typeof nested !== "object" || nested === null || Array.isArray(nested)) continue;
              const remaining = { ...nested };
              for (const name of [
                "enable_thinking",
                "thinking",
                "thinking_budget",
                "reasoning_effort",
                "effort",
                "preserve_thinking",
                "thinkingConfig",
              ])
                Reflect.deleteProperty(remaining, name);
              if (Object.keys(remaining).length) Reflect.set(result, field, remaining);
              else Reflect.deleteProperty(result, field);
            }
            return result;
          },
        });
        if (key === "completeSimple") {
          const complete: Models["completeSimple"] = (model, context, options) =>
            target.completeSimple(
              model,
              context,
              requestOptions({
                ...options,
                maxTokens: compactionMaxTokens?.(model) ?? options?.maxTokens,
              }),
            );
          return complete;
        }
        const stream: Models["streamSimple"] = (model, context, options) =>
          target.streamSimple(model, context, requestOptions(options));
        return stream;
      }
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
