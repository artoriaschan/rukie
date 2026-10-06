import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import { jobStatus, type Jobs } from "./index.ts";

const outputSchema = Type.Object({
  job_id: Type.String(),
  wait: Type.Optional(Type.Boolean()),
  timeout_ms: Type.Optional(Type.Number({ minimum: 0, maximum: 600_000 })),
});
const killSchema = Type.Object({ job_id: Type.String(), reason: Type.Optional(Type.String()) });

export function createJobTools(jobs: Jobs): AgentTool[] {
  const output: AgentTool<typeof outputSchema> = {
    name: "job_output",
    label: "job output",
    description:
      "Read new background job output. Set wait only when blocked on output or completion (default 30000ms, maximum 600000ms).",
    parameters: outputSchema,
    async execute(_id, { job_id, wait = false, timeout_ms = 30_000 }, signal) {
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
  const kill: AgentTool<typeof killSchema> = {
    name: "job_kill",
    label: "job kill",
    description:
      "Stop a background job and its process group. Finished jobs keep their final status.",
    parameters: killSchema,
    async execute(_id, { job_id }) {
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
  return [
    output,
    {
      name: "job_list",
      label: "job list",
      description: "List every background job owned by this Session.",
      parameters: Type.Object({}),
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
    },
    kill,
  ];
}
