import { expect, spyOn, test } from "bun:test";
import { useEffect, useState } from "react";
import { setImmediate } from "node:timers/promises";
import { setTimeout as ioTimeout, clearTimeout as clearIoTimeout } from "node:timers";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AlternateScreen, Box, Text, renderSync, useInput } from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

type Terminal = ReturnType<typeof createTerminal>;
function View({ text = "ready" }: { text?: string }) {
  useInput(() => {});
  return (
    <AlternateScreen>
      <Text>{text}</Text>
    </AlternateScreen>
  );
}
async function dispose(app: ReturnType<typeof renderSync>, terminal: Terminal, failure?: Error) {
  app.unmount();
  try {
    await app.waitUntilExit();
  } catch (error) {
    if (error !== failure) throw error;
  } finally {
    app.cleanup();
    await terminal.flush();
    terminal.dispose();
  }
}
function restored(terminal: Terminal) {
  expect(terminal.stdin.isRaw).toBe(false);
  expect(terminal.terminal.modes.bracketedPasteMode).toBe(false);
  expect(terminal.terminal.buffer.active.type).toBe("normal");
  expect(terminal.output().lastIndexOf("\x1b[?25h")).toBeGreaterThan(
    terminal.output().lastIndexOf("\x1b[?25l"),
  );
}

test("unmount restores raw mode, bracketed paste and cursor visibility and detaches IO", async () => {
  const terminal = createTerminal();
  const input: string[] = [];
  const listeners = {
    input: terminal.stdin.listenerCount("readable"),
    resize: terminal.stdout.listenerCount("resize"),
  };
  function Screen() {
    useInput((text) => input.push(text));
    return (
      <AlternateScreen>
        <Text>ready</Text>
      </AlternateScreen>
    );
  }
  const app = renderSync(<Screen />, terminal);
  try {
    await terminal.waitFor(() => terminal.screen()[0] === "ready");
    expect(terminal.stdin.isRaw).toBe(true);
    expect(terminal.terminal.modes.bracketedPasteMode).toBe(true);
    terminal.stdin.write("\x1b[200~unfinished");
    await setImmediate();
    app.unmount();
    app.unmount();
    await app.waitUntilExit();
    await terminal.flush();
    restored(terminal);
    expect(terminal.stdin.listenerCount("readable")).toBe(listeners.input);
    expect(terminal.stdout.listenerCount("resize")).toBe(listeners.resize);
    const before = terminal.bytesWritten();
    terminal.stdin.write("\x1b[201~ignored");
    terminal.resize(10, 4);
    await terminal.flush();
    expect(input).toEqual([]);
    expect(terminal.bytesWritten()).toBe(before);
  } finally {
    await dispose(app, terminal);
  }
});

for (const phase of ["render", "effect"] as const) {
  test(`a ${phase} failure rejects early and late waitUntilExit and preserves another root`, async () => {
    const own = createTerminal(),
      other = createTerminal();
    const failure = new Error(`public ${phase} failure`);
    function Crash() {
      const [broken, setBroken] = useState(false);
      useInput((input) => {
        if (input === "x") setBroken(true);
      });
      useEffect(() => {
        if (broken) throw failure;
      }, [broken]);
      if (phase === "render") throw failure;
      return (
        <AlternateScreen>
          <Text>ready</Text>
        </AlternateScreen>
      );
    }
    const healthy = renderSync(<View text="healthy" />, other);
    const failed = renderSync(<Crash />, own);
    const early = failed.waitUntilExit();
    try {
      if (phase === "effect") {
        await own.waitFor(() => own.screen()[0] === "ready");
        own.stdin.write("x");
      }
      await expect(early).rejects.toBe(failure);
      await expect(failed.waitUntilExit()).rejects.toBe(failure);
      await own.flush();
      restored(own);
      expect(other.stdin.isRaw).toBe(true);
      expect(other.terminal.buffer.active.type).toBe("alternate");
      const before = own.output();
      failed.rerender(<View text="late" />);
      own.stdin.write("late");
      own.resize(10, 4);
      await own.flush();
      healthy.rerender(<View text="still healthy" />);
      await other.waitFor(() => other.screen()[0] === "still healthy");
      expect(own.output()).toBe(before);
    } finally {
      await dispose(failed, own, failure);
      await dispose(healthy, other);
    }
  });
}

