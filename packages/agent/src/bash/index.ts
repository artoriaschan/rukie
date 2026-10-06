import {
  applyShellOutputUpdate,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type AgentTool,
  type ShellOutputView,
} from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { spawn } from "node:child_process";
import { closeSync, mkdtempSync, openSync, writeSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Type } from "typebox";
import { OutputCapture } from "./output-capture.ts";

const schema = Type.Object({
  command: Type.String({ description: "Bash command to execute." }),
  description: Type.String({ description: "Short description in 3–10 words." }),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in seconds (default: 120; maximum: 600)." }),
  ),
  workdir: Type.Optional(
    Type.String({ description: "Working directory relative to Session cwd." }),
  ),
});

export function createBashTool(cwd: string): AgentTool<typeof schema> {
  return {
    name: "bash",
    label: "bash",
    description: `Execute a bash command. Returns combined stdout and stderr, truncated to the last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB. If truncated, full output is saved to a temp file. Timeout defaults to 120 seconds (maximum: 600).`,
    parameters: schema,
    async execute(_id, { command, timeout = 120, workdir }, signal, onUpdate) {
      if (!Number.isFinite(timeout) || timeout <= 0)
        throw new Error("Invalid timeout: must be a finite number of seconds");
      if (timeout > 600) throw new Error("Invalid timeout: maximum is 600 seconds");
      if (signal?.aborted) throw new Error("Command aborted");

      let view: ShellOutputView | undefined;
      let failure: unknown;
      let status: string | undefined;
      let spillFd: number | undefined;
      const pending: Uint8Array[] = [];
      const proc = spawn("bash", ["-c", command], {
        cwd: resolve(cwd, workdir ?? "."),
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const killGroup = (sig: NodeJS.Signals) => {
        if (proc.pid === undefined) return;
        try {
          process.kill(-proc.pid, sig);
        } catch (error) {
          if (!(error instanceof Error && "code" in error && error.code === "ESRCH"))
            failure ??= error;
        }
      };
      const terminate = () => {
        if (killTimer !== undefined) return;
        killGroup("SIGTERM");
        killTimer = setTimeout(() => killGroup("SIGKILL"), 3000);
        killTimer.unref();
      };
      proc.once("exit", () => {
        // A shell can fork between the first group signal and its own exit.
        // Signal again after that boundary so the new child gets SIGTERM too.
        if (killTimer !== undefined) killGroup("SIGTERM");
      });
      const capture = new OutputCapture(
        {
          limits: { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES, retain: "tail" },
          spill: true,
        },
        BACKGROUND_CONTEXT,
        {
          onUpdate(update) {
            view = applyShellOutputUpdate(view, update);
            onUpdate?.({
              content: [{ type: "text", text: view.text }],
              details: {
                truncation: view.truncation.truncated ? view.truncation : undefined,
                fullOutputPath: view.spillPath,
              },
            });
          },
          onError(error) {
            failure ??= error;
            terminate();
          },
        },
      );
      const accept = (chunk: Uint8Array) => {
        try {
          capture.push(chunk);
          if (spillFd !== undefined) writeSync(spillFd, chunk);
          else {
            pending.push(chunk);
            if (capture.truncated) {
              const path = join(mkdtempSync(join(tmpdir(), "neant-bash-")), "output.log");
              spillFd = openSync(path, "wx", 0o600);
              for (const initial of pending) writeSync(spillFd, initial);
              pending.length = 0;
              capture.setSpillPath(path);
            }
          }
        } catch (error) {
          failure ??= error;
          terminate();
        }
      };
      const abort = () => {
        status ??= "Command aborted";
        terminate();
      };
      const timer = setTimeout(() => {
        status ??= `Command timed out after ${timeout} seconds`;
        terminate();
      }, timeout * 1000);
      try {
        onUpdate?.({ content: [], details: undefined });
        proc.stdout.on("data", accept);
        proc.stderr.on("data", accept);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        const code = await new Promise<number>((done) => {
          proc.once("error", (error) => {
            failure ??= error;
          });
          proc.once("close", (code, exitSignal) =>
            done(code ?? (exitSignal ? 128 + (constants.signals[exitSignal] ?? 0) : 1)),
          );
        });
        capture.finish();
        capture.flush();
        const output = capture.snapshot();
        let text = output.text;
        let details;
        if (output.truncation.truncated) {
          details = { truncation: output.truncation, fullOutputPath: output.spillPath };
          const start = output.truncation.totalLines - output.truncation.outputLines + 1;
          const end = output.truncation.totalLines;
          if (output.truncation.lastLinePartial)
            text += `\n\n[Showing last ${formatSize(output.truncation.outputBytes)} of line ${end} (line is ${formatSize(output.lastLineBytes ?? output.truncation.outputBytes)}). Full output: ${output.spillPath}]`;
          else if (output.truncation.truncatedBy === "lines")
            text += `\n\n[Showing lines ${start}-${end} of ${end}. Full output: ${output.spillPath}]`;
          else
            text += `\n\n[Showing lines ${start}-${end} of ${end} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${output.spillPath}]`;
        }
        status ??=
          failure instanceof Error ? failure.message : failure ? String(failure) : undefined;
        status ??= code !== 0 ? `Command exited with code ${code}` : undefined;
        if (status) throw new Error(text ? `${text}\n\n${status}` : status);
        return { content: [{ type: "text", text: text || "(no output)" }], details };
      } catch (error) {
        terminate();
        throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        capture.dispose();
        if (spillFd !== undefined) closeSync(spillFd);
        // Keep escalation armed if a descendant outlived the shell and closed
        // its inherited output streams; its process group still needs killing.
        if (killTimer !== undefined && proc.pid !== undefined) {
          try {
            process.kill(-proc.pid, 0);
          } catch {
            clearTimeout(killTimer);
          }
        }
      }
    },
  };
}
