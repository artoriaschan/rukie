#!/usr/bin/env bun
import { homedir } from "node:os";
import { createSession, loadSettings, type Session } from "@rukie/agent";
import type { PermissionMode, ThinkingLevel } from "@rukie/shared";
import type { CliOptions } from "../cli";
import type { PrintIo } from "../io";

async function readStdin(io: PrintIo): Promise<string> {
  const signal = io.signal;
  if (!signal) return io.readStdin();
  signal.throwIfAborted();
  const interrupted = Promise.withResolvers<never>();
  const abort = () => interrupted.reject(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  try {
    return await Promise.race([io.readStdin(), interrupted.promise]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** Runs the CLI and resolves to the process exit code. */
export async function runHeadless(options: CliOptions, io: PrintIo): Promise<number> {
  const { values, prompt: initialPrompt } = options;
  let session: Session | undefined;
  let unsubscribe: (() => void) | undefined;
  let interrupt: (() => void) | undefined;
  try {
    const cwd = io.session?.cwd ?? process.cwd();
    const homeDir = io.session?.homeDir ?? homedir();
    const { settings, warnings } = await loadSettings({ cwd, homeDir });
    for (const warning of warnings) io.stderr(`Warning: ${warning}\n`);
    if (values.model) settings.model = values.model;
    if (values.thinking) settings.thinking = values.thinking as ThinkingLevel;
    session = await createSession({
      cwd,
      homeDir,
      settings,
      onWarning: (warning) => io.stderr(`Warning: ${warning}\n`),
      ...io.session,
      initializationSignal: io.signal ?? io.session?.initializationSignal,
      resumeId: values.resume,
      allowRules: [...(io.session?.allowRules ?? []), ...(values["allow-tools"] ?? [])],
      permissionMode: values.yolo
        ? "full-access"
        : ((values["permission-mode"] as PermissionMode | undefined) ?? io.session?.permissionMode),
      trustProjectMcp: values["trust-project-mcp"] ?? io.session?.trustProjectMcp,
    });
    const streamJson = values["output-format"] === "stream-json";
    unsubscribe = session.subscribe((event) => {
      if (event.type === "mcp_auth_required")
        io.stderr(
          `MCP server ${event.server} needs authentication; run /mcp login ${event.server} in the TUI\n`,
        );
      if (streamJson) io.stdout(`${JSON.stringify(event)}\n`);
      else if (event.type === "hook_message") io.stderr(`${event.message}\n`);
      else if (
        event.type === "request_settled" &&
        (event.stopReason === "hook_stopped" || event.stopReason === "hook_blocked")
      )
        io.stderr(
          `${event.reason ?? (event.stopReason === "hook_blocked" ? "Prompt blocked by hook" : "Stopped by hook")}\n`,
        );
    });
    const startupRequestId = session.currentRequestId;
    if (values.goal !== undefined) {
      if (session.goal && session.goal.phase !== "complete")
        throw new Error(
          "An unfinished Goal already exists in this Session. Use the TUI to edit, resume or clear it.",
        );
      interrupt = () => {
        void session?.close("exit");
      };
      io.signal?.addEventListener("abort", interrupt);
      io.signal?.throwIfAborted();
      // SessionStart hooks may already have started an internal Run. Preserve the
      // supplied objective until that Run settles, then use the idle-only API.
      if (startupRequestId) await session.waitForRequest(startupRequestId);
      else await session.waitForIdle();
      io.signal?.throwIfAborted();
      const goal = await session.createGoal(values.goal, {
        maxRounds:
          values["max-goal-rounds"] === undefined ? undefined : Number(values["max-goal-rounds"]),
      });
      const result = await session.waitForRequest(goal.requestId);
      io.signal?.throwIfAborted();
      if (!streamJson && result.text) io.stdout(`${result.text}\n`);
      if (!result.success && result.error) io.stderr(`${result.error}\n`);
      return result.success && session.goal?.phase === "complete" ? 0 : 1;
    }
    const prompt = initialPrompt ?? (await readStdin(io)).trimEnd();
    interrupt = () => {
      void session?.close("exit");
    };
    io.signal?.addEventListener("abort", interrupt);
    io.signal?.throwIfAborted();
    if (prompt) {
      if (startupRequestId) await session.waitForRequest(startupRequestId);
      else await session.waitForIdle();
      io.signal?.throwIfAborted();
    }
    let requestId = !prompt ? session.currentRequestId : undefined;
    if (!requestId) {
      try {
        requestId = (await session.run(prompt)).requestId;
      } catch (error) {
        // A committed failed Run still has a causal request to settle. Storage
        // faults and host shutdown keep their original failure semantics.
        if (io.signal?.aborted || !session.currentRequestId) throw error;
        requestId = session.currentRequestId;
      }
    }
    const result = await session.waitForRequest(requestId);
    io.signal?.throwIfAborted();
    const { text } = result;
    if (!streamJson) io.stdout(`${text}\n`);
    if (!result.success && result.error) io.stderr(`${result.error}\n`);
    return result.success ? 0 : 1;
  } catch (error) {
    if (io.signal?.aborted) {
      io.stderr("Interrupted\n");
      return 130;
    }
    io.stderr(`${(error as Error).message}\n`);
    return 1;
  } finally {
    try {
      await session?.close("exit");
    } finally {
      unsubscribe?.();
      if (interrupt) io.signal?.removeEventListener("abort", interrupt);
    }
  }
}
