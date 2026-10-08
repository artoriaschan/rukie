import {
  defineTask,
  configure,
  UsageDoc,
  AgentDoc,
  type AgentChange,
  type AgentState,
  type LiveState,
  type CommitPublication,
  type Conversation,
  type ConversationId,
  type EntryId,
  type Harness,
  type ToolExecutionApi,
  type TaskId,
  type Extension,
  type Cursor,
  type EntryRecord,
  type SubmissionId,
  type Tx,
} from "@earendil-works/pi-durable";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT, awaitWithContext } from "@earendil-works/chord/context";
import type { RunResult } from "@rukie/shared";
import { projectCommittedOutcomeFacts } from "../../session/observation.ts";
import { transcriptMessages } from "../../session/messages.ts";
import type { ToolStateDefinition } from "../../tool-state/index.ts";
import {
  parseSubagentIdentities,
  subagentRunState,
  SubagentDirectoryDoc,
  type SubagentIdentity,
  type SubagentRun,
} from "./state.ts";
import type { SubagentType } from "./types.ts";

const SUBAGENT_PROMPT =
  "You are a subagent delegated by a parent session. Work on the assigned prompt; your final reply will be delivered to the parent. You cannot expand the parent session permissions or create other subagents.";
const FORK_TYPE: SubagentType = {
  name: "fork",
  description: "Fork of the parent conversation",
  prompt: "",
};
const DELEGATION_TOOLS = new Set(["subagent", "subagent_fork", "send_message", "list_agents"]);

export interface SubagentControllerOptions {
  harness: Harness;
  parent: Conversation;
  parentSessionId: string;
  state: ToolStateDefinition;
  restored?: readonly SubagentIdentity[];
  onWarning?(warning: string): void;
  forkAt(): EntryId | undefined;
  /** Install child capability extensions before returning its explicit agent config. */
  childAgent(
    type: SubagentType,
    conversation: Conversation,
    selection: { retained: boolean },
  ): Promise<AgentChange>;
  /** Settle child resources and end hooks before exposing its terminal receipt. */
  afterRun?(
    request: {
      agentId: string;
      description: string;
      type: string;
      prompt: string;
      background: boolean;
    },
    conversation: Conversation,
    result: RunResult & { outcome: NonNullable<SubagentRun["outcome"]> },
    context: Context,
  ): Promise<void>;
  beforeStart?(
    request: {
      agentId: string;
      description: string;
      type: string;
      prompt: string;
      background: boolean;
    },
    conversation: Conversation,
    context: Context,
  ): Promise<{ stop: string } | undefined>;
}
export type SubagentDelegationFact =
  | { kind: "started"; agentId: string; childSessionId: string; reused: boolean }
  | { kind: "completed"; agentId: string; childSessionId: string; result: RunResult };
export type SubagentSendFact =
  | { kind: "steered"; agentId: string }
  | Extract<SubagentDelegationFact, { kind: "started" }>;
type Result = {
  text: string;
  success: boolean;
  durationMs: number;
  endedAt: number;
  error?: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
  };
  driverFailure?: string;
  parentAnswer?: number;
  parentSubmissionId?: number;
};
type Input = {
  description: string;
  type: string;
  prompt: string;
  background: boolean;
  originToolTaskId: TaskId;
  startedAt: number;
  retained?: boolean;
};
type Phase =
  | { phase: "configure" }
  | { phase: "run"; childId: ConversationId; agentId: string }
  | {
      phase: "report";
      childId: ConversationId;
      agentId: string;
      result: Result;
      submissionId?: SubmissionId;
    };

