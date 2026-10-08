import { createHash, randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  normalizeContext,
  type Api,
  type Model,
  type Provider,
  type TranscriptContext,
  type StreamOptions,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
} from "@earendil-works/pi-ai";

function observeFetch(
  original: typeof fetch = globalThis.fetch,
  observe: (status: number) => void,
): typeof fetch {
  return Object.assign(
    async (...args: Parameters<typeof fetch>) => {
      const response = await original(...args);
      observe(response.status);
      return response;
    },
    { preconnect: original.preconnect },
  );
}

const PROBE_TOOL = "rukie_native_tool_probe";
const PROBE_TIMEOUT = 10_000;
const RecordSchema = Type.Object({
  api: Type.String(),
  model: Type.String(),
  outcome: Type.Enum(["supported", "unsupported", "unknown"]),
  checkedAt: Type.Number(),
  expiresAt: Type.Number(),
  reason: Type.String(),
  httpStatus: Type.Optional(Type.Number()),
  usage: Type.Optional(
    Type.Object({
      input: Type.Number(),
      output: Type.Number(),
      cacheRead: Type.Number(),
      cacheWrite: Type.Number(),
      cost: Type.Number(),
    }),
  ),
});
type ProbeRecord = Static<typeof RecordSchema>;
const CacheSchema = Type.Object({
  version: Type.Literal(1),
  entries: Type.Record(Type.String(), RecordSchema),
});

class CapabilityCache {
  readonly path: string;
  private entries: Record<string, ProbeRecord> = {};
  private readonly loaded: Promise<void>;
  private saving = Promise.resolve();
  private readonly pending = new Map<string, Promise<ProbeRecord>>();
  constructor(
    homeDir: string,
    private readonly warn: (message: string) => void,
  ) {
    this.path = join(homeDir, ".rukie/model-capabilities.json");
    this.loaded = this.read();
  }
  private async read() {
    try {
      const file = Bun.file(this.path);
      if (!(await file.exists())) return;
      const value: unknown = await file.json();
      if (Value.Check(CacheSchema, value)) this.entries = value.entries;
      else this.warn(`${this.path}: ignoring invalid capability cache`);
    } catch {
      this.warn(`${this.path}: cannot read capability cache`);
    }
  }
  async resolve(key: string, probe: () => Promise<ProbeRecord>): Promise<ProbeRecord> {
    await this.loaded;
    const record = this.entries[key];
    if (record && record.expiresAt > Date.now()) return record;
    const running = this.pending.get(key);
    if (running) {
      const result = await running;
      if (result.reason !== "aborted") return result;
      if (this.pending.get(key) === running) this.pending.delete(key);
      return this.resolve(key, probe);
    }
    const operation = (async () => {
      const result = await probe();
      await this.set(key, result);
      return result;
    })();
    this.pending.set(key, operation);
    try {
      return await operation;
    } finally {
      if (this.pending.get(key) === operation) this.pending.delete(key);
    }
  }
  async set(key: string, record: ProbeRecord) {
    await this.loaded;
    this.entries[key] = record;
    this.saving = this.saving.then(async () => {
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        await mkdir(join(this.path, ".."), { recursive: true, mode: 0o700 });
        await writeFile(temporary, JSON.stringify({ version: 1, entries: this.entries }) + "\n", {
          mode: 0o600,
        });
        await rename(temporary, this.path);
      } catch {
        this.warn(`${this.path}: cannot save capability cache`);
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
    });
    await this.saving;
  }
}
const caches = new Map<string, CapabilityCache>();
function cacheFor(homeDir: string, warn: (message: string) => void) {
  let cache = caches.get(homeDir);
  if (!cache) {
    cache = new CapabilityCache(homeDir, warn);
    caches.set(homeDir, cache);
  }
  return cache;
}

