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
    description:
      "Read the contents of a file. Supports text files and image attachments (jpg, png, gif, webp). BMP images return an omission notice without an attachment. For text files, output is truncated to 2000 lines or 50KB (whichever is hit first). Use offset/limit for large files. When you need the full file, continue with offset until complete.",
    async execute(args, api, context) {
      if (!api.env) throw new Error("read requires an execution environment");
      const bytes = await api.env.readBinaryFile(args.path, context);
      if (!bytes.ok) throw bytes.error;
      // BMP requires conversion before attachment; reading it still succeeds
      // with the capability's explicit omission receipt.
      if (bytes.value[0] === 0x42 && bytes.value[1] === 0x4d)
        return {
          content: [
            {
              type: "text",
              text: "Read image file [image/bmp]\n[Image omitted: configure an imageProcessor to convert BMP images.]",
            },
          ],
        };
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
