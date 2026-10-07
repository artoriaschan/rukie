import { expect, test } from "bun:test";
import React, { useState } from "react";
import { PassThrough, Writable } from "node:stream";
import { Terminal } from "@xterm/headless";
import render from "./src/ink/root.js";
import Box from "./src/ink/components/Box.js";
import Text from "./src/ink/components/Text.js";
import ScrollBox from "./src/ink/components/ScrollBox.js";
import { AlternateScreen } from "./src/ink/components/AlternateScreen.js";
import useInput from "./src/ink/hooks/use-input.js";

// Public seam: injected streams -> render(Box/Text/ScrollBox/useInput) -> xterm cells.
// xterm write callbacks and render onFrame acknowledge completion; timeout only bounds failure.
test("Bun paints a fullscreen frame and handles injected input", async () => {
  const terminal = new Terminal({ cols: 40, rows: 8, allowProposedApi: true });
  let pending = Promise.resolve();
  const stdout = Object.assign(
    new Writable({
      write(chunk, _encoding, callback) {
        pending = pending.then(
          () => new Promise<void>((resolve) => terminal.write(chunk.toString(), resolve)),
        );
        callback();
      },
    }),
    { isTTY: true, columns: 40, rows: 8 },
  );
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: false,
    ref() {
      return this;
    },
    unref() {
      return this;
    },
    setRawMode(raw: boolean) {
      this.isRaw = raw;
      return this;
    },
  });
  const frame = () =>
    Array.from(
      { length: 8 },
      (_, i) => terminal.buffer.active.getLine(i)?.translateToString(true) ?? "",
    ).join("\n");
  let acknowledge: (() => void) | undefined;
  function Screen() {
    const [input, setInput] = useState("ready");
    useInput((value) => setInput(value));
    return (
      <AlternateScreen>
        <Box flexDirection="column">
          <Text>Rukie Bun spike</Text>
          <ScrollBox height={3}>
            <Text>conversation</Text>
            <Text>second row</Text>
          </ScrollBox>
          <Text>input: {input}</Text>
        </Box>
      </AlternateScreen>
    );
  }
  const app = await render(<Screen />, {
    stdout: stdout as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    stderr: stdout as NodeJS.WriteStream,
    patchConsole: false,
    exitOnCtrlC: false,
    terminalImages: false,
    onFrame: () => acknowledge?.(),
  });
  const exited = app.waitUntilExit();
  try {
    await pending;
    expect(frame()).toContain("Rukie Bun spike");
    expect(frame()).toContain("conversation");
    expect(frame()).toContain("input: ready");
    const painted = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    stdin.write("x");
    await painted;
    await pending;
    expect(frame()).toContain("input: x");
    expect(stdin.isRaw).toBe(true);
  } finally {
    app.unmount();
    await exited;
    app.cleanup();
    await pending;
    expect(stdin.isRaw).toBe(false);
    terminal.dispose();
    stdin.destroy();
    stdout.destroy();
  }
}, 5000);

// Real worker boundary: parent clocks cannot replace worker_threads message/exit signals.
test("Bun sixel worker transfers RGBA, encodes pixels, and exits", async () => {
  const { Worker } = await import("node:worker_threads");
  const worker = new Worker(new URL("./src/ink/sixel-worker.js", import.meta.url), {
    execArgv: [],
  });
  try {
    const reply = new Promise<Record<string, unknown>>((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
    });
    const data = new Uint8Array([255, 0, 0, 255]);
    worker.postMessage(
      {
        assetKey: "red",
        request: {
          source: { width: 1, height: 1, data },
          width: 8,
          height: 16,
          background: "#000000",
          presentation: "transcript",
        },
      },
      [data.buffer],
    );
    const result = await reply;
    expect(result.error).toBeUndefined();
    expect(result.raster).toBeDefined();
    const raster = result.raster as { data: string; width: number; height: number };
    expect(raster.width).toBe(8);
    expect(raster.height).toBe(16);
    expect(raster.data).toContain("q");
  } finally {
    await worker.terminate();
  }
}, 5000);

test("Bun process default streams render and exit without a TTY", async () => {
  const child = Bun.spawn([process.execPath, "default-streams.tsx"], {
    cwd: import.meta.dir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [output, diagnostics, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(code).toBe(0);
  expect(output).toContain("default Bun streams");
  expect(diagnostics).toBe("");
}, 5000);
