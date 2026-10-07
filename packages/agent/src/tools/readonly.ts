import { createReadTool, type AgentTool } from "@earendil-works/pi-agent-core";
import { homedir } from "node:os";
import { createGlobTool } from "./glob.ts";
import { createGrepTool } from "./grep.ts";
import { adaptTool, createImageReadEnv, preserveErrorDetails } from "./runtime.ts";

/** Read-only tools for isolated model hook checks, without loading the other capabilities. */
export function createReadonlyTools(cwd: string, homeDir = homedir()): AgentTool[] {
  return [
    preserveErrorDetails(adaptTool(createReadTool(), createImageReadEnv(cwd), homeDir)),
    createGlobTool(cwd),
    preserveErrorDetails(createGrepTool(cwd)),
  ];
}
