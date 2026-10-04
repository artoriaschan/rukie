#!/usr/bin/env bun
import { homedir } from "node:os";
import { addAbortSignal } from "node:stream";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import {
  createSession,
  loadSettings,
  parsePermissionRules,
  type Session,
  type SessionOptions,
} from "@neant/agent";
import {
  PERMISSION_MODES,
  THINKING_LEVELS,
  type PermissionMode,
  type ThinkingLevel,
} from "@neant/shared";

export interface CliIo {
  /** The process SIGINT signal; forwarded to the active Run. */
  signal?: AbortSignal;
  readStdin: () => Promise<string>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Overrides for the session; in-process tests inject `streamFn` and `model` here. */
  session?: Partial<SessionOptions>;
}

async function readStdin(io: CliIo): Promise<string> {
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
export async function main(argv: string[], io: CliIo): Promise<number> {
  let values;
  try {
    const parsed = parseArgs({
      args: argv,
      tokens: true,
      allowPositionals: true,
      options: {
        prompt: { type: "string", short: "p" },
        model: { type: "string" },
        thinking: { type: "string" },
        resume: { type: "string" },
        "output-format": { type: "string", default: "text" },
        "allow-tools": { type: "string", multiple: true },
        "permission-mode": { type: "string" },
        yolo: { type: "boolean" },
        "trust-project-mcp": { type: "boolean" },
      },
    });
    values = parsed.values;
    // parseArgs consumes the first pattern; subsequent positionals belong only
    // to the immediately preceding --allow-tools option, until the next flag.
    let collectingTools = false;
    for (const token of parsed.tokens) {
      if (token.kind === "option") collectingTools = token.name === "allow-tools";
      else if (token.kind === "positional" && collectingTools) {
        values["allow-tools"]!.push(token.value);
      } else if (token.kind === "positional") {
        throw new Error(`Unexpected argument: ${token.value}`);
      } else collectingTools = false;
    }
    parsePermissionRules({ allow: values["allow-tools"] }, "--allow-tools");
    if (values["output-format"] !== "text" && values["output-format"] !== "stream-json") {
      throw new Error("--output-format must be text or stream-json");
    }
    if (
      values["permission-mode"] !== undefined &&
      !PERMISSION_MODES.includes(values["permission-mode"] as PermissionMode)
    ) {
      throw new Error(`--permission-mode must be one of ${PERMISSION_MODES.join(", ")}`);
    }
    if (
      values.yolo &&
      values["permission-mode"] !== undefined &&
      values["permission-mode"] !== "full-access"
    ) {
      throw new Error("--yolo conflicts with --permission-mode; --yolo requires full-access");
    }
    if (values.model !== undefined && !/^[^/]+\/.+/.test(values.model)) {
      throw new Error(`--model must be provider/id, got "${values.model}"`);
    }
    if (
      values.thinking !== undefined &&
      !THINKING_LEVELS.includes(values.thinking as ThinkingLevel)
    ) {
      throw new Error(`--thinking must be one of ${THINKING_LEVELS.join(", ")}`);
    }
  } catch (error) {
    io.stderr(`${(error as Error).message}\n`);
    return 2;
  }
  let session: Session | undefined;
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
    const prompt = values.prompt ?? (await readStdin(io)).trimEnd();
    const streamJson = values["output-format"] === "stream-json";
    const { text } = await session.run(prompt, {
      signal: io.signal,
      onEvent: (event) => {
        if (streamJson) io.stdout(`${JSON.stringify(event)}\n`);
        else if (event.type === "hook_message") io.stderr(`${event.message}\n`);
        else if (
          event.type === "result" &&
          (event.stopReason === "hook_stopped" || event.stopReason === "hook_blocked")
        )
          io.stderr(
            `${event.reason ?? (event.stopReason === "hook_blocked" ? "Prompt blocked by hook" : "Stopped by hook")}\n`,
          );
      },
    });
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
    await session?.dispose();
  }
}

if (import.meta.main) {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on("SIGINT", interrupt);
  try {
    process.exitCode = await main(Bun.argv.slice(2), {
      signal: controller.signal,
      readStdin: () => text(addAbortSignal(controller.signal, process.stdin)),
      stdout: (s) => process.stdout.write(s),
      stderr: (s) => process.stderr.write(s),
    });
  } finally {
    process.off("SIGINT", interrupt);
  }
}
