import type { UserVisibleErrorData } from "./errors.ts";

export interface McpToolView {
  /** Original MCP protocol name, without Rukie's server prefix. */
  name: string;
  description: string;
  inputSchema: unknown;
}

export interface McpConfigError {
  scope: "user" | "project";
  path: string;
  error: string;
  errorData?: UserVisibleErrorData;
}

export interface McpSnapshot {
  servers: McpServerView[];
  configErrors: McpConfigError[];
}

export interface McpServerView {
  scope: "user" | "project";
  configPath: string;
  /** Configuration expression with URL credentials, query and fragment removed. */
  url?: string;
  command?: string;
  tools: McpToolView[];
  name: string;
  transport: "stdio" | "http";
  status: "connected" | "needs-auth" | "failed";
  toolCount: number;
  auth: "oauth" | "headers" | "none";
  error?: string;
  /** Known Agent Core failures can be translated; error retains its original English message. */
  errorData?: UserVisibleErrorData;
}
