import { useRef, useState } from "react";
import type { JobOutput } from "@rukie/shared";

export interface TraceOutputPage {
  page?: JobOutput;
  cursor: number;
  end: boolean;
}
/** Ephemeral reader choices belong to the keyed conversation, outside recycled rows. */
export interface TraceReaderState {
  choices: Readonly<Record<string, boolean>>;
  choose: (id: string, open: boolean) => void;
  /** Associate an uncommitted message with its eventual entry ID in this view only. */
  identities: Map<string, string>;
  outputPages: Readonly<Record<string, TraceOutputPage>>;
  showOutput: (id: string, page: TraceOutputPage) => void;
}
export function useTraceReaderState(): TraceReaderState {
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [outputPages, setOutputPages] = useState<Record<string, TraceOutputPage>>({});
  const identities = useRef(new Map<string, string>());
  return {
    choices,
    outputPages,
    identities: identities.current,
    choose: (id, open) => setChoices((previous) => ({ ...previous, [id]: open })),
    showOutput: (id, page) => setOutputPages((previous) => ({ ...previous, [id]: page })),
  };
}