for (const persistent of [false, true]) {
  test(`${persistent ? "persistent" : "recovering"} paint IO failure settles owning exit and detaches its input`, async () => {
    const own = createTerminal(),
      other = createTerminal();
    const failure = new Error("write failed");
    const original = own.stdout.write.bind(own.stdout);
    let broken = false;
    const attempts: string[] = [];
    own.stdout.write = (
      chunk: string | Uint8Array,
      encoding?: BufferEncoding | ((error: Error | null | undefined) => void),
      callback?: (error: Error | null | undefined) => void,
    ) => {
      if (broken) {
        attempts.push(chunk.toString());
        if (!persistent) broken = false;
        throw failure;
      }
      return typeof encoding === "string"
        ? original(chunk, encoding, callback)
        : original(chunk, encoding);
    };
    const healthy = renderSync(<View text="healthy" />, other);
    const failed = renderSync(<View />, own);
    try {
      await own.waitFor(() => own.screen()[0] === "ready");
      await other.waitFor(() => other.screen()[0] === "healthy");
      const early = failed.waitUntilExit();
      broken = true;
      failed.rerender(<View text="broken" />);
      await expect(early).rejects.toBe(failure);
      await expect(failed.waitUntilExit()).rejects.toBe(failure);
      expect(own.stdin.isRaw).toBe(false);
      expect(own.stdin.listenerCount("readable")).toBe(0);
      if (persistent) {
        expect(attempts.join("")).toContain("\x1b[?1049l");
        expect(attempts.join("")).toContain("\x1b[?2004l");
        expect(attempts.join("")).toContain("\x1b[?25h");
      }
      // A broken physical stream cannot accept restore bytes; resource restoration still completes.
      broken = false;
      await own.flush();
      if (!persistent) restored(own);
      const before = own.output();
      failed.rerender(<View text="late" />);
      own.stdin.write("late");
      own.resize(10, 4);
      await own.flush();
      expect(own.output()).toBe(before);
      healthy.rerender(<View text="still healthy" />);
      await other.waitFor(() => other.screen()[0] === "still healthy");
      expect(other.stdin.isRaw).toBe(true);
    } finally {
      broken = false;
      await dispose(failed, own, failure);
      await dispose(healthy, other);
    }
  });
}

test("an IO failure while enabling terminal modes restores input and rejects exit", async () => {
  const terminal = createTerminal();
  const failure = new Error("enable write failed");
  const original = terminal.stdout.write.bind(terminal.stdout);
  let first = true;
  terminal.stdout.write = (
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error: Error | null | undefined) => void),
    callback?: (error: Error | null | undefined) => void,
  ) => {
    if (first) {
      first = false;
      throw failure;
    }
    return typeof encoding === "string"
      ? original(chunk, encoding, callback)
      : original(chunk, encoding);
  };
  const errors: unknown[][] = [];
  const warn = spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args);
  });
  const app = renderSync(<View />, terminal);
  try {
    await expect(app.waitUntilExit()).rejects.toBe(failure);
    await terminal.flush();
    restored(terminal);
    expect(errors).toEqual([]);
  } finally {
    await dispose(app, terminal, failure);
    warn.mockRestore();
  }
});

test("unmount leaves an already-raw stdin untouched when no input consumer borrowed it", async () => {
  const terminal = createTerminal();
  terminal.stdin.setRawMode(true);
  const app = renderSync(
    <AlternateScreen>
      <Text>ready</Text>
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    app.unmount();
    await app.waitUntilExit();
    expect(terminal.stdin.isRaw).toBe(true);
  } finally {
    await dispose(app, terminal);
  }
});

