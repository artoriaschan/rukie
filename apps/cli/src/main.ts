#!/usr/bin/env bun
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { createSession, loadSettings, type SessionOptions } from "@neant/agent";
import { THINKING_LEVELS, type ThinkingLevel } from "@neant/shared";

export interface CliIo {
  readStdin: () => Promise<string>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Overrides for the session; in-process tests inject `streamFn` and `model` here. */
  session?: Partial<SessionOptions>;
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
      },
    }));
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
    const session = await createSession({ cwd, homeDir, settings, ...io.session });
    const prompt = values.prompt ?? (await io.readStdin()).trimEnd();
    const { text } = await session.run(prompt);
    io.stdout(`${text}\n`);
    return 0;
  } catch (error) {
    io.stderr(`${(error as Error).message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main(Bun.argv.slice(2), {
    readStdin: () => Bun.stdin.text(),
    stdout: (s) => process.stdout.write(s),
    stderr: (s) => process.stderr.write(s),
  });
}
