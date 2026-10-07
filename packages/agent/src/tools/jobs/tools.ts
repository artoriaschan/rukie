import type { ToolRegistration } from "@earendil-works/pi-durable";
import { Type } from "typebox";
import type { PresentedTool } from "../presentation.ts";
import { jobStatus, type Jobs } from "./registry.ts";

const outputSchema = Type.Object({
  job_id: Type.String(),
  wait: Type.Optional(Type.Boolean()),
  timeout_ms: Type.Optional(Type.Number({ minimum: 0, maximum: 600_000 })),
});
const killSchema = Type.Object({ job_id: Type.String(), reason: Type.Optional(Type.String()) });

export function createJobTools(jobs: Jobs): ToolRegistration[] {
  const output: PresentedTool<typeof outputSchema> = {
    name: "job_output",
    description:
      "Read new background job output. Set wait only when blocked on output or completion (default 30000ms, maximum 600000ms).",
    parameters: outputSchema,
    // Jobs already retains at most 256 KiB across stdout/stderr. Allow its
    // status and spill receipt without a second truncation of the bounded tail.
    outputLimits: { maxBytes: 260 * 1024, maxLines: 260 * 1024, retain: "tail" },
    presentCall: (args) => ({
      card: "generic",
      kind: "execute",
      displayKey: "tool.job_output",
      title: args.job_id,
    }),
    presentResult: (_args, text) => ({
      card: "generic",
      kind: "execute",
      displayKey: "tool.job_output",
      text,
    }),
    async execute({ job_id, wait = false, timeout_ms = 30_000 }, _api, context) {
      const signal = context.abortSignal;
      const job = jobs.get(job_id);
      const result = await job.collect(wait, timeout_ms, signal);
      let text = result.stdout;
      if (result.stderr) text += `${text ? "\n" : ""}[stderr]\n${result.stderr}`;
      text ||= "(no new output)";
      if (result.dropped)
        text += `\n[some output was dropped from memory; full output: ${job.view.spillPath}]`;
      text += `\n${jobStatus(job.view)}`;
      return { content: [{ type: "text", text }], details: undefined };
    },
  };
  const kill: PresentedTool<typeof killSchema> = {
    name: "job_kill",
    description:
      "Stop a background job and its process group. Finished jobs keep their final status.",
    parameters: killSchema,
    presentCall: (args) => ({
      card: "generic",
      kind: "execute",
      displayKey: "tool.job_kill",
      title: args.job_id,
    }),
    presentResult: (_args, text) => ({
      card: "generic",
      kind: "execute",
      displayKey: "tool.job_kill",
      text,
    }),
    async execute({ job_id }) {
      const job = jobs.get(job_id);
      if (!["running", "stopping"].includes(job.view.status))
        return {
          content: [
            { type: "text", text: `job ${job_id} had already finished ${jobStatus(job.view)}` },
          ],
          details: undefined,
        };
      job.kill("model");
      return {
        content: [{ type: "text", text: `requested cancellation of job ${job_id}` }],
        details: undefined,
      };
    },
  };
  const list: PresentedTool = {
    name: "job_list",
    description: "List every background job owned by this Session.",
    parameters: Type.Object({}),
    presentCall: () => ({ card: "generic", kind: "execute", displayKey: "tool.job_list" }),
    presentResult: (_args: unknown, text: string) => ({
      card: "generic",
      kind: "execute",
      displayKey: "tool.job_list",
      text,
    }),
    async execute() {
      const text = jobs
        .list()
        .map((job) => `${job.id} [bash] ${job.status} — ${job.label}`)
        .join("\n");
      return {
        content: [{ type: "text", text: text || "(no background jobs)" }],
        details: undefined,
      };
    },
  };
  return [output, list, kill];
}