for (const mode of ["exit", "SIGINT", "SIGTERM", "uncaught"] as const) {
  // A parent virtual clock cannot deliver OS signals or advance a child process's lifecycle.
  test(`actual child ${mode} restores both injected roots and preserves frontend signal ownership`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "ink-process-lifecycle-"));
    const trace = join(directory, "trace");
    const script = join(directory, "child.tsx");
    const react = Bun.resolveSync("react", import.meta.dir);
    const ink = new URL("../../../src/ink/index.ts", import.meta.url).pathname;
    const helper = new URL("../helpers/terminal.ts", import.meta.url).pathname;
    await writeFile(
      script,
      `
import React from ${JSON.stringify(react)};
import {appendFileSync} from "node:fs";
import {AlternateScreen,Text,useInput,renderSync} from ${JSON.stringify(ink)};
import {createTerminal} from ${JSON.stringify(helper)};
const trace=${JSON.stringify(trace)};
const terminals=[createTerminal(),createTerminal()];
for(const [index,t] of terminals.entries()){
 const write=t.stdout.write.bind(t.stdout),raw=t.stdin.setRawMode.bind(t.stdin);
 t.stdout.write=(...args)=>{appendFileSync(trace,JSON.stringify({index,write:String(args[0])})+"\\n");return write(...args);};
 t.stdin.setRawMode=value=>{appendFileSync(trace,JSON.stringify({index,raw:value})+"\\n");return raw(value);};
}
function View({text}){useInput(()=>{});return <AlternateScreen><Text>{text}</Text></AlternateScreen>;}
const apps=terminals.map((t,index)=>renderSync(<View text={"root"+index}/>,t));
for(const [index,t] of terminals.entries())await t.waitFor(()=>t.screen()[0]==="root"+index);
for(const [signal,code] of [["SIGINT",130],["SIGTERM",143]])process.on(signal,()=>{appendFileSync(trace,JSON.stringify({handled:signal})+"\\n");process.exit(code);});
process.on("exit",()=>appendFileSync(trace,JSON.stringify({exitObserved:true})+"\\n"));
process.stdin.once("data",()=>{if(${JSON.stringify(mode)}==="uncaught")throw new Error("actual child crash");process.exit(0);});
process.stdin.resume();process.stdout.write("READY\\n");
`,
    );
    const child = Bun.spawn([process.execPath, script], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const ready = Promise.withResolvers<void>();
    // Only bounds the actual isolated process; parent virtual clocks cannot
    // supply its signal/uncaught-exit or terminal restoration contract.
    const deadline = ioTimeout(() => {
      ready.reject(new Error(`child lifecycle ${mode} exceeded its completion bound`));
      if (child.exitCode === null) child.kill("SIGKILL");
    }, 2000);
    const readOutput = (async () => {
      const reader = child.stdout.getReader();
      let output = "";
      const decoder = new TextDecoder();
      for (;;) {
        const part = await reader.read();
        if (part.done) return output;
        output += decoder.decode(part.value, { stream: true });
        if (output.includes("READY")) ready.resolve();
      }
    })();
    const stderr = new Response(child.stderr).text();
    try {
      await Promise.race([
        ready.promise,
        child.exited.then((code) => {
          throw new Error(`child exited before readiness: ${code}`);
        }),
      ]);
      if (mode === "SIGINT" || mode === "SIGTERM") child.kill(mode);
      else {
        child.stdin.write("exit\n");
        child.stdin.end();
      }
      const code = await child.exited;
      await readOutput;
      const errors = await stderr;
      expect(code).toBe(
        mode === "SIGINT" ? 130 : mode === "SIGTERM" ? 143 : mode === "uncaught" ? 7 : 0,
      );
      if (mode === "uncaught") expect(errors).toContain("actual child crash");
      const records: unknown[] = (await readFile(trace, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      for (const index of [0, 1]) {
        const writes: string[] = [];
        const raw: boolean[] = [];
        for (const record of records) {
          if (
            typeof record !== "object" ||
            record === null ||
            !("index" in record) ||
            record.index !== index
          )
            continue;
          if ("write" in record && typeof record.write === "string") writes.push(record.write);
          if ("raw" in record && typeof record.raw === "boolean") raw.push(record.raw);
        }
        expect(raw[0]).toBe(true);
        expect(raw.at(-1)).toBe(false);
        const output = writes.join("");
        for (const [enabled, disabled] of [
          ["?1049h", "?1049l"],
          ["?2004h", "?2004l"],
          ["?25l", "?25h"],
        ])
          expect(output.lastIndexOf(disabled!)).toBeGreaterThan(output.lastIndexOf(enabled!));
      }
      expect(records).toContainEqual({ exitObserved: true });
      if (mode === "SIGINT" || mode === "SIGTERM")
        expect(records).toContainEqual({ handled: mode });
    } finally {
      clearIoTimeout(deadline);
      if (child.exitCode === null) child.kill("SIGKILL");
      await child.exited;
      await rm(directory, { recursive: true, force: true });
    }
  }, 5000);
}

