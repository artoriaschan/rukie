import { spawn } from "node:child_process";
import { createUserVisibleError, type HookHandler } from "@neant/shared";

export interface CommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Kill the process group as well as the shell so timeout cannot leave its script running. */
export async function executeCommand(
  handler: Extract<HookHandler, { type: "command" }>,
  input: unknown,
  options: { cwd: string; projectDir: string; signal?: AbortSignal; timeout: number },
): Promise<CommandOutput> {
  options.signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const grouped = process.platform !== "win32";
    const child = spawn(
      handler.args !== undefined ? handler.command : (handler.shell ?? "sh"),
      handler.args ?? ["-c", handler.command],
      {
        cwd: options.cwd,
        env: { ...process.env, NEANT_PROJECT_DIR: options.projectDir },
        stdio: ["pipe", "pipe", "pipe"],
        detached: grouped,
      },
    );
    let stdout = "";
    let stderr = "";
    let failure: Error | undefined;
    const kill = (error: Error) => {
      failure = error;
      try {
        if (grouped && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        /* It may have exited between timeout and kill. */
      }
    };
    const abort = () => kill(new Error("Hook cancelled"));
    const timer = setTimeout(
      () =>
        kill(
          createUserVisibleError(`Hook timed out after ${options.timeout}s`, {
            code: "hook-timeout",
            params: { timeout: String(options.timeout) },
          }),
        ),
      options.timeout * 1000,
    );
    options.signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    };
    child.stdout.setEncoding("utf8").on("data", (data: string) => {
      stdout += data;
    });
    child.stderr.setEncoding("utf8").on("data", (data: string) => {
      stderr += data;
    });
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code, signal) => {
      cleanup();
      if (failure) reject(failure);
      else if (signal)
        reject(
          createUserVisibleError(`Hook crashed: ${signal}`, {
            code: "hook-crashed",
            params: { signal },
          }),
        );
      else resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
    // A script may exit before consuming its input; EPIPE belongs to that script's exit result.
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify(input));
    if (options.signal?.aborted) abort();
  });
}
