import type { ToolRegistration } from "@earendil-works/pi-durable";
import type { JsonValue } from "@earendil-works/chord";
import { createReadTool } from "@earendil-works/pi-durable/tools";
import { detectReadImageMimeType, validateImageBytes } from "../images/index.ts";
import { normalizeFileTool } from "./runtime.ts";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { PresentedTool } from "./presentation.ts";

const truncationDetails = Type.Object({
  truncation: Type.Object({
    truncated: Type.Boolean(),
    outputLines: Type.Number(),
    firstLineExceedsLimit: Type.Boolean(),
  }),
});

type ReadParameters = ReturnType<typeof createReadTool>["parameters"];

/** Keep pi's read execution and image attachments; presentation needs no second file read. */
export function withReadView<D extends JsonValue>(
  tool: ToolRegistration<ReadParameters, D>,
): PresentedTool<ReadParameters, D> {
  return {
    ...tool,
    presentCall: (args) => ({
      card: "generic",
      kind: "read",
      displayKey: "tool.read",
      title: args.path,
    }),
    presentResult: (args, content, details) => ({
      card: "read",
      kind: "read",
      displayKey: "tool.read",
      path: args.path,
      offset: args.offset,
      content,
      ...(Value.Check(truncationDetails, details) && details.truncation.truncated
        ? {
            outputUnavailable: true,
            ...(!details.truncation.firstLineExceedsLimit
              ? { nextOffset: (args.offset ?? 1) + details.truncation.outputLines }
              : {}),
          }
        : {}),
    }),
  };
}

/** Native read handles text; image admission validates the same original binary bytes. */
export function createImageReadTool(cwd: string, homeDir: string) {
  const text = createReadTool();
  const tool: ToolRegistration<typeof text.parameters> = {
    ...text,
    async execute(args, api, context) {
      if (!api.env) throw new Error("read requires an execution environment");
      const bytes = await api.env.readBinaryFile(args.path, context);
      if (!bytes.ok) throw bytes.error;
      const mimeType = detectReadImageMimeType(bytes.value);
      if (mimeType) {
        validateImageBytes(bytes.value);
        return {
          content: [
            { type: "text", text: `Read image file [${mimeType}]` },
            { type: "image", mimeType, data: Buffer.from(bytes.value).toString("base64") },
          ],
        };
      }
      return text.execute(args, api, context);
    },
  };
  return normalizeFileTool(tool, cwd, homeDir);
}
