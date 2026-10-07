import { normalizeContext, type Api, type Model, type Models } from "@earendil-works/pi-ai";
import { createUserVisibleError } from "@rukie/shared";
import type { ToolStateDefinition } from "../tool-state/index.ts";

export type TitleSource = "prompt" | "model" | "user";
export const titleSourceState: ToolStateDefinition = {
  name: "title-source",
  version: 1,
  parse(version, value) {
    if (version !== 1 || (value !== "prompt" && value !== "model" && value !== "user"))
      throw new Error("Invalid Session Title source.");
    return value;
  },
};

const POLICY = [
  "Create a concise title for an AI coding-assistant session from the supplied human messages.",
  "Return only the title on one line, **in plain text of natural language**, with no quotes, prefix, explanation, Markdown, XML, or terminal control codes. No code is allowed.",
  "Use the language of the messages.",
  "Aim for about 5 words in non-CJK languages or 10 CJK characters.",
].join("\n");

function truncate(text: string, bytes: number) {
  let result = "";
  let length = 0;
  for (const point of text) {
    const size = new TextEncoder().encode(point).length;
    if (length + size > bytes) break;
    result += point;
    length += size;
  }
  return result;
}

function clean(text: string) {
  return (
    text
      // eslint-disable-next-line no-control-regex -- Strip terminal escape sequences from display names.
      .replace(/\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|[@-_])/g, "")
      .replace(/\s+/gu, " ")
      // eslint-disable-next-line no-control-regex -- Names must never emit terminal controls.
      .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
      .trim()
  );
}

function framePrompt(prompt: string) {
  const points = Array.from(truncate(prompt, 4096));
  const frame = (length: number) =>
    `Generate the session title from this JSON array of human messages:\n${JSON.stringify([points.slice(0, length).join("")])}`;
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (new TextEncoder().encode(frame(middle)).length <= 4096) low = middle;
    else high = middle - 1;
  }
  return frame(low);
}

/** Session-owned asynchronous title work; primary Runs never wait for model completion. */
export function createSessionTitle(options: {
  title?: string;
  source?: TitleSource;
  hasPrompt: boolean;
  childDescription?: string;
  getModel(): Promise<Model<Api>>;
  models: Models;
  persist(title: string, source: TitleSource): Promise<void>;
  changed(title: string, source: TitleSource): void;
  warning(message: string): void;
}) {
  let title = options.title ?? "";
  let source = options.source;
  let attempted = options.hasPrompt || !!options.childDescription || !!title;
  let writes = Promise.resolve();
  let request: AbortController | undefined;
  let generation: Promise<void> | undefined;
  let revision = 0;
  const set = (next: string, nextSource: TitleSource) => {
    title = next;
    source = nextSource;
    const write = writes.then(() => options.persist(next, nextSource));
    writes = write.catch(() => {});
    return write.then(() => options.changed(next, nextSource));
  };
  const generate = async (prompt: string, controller: AbortController, started: number) => {
    const deadline = setTimeout(
      () => controller.abort(new Error("Session Title timed out")),
      30_000,
    );
    let abort: () => void = () => {};
    try {
      const response = await Promise.race([
        new Promise<never>((_, reject) => {
          abort = () => reject(controller.signal.reason);
          controller.signal.addEventListener("abort", abort, { once: true });
          if (controller.signal.aborted) abort();
        }),
        (async () => {
          const model = await options.getModel();
          controller.signal.throwIfAborted();
          return (
            await options.models.streamSimple(
              model,
              normalizeContext({
                systemPrompt: POLICY,
                messages: [
                  {
                    role: "user",
                    content: [{ type: "text", text: framePrompt(prompt) }],
                    timestamp: Date.now(),
                  },
                ],
              }),
              { signal: controller.signal, temperature: 0, maxTokens: 64 },
            )
          ).result();
        })(),
      ]);
      if (controller.signal.aborted || started !== revision || source === "user") return;
      if (
        response.stopReason !== "stop" ||
        response.content.some((block) => block.type === "toolCall")
      )
        throw new Error(response.errorMessage ?? `Title model stopped: ${response.stopReason}`);
      const next = truncate(
        clean(
          response.content
            .flatMap((block) => (block.type === "text" ? [block.text] : []))
            .join(" "),
        ),
        80,
      );
      if (!next) throw new Error("Title model returned an empty title");
      await set(next, "model");
    } catch (error) {
      if (started === revision)
        options.warning(
          `Session Title generation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    } finally {
      clearTimeout(deadline);
      controller.signal.removeEventListener("abort", abort);
      if (request === controller) request = undefined;
    }
  };
  return {
    get title() {
      return title;
    },
    get source() {
      return source;
    },
    async initializeChild() {
      if (options.childDescription && !title) await set(clean(options.childDescription), "prompt");
    },
    async firstPrompt(prompt: string) {
      if (attempted || source === "user") return;
      attempted = true;
      const started = revision;
      await set(truncate(clean(prompt), 40), "prompt");
      if (started !== revision) return;
      const controller = new AbortController();
      request = controller;
      generation = generate(prompt, controller, revision);
    },
    rename(next: string) {
      const normalized = clean(next);
      if (!normalized)
        throw createUserVisibleError("Session Title cannot be empty.", {
          code: "session-title-empty",
          params: {},
        });
      revision++;
      request?.abort();
      attempted = true;
      return set(normalized, "user");
    },
    settleWrites() {
      return writes;
    },
    async cancelGeneration() {
      revision++;
      request?.abort();
      await generation;
      await writes;
    },
    async dispose() {
      revision++;
      request?.abort();
      await generation;
      await writes;
    },
  };
}
