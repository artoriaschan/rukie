#!/usr/bin/env bun
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { createSession, type SessionOptions } from "@neant/agent";

export interface CliIo {
  readStdin: () => Promise<string>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  /** Overrides for the session; tests inject `streamFn` and `model` here. */
  session?: Partial<SessionOptions>;
}

/** Runs the CLI and resolves to the process exit code. */
export async function main(argv: string[], io: CliIo): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: { prompt: { type: "string", short: "p" } } }));
  } catch (error) {
    io.stderr(`${(error as Error).message}\n`);
    return 2;
  }
  const { streamFn, model, ...rest } = io.session ?? {};
  // ponytail: model comes from settings in ticket 02; until then only injected models work
  if (!streamFn || !model) {
    io.stderr("No model configured.\n");
    return 1;
  }
  const prompt = values.prompt ?? (await io.readStdin()).trimEnd();
  try {
    const session = await createSession({
      cwd: process.cwd(),
      homeDir: homedir(),
      ...rest,
      streamFn,
      model,
    });
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
