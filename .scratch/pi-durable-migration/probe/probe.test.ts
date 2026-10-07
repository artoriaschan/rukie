import {
  BACKGROUND_CONTEXT,
  awaitWithContext,
  withAbortSignal,
} from "@earendil-works/chord/context";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { smoke, hookClose, ownershipAndFork } from "./scenario.ts";

const Ready = Type.Object({ mode: Type.String(), id: Type.Number(), providerCalls: Type.Number() });
const Report = Type.Object({
  done: Type.Boolean(),
  sameId: Type.Boolean(),
  executed: Type.Number(),
  interrupted: Type.Boolean(),
  output: Type.Boolean(),
  partial: Type.Boolean(),
  retained: Type.Boolean(),
});

test("public Harness commits streaming, files and documents through close/reopen", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rukie-durable-"));
  try {
    expect(await smoke(dir)).toEqual({
      status: "done",
      text: "hello",
      doc: 1,
      duplicates: true,
      streamed: true,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 10000);

for (const mode of [
  "admitted",
  "partial",
  "hook",
  "safe",
  "unsafe",
  "downgrade",
  "upgrade",
  "result",
]) {
  test(`independent process recovery at ${mode} boundary`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "rukie-restart-"));
    let child: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
    let resumed: Bun.Subprocess<"ignore", "pipe", "pipe"> | undefined;
    const deadline = withAbortSignal(AbortSignal.timeout(5000), BACKGROUND_CONTEXT);
    try {
      child = Bun.spawn([process.execPath, "worker.ts", dir, mode], {
        cwd: import.meta.dir,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const reader = child.stdout.getReader();
      let output = "";
      while (!output.includes("\n")) {
        const chunk = await awaitWithContext(reader.read(), deadline);
        if (chunk.done)
          throw new Error(
            "worker ended: " +
              output +
              (await awaitWithContext(new Response(child.stderr).text(), deadline)),
          );
        output += new TextDecoder().decode(chunk.value);
      }
      const ready: unknown = JSON.parse(output.split("\n")[0]);
      if (!Value.Check(Ready, ready)) throw new Error("invalid worker readiness record");
      expect(ready.mode).toBe(mode);
      if (mode === "admitted") expect(ready.providerCalls).toBe(0);
      child.kill(9);
      await awaitWithContext(child.exited, deadline);
      reader.releaseLock();
      resumed = Bun.spawn([process.execPath, "worker.ts", dir, mode, "resume", String(ready.id)], {
        cwd: import.meta.dir,
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const result = await awaitWithContext(new Response(resumed.stdout).text(), deadline);
      const stderr = await awaitWithContext(new Response(resumed.stderr).text(), deadline);
      expect(await awaitWithContext(resumed.exited, deadline)).toBe(0);
      if (stderr) throw new Error(stderr);
      const report: unknown = JSON.parse(result);
      if (!Value.Check(Report, report)) throw new Error("invalid worker recovery report");
      expect(report.done).toBe(true);
      expect(report.sameId).toBe(true);
      expect(report.executed).toBe(mode === "safe" || mode === "hook" ? 1 : 0);
      if (["unsafe", "downgrade", "upgrade"].includes(mode)) {
        expect(report.interrupted).toBe(true);
        expect(report.output).toBe(true);
      }
      if (mode === "partial") expect(report.partial).toBe(true);
      if (mode === "result") expect(report.retained).toBe(true);
    } finally {
      const exits = await Promise.allSettled(
        [child, resumed].map(async (proc) => {
          if (!proc) return;
          if (proc.exitCode === null) proc.kill(9);
          await awaitWithContext(
            proc.exited,
            withAbortSignal(AbortSignal.timeout(3000), BACKGROUND_CONTEXT),
          );
        }),
      );
      await rm(dir, { recursive: true, force: true });
      for (const exit of exits) if (exit.status === "rejected") throw exit.reason;
    }
  }, 10000);
}

test("close while beforeTool waits preserves work and reruns current hook", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rukie-hook-"));
  try {
    expect(await hookClose(dir)).toEqual({ hooks: 2, executed: 1, done: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 10000);

test("read-only reopen, rewindable fork, event snapshot and background abort boundary", async () => {
  const dir = await mkdtemp(join(tmpdir(), "rukie-ownership-"));
  try {
    expect(await ownershipAndFork(dir)).toEqual({
      noWork: true,
      asOf: 1,
      fork: 1,
      retained: 2,
      snapshot: true,
      survives: true,
      stopped: true,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 10000);
