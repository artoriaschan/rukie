import { expect, test } from "bun:test";
import { join } from "node:path";
import {
  awaitWithContext,
  BACKGROUND_CONTEXT,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { tempDirs } from "../helpers/temp-dirs.ts";
import { killAtReady } from "../helpers/subagent-crash-barrier.ts";

const worker = join(import.meta.dir, "../helpers/subagent-recovery-worker.ts");
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

test.each(["child-done", "report-admitted", "report-processing", "report-answered"])(
  "real process recovery after %s keeps child and reporter identities and logically delivers once",
  async (cut) => {
    const dirs = await tempDirs();
    try {
      const facts = await killAtReady(
        worker,
        ["crash", dirs.cwd, dirs.homeDir, cut],
        join(import.meta.dir, "../.."),
      );
      const cold = Bun.spawn(
        [process.execPath, worker, "cold", dirs.cwd, dirs.homeDir, JSON.stringify(facts)],
        {
          cwd: join(import.meta.dir, "../.."),
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      // Real child-process recovery and SDK transport boundary; a parent fake clock cannot advance it.
      const bound = withAbortSignal(AbortSignal.timeout(5000), BACKGROUND_CONTEXT);
      const output = new Response(cold.stdout).text();
      const errors = new Response(cold.stderr).text();
      try {
        const [code, stdout, stderr] = await awaitWithContext(
          Promise.all([cold.exited, output, errors]),
          bound,
        );
        expect(stderr).toBe("");
        expect(code).toBe(0);
        const line = stdout.split("\n").find((line) => line.startsWith("COLD "));
        if (!line) throw new Error(`No cold public facts: ${stdout}`);
        const value: unknown = JSON.parse(line.slice(5));
        if (
          !object(value) ||
          !Array.isArray(value.directory) ||
          !Array.isArray(value.calls) ||
          !Array.isArray(value.reportInputs) ||
          !Array.isArray(value.child) ||
          !object(value.result)
        )
          throw new Error("Malformed public cold result");
        expect(value.directory).toHaveLength(1);
        expect(value.directory[0]).toMatchObject({
          id: facts.childId,
          driverTaskId: facts.driverId,
          active: false,
        });
        expect(value.calls).not.toContain(facts.childProviderId);
        expect(value.calls.every((id) => id === facts.parentProviderId)).toBe(true);
        expect(value.calls).toHaveLength(cut === "report-answered" ? 0 : 1);
        expect(value.reportInputs).toHaveLength(1);
        expect(
          value.child.filter(
            (message) =>
              object(message) &&
              message.role === "assistant" &&
              JSON.stringify(message.content).includes("committed child closing fact"),
          ),
        ).toHaveLength(1);
        expect(value.result.success).toBe(true);
        expect(value.result.text).toBe(
          cut === "report-answered" ? "warm report processed" : "cold report processed",
        );
        expect(value.idleCalls).toBe(0);
      } finally {
        cold.kill("SIGKILL");
        await awaitWithContext(
          cold.exited,
          withAbortSignal(AbortSignal.timeout(5000), BACKGROUND_CONTEXT),
        );
      }
    } finally {
      await dirs.cleanup();
    }
  },
);