/** Native tasks own child execution and the durable reporter; the directory is only committed identity/state. */
export function createSubagentController(options: SubagentControllerOptions) {
  const { harness, parentSessionId, state } = options;
  let parent = options.parent;
  let types = new Map<string, SubagentType>();
  let identities = [...(options.restored ?? [])];
  const warnedTypes = new Set<string>();
  const typeFor = (name: string) => {
    if (name === "fork") return FORK_TYPE;
    const type = types.get(name);
    if (type) return type;
    const fallback = types.get("general-purpose");
    if (fallback && !warnedTypes.has(name)) {
      warnedTypes.add(name);
      options.onWarning?.(
        `Subagent type "${name}" is unavailable; falling back to general-purpose.`,
      );
    }
    return fallback;
  };
  function adopt(publication: CommitPublication) {
    for (const change of publication.changes) {
      if (
        change.type !== "document" ||
        change.conversationId !== parent.id ||
        change.record.kind !== state.document.definition.kind
      )
        continue;
      const raw = change.value?.value;
      identities =
        raw === undefined || raw === null ? [] : parseSubagentIdentities(raw, parentSessionId);
    }
  }
  const unsubscribe = harness.subscribeCommits(adopt);
  async function rows(context: Context) {
    const raw = await harness.snapshot(state.document, parent.id, context);
    return raw?.value === undefined || raw.value === null
      ? []
      : parseSubagentIdentities(raw.value, parentSessionId);
  }
  async function waitForInput(
    agentId: string,
    driverTaskId: number,
    api: ToolExecutionApi,
    context: Context,
  ) {
    const watch = await api.watchDoc(state.document, parent.id, context);
    if (!watch) throw new Error("Subagent directory is missing.");
    const ready = Promise.withResolvers<void>();
    const check = (value: typeof watch.value) => {
      const row = parseSubagentIdentities(value?.value ?? [], parentSessionId).find(
        (row) => row.id === agentId,
      );
      if (!row || row.driverTaskId !== driverTaskId)
        throw new Error("Subagent Run changed before steering.");
      if (!row.active || row.latestRun?.outcome)
        throw new Error("Subagent Run ended before steering.");
      if (row.latestRun?.inputSubmissionId !== undefined) ready.resolve();
    };
    try {
      check(watch.value);
      watch.start(async (value) => {
        try {
          check(value);
        } catch (error) {
          ready.reject(error);
        }
      });
      void watch.closed.then((end) =>
        ready.reject(new Error(`Subagent input watch ${end.reason}.`)),
      );
      await awaitWithContext(ready.promise, context);
    } finally {
      await watch.stop();
    }
  }
  function childRow(taskId: TaskId) {
    const row = identities.find((row) => row.driverTaskId === taskId);
    if (!row) throw new Error(`Subagent driver ${taskId} has no directory identity.`);
    return row;
  }
  function resultError(error: string, startedAt: number, endedAt: number): Result {
    return {
      text: "",
      success: false,
      error,
      durationMs: Math.max(0, endedAt - startedAt),
      endedAt,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    };
  }
  async function settleChild(
    task: { input: Input },
    childId: ConversationId,
    agentId: string,
    result: Result,
    outcome: NonNullable<SubagentRun["outcome"]>,
    context: Context,
  ): Promise<Result> {
    if (!options.afterRun) return result;
    try {
      const conversation = await harness.conversation(childId, context);
      if (!conversation) throw new Error("Subagent conversation is missing.");
      await options.afterRun(
        { ...task.input, agentId },
        conversation,
        { ...result, outcome },
        context,
      );
      return result;
    } catch (error) {
      if (context.abortSignal?.aborted) throw error;
      const failure = error instanceof Error ? error.message : String(error);
      return { ...result, success: false, error: failure, driverFailure: failure };
    }
  }
  function terminalResult(result: Result) {
    return result.driverFailure
      ? { status: "failed" as const, error: { message: result.driverFailure }, result }
      : { status: "completed" as const, result };
  }
  const driver = defineTask<Input, Phase, Result>({
    name: "rukie.subagent-driver",
    version: 1,
    initial: () => ({ phase: "configure" }),
    phases: {
      async configure(task, runtime, context) {
        const row = childRow(task.id);
        // IDs are checked integral values saved directly from native records;
        // branding restores that validated native identity at the protocol boundary.
        const childId = row.conversationId as ConversationId;
        try {
          const conversation = await harness.conversation(childId, context);
          if (!conversation) throw new Error("Subagent conversation is missing.");
          const type = typeFor(task.input.type);
          if (!type) throw new Error(`Subagent type ${task.input.type} is unavailable.`);
          const decision = await options.beforeStart?.(
            { ...task.input, agentId: row.id },
            conversation,
            context,
          );
          if (decision) {
            const result = resultError(decision.stop, task.input.startedAt, runtime.now());
            await runtime.commit(async (tx) => {
              const doc = await tx.doc(state.document, parent.id);
              const current = parseSubagentIdentities(doc.value ?? [], parentSessionId);
              const identity = current.find((item) => item.driverTaskId === task.id);
              if (!identity?.latestRun) throw new Error("Subagent Run identity is missing.");
              identity.active = false;
              identity.latestRun = {
                ...identity.latestRun,
                endedAt: result.endedAt,
                durationMs: result.durationMs,
                tokens: 0,
                outcome: "hook_stopped",
                reason: decision.stop,
              };
              doc.value = current;
              (await tx.doc(subagentRunState.document, childId)).value = identity.latestRun;
              return task.input.background
                ? {
                    status: "running",
                    checkpoint: { phase: "report", childId, agentId: row.id, result },
                  }
                : { status: "terminal", outcome: { status: "completed", result } };
            }, context);
            return;
          }
          const inherited = task.input.retained
            ? await runtime.snapshot(AgentDoc, childId, context)
            : undefined;
          if (task.input.retained && !inherited?.model)
            throw new Error("Retained subagent model is missing.");
          const change = await options.childAgent(type, conversation, {
            retained: task.input.retained === true,
          });
          const parentAgent = await runtime.agent(context);
          const selection = change.tools;
          const selected =
            selection && "remove" in selection
              ? parentAgent.tools.filter(
                  (tool) => !selection.remove.some((removed) => removed.name === tool.name),
                )
              : (selection ?? parentAgent.tools);
          const selectedTools = selected.filter(
            (tool) =>
              !DELEGATION_TOOLS.has(tool.name) && (!type.tools || type.tools.includes(tool.name)),
          );
          await runtime.commit(async (tx) => {
            await configure(tx, childId, {
              ...change,
              ...(inherited?.model
                ? { model: inherited.model, thinkingLevel: inherited.thinkingLevel }
                : {}),
              tools: selectedTools,
              instructions: [change.instructions ?? "", SUBAGENT_PROMPT, type.prompt]
                .filter(Boolean)
                .join("\n\n"),
            });
            return { status: "running", checkpoint: { phase: "run", childId, agentId: row.id } };
          }, context);
        } catch (error) {
          if (runtime.signal.aborted || context.abortSignal?.aborted) throw error;
          const result = resultError(
            error instanceof Error ? error.message : String(error),
            task.input.startedAt,
            runtime.now(),
          );
          await runtime.commit(async (tx) => {
            const doc = await tx.doc(state.document, parent.id);
            const current = parseSubagentIdentities(doc.value ?? [], parentSessionId);
            const identity = current.find((item) => item.driverTaskId === task.id);
            if (identity) {
              identity.active = false;
              identity.latestRun = {
                id: String(task.id),
                sessionId: identity.id,
                parentSessionId,
                startedAt: task.input.startedAt,
                endedAt: result.endedAt,
                durationMs: result.durationMs,
                outcome: "error",
                error: result.error,
              };
              doc.value = current;
              (await tx.doc(subagentRunState.document, childId)).value = identity.latestRun;
            }
            return task.input.background
              ? {
                  status: "running",
                  checkpoint: { phase: "report", childId, agentId: row.id, result },
                }
              : {
                  status: "terminal",
                  outcome: {
                    status: "failed",
                    error: { message: result.error ?? "Subagent configuration failed" },
                    result,
                  },
                };
          }, context);
        }
      },
      async run(task, runtime, context) {
        const { childId, agentId } = task.state.checkpoint;
        const child = await runtime.conversation(childId, context);
        if (!child) throw new Error("Subagent conversation is missing.");
        const request = await child.submit(
          {
            type: "input",
            content: task.input.prompt,
            requestId: `subagent:${task.id}:input`,
            whenBusy: "followUp",
          },
          context,
        );
        const admitted = await request.status(context);
        const agent = await runtime.snapshot(AgentDoc, childId, context);
        await runtime.commit(async (tx) => {
          const doc = await tx.doc(state.document, parent.id);
          const current = parseSubagentIdentities(doc.value ?? [], parentSessionId);
          const row = current.find((row) => row.id === agentId);
          if (!row?.latestRun) throw new Error("Subagent Run identity is missing.");
          row.latestRun.inputSubmissionId = Number(request.id);
          if (admitted.entry !== undefined) row.latestRun.promptEntryId = admitted.entry;
          if (agent?.model) row.latestRun.model = `${agent.model.provider}/${agent.model.modelId}`;
          doc.value = current;
          (await tx.doc(subagentRunState.document, childId)).value = row.latestRun;
        }, context);
        const receipt = await request.wait(context);
        await child.waitForIdle(context);
        const view = await runtime.context(childId, context);
        const answer =
          receipt.type === "input" && receipt.status === "done"
            ? view.entries.find((entry) => entry.id === receipt.answer)
            : view.entries.findLast(
                (entry) =>
                  entry.id >= (childRow(task.id).latestRun?.promptEntryId ?? Infinity) &&
                  entry.model?.some((message) => message.role === "assistant"),
              );
        const message = answer?.model?.find((message) => message.role === "assistant");
        let outcome: NonNullable<SubagentRun["outcome"]> =
          message?.stopReason === "length"
            ? "length"
            : message?.stopReason === "aborted" ||
                (receipt.status === "unanswered" && receipt.reason === "aborted")
              ? "aborted"
              : receipt.status === "done" && message?.stopReason !== "error"
                ? "completed"
                : "error";
        const error =
          outcome === "completed"
            ? undefined
            : (message?.errorMessage ??
              (outcome === "length"
                ? "Model response reached its token limit"
                : receipt.status === "unanswered"
                  ? receipt.reason
                  : outcome));
        const usageState = await runtime.snapshot(UsageDoc, childId, context);
        const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
        for (const entry of Object.values(usageState?.models ?? {})) {
          usage.input += entry.input;
          usage.output += entry.output;
          usage.cacheRead += entry.cacheRead;
          usage.cacheWrite += entry.cacheWrite;
          usage.totalTokens += entry.totalTokens;
        }
        const endedAt = runtime.now();
        let result: Result = {
          text:
            view.entries
              .filter(
                (entry) => entry.id >= (childRow(task.id).latestRun?.promptEntryId ?? Infinity),
              )
              .flatMap((entry) => entry.model ?? [])
              .filter((message) => message.role === "assistant")
              .map((message) =>
                message.content
                  .flatMap((block) => (block.type === "text" ? [block.text] : []))
                  .join(""),
              )
              .findLast((text) => text.trim().length > 0) ?? "",
          success: outcome === "completed",
          usage,
          endedAt,
          durationMs: Math.max(0, endedAt - task.input.startedAt),
          ...(error ? { error } : {}),
        };
        result = await settleChild(task, childId, agentId, result, outcome, context);
        if (result.driverFailure) outcome = "error";
        await runtime.commit(async (tx) => {
          const doc = await tx.doc(state.document, parent.id);
          const current = parseSubagentIdentities(doc.value ?? [], parentSessionId);
          const row = current.find((row) => row.id === agentId);
          if (!row) throw new Error("Subagent identity is missing.");
          row.active = false;
          row.latestRun = {
            ...row.latestRun,
            ...(receipt.type === "input" && receipt.status === "done"
              ? { answerEntryId: receipt.answer }
              : {}),
            id: String(task.id),
            sessionId: agentId,
            parentSessionId,
            startedAt: task.input.startedAt,
            endedAt,
            durationMs: result.durationMs,
            tokens: usage.totalTokens,
            outcome,
            ...(result.error ? { error: result.error } : {}),
          };
          doc.value = current;
          (await tx.doc(subagentRunState.document, childId)).value = row.latestRun;
          return task.input.background
            ? { status: "running", checkpoint: { phase: "report", childId, agentId, result } }
            : { status: "terminal", outcome: terminalResult(result) };
        }, context);
      },
      async report(task, runtime, context) {
        const { agentId, result } = task.state.checkpoint;
        const parentHandle = await runtime.conversation(parent.id, context);
        if (!parentHandle) throw new Error("Parent conversation is missing.");
        const request = await parentHandle.submit(
          {
            type: "input",
            whenBusy: "followUp",
            requestId: `subagent:${task.id}:report`,
            content: `Subagent ${agentId} (${task.input.description}) ${result.success ? "finished" : `failed: ${result.error ?? "unknown error"}`}.${result.text.trim() ? ` Its closing message:\n${result.text}` : ""}`,
          },
          context,
        );
        await runtime.commit(
          () => ({
            status: "running",
            checkpoint: { ...task.state.checkpoint, submissionId: request.id },
          }),
          context,
        );
        const receipt = await request.wait(context);
        const reported: Result = {
          ...result,
          parentSubmissionId: request.id,
          ...(receipt.type === "input" && receipt.status === "done"
            ? { parentAnswer: receipt.answer }
            : {}),
        };
        await runtime.commit(
          () => ({ status: "terminal", outcome: terminalResult(reported) }),
          context,
        );
      },
    },
    async abort(task, runtime, context) {
      const row = childRow(task.id);
      const child = await runtime.conversation(row.conversationId as ConversationId, context);
      await child?.abort(context);
      let result =
        task.state.checkpoint.phase === "report" && task.state.checkpoint.result.error === "aborted"
          ? task.state.checkpoint.result
          : resultError("aborted", task.input.startedAt, runtime.now());
      if (task.state.checkpoint.phase === "run") {
        await child?.waitForIdle(context);
        result = await settleChild(
          task,
          row.conversationId as ConversationId,
          row.id,
          result,
          "aborted",
          context,
        );
      }
      await runtime.commit(async (tx) => {
        const doc = await tx.doc(state.document, parent.id);
        const current = parseSubagentIdentities(doc.value ?? [], parentSessionId);
        const identity = current.find((item) => item.id === row.id);
        if (identity) {
          identity.active = false;
          identity.latestRun = {
            ...identity.latestRun,
            id: String(task.id),
            sessionId: row.id,
            parentSessionId,
            startedAt: task.input.startedAt,
            endedAt: result.endedAt,
            durationMs: result.durationMs,
            outcome: result.driverFailure ? "error" : "aborted",
            ...(result.driverFailure ? { error: result.driverFailure } : {}),
          };
          doc.value = current;
          (await tx.doc(subagentRunState.document, row.conversationId as ConversationId)).value =
            identity.latestRun;
        }
        return task.input.background
          ? {
              status: "running",
              checkpoint: {
                phase: "report",
                childId: row.conversationId as ConversationId,
                agentId: row.id,
                result,
              },
            }
          : {
              status: "terminal",
              outcome: result.driverFailure
                ? terminalResult(result)
                : { status: "aborted", reason: "aborted", result },
            };
      }, context);
      if (task.input.background) {
        const parentHandle = await runtime.conversation(parent.id, context);
        if (!parentHandle) throw new Error("Parent conversation is missing.");
        const request = await parentHandle.submit(
          {
            type: "input",
            whenBusy: "followUp",
            requestId: `subagent:${task.id}:report`,
            content: result.driverFailure
              ? `Subagent ${row.id} (${task.input.description}) failed: ${result.driverFailure}.`
              : `Subagent ${row.id} (${task.input.description}) aborted.`,
          },
          context,
        );
        await runtime.commit(
          () => ({
            status: "running",
            checkpoint: {
              phase: "report",
              childId: row.conversationId as ConversationId,
              agentId: row.id,
              result,
              submissionId: request.id,
            },
          }),
          context,
        );
        const receipt = await request.wait(context);
        const reported = {
          ...result,
          parentSubmissionId: request.id,
          ...(receipt.type === "input" && receipt.status === "done"
            ? { parentAnswer: receipt.answer }
            : {}),
        };
        await runtime.commit(
          () => ({
            status: "terminal",
            outcome: result.driverFailure
              ? terminalResult(reported)
              : { status: "aborted", reason: "aborted", result: reported },
          }),
          context,
        );
      }
    },
  });
  const extension: Extension = { name: "rukie.subagent-runtime", tasks: [driver] };

  async function start(
    request: { type: string; description: string; prompt: string; background: boolean },
    api: ToolExecutionApi,
    context: Context,
    forkAt?: EntryId,
    existing?: SubagentIdentity,
  ): Promise<SubagentDelegationFact> {
    const type = typeFor(request.type);
    if (!type)
      throw new Error(
        `Unknown subagent type "${request.type}". Available types: ${[...types.keys()].join(", ")}.`,
      );
    const startedAt = Date.now();
    const created = await api.commit(async (tx) => {
      const doc = await tx.doc(state.document, parent.id);
      const current = parseSubagentIdentities(doc.value ?? [], parentSessionId);
      const admitted = current.find((row) => row.originToolTaskId === api.taskId);
      if (admitted) return { id: admitted.id, taskId: admitted.driverTaskId as TaskId<Result> };
      const active = existing && current.find((row) => row.id === existing.id && row.active);
      if (active)
        return {
          id: active.id,
          taskId: active.driverTaskId as TaskId<Result>,
          steerConversationId: active.conversationId as ConversationId,
        };
      if (current.filter((row) => row.active).length >= 8)
        throw new Error("At most 8 subagents can run at once.");
      const taskId = await tx.createTask(
        driver,
        {
          ...request,
          originToolTaskId: api.taskId,
          startedAt,
          ...(existing ? { retained: true } : {}),
        },
        request.background
          ? { ownership: { kind: "conversation" }, conversationId: parent.id, background: true }
          : { ownership: { kind: "task", taskId: api.taskId } },
      );
      const source = existing ? (existing.conversationId as ConversationId) : parent.id;
      const child = forkAt
        ? await tx.forkConversation(source, forkAt, { ownership: { kind: "task", taskId } })
        : await tx.createConversation({ ownership: { kind: "task", taskId } });
      // A child inherits model history, but owns no parent delegation directory.
      // Root conversation rewind uses the same native fork with its directory intact.
      if (forkAt !== undefined) (await tx.doc(state.document, child.id)).value = [];
      const id = existing?.id ?? String(child.id);
      const row: SubagentIdentity = {
        id,
        description: request.description,
        type: request.type,
        conversationId: child.id,
        driverTaskId: taskId,
        originToolTaskId: api.taskId,
        active: true,
        latestRun: { id: String(taskId), sessionId: id, parentSessionId, startedAt },
      };
      const index = current.findIndex((row) => row.id === id);
      if (index < 0) current.push(row);
      else current[index] = row;
      doc.value = current;
      (await tx.doc(subagentRunState.document, child.id)).value = row.latestRun!;
      return { id, taskId };
    }, context);
    if ("steerConversationId" in created && created.steerConversationId !== undefined) {
      await waitForInput(created.id, Number(created.taskId), api, context);
      const child = await api.conversation(created.steerConversationId, context);
      if (!child) throw new Error("Subagent conversation is missing.");
      await child.submit(
        {
          type: "input",
          content: request.prompt,
          whenBusy: "steer",
          requestId: `subagent-send:${api.taskId}`,
        },
        context,
      );
    }
    if (request.background)
      return {
        kind: "started",
        agentId: created.id,
        childSessionId: created.id,
        reused: Boolean(existing),
      };
    const done = await api.waitForTask(created.taskId, context);
    const outcome = done.state.outcome;
    const result =
      outcome.result ??
      resultError(
        outcome.status === "faulted" || outcome.status === "failed"
          ? outcome.error.message
          : outcome.status === "orphaned"
            ? outcome.reason
            : "aborted",
        startedAt,
        Date.now(),
      );
    return { kind: "completed", agentId: created.id, childSessionId: created.id, result };
  }
  return {
    extension,
    adopt,
    /** Caller must settle related native work before changing the parent branch. */
    /** Capture native committed directory history before a root rewind fork. */
    async snapshotForRewind(
      at: EntryId,
      context: Context,
    ): Promise<SubagentIdentity[] | undefined> {
      const raw = await harness.snapshotAsOf(SubagentDirectoryDoc, parent.id, at, context);
      return raw?.value === undefined || raw.value === null
        ? undefined
        : parseSubagentIdentities(raw.value, parentSessionId);
    },
    /** Restore the captured directory inside the caller's atomic root fork commit. */
    async restoreFork(
      tx: Tx,
      forkId: ConversationId,
      snapshot: readonly SubagentIdentity[] | undefined,
    ): Promise<void> {
      if (snapshot !== undefined)
        (await tx.doc(state.document, forkId)).value = structuredClone([...snapshot]);
    },
    async rebindParent(next: Conversation, context: Context) {
      const raw = await harness.snapshot(state.document, next.id, context);
      const nextIdentities =
        raw?.value === undefined || raw.value === null
          ? []
          : parseSubagentIdentities(raw.value, parentSessionId);
      parent = next;
      identities = nextIdentities;
    },
    types: () => [...types.values()],
    setTypes(available: Map<string, SubagentType>) {
      types = available;
    },
    list: () => structuredClone(identities),
    get count() {
      return identities.filter((row) => row.active).length;
    },
    delegate(
      request: { type: string; description: string; prompt: string; background: boolean },
      api: ToolExecutionApi,
      context: Context,
    ) {
      if (!types.has(request.type))
        throw new Error(
          `Unknown subagent type "${request.type}". Available types: ${[...types.keys()].join(", ")}.`,
        );
      return start(request, api, context);
    },
    fork(
      request: { description: string; prompt: string; background: boolean },
      api: ToolExecutionApi,
      context: Context,
    ) {
      return start({ ...request, type: "fork" }, api, context, options.forkAt());
    },
    async send(
      agentId: string,
      message: string,
      api: ToolExecutionApi,
      context: Context,
    ): Promise<SubagentSendFact> {
      const child = (await rows(context)).find((row) => row.id === agentId);
      if (!child) throw new Error(`Unknown subagent: ${agentId}`);
      const conversation = await harness.conversation(
        child.conversationId as ConversationId,
        context,
      );
      if (!conversation) throw new Error("Subagent conversation is missing.");
      if (child.active) {
        await waitForInput(child.id, child.driverTaskId, api, context);
        await conversation.submit(
          {
            type: "input",
            content: message,
            whenBusy: "steer",
            requestId: `subagent-send:${api.taskId}`,
          },
          context,
        );
        return { kind: "steered", agentId };
      }
      const at = (await conversation.context(context)).entries.at(-1)?.id;
      const fact = await start(
        { type: child.type, description: child.description, prompt: message, background: true },
        api,
        context,
        at,
        child,
      );
      if (fact.kind !== "started") throw new Error("Background continuation did not start.");
      return fact;
    },
    async prepareChildren(context: Context = BACKGROUND_CONTEXT) {
      identities = await rows(context);
      for (const row of identities) {
        const conversation = await harness.conversation(
          row.conversationId as ConversationId,
          context,
        );
        const type = typeFor(row.type);
        if (conversation && type) await options.childAgent(type, conversation, { retained: true });
      }
    },
    async readChild(id: string, context: Context = BACKGROUND_CONTEXT) {
      const row = identities.find((row) => row.id === id);
      if (!row) return;
      const conversation = await harness.conversation(
        row.conversationId as ConversationId,
        context,
      );
      if (!conversation) return;
      const attached = await conversation.viewState(context);
      const frame = attached.value;
      attached.dispose();
      // These reserved native documents are validated by Durable. Keep model,
      // committed messages and live generation in the same immutable frame.
      const agent = frame.docs["pi.agent"] as AgentState;
      const live = frame.docs["pi.live"] as LiveState;
      const history: EntryRecord[] = [];
      let cursor: Cursor | undefined;
      do {
        const page = await conversation.entries({}, 100, cursor, context);
        history.push(...page.items);
        cursor = page.next;
      } while (cursor !== undefined);
      const historyEntries = history
        .filter(
          (entry) =>
            row.latestRun?.promptEntryId === undefined || entry.id < row.latestRun.promptEntryId,
        )
        .sort((a, b) => a.id - b.id);
      return {
        id,
        conversation,
        messages: await projectCommittedOutcomeFacts(
          transcriptMessages(frame.entries),
          frame.entries,
          harness,
          context,
        ),
        generation: live.generation,
        historyMessages: await projectCommittedOutcomeFacts(
          transcriptMessages(historyEntries),
          historyEntries,
          harness,
          context,
        ),
        model: agent.model ? `${agent.model.provider}/${agent.model.modelId}` : "",
        run: row.latestRun,
        latestRun: row.latestRun,
        active: row.active,
        description: row.description,
        subagentType: row.type,
      };
    },
    async interrupt(id: string, context: Context = BACKGROUND_CONTEXT) {
      const row = identities.find((row) => row.id === id);
      if (!row) throw new Error(`Unknown subagent: ${id}`);
      const taskId = row.driverTaskId as TaskId;
      if (row.active) await harness.abortTask(taskId, context);
      // Activity ends before reporter settlement. Repeated stops still join that same native terminal.
      await harness.waitForTask(taskId, context);
    },
    close() {
      unsubscribe();
    },
  };
}