function nativeModel(model: Model<Api>, enabled: boolean): Model<Api> {
  return {
    ...model,
    compat:
      model.api === "anthropic-messages"
        ? {
            ...model.compat,
            supportsMidConvoToolChanges: enabled,
            supportsMidConvoSystemMessages: enabled,
          }
        : {
            ...model.compat,
            supportsToolSearch: enabled,
            supportsAdditionalTools: false,
            supportsMidConvoSystemMessages: enabled,
          },
  };
}
function autoDetect(model: Model<Api>) {
  const compat = model.compat;
  if (model.api === "anthropic-messages") {
    const native =
      compat && "supportsMidConvoToolChanges" in compat
        ? compat.supportsMidConvoToolChanges
        : undefined;
    const system =
      compat && "supportsMidConvoSystemMessages" in compat
        ? compat.supportsMidConvoSystemMessages
        : undefined;
    return native !== false && system !== false && !(native === true && system === true);
  }
  if (model.api === "openai-responses") {
    const native = compat && "supportsToolSearch" in compat ? compat.supportsToolSearch : undefined;
    const additional =
      compat && "supportsAdditionalTools" in compat ? compat.supportsAdditionalTools : undefined;
    const system =
      compat && "supportsMidConvoSystemMessages" in compat
        ? compat.supportsMidConvoSystemMessages
        : undefined;
    return (
      additional !== true &&
      native !== false &&
      system !== false &&
      !(native === true && system === true)
    );
  }
  return false;
}
function usesNative(model: Model<Api>) {
  const compat = model.compat;
  return (
    !!(compat && "supportsMidConvoSystemMessages" in compat
      ? compat.supportsMidConvoSystemMessages
      : undefined) &&
    !!compat &&
    (("supportsToolSearch" in compat && compat.supportsToolSearch) ||
      ("supportsAdditionalTools" in compat && compat.supportsAdditionalTools) ||
      ("supportsMidConvoToolChanges" in compat && compat.supportsMidConvoToolChanges))
  );
}
function rejectedFormat(status: number | undefined, message: string | undefined) {
  return (
    (status === 400 || status === 422) &&
    /tool_addition|tool_definition|tool_search_(?:call|output)|additional_tools|system.{0,40}(?:role|message)|(?:role|message).{0,40}system|no function named.{0,100}tools/i.test(
      message ?? "",
    ) &&
    /unsupported|not supported|unknown|invalid|not allowed|expected|no function named/i.test(
      message ?? "",
    )
  );
}
function record(
  model: Model<Api>,
  outcome: ProbeRecord["outcome"],
  reason: string,
  status?: number,
  answer?: AssistantMessage,
): ProbeRecord {
  const checkedAt = Date.now();
  const ttl =
    outcome === "supported"
      ? 86_400_000
      : outcome === "unsupported"
        ? 3_600_000
        : reason === "aborted"
          ? 0
          : 60_000;
  return {
    api: model.api,
    model: model.id,
    outcome,
    reason,
    checkedAt,
    expiresAt: checkedAt + ttl,
    ...(status === undefined ? {} : { httpStatus: status }),
    ...(answer
      ? {
          usage: {
            input: answer.usage.input,
            output: answer.usage.output,
            cacheRead: answer.usage.cacheRead,
            cacheWrite: answer.usage.cacheWrite,
            cost: answer.usage.cost.total,
          },
        }
      : {}),
  };
}

