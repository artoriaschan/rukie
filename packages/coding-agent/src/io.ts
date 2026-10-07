import type { SessionOptions } from "@rukie/agent";
import type { RenderOptions } from "./ink/index.ts";
import type { TuiHost } from "./tui/host";

interface CommonIo {
  stderr(text: string): void;
  env?: Record<string, string | undefined>;
  /** Session overrides let embedders supply credentials, storage and model transport. */
  session?: Partial<SessionOptions>;
  /** Cancellation is forwarded to the active Run or pending stdin read. */
  signal?: AbortSignal;
}

/** Input/output adapters shared by both dispatch modes. Print callers may supply a callback sink. */
export interface CodingAgentIo extends CommonIo {
  stdin?: RenderOptions["stdin"];
  stdout: NonNullable<RenderOptions["stdout"]> | ((text: string) => void);
  readStdin?: () => Promise<string>;
  host?: TuiHost;
  term?: string;
}

export interface PrintIo extends CodingAgentIo {
  readStdin(): Promise<string>;
  stdout(text: string): void;
}

export interface TuiIo extends CodingAgentIo {
  stdin: NonNullable<RenderOptions["stdin"]>;
  stdout: NonNullable<RenderOptions["stdout"]>;
}
