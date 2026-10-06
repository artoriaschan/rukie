import type { UserVisibleErrorData } from "./errors.ts";

export interface McpServerView {
  name: string;
  transport: "stdio" | "http";
  status: "connected" | "needs-auth" | "failed";
  toolCount: number;
  auth: "oauth" | "headers" | "none";
  error?: string;
  /** Known Agent Core failures can be translated; error retains its original English message. */
  errorData?: UserVisibleErrorData;
}
