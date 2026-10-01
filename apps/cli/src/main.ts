#!/usr/bin/env bun
import { homedir } from "node:os";
import { addAbortSignal } from "node:stream";
import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import { createSession, loadSettings, type SessionOptions } from "@neant/agent";
import { THINKING_LEVELS, type ThinkingLevel } from "@neant/shared";

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
    ({ values } = parseArgs({
      args: argv,
      options: {
        prompt: { type: "string", short: "p" },
        model: { type: "string" },
        thinking: { type: "string" },
        resume: { type: "string" },
        "output-format": { type: "string", default: "text" },
      },
    }));
    if (values["output-format"] !== "text" && values["output-format"] !== "stream-json") {
      throw new Error("--output-format must be text or stream-json");
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
  try {
    const cwd = io.session?.cwd ?? process.cwd();
    const homeDir = io.session?.homeDir ?? homedir();
    const { settings, warnings } = await loadSettings({ cwd, homeDir });
    for (const warning of warnings) io.stderr(`Warning: ${warning}\n`);
    if (values.model) settings.model = values.model;
    if (values.thinking) settings.thinking = values.thinking as ThinkingLevel;
    const session = await createSession({
      cwd,
      homeDir,
      settings,
      ...io.session,
      resumeId: values.resume,
    });
    const prompt = values.prompt ?? (await readStdin(io)).trimEnd();
    const streamJson = values["output-format"] === "stream-json";
    const { text } = await session.run(prompt, {
      signal: io.signal,
      onEvent: streamJson ? (event) => io.stdout(`${JSON.stringify(event)}\n`) : undefined,
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