async function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return promise;
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([promise, aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

async function probe(
  provider: Provider,
  model: Model<Api>,
  options: StreamOptions,
): Promise<ProbeRecord> {
  const timeout = AbortSignal.timeout(PROBE_TIMEOUT);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let status: number | undefined;
  const tool = {
    name: PROBE_TOOL,
    description: "Harmless capability probe; return an empty argument object.",
    parameters: Type.Object({}),
  };
  const initial = { ...tool, name: "rukie_initial_tool_probe" };
  const context = normalizeContext({
    messages: [
      {
        role: "system",
        content:
          "This is an isolated protocol capability check. Call only the newly added probe tool.",
        toolsAdded: [initial],
        timestamp: 0,
      },
      { role: "user", content: "Prepare for a tool addition.", timestamp: 1 },
      {
        ...fauxAssistantMessage("Ready"),
        api: model.api,
        provider: model.provider,
        model: model.id,
        timestamp: 2,
      },
      { role: "system", content: "", toolsAdded: [tool], timestamp: 3 },
      { role: "user", content: `Call ${PROBE_TOOL} now with {}.`, timestamp: 4 },
    ],
  });
  try {
    const answer = await waitFor(
      provider
        .streamSimple({ ...nativeModel(model, true), thinkingLevelMap: { off: "none" } }, context, {
          apiKey: options.apiKey,
          headers: options.headers,
          env: options.env,
          fetch: observeFetch(options.fetch, (value) => {
            status = value;
          }),
          signal,
          timeoutMs: PROBE_TIMEOUT,
          maxRetries: 0,
          maxTokens: 256,
          cacheRetention: "none",
          onResponse: (response) => {
            status = response.status;
          },
          onPayload: (payload) =>
            typeof payload === "object" && payload !== null && !Array.isArray(payload)
              ? {
                  ...payload,
                  tool_choice:
                    model.api === "anthropic-messages"
                      ? { type: "tool", name: PROBE_TOOL }
                      : { type: "function", name: PROBE_TOOL },
                }
              : payload,
        })
        .result(),
      signal,
    );
    if (rejectedFormat(status, answer.errorMessage))
      return record(model, "unsupported", "native-format-rejected", status, answer);
    if (
      answer.stopReason === "toolUse" &&
      answer.content.some((block) => block.type === "toolCall" && block.name === PROBE_TOOL)
    )
      return record(model, "supported", "probe-tool-called", status, answer);
    return record(
      model,
      "unknown",
      answer.stopReason === "error" ? "request-error" : "probe-tool-not-called",
      status,
      answer,
    );
  } catch {
    return record(
      model,
      "unknown",
      options.signal?.aborted ? "aborted" : timeout.aborted ? "timeout" : "request-error",
      status,
    );
  }
}

/** Probe outside Session execution; pass only real task events to the Harness. */
export function withToolCapabilityDetection(
  provider: Provider,
  homeDir: string,
  warn: (message: string) => void,
): Provider {
  function stream(
    model: Model<Api>,
    context: TranscriptContext,
    options: StreamOptions | undefined,
    request: (
      selected: Model<Api>,
      onResponse: NonNullable<StreamOptions["onResponse"]>,
      fetch: StreamOptions["fetch"],
    ) => AssistantMessageEventStream,
  ) {
    if (
      !context.messages.some(
        (message, index) => index > 0 && message.role === "system" && message.toolsAdded?.length,
      ) ||
      (model.api !== "anthropic-messages" && model.api !== "openai-responses")
    )
      return request(model, (response) => options?.onResponse?.(response, model), options?.fetch);
    const output = createAssistantMessageEventStream();
    void (async () => {
      try {
        const cache = cacheFor(homeDir, warn);
        // Credential fingerprints prevent sharing availability across accounts; neither key nor URL is persisted.
        const key = createHash("sha256")
          .update(
            JSON.stringify([
              model.api,
              model.provider,
              model.baseUrl,
              model.id,
              options?.apiKey,
              options?.headers,
            ]),
          )
          .digest("hex");
        let selected = model;
        if (autoDetect(model)) {
          const result = await waitFor(
            cache.resolve(key, () => probe(provider, model, options ?? {})),
            options?.signal,
          );
          const inferred = nativeModel(model, result.outcome === "supported");
          selected = { ...inferred, compat: { ...inferred.compat, ...model.compat } };
        }
        options?.signal?.throwIfAborted();
        let status: number | undefined;
        let emitted = false;
        const buffered: AssistantMessageEvent[] = [];
        let retry = false;
        for await (const event of request(
          selected,
          (response) => options?.onResponse?.(response, selected),
          observeFetch(options?.fetch, (value) => {
            status = value;
          }),
        )) {
          if (event.type === "start" && !emitted) {
            buffered.push(event);
            continue;
          }
          if (
            event.type === "error" &&
            !emitted &&
            usesNative(selected) &&
            rejectedFormat(status, event.error.errorMessage) &&
            !options?.signal?.aborted
          ) {
            await cache.set(
              key,
              record(model, "unsupported", "native-request-format-rejected", status, event.error),
            );
            retry = true;
            break;
          }
          for (const pending of buffered.splice(0)) output.push(pending);
          emitted = true;
          output.push(event);
        }
        if (retry) {
          const fallback = nativeModel(model, false);
          for await (const event of request(
            fallback,
            (response) => options?.onResponse?.(response, fallback),
            options?.fetch,
          ))
            output.push(event);
        }
      } catch (error) {
        const answer = {
          ...fauxAssistantMessage("", {
            stopReason: options?.signal?.aborted ? "aborted" : "error",
            errorMessage: String(error),
          }),
          api: model.api,
          provider: model.provider,
          model: model.id,
        };
        output.push({
          type: "error",
          reason: answer.stopReason === "aborted" ? "aborted" : "error",
          error: answer,
        });
      }
    })();
    return output;
  }
  return {
    ...provider,
    stream: (model, context, options) =>
      stream(model, context, options, (selected, onResponse, fetch) =>
        provider.stream(selected, context, { ...options, onResponse, fetch }),
      ),
    streamSimple: (model, context, options) =>
      stream(model, context, options, (selected, onResponse, fetch) =>
        provider.streamSimple(selected, context, { ...options, onResponse, fetch }),
      ),
  };
}
