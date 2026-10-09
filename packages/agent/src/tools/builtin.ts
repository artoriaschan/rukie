import type { JsonValue } from "@earendil-works/chord";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import type { Skill } from "../skills/index.ts";
import { createImageReadTool } from "./read.ts";
import { createPresentedFileTools } from "./file-diffs.ts";
import { homedir } from "node:os";
import { type TSchema } from "typebox";
import type { createFileTracking } from "../file-tracking/index.ts";
import type { WebFetchOptions } from "./web-fetch/index.ts";
import type { OnInteractionStart } from "../interaction/index.ts";
import { createJobTools, type Jobs } from "./jobs/index.ts";
import { createBashTool } from "./bash/index.ts";
import { withReadView } from "./read.ts";
import { createGlobTool } from "./glob.ts";
import { createGrepTool } from "./grep.ts";
import { createSkillTool } from "./skill.ts";
import { createQuestionTool, type OnQuestion } from "./question.ts";
import { createTodoTool, type TodoItem } from "./todo/index.ts";
import { createWebFetchTool } from "./web-fetch/index.ts";
import { preserveErrorDetails } from "./support/runtime.ts";

export interface BuiltinToolsOptions {
  cwd: string;
  jobs: Jobs;
  getSkill: (name: string) => Skill | undefined;
  setTodo: (todos: TodoItem[]) => Promise<void>;
  /** The `ask_user_question` tool is absent when this callback is omitted. */
  onQuestion?: OnQuestion;
  /** Defaults to the process home; tests inject an isolated one. */
  homeDir?: string;
  onInteractionStart?: OnInteractionStart;
  webFetch?: WebFetchOptions;
  applicationVersion?: string;
  fileTracking?: ReturnType<typeof createFileTracking>;
}

export function createBuiltinTools(options: BuiltinToolsOptions): ToolRegistration[] {
  const { cwd, jobs, getSkill, setTodo, onQuestion, onInteractionStart, webFetch, fileTracking } =
    options;
  const homeDir = options.homeDir ?? homedir();
  const track = <T extends TSchema, D extends JsonValue>(
    tool: ToolRegistration<T, D>,
  ): ToolRegistration<T, D> => (fileTracking ? fileTracking.wrapTool(tool) : tool);
  const [write, edit] = createPresentedFileTools(cwd, homeDir);
  return [
    track(withReadView(preserveErrorDetails(createImageReadTool(cwd, homeDir)))),
    track(write),
    track(edit),
    preserveErrorDetails(createBashTool(cwd, jobs)),
    ...createJobTools(jobs),
    createGlobTool(cwd),
    preserveErrorDetails(createGrepTool(cwd)),
    createSkillTool(getSkill),
    createTodoTool(setTodo),
    createWebFetchTool(webFetch, options.applicationVersion),
    ...(onQuestion ? [createQuestionTool(onQuestion, onInteractionStart)] : []),
  ];
}
