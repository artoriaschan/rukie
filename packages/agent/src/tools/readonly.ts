import type { ToolRegistration } from "@earendil-works/pi-durable";
import { createImageReadTool } from "./read.ts";
import { homedir } from "node:os";
import { createGlobTool } from "./glob.ts";
import { createGrepTool } from "./grep.ts";
import { preserveErrorDetails } from "./runtime.ts";

/** Read-only tools for isolated model hook checks, without loading the other capabilities. */
export function createReadonlyTools(cwd: string, homeDir = homedir()): ToolRegistration[] {
  return [
    preserveErrorDetails(createImageReadTool(cwd, homeDir)),
    createGlobTool(cwd),
    preserveErrorDetails(createGrepTool(cwd)),
  ];
}
