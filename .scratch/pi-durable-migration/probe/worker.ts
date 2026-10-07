import { open } from "./scenario.ts";
import { BACKGROUND_CONTEXT as ctx, awaitWithContext } from "@earendil-works/chord/context";
import {
  fauxAssistantMessage,
  fauxToolCall,
  createAssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import {
  defineExtension,
  defineTool,
  hook,
  ToolTask,
  GenerationTask,
} from "@earendil-works/pi-durable";
import { Type } from "typebox";
const [dir, mode, resumed, id] = process.argv.slice(2);
const recovering = resumed === "resume";
let executed = 0;
let readyId: number | undefined;
let announced = false;
function ready() {
  if (readyId !== undefined && !announced) {
    announced = true;
    console.log(JSON.stringify({ mode, id: readyId }));
  }
}
const hang = (context: Parameters<typeof awaitWithContext>[1]) =>
  awaitWithContext(new Promise<void>(() => {}), context);
const tool = defineTool({
  name: "probe",
  description: "probe",
  parameters: Type.Object({}),
  ...(mode === "safe" || (mode === "downgrade" && !recovering) || (mode === "upgrade" && recovering)
    ? { replay: "safe" as const }
    : {}),
  execute: async (_args, api, context) => {
    executed++;
    if (!recovering && mode !== "result") {
      api.output("committed tool output");
      await api.details({ started: true }, context);
      await hang(context);
    }
    return { content: [{ type: "text" as const, text: "tool result retained" }] };
  },
});
const ext = defineExtension({
  name: "probe",
  tools: [tool],
  hooks: [
    hook(ToolTask, {
      beforeTool: async (_call, _api, context) => {
        if (mode === "hook" && !recovering) {
          ready();
          await hang(context);
        }
        return undefined;
      },
    }),
    hook(GenerationTask, {
      beforeRequest: async (request, _api, context) => {
        if (
          !recovering &&
          mode === "result" &&
          request.messages.some((m) => m.role === "toolResult")
        ) {
          ready();
          await hang(context);
        }
        return undefined;
      },
    }),
  ],
});
const callsTool = ["hook", "safe", "unsafe", "downgrade", "upgrade", "result"].includes(mode);
const responses = recovering
  ? mode === "hook"
    ? [fauxAssistantMessage("recovered")]
    : [fauxAssistantMessage("recovered")]
  : callsTool
    ? [
        fauxAssistantMessage(fauxToolCall("probe", {}), { stopReason: "toolUse" }),
        fauxAssistantMessage("done"),
      ]
    : [fauxAssistantMessage("done")];
const h = await open(dir, responses, [ext], (provider) =>
  !recovering && mode === "partial"
    ? {
        ...provider,
        streamSimple(model, _input, options) {
          const stream = createAssistantMessageEventStream();
          const partial = fauxAssistantMessage("committed partial output");
          partial.api = model.api;
          partial.provider = model.provider;
          partial.model = model.id;
          queueMicrotask(() => {
            stream.push({ type: "start", partial });
            stream.push({ type: "text_start", contentIndex: 0, partial });
            stream.push({
              type: "text_delta",
              contentIndex: 0,
              delta: "committed partial output",
              partial,
            });
          });
          options?.signal?.addEventListener(
            "abort",
            () => {
              partial.stopReason = "aborted";
              stream.push({ type: "error", reason: "aborted", error: partial });
              stream.end(partial);
            },
            { once: true },
          );
          return stream;
        },
      }
    : provider,
);
const watch = await h.root.watch(ctx);
watch.start(async (view) => {
  const value = JSON.stringify(view.docs["pi.live"]);
  if (
    !recovering &&
    ((mode === "partial" && value.includes("committed partial output")) ||
      (["safe", "unsafe", "downgrade", "upgrade"].includes(mode) &&
        value.includes("committed tool output")))
  )
    ready();
});
const before = recovering ? JSON.stringify(watch.value) : "";
const sub = await h.root.submit({ type: "input", content: "probe", requestId: "restart" }, ctx);
readyId = sub.id;
if (!recovering) {
  if (mode === "admitted") ready();
  await hang(ctx);
} else {
  const result = await sub.wait(ctx);
  const context = JSON.stringify(await h.root.context(ctx));
  await watch.stop();
  await h.harness.close(ctx);
  await h.env.cleanup(ctx);
  console.log(
    JSON.stringify({
      done: result.status === "done",
      sameId: sub.id === Number(id),
      executed,
      interrupted: context.includes("interrupted"),
      output: context.includes("committed tool output"),
      partial: before.includes("committed partial output"),
      retained: context.includes("tool result retained"),
    }),
  );
}
