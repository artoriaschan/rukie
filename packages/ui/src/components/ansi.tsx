import Anser from "anser";
import { cn } from "../lib/utils";
export function AnsiOutput({ text }: { text: string }) {
  // Preserve SGR only; OSC links and cursor controls never become DOM capabilities.
  const clean = text
    // SGR output intentionally contains terminal control bytes.
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "")
    // SGR output intentionally contains terminal control bytes.
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\[(?![0-9;]*m)[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.split("\r").at(-1))
    .join("\n");
  const parts = Anser.ansiToJson(clean, { use_classes: false, remove_empty: true });
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-ui-sm leading-5">
      {parts.map((part, index) => (
        <span
          key={index}
          style={{
            color: part.fg ? `rgb(${part.fg})` : undefined,
            backgroundColor: part.bg ? `rgb(${part.bg})` : undefined,
          }}
          className={cn(
            part.decorations.includes("bold") && "font-bold",
            part.decorations.includes("italic") && "italic",
            part.decorations.includes("underline") && "underline",
          )}
        >
          {part.content}
        </span>
      ))}
    </pre>
  );
}
