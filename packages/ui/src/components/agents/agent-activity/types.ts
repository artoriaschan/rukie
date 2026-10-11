import type { ReactNode } from "react";

export type AgentActivityStatus = "working" | "complete";
export type AgentStepStatus = "pending" | "active" | "complete";

export interface AgentActivityStep {
  id: string;
  type: "step";
  label: ReactNode;
  status?: AgentStepStatus;
  meta?: ReactNode;
}

export interface AgentActivityText {
  id: string;
  type: "text";
  content: ReactNode;
}

export interface AgentSearchResult {
  id: string;
  title: ReactNode;
  domain?: ReactNode;
  url?: string;
  icon?: ReactNode;
}

export interface AgentActivitySearch {
  id: string;
  type: "search";
  query: ReactNode;
  results?: AgentSearchResult[];
  moreCount?: number;
}

export interface AgentActivityTool {
  id: string;
  type: "tool";
  action: "read" | "edit" | "run" | (string & {});
  target: ReactNode;
  additions?: number;
  deletions?: number;
}

export type AgentTraceKind = "thinking" | "message" | "write" | "run" | "read" | (string & {});

export interface AgentActivityTrace {
  id: string;
  type: "trace";
  kind: AgentTraceKind;
  label: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  /** Rich message content below the trace label; tool details can remain in the label. */
  content?: ReactNode;
}

export type AgentActivityItem =
  | AgentActivityStep
  | AgentActivityText
  | AgentActivitySearch
  | AgentActivityTool
  | AgentActivityTrace;

export type AgentActivityContentType = AgentActivityItem["type"] | "mixed";

export interface AgentActivityProps {
  /** Chronological activity entries. Append or update items as events stream. */
  items: AgentActivityItem[];
  /** Expected activity kind before the first streamed item arrives. */
  contentType?: AgentActivityContentType;
  /** Current run phase. Active runs stay expanded unless collapsibleWhileWorking is enabled. */
  status?: AgentActivityStatus;
  /** Elapsed run time, in seconds. Used by the step-only summary. */
  duration?: number;
  /** Controlled expanded state. */
  open?: boolean;
  /** Initial expanded state. */
  defaultOpen?: boolean;
  /** Called when the activity disclosure changes state. */
  onOpenChange?: (open: boolean) => void;
  /** Collapse the disclosure when status changes from working to complete. */
  collapseOnComplete?: boolean;
  /** Allow the status title to toggle activity during a running Run as well. */
  collapsibleWhileWorking?: boolean;
  /** Optional label shown while the run is active. */
  activeLabel?: ReactNode;
  /** Optional completed summary. Derived from the item types by default. */
  summary?: ReactNode;
  /** Optional renderer for the contents of the active status row. */
  renderWorkingStatus?: (context: { label: ReactNode; duration: number }) => ReactNode;
  /** Optional renderer for the contents before the built-in disclosure chevron. */
  renderCompletedStatus?: (context: { summary: ReactNode; duration: number }) => ReactNode;
  /** Maximum visible activity height before the stream begins gliding. Null displays all activity. */
  maxHeight?: number | null;
  /** Keep a separator immediately below the status title in both disclosure states. */
  showStatusDivider?: boolean;
  className?: string;
  contentClassName?: string;
}
