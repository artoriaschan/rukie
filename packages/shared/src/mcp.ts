export interface McpServerView {
  name: string;
  transport: "stdio" | "http";
  status: "connected" | "needs-auth" | "failed";
  toolCount: number;
  auth: "oauth" | "headers" | "none";
  error?: string;
}
