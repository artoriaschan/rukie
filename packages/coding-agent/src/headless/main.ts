#!/usr/bin/env bun
import { homedir } from "node:os";
import { createSession, loadSettings, type Session } from "@neant/agent";
import type { PermissionMode, ThinkingLevel } from "@neant/shared";
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
      resumeId: values.resume,
      allowRules: [...(io.session?.allowRules ?? []), ...(values["allow-tools"] ?? [])],
      permissionMode: values.yolo
        ? "full-access"
        : ((values["permission-mode"] as PermissionMode | undefined) ?? io.session?.permissionMode),
      trustProjectMcp: values["trust-project-mcp"] ?? io.session?.trustProjectMcp,
    });
    const streamJson = values["output-format"] === "stream-json";
    let runFailed = false;
    unsubscribe = session.subscribe((event) => {
      if (streamJson) io.stdout(`${JSON.stringify(event)}\n`);
      else if (event.type === "hook_message") io.stderr(`${event.message}\n`);
      else if (
        event.type === "result" &&
        (event.stopReason === "hook_stopped" || event.stopReason === "hook_blocked")
      )
        io.stderr(
          `${event.reason ?? (event.stopReason === "hook_blocked" ? "Prompt blocked by hook" : "Stopped by hook")}\n`,
        );
      if (values.goal !== undefined && event.type === "result") {
        if (!streamJson && event.text) io.stdout(`${event.text}\n`);
        if (!event.success) {
          runFailed = true;
          if (event.error && !io.signal?.aborted) io.stderr(`${event.error}\n`);
        }
      }
    });
    if (values.goal !== undefined) {
      if (session.goal && session.goal.phase !== "complete")
        throw new Error(
          "An unfinished Goal already exists in this Session. Use the TUI to edit, resume or clear it.",
        );
      interrupt = () => session?.interruptRun();
      io.signal?.addEventListener("abort", interrupt);
      io.signal?.throwIfAborted();
      // SessionStart hooks may already have started an internal Run. Preserve the
      // supplied objective until that Run settles, then use the idle-only API.
      await session.waitForIdle();
      io.signal?.throwIfAborted();
      await session.createGoal(values.goal, {
        maxRounds:
          values["max-goal-rounds"] === undefined ? undefined : Number(values["max-goal-rounds"]),
      });
      io.signal?.throwIfAborted();
      do {
        await session.waitForIdle();
        io.signal?.throwIfAborted();
      } while (session.goal?.armed);
      return !runFailed && session.goal?.phase === "complete" ? 0 : 1;
    }
    const prompt = initialPrompt ?? (await readStdin(io)).trimEnd();
    const { text } = await session.run(prompt, { signal: io.signal });
    if (!streamJson) io.stdout(`${text}\n`);
    return 0;
  } catch (error) {
    if (io.signal?.aborted) {
      io.stderr("Interrupted\n");
      return 130;
    }
    io.stderr(`${(error as Error).message}\n`);
    return 1;
  } finally {
    try {
      await session?.dispose();
      if (values.goal !== undefined) await session?.waitForIdle();
    } finally {
      unsubscribe?.();
      if (interrupt) io.signal?.removeEventListener("abort", interrupt);
    }
  }
}
