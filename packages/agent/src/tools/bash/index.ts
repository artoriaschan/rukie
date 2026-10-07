import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize } from "./output-capture.ts";
import { resolve } from "node:path";
import type { Jobs } from "../jobs/index.ts";
import { Type } from "typebox";
import type { PresentedTool } from "../presentation.ts";
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

export function createBashTool(cwd: string, jobs: Jobs): PresentedTool<typeof schema> {
  return {
    name: "bash",
    presentCall(args) {
      return args.run_in_background
        ? { card: "generic", kind: "execute", displayKey: "tool.bash", rawInput: args }
        : { card: "terminal", kind: "execute", displayKey: "tool.bash", command: args.command };
    },
    presentResult(args, output, details) {
      const facts = typeof details === "object" && details !== null ? details : {};
      if (args.run_in_background || "jobId" in facts)
        return { card: "generic", kind: "execute", displayKey: "tool.bash", text: output };
      return {
        card: "terminal",
        kind: "execute",
        displayKey: "tool.bash",
        output,
        ...("exitCode" in facts && typeof facts.exitCode === "number"
          ? { exitCode: facts.exitCode }
          : {}),
        ...("signal" in facts && typeof facts.signal === "string" ? { signal: facts.signal } : {}),
        ...("truncation" in facts ? { outputUnavailable: true } : {}),
        ...("fullOutputPath" in facts && typeof facts.fullOutputPath === "string"
          ? { fullOutputPath: facts.fullOutputPath }
          : {}),
      };
    },
    description: `Execute a bash command. Returns combined stdout and stderr, truncated to the last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB. If truncated, full output is saved to a temp file. Timeout defaults to 120 seconds (maximum: 600); commands still running at the timeout move to background jobs. Set run_in_background to start a job without a timeout; use job_output, job_list, and job_kill to manage it.`,
    parameters: schema,
    outputLimits: { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES, retain: "tail" },
    async execute(
      { command, description, timeout = 120, workdir, run_in_background = false },
      api,
      context,
    ) {
      const signal = context.abortSignal;
      if (!Number.isFinite(timeout) || timeout <= 0)
        throw new Error("Invalid timeout: must be a finite number of seconds");
      if (timeout > 600) throw new Error("Invalid timeout: maximum is 600 seconds");
      if (signal?.aborted) throw new Error("Command aborted");

      let failure: unknown;
      let progress = Promise.resolve();
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
      const capture = new OutputCapture({
        limits: { maxBytes: DEFAULT_MAX_BYTES, maxLines: DEFAULT_MAX_LINES, retain: "tail" },
        spill: true,
      });
      job = jobs.start({
        command,
        label: description,
        cwd: resolve(cwd, workdir ?? "."),
        background: false,
        onOutput(chunk) {
          api.output(chunk);
          capture.push(chunk);
          if (capture.truncated) {
            const fullOutputPath = job!.view.spillPath!;
            capture.setSpillPath(fullOutputPath);
            const { truncation } = capture.snapshot();
            progress = progress
              .then(() => api.details({ truncation, fullOutputPath }, context))
              .catch((error: unknown) => {
                failure ??= error;
                terminate();
              });
          }
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
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        const code = await Promise.race([job.completed, deadline]);
        // The promotion result hands over output already shown by foreground capture.
        if (promoted) await job.collect(false, 0);
        await progress;
        failure ??= job.failure;
        capture.finish();
        if (capture.truncated) capture.setSpillPath(job.view.spillPath!);
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
        const facts = {
          ...details,
          ...(code !== undefined && { exitCode: code }),
          ...(job.view.signal ? { signal: job.view.signal } : {}),
        };
        if (status)
          return {
            isError: true,
            content: [{ type: "text", text: text ? `${text}\n\n${status}` : status }],
            details: facts,
          };
        return { content: [{ type: "text", text: text || "(no output)" }], details: facts };
      } catch (error) {
        terminate();
        throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (!promoted) jobs.forget(job.view.id);
      }
    },
  };
}
