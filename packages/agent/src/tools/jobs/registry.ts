import { spawn } from "node:child_process";
import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import { StringDecoder } from "node:string_decoder";
import { join } from "node:path";
import { createUserVisibleError } from "@rukie/shared";
import type { JobView, JobOutput, JobEvent } from "@rukie/shared";

interface OutputChunk {
  offset: number;
  stream: "stdout" | "stderr";
  bytes: Buffer;
}

// One exit listener covers live groups without retaining idle Sessions.
const liveGroups = new Set<number>();
process.once("exit", () => {
  for (const pid of liveGroups) signalGroup(pid, "SIGKILL");
});

function signalGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) return error;
  }
}

export function jobStatus(job: JobView) {
  return `[status: ${job.status}${job.exitCode !== undefined && ["completed", "failed"].includes(job.status) ? `, exit code: ${job.exitCode}` : ""}]`;
}

/** Session-owned processes. Foreground entries become visible only when promoted. */
export function createJobs(
  options: {
    initialSequence?: number;
    onNotify?(job: JobView): void;
    onEvent?(event: JobEvent): void;
  } = {},
) {
  let sequence = options.initialSequence ?? 0;
  let spillDir: string | undefined;
  let disposed = false;
  let clearing: Promise<void> | undefined;
  const ownedGroups = new Set<number>();
  const records = new Map<string, ReturnType<typeof start>>();
  function start(input: {
    command: string;
    label: string;
    cwd: string;
    background: boolean;
    onOutput?(bytes: Buffer): void;
  }) {
    if (disposed) throw new Error("Background jobs have been disposed.");
    if (
      input.background &&
      list().filter((job) => ["running", "stopping"].includes(job.status)).length >= 10
    )
      throw createUserVisibleError(
        "background job limit reached for this owner (limit: 10); stop an existing job before starting another",
        {
          code: "background-job-limit",
          params: { limit: 10 },
        },
      );
    spillDir ??= mkdtempSync(join(tmpdir(), "rukie-jobs-"));
    const id = `bash-${++sequence}`;
    const view: JobView = {
      id,
      kind: "bash",
      label: input.label,
      command: input.command,
      status: "running",
      startedAt: Date.now(),
      spillPath: join(spillDir, `${id}.log`),
    };
    const fd = openSync(view.spillPath!, "wx", 0o600);
    let fdClosed = false;
    const closeSpill = () => {
      if (!fdClosed) {
        fdClosed = true;
        closeSync(fd);
      }
    };
    const decoders = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
    let visible = input.background;
    let onOutput = input.onOutput;
    let suppressed = false;
    let silenced = false;
    let failure: unknown;
    let offset = 0;
    let modelOffset = 0;
    let retained = 0;
    let outputTimer: ReturnType<typeof setTimeout> | undefined;
    let outputPending = false;
    const emit = (kind: JobEvent["kind"]) => {
      if (visible && !silenced) options.onEvent?.({ type: "job_event", kind, job: { ...view } });
    };
    const flushOutput = () => {
      clearTimeout(outputTimer);
      outputTimer = undefined;
      if (!outputPending) return;
      outputPending = false;
      emit("output");
    };
    const rings: Record<OutputChunk["stream"], OutputChunk[]> = { stdout: [], stderr: [] };
    const waiters = new Set<() => void>();
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const proc = spawn("bash", ["-c", input.command], {
      cwd: input.cwd,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (proc.pid !== undefined) {
      liveGroups.add(proc.pid);
      ownedGroups.add(proc.pid);
    }
    const notify = () => {
      for (const wake of waiters) wake();
    };
    function trim(limit: number) {
      while (retained > limit) {
        const out = rings.stdout[0];
        const err = rings.stderr[0];
        const first = out && (!err || out.offset < err.offset) ? out : err;
        if (!first) return;
        const chunks = rings[first.stream];
        let cut = Math.min(first.bytes.length, retained - limit);
        while (cut < first.bytes.length && (first.bytes[cut]! & 0xc0) === 0x80) cut++;
        retained -= cut;
        if (cut === first.bytes.length) chunks.shift();
        else {
          first.offset += cut;
          first.bytes = first.bytes.subarray(cut);
        }
      }
    }
    const retain = (stream: OutputChunk["stream"], text: string) => {
      if (silenced) return;
      const bytes = Buffer.from(text);
      if (!bytes.length) return;
      rings[stream].push({ stream, bytes, offset });
      offset += bytes.length;
      retained += bytes.length;
      trim(256 * 1024);
      notify();
      if (visible) {
        outputPending = true;
        if (outputTimer === undefined) {
          outputTimer = setTimeout(flushOutput, 150);
          outputTimer.unref();
        }
      }
    };
    const receive = (stream: OutputChunk["stream"], bytes: Buffer) => {
      try {
        let written = 0;
        while (written < bytes.length)
          written += writeSync(fd, bytes, written, bytes.length - written);
        retain(stream, decoders[stream].write(bytes));
        onOutput?.(bytes);
      } catch (error) {
        failure ??= error;
        kill("teardown");
      }
    };
    proc.stdout.on("data", (bytes: Buffer) => receive("stdout", bytes));
    proc.stderr.on("data", (bytes: Buffer) => receive("stderr", bytes));
    proc.once("error", (error) => {
      failure ??= error;
    });
    proc.once("exit", () => {
      if (killTimer !== undefined && proc.pid !== undefined) signalGroup(proc.pid, "SIGTERM");
    });
    const completed = new Promise<number>((done) => {
      proc.once("close", (code, signal) => {
        const exitCode = code ?? (signal ? 128 + (constants.signals[signal] ?? 0) : 1);
        view.exitCode = exitCode;
        if (signal) view.signal = signal;
        view.endedAt = Date.now();
        view.status =
          view.status === "stopping"
            ? "killed"
            : failure || exitCode !== 0
              ? "failed"
              : "completed";
        retain("stdout", decoders.stdout.end());
        retain("stderr", decoders.stderr.end());
        closeSpill();
        trim(16 * 1024);
        if (proc.pid !== undefined) {
          // Escalation remains armed for descendants that closed inherited pipes.
          try {
            process.kill(-proc.pid, 0);
          } catch {
            if (killTimer !== undefined) clearTimeout(killTimer);
            liveGroups.delete(proc.pid);
            ownedGroups.delete(proc.pid);
          }
        }
        // Wake collectors before resolving completion: their successful cursor
        // commit suppresses notifications; a cancelled wait leaves them eligible.
        notify();
        done(exitCode);
      });
    });
    function kill(reason: "model" | "user" | "teardown" | "foreground") {
      suppressed = true;
      if (killTimer !== undefined) return;
      if (view.status !== "running" && reason !== "teardown") return;
      if (view.status === "running") view.status = "stopping";
      if (proc.pid !== undefined) {
        signalGroup(proc.pid, "SIGTERM");
        killTimer = setTimeout(() => {
          signalGroup(proc.pid!, "SIGKILL");
          liveGroups.delete(proc.pid!);
          ownedGroups.delete(proc.pid!);
        }, 3000);
        killTimer.unref();
      }
      notify();
    }
    function read(from: number): JobOutput {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const firstOffset = Math.min(
        rings.stdout[0]?.offset ?? offset,
        rings.stderr[0]?.offset ?? offset,
      );
      for (const chunk of [...rings.stdout, ...rings.stderr]) {
        if (chunk.offset + chunk.bytes.length <= from) continue;
        let start = Math.max(0, from - chunk.offset);
        while (start < chunk.bytes.length && (chunk.bytes[start]! & 0xc0) === 0x80) start++;
        const bytes = chunk.bytes.subarray(start);
        (chunk.stream === "stdout" ? stdout : stderr).push(bytes);
      }
      return {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        nextOffset: offset,
        dropped: from < firstOffset,
      };
    }
    async function collect(wait: boolean, timeout: number, signal?: AbortSignal) {
      signal?.throwIfAborted();
      if (wait && offset === modelOffset && ["running", "stopping"].includes(view.status)) {
        await new Promise<void>((done, reject) => {
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            waiters.delete(wake);
            signal?.removeEventListener("abort", abort);
          };
          const wake = () => {
            if (offset !== modelOffset || !["running", "stopping"].includes(view.status)) {
              finish();
              done();
            }
          };
          const abort = () => {
            finish();
            reject(signal?.reason ?? new Error("Command aborted"));
          };
          const timer = setTimeout(() => {
            finish();
            done();
          }, timeout);
          waiters.add(wake);
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) abort();
          else wake();
        });
      }
      signal?.throwIfAborted();
      const output = read(modelOffset);
      modelOffset = output.nextOffset;
      if (wait && !["running", "stopping"].includes(view.status)) suppressed = true;
      return output;
    }
    const job = {
      get view() {
        return { ...view };
      },
      get visible() {
        return visible;
      },
      get suppressed() {
        return suppressed;
      },
      get failure() {
        return failure;
      },
      completed,
      read,
      collect,
      kill,
      prepareCleanup(silent: boolean) {
        suppressed = true;
        if (!silent) return;
        silenced = true;
        onOutput = undefined;
        clearTimeout(outputTimer);
        outputTimer = undefined;
        outputPending = false;
        rings.stdout.length = 0;
        rings.stderr.length = 0;
        retained = 0;
      },
      async cleanup() {
        kill("teardown");
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            completed,
            new Promise<void>((done) => {
              timer = setTimeout(() => {
                proc.stdout.destroy();
                proc.stderr.destroy();
                proc.unref();
                closeSpill();
                done();
              }, 3100);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      },
      promote() {
        if (visible) return;
        visible = true;
        onOutput = undefined;
        emit("started");
      },
    };
    records.set(id, job);
    // Collectors released by close commit their suppression before this callback.
    void completed.then(() => {
      flushOutput();
      emit("settled");
      if (job.visible && !job.suppressed && !disposed) options.onNotify?.(job.view);
    });
    if (visible) emit("started");
    return job;
  }
  function list() {
    return [...records.values()].filter((job) => job.visible).map((job) => job.view);
  }
  function get(id: string) {
    const job = records.get(id);
    if (!job?.visible)
      throw new Error(`unknown job ${id}; background jobs do not survive a session restart`);
    return job;
  }
  /** Reusable cleanup for a child Run; dispose permanently closes the registry. */
  async function clear(silent = true) {
    // Suppress notifications for every record before any group signal. Child
    // teardown also closes event/output callbacks, including overlapping dispose.
    for (const job of records.values()) job.prepareCleanup(silent);
    if (clearing) return clearing;
    clearing = clearRecords();
    try {
      await clearing;
    } finally {
      clearing = undefined;
    }
  }
  async function clearRecords() {
    // A completed foreground shell can leave a descendant with closed pipes.
    // Keep group ownership after its invisible output record is forgotten.
    for (const pid of ownedGroups) signalGroup(pid, "SIGTERM");
    const reapGroups = async () => {
      const deadline = Date.now() + 3000;
      while (ownedGroups.size) {
        for (const pid of ownedGroups) {
          try {
            process.kill(-pid, 0);
          } catch {
            ownedGroups.delete(pid);
            liveGroups.delete(pid);
          }
        }
        if (!ownedGroups.size) return;
        if (Date.now() >= deadline) {
          for (const pid of ownedGroups) {
            signalGroup(pid, "SIGKILL");
            liveGroups.delete(pid);
          }
          ownedGroups.clear();
          return;
        }
        await new Promise<void>((done) => setTimeout(done, 10));
      }
    };
    await Promise.all([reapGroups(), ...[...records.values()].map((job) => job.cleanup())]);
    records.clear();
    if (spillDir !== undefined) rmSync(spillDir, { recursive: true, force: true });
    spillDir = undefined;
  }
  return {
    start,
    list,
    get,
    forget(id: string) {
      records.delete(id);
    },
    clear,
    async dispose(silent = false) {
      disposed = true;
      await clear(silent);
    },
  };
}

export type Jobs = ReturnType<typeof createJobs>;
