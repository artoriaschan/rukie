/** Process-local background work owned by one Session; never restored from Transcript. */
export interface JobView {
  id: string;
  kind: "bash";
  label: string;
  command: string;
  status: "running" | "stopping" | "completed" | "failed" | "killed";
  exitCode?: number;
  signal?: string;
  startedAt: number;
  endedAt?: number;
  spillPath?: string;
}

/** stdout and stderr since an absolute UTF-8 byte offset shared by both streams. */
export interface JobOutput {
  stdout: string;
  stderr: string;
  nextOffset: number;
  dropped: boolean;
}

/** Output events carry a view; consumers read output with their own offset. */
export interface JobEvent {
  type: "job_event";
  kind: "started" | "output" | "settled";
  job: JobView;
}
