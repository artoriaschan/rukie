import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { isAbsolute } from "node:path";

/** Reads local exports without logging or persisting values; inherited variables retain priority. */
export async function readLoginShellEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<NodeJS.ProcessEnv> {
  if (platform !== "darwin") return environment;
  try {
    const shell =
      environment.SHELL && isAbsolute(environment.SHELL) ? environment.SHELL : userInfo().shell;
    if (!shell || !isAbsolute(shell)) return environment;
    const marker = `RUKIE_ENV_${randomUUID()}`;
    const child = spawn(shell, ["-ilc", `/usr/bin/printf '\\0${marker}\\0'; /usr/bin/env -0`], {
      env: environment,
      stdio: ["ignore", "pipe", "ignore"],
      detached: true,
    });
    let output = "";
    let failed = false;
    const stop = () => {
      failed = true;
      // Shell startup scripts may own children; stop the entire acquisition process group.
      try {
        if (child.pid) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    };
    const timer = setTimeout(stop, 5_000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 1024 * 1024) stop();
    });
    child.once("error", () => {
      failed = true;
    });
    const code = await new Promise<number | null>((resolve) => child.once("close", resolve));
    clearTimeout(timer);
    const start = output.indexOf(`\0${marker}\0`);
    if (failed || code !== 0 || start < 0) return environment;
    const imported: NodeJS.ProcessEnv = {};
    for (const record of output.slice(start + marker.length + 2).split("\0")) {
      const separator = record.indexOf("=");
      if (separator > 0) imported[record.slice(0, separator)] = record.slice(separator + 1);
    }
    return { ...imported, ...environment };
  } catch {
    return environment;
  }
}
