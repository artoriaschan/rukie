import type {
  ShellOutputCaptureOptions,
  ShellOutputUpdate,
  ShellOutputView,
} from "@earendil-works/pi-agent-core";
import type { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";

interface Capture {
  readonly truncated: boolean;
  push(chunk: Uint8Array): void;
  finish(): void;
  setSpillPath(path: string): void;
  snapshot(): ShellOutputView;
  flush(): void;
  dispose(): void;
}

type CaptureConstructor = new (
  options: ShellOutputCaptureOptions,
  context: typeof BACKGROUND_CONTEXT,
  handlers: { onUpdate(update: ShellOutputUpdate): void; onError(error: unknown): void },
) => Capture;

// pi 0.99.2 exports the view helpers but not its capture class. Resolve against
// that pinned package to preserve its bounded UTF-8 capture and publication.
// Remove this adapter when pi exports OutputCapture from its public entry point.
const module: unknown = await import(
  new URL("harness/utils/output-capture.js", import.meta.resolve("@earendil-works/pi-agent-core"))
    .href
);
if (
  typeof module !== "object" ||
  module === null ||
  !("OutputCapture" in module) ||
  typeof module.OutputCapture !== "function"
)
  throw new Error("Locked pi output capture is unavailable.");
// Constructor contract verified against the installed pi 0.99.2 declaration.
export const OutputCapture = module.OutputCapture as CaptureConstructor;
