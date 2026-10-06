import {
  applyShellOutputUpdate,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type AgentTool,
  type ShellOutputView,
} from "@earendil-works/pi-agent-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/pi-agent-core/harness/context";
import { resolve } from "node:path";
import type { Jobs } from "../jobs/index.ts";
import { Type } from "typebox";
import { OutputCapture } from "./output-capture.ts";

const schema = Type.Object({
  command: Type.String({ description: "Bash command to execute." }),
  description: Type.String({ description: "Short description in 3–10 words." }),
  timeout: Type.Optional(
    Type.Number({
      description:
        "Foreground timeout in seconds (default: 120; maximum: 600); still-running commands move to background jobs.",
    }),
  ),
  run_in_background: Type.Optional(
    Type.Boolean({ description: "Start a background job and return immediately." }),
  ),
  workdir: Type.Optional(
    Type.String({ description: "Working directory relative to Session cwd." }),
  ),
});

export function createBashTool(cwd: string, jobs: Jobs): AgentTool<typeof schema> {
  return {
    name: "bash",
    label: "bash",
    description: `Execute a bash command. Returns combined stdout and stderr, truncated to the last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB. If truncated, full output is saved to a temp file. Timeout defaults to 120 seconds (maximum: 600); commands still running at the timeout move to background jobs. Set run_in_background to start a job without a timeout; use job_output, job_list, and job_kill to manage it.`,
    parameters: schema,
    async execute(
      _id,
      { command, description, timeout = 120, workdir, run_in_background = false },
      signal,
      onUpdate,
    ) {
      if (!Number.isFinite(timeout) || timeout <= 0)
        throw new Error("Invalid timeout: must be a finite number of seconds");
      if (timeout > 600) throw new Error("Invalid timeout: maximum is 600 seconds");
      if (signal?.aborted) throw new Error("Command aborted");

      let view: ShellOutputView | undefined;
      let failure: unknown;
      let status: string | undefined;
      if (run_in_background) {
        const job = jobs.start({
          command,
          label: description,
          cwd: resolve(cwd, workdir ?? "."),
          background: true,
        });
        return {
          content: [{ type: "text", text: `started background job ${job.view.id}` }],
          details: { jobId: job.view.id },
        };
      }
      let job: ReturnType<Jobs["start"]> | undefined;
      const terminate = () => job?.kill("foreground");
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
      job = jobs.start({
        command,
        label: description,
        cwd: resolve(cwd, workdir ?? "."),
        background: false,
        onOutput(chunk) {
          capture.push(chunk);
          if (capture.truncated) capture.setSpillPath(job!.view.spillPath!);
        },
      });
      let promoted = false;
      const abort = () => {
        if (promoted) return;
        status ??= "Command aborted";
        terminate();
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<undefined>((done) => {
        timer = setTimeout(() => {
          if (status) return;
          promoted = true;
          job!.promote();
          signal?.removeEventListener("abort", abort);
          done(undefined);
        }, timeout * 1000);
      });
      try {
        onUpdate?.({ content: [], details: undefined });
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        const code = await Promise.race([job.completed, deadline]);
        // The promotion result hands over output already shown by foreground capture.
        if (promoted) await job.collect(false, 0);
        failure ??= job.failure;
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
        if (promoted) {
          text += `${text ? "\n" : ""}[still running after ${timeout}s; moved to background job ${job.view.id}]\nThe command keeps running in the background. You will be notified when it finishes; read newer output with job_output, stop it with job_kill.`;
          return {
            content: [{ type: "text", text }],
            details: { ...details, jobId: job.view.id },
          };
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
        if (!promoted) jobs.forget(job.view.id);
      }
    },
  };
}
