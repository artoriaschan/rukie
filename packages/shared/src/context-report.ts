/** Stable category ids; frontends own their translated labels. */
export type ContextCategory =
  | "system-prompt"
  | "memory-files"
  | "system-tools"
  | "mcp-tools"
  | "skills"
  | "messages"
  | "compaction-reserve"
  | "free-space";

/** Read-only snapshot. Category estimates may differ from provider-reported used tokens. */
export interface ContextReport {
  model: string;
  window: number;
  used: number;
  categories: { name: ContextCategory; tokens: number }[];
  memoryFiles: { path: string; tokens: number }[];
  mcpTools: { server: string; name: string; tokens: number }[];
  skills: { name: string; tokens: number }[];
  agentTypes: { name: string; tokens: number }[];
}
