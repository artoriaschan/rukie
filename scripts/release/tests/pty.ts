import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { installRelease } from "./installed-fixture.ts";

type Fixture = Awaited<ReturnType<typeof installRelease>>;
export interface PtyAction {
  when: string | RegExp;
  raw?: boolean;
  send?: string;
  signal?: "SIGINT" | "SIGTERM";
  resize?: { columns: number; rows: number };
}
interface PtyResult {
  code: number;
  transcript: string;
  canonical: boolean;
  echo: boolean;
  restoredFullTermios: boolean;
  alternateEnter: boolean;
  alternateExit: boolean;
  cursorShow: boolean;
  kittyUpload: boolean;
  sixelUpload: boolean;
}
/** Owns one PTY/session leader. Each action matches output received after the preceding action; regexes use the Python-compatible subset without flags. */
export async function runPty(
  fixture: Fixture,
  options: {
    actions: PtyAction[];
    graphics?: "kitty" | "sixel";
    args?: string[];
    env?: Record<string, string>;
    timeoutMs?: number;
  },
): Promise<PtyResult> {
  const config = join(fixture.root, `pty-${randomUUID()}.json`);
  try {
    await Bun.write(
      config,
      JSON.stringify({
        command: fixture.command,
        cwd: fixture.cwd,
        args: options.args ?? [],
        env: { ...fixture.env, TERM: "xterm-256color", COLORTERM: "truecolor", ...options.env },
        graphics: options.graphics ?? "none",
        timeoutMs: options.timeoutMs ?? 10_000,
        actions: options.actions.map((action) => {
          if (action.when instanceof RegExp && action.when.flags)
            throw new Error("PTY regex actions must not use JavaScript flags");
          return {
            ...action,
            when:
              typeof action.when === "string"
                ? action.when.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
                : action.when.source,
          };
        }),
      }),
    );
    // Real process/terminal behavior cannot be advanced by a parent virtual clock.
    const child = Bun.spawn(
      ["/usr/bin/python3", join(import.meta.dir, "terminal-pty.py"), config],
      {
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (code !== 0)
      throw new Error(`PTY acceptance failed (${code}): ${stderr}\n${stdout.slice(-2500)}`);
    const result: unknown = JSON.parse(stdout);
    if (
      !result ||
      typeof result !== "object" ||
      !("code" in result) ||
      typeof result.code !== "number" ||
      !("transcript" in result) ||
      typeof result.transcript !== "string"
    )
      throw new Error("Invalid PTY result");
    for (const key of [
      "canonical",
      "echo",
      "restoredFullTermios",
      "alternateEnter",
      "alternateExit",
      "cursorShow",
      "kittyUpload",
      "sixelUpload",
    ])
      if (!(key in result) || typeof Reflect.get(result, key) !== "boolean")
        throw new Error(`Invalid PTY result ${key}`);
    // Every required property has been checked above at the subprocess JSON boundary.
    return result as PtyResult;
  } finally {
    await rm(config, { force: true });
  }
}
