#!/usr/bin/env bun
import { addAbortSignal } from "node:stream";
import { text } from "node:stream/consumers";
import { resolveLocale } from "@neant/i18n";
import { parseCli, formatArgvError } from "./cli";
import { createTuiI18n } from "./view/i18n";
import type { CodingAgentIo, TuiIo } from "./io";

function isTuiIo(io: CodingAgentIo): io is TuiIo {
  return typeof io.stdout !== "function" && io.stdin !== undefined;
}

/** Parse arguments once, then load only the selected frontend. */
export async function main(argv: string[], io: CodingAgentIo): Promise<number> {
  const env = io.env ?? process.env;
  const t = createTuiI18n(resolveLocale([env.LC_ALL, env.LC_MESSAGES, env.LANG]));
  let options;
  try {
    options = parseCli(argv, t);
  } catch (error) {
    io.stderr(`${formatArgvError(error, t)}\n`);
    return 2;
  }
  if (options.mode === "headless") {
    const { runHeadless } = await import("./headless/main.ts");
    const stdout = io.stdout;
    return runHeadless(options, {
      ...io,
      stdout:
        typeof stdout === "function"
          ? stdout
          : (value) => {
              stdout.write(value);
            },
      readStdin: io.readStdin ?? (() => text(io.stdin ?? process.stdin)),
    });
  }
  if (!isTuiIo(io) || !io.stdin.isTTY) {
    io.stderr(`${t("argv.terminal")}\n`);
    return 2;
  }
  if (io.signal?.aborted) return 0;
  // oxlint-disable-next-line no-restricted-imports -- Dynamic dispatch intentionally loads only the selected terminal mode.
  const { runTui } = await import("./tui/main.tsx");
  return runTui(options, { ...io, stdin: io.stdin, stdout: io.stdout });
}

if (import.meta.main) {
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.on("SIGINT", interrupt);
  try {
    process.exitCode = await main(Bun.argv.slice(2), {
      signal: controller.signal,
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: (value) => {
        process.stderr.write(value);
      },
      readStdin: () => text(addAbortSignal(controller.signal, process.stdin)),
    });
  } finally {
    process.off("SIGINT", interrupt);
  }
}
