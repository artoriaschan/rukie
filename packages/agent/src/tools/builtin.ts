import {
  createReadTool,
  createWriteTool,
  createEditTool,
  type AgentTool,
  type Skill,
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import { homedir } from "node:os";
import { type TSchema } from "typebox";
import type { createFileTracking } from "../file-tracking/index.ts";
import type { WebFetchOptions } from "./web-fetch/index.ts";
import type { OnInteractionStart } from "../interaction/index.ts";
import { createJobTools, type Jobs } from "./jobs/index.ts";
import { createBashTool } from "./bash/index.ts";
import { createGlobTool } from "./glob.ts";
import { createGrepTool } from "./grep.ts";
import { createSkillTool } from "./skill.ts";
import { createQuestionTool, type OnQuestion } from "./question.ts";
import { createTodoTool, type TodoItem } from "./todo/index.ts";
import { createWebFetchTool } from "./web-fetch/index.ts";
import { adaptTool, createImageReadEnv, preserveErrorDetails } from "./runtime.ts";

/** Read-only tools for isolated model hook checks. */
export function createReadonlyTools(cwd: string, homeDir = homedir()): AgentTool[] {
  return [
    preserveErrorDetails(adaptTool(createReadTool(), createImageReadEnv(cwd), homeDir)),
    createGlobTool(cwd),
    preserveErrorDetails(createGrepTool(cwd)),
  ];
}

export function createBuiltinTools(
  cwd: string,
  jobs: Jobs,
  getSkill: (name: string) => Skill | undefined,
  setTodo: (todos: TodoItem[]) => Promise<void>,
  onQuestion?: OnQuestion,
  homeDir = homedir(),
  onInteractionStart?: OnInteractionStart,
  webFetch?: WebFetchOptions,
  fileTracking?: ReturnType<typeof createFileTracking>,
): AgentTool[] {
  const env = new NodeExecutionEnv({ cwd });
  const track = <T extends TSchema, D>(tool: AgentTool<T, D>): AgentTool<T, D> =>
    fileTracking ? fileTracking.wrapTool(tool) : tool;
  return [
    track(preserveErrorDetails(adaptTool(createReadTool(), createImageReadEnv(cwd), homeDir))),
    track(adaptTool(createWriteTool(), env, homeDir)),
    track(adaptTool(createEditTool(), env, homeDir)),
    preserveErrorDetails(createBashTool(cwd, jobs)),
    ...createJobTools(jobs),
    createGlobTool(cwd),
    preserveErrorDetails(createGrepTool(cwd)),
    createSkillTool(getSkill),
    createTodoTool(setTodo),
    createWebFetchTool(webFetch),
    ...(onQuestion ? [createQuestionTool(onQuestion, onInteractionStart)] : []),
  ];
}