test("a deferred alternate-screen hover failure rejects only its owning root", async () => {
  const own = createTerminal(),
    other = createTerminal();
  const failure = new Error("deferred leave failed");
  let entered = false;
  function Screen() {
    const [alternate, setAlternate] = useState(true);
    useInput((input) => {
      if (input === "m") setAlternate(false);
    });
    return (
      <>
        <Box
          width={12}
          height={2}
          onMouseEnter={() => {
            entered = true;
          }}
          onMouseLeave={() => {
            throw failure;
          }}
        >
          <Text>leave-ready</Text>
        </Box>
        {alternate && <AlternateScreen />}
      </>
    );
  }
  const failed = renderSync(<Screen />, own),
    healthy = renderSync(<View text="healthy" />, other);
  try {
    await own.waitFor(() => own.screen()[0] === "leave-ready");
    own.stdin.write("\x1b[<35;2;1M");
    await own.waitFor(() => entered);
    const early = failed.waitUntilExit();
    own.stdin.write("m");
    await expect(early).rejects.toBe(failure);
    await expect(failed.waitUntilExit()).rejects.toBe(failure);
    await own.flush();
    restored(own);
    healthy.rerender(<View text="still healthy" />);
    await other.waitFor(() => other.screen()[0] === "still healthy");
    expect(other.stdin.isRaw).toBe(true);
  } finally {
    await dispose(failed, own, failure);
    await dispose(healthy, other);
  }
}, 1500);

test("alternate exit settles held component drag after commit without an insertion warning", async () => {
  const terminal = createTerminal();
  const errors: unknown[][] = [];
  let ends = 0;
  const error = spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args);
  });
  function Screen() {
    const [alternate, setAlternate] = useState(true);
    const [dragging, setDragging] = useState(false);
    useInput((input) => {
      if (input === "m") setAlternate(false);
    });
    return (
      <>
        <Box
          width={12}
          height={2}
          onDragStart={() => setDragging(true)}
          onDragEnd={() => {
            ends++;
            setDragging(false);
          }}
        >
          <Text>{dragging ? "dragging" : "idle"}</Text>
        </Box>
        {alternate && <AlternateScreen />}
      </>
    );
  }
  const app = renderSync(<Screen />, terminal);
  try {
    await terminal.waitFor(() => terminal.screen()[0] === "idle");
    terminal.stdin.write("\x1b[<0;2;1M\x1b[<32;4;1M");
    await terminal.waitFor(() => terminal.screen()[0] === "dragging");
    terminal.stdin.write("m");
    await terminal.waitFor(
      () => terminal.terminal.buffer.active.type === "normal" && terminal.screen().includes("idle"),
    );
    expect(ends).toBe(1);
    expect(errors.flat().some((value) => String(value).includes("useInsertionEffect"))).toBe(false);
    terminal.stdin.write("\x1b[<0;4;1m");
    await terminal.flush();
    expect(ends).toBe(1);
  } finally {
    await dispose(app, terminal);
    error.mockRestore();
  }
});
