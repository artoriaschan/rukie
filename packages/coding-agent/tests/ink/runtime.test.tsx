import { expect, test } from "bun:test";
import React, { useState, useRef } from "react";
import { PassThrough, Writable } from "node:stream";
import { Terminal } from "@xterm/headless";
import {
  render,
  renderSync,
  Box,
  Text,
  ScrollBox,
  AlternateScreen,
  useInput,
  useSelection,
  useSearchHighlight,
  useApp,
  type DOMElement,
} from "../../src/ink/index.ts";

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
    await app.waitUntilExit();
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
  const worker = new Worker(new URL("../../src/ink/sixel-worker.js", import.meta.url), {
    execArgv: [],
  });
  try {
    const reply = new Promise<unknown>((resolve, reject) => {
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
    if (typeof result !== "object" || result === null || !("raster" in result))
      throw new Error("worker returned no raster");
    const raster = result.raster;
    if (
      typeof raster !== "object" ||
      raster === null ||
      !("width" in raster) ||
      !("height" in raster) ||
      !("data" in raster) ||
      typeof raster.data !== "string"
    )
      throw new Error("worker returned invalid raster");
    expect("error" in result).toBe(false);
    expect(raster.width).toBe(8);
    expect(raster.height).toBe(16);
    expect(raster.data).toContain("q");
  } finally {
    await worker.terminate();
  }
}, 5000);

test("Bun process default streams render and exit without a TTY", async () => {
  const child = Bun.spawn([process.execPath, "../fixtures/runtime-default-streams.tsx"], {
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

// Distinct injected roots must own mode writes, selection, and search state.
test("independent roots bind selection/search and restore their own terminal", async () => {
  function terminalHost() {
    let output = "";
    const stdout = Object.assign(
      new Writable({
        write(chunk, _encoding, done) {
          output += chunk.toString();
          done();
        },
      }),
      { isTTY: true, columns: 30, rows: 6 },
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
    return {
      stdout,
      stdin,
      output: () => output,
      options: {
        stdout: stdout as NodeJS.WriteStream,
        stdin: stdin as unknown as NodeJS.ReadStream,
        stderr: stdout as NodeJS.WriteStream,
        patchConsole: false,
        exitOnCtrlC: false,
        terminalImages: false,
      },
    };
  }
  type Controls = {
    selection: ReturnType<typeof useSelection>;
    search: ReturnType<typeof useSearchHighlight>;
    element: () => DOMElement | null;
    exit: (error?: Error) => void;
    click: (column: number, row: number) => boolean;
  };
  const controls: Controls[] = [];
  const clicks = [0, 0];
  function Screen({ label, index }: { label: string; index: number }) {
    useInput(() => {});
    const ref = useRef<DOMElement>(null);
    const selection = useSelection();
    const search = useSearchHighlight();
    const { exit, renderer } = useApp();
    controls[index] = {
      selection,
      search,
      element: () => ref.current,
      exit,
      click: (column, row) => renderer?.dispatchClick(column, row) ?? false,
    };
    return (
      <AlternateScreen>
        <Box ref={ref} marginLeft={3} marginTop={1} width={10} height={1}>
          <Text>{label}</Text>
          <Box
            position="absolute"
            left={0}
            top={0}
            width={5}
            height={1}
            onClick={() => {
              clicks[index] = clicks[index]! + 1;
            }}
          />
        </Box>
      </AlternateScreen>
    );
  }
  const first = terminalHost();
  const second = terminalHost();
  const a = renderSync(<Screen label="alpha" index={0} />, first.options);
  const b = await render(<Screen label="beta" index={1} />, second.options);
  try {
    expect(controls[0]!.selection.getState()).not.toBeNull();
    expect(controls[1]!.selection.getState()).not.toBeNull();
    expect(controls[0]!.selection.getState()).not.toBe(controls[1]!.selection.getState());
    controls[0]!.search.setQuery("alpha");
    controls[1]!.search.setQuery("beta");
    expect(controls[0]!.search.scanElement(controls[0]!.element()!)).toHaveLength(1);
    expect(controls[1]!.search.scanElement(controls[1]!.element()!)).toHaveLength(1);
    expect(controls[0]!.search.scanElement(controls[1]!.element()!)).toHaveLength(0);
    expect(controls[1]!.search.scanElement(controls[0]!.element()!)).toHaveLength(0);
    // Scanning either root must preserve the painted pointer geometry before
    // another frame has a chance to repair it.
    expect(controls[0]!.click(3, 1)).toBe(true);
    expect(controls[1]!.click(3, 1)).toBe(true);
    expect(clicks).toEqual([1, 1]);
    const selected = new Promise<void>((resolve) => {
      const unsubscribe = controls[0]!.selection.subscribe(() => {
        if (controls[0]!.selection.hasSelection()) {
          unsubscribe();
          resolve();
        }
      });
    });
    first.stdin.write("\x1b[<0;4;2M\x1b[<32;8;2M\x1b[<0;8;2m");
    await selected;
    expect(controls[0]!.selection.copySelectionNoClear()).toBe("alpha");
    expect(controls[1]!.selection.hasSelection()).toBe(false);
    a.unmount();
    await a.waitUntilExit();
    expect(first.stdin.isRaw).toBe(false);
    expect(second.stdin.isRaw).toBe(true);
    expect(second.output()).not.toContain("\x1b[?1049l");
    expect(first.output()).toContain("\x1b[?1049l");
    const failure = new Error("public exit failure");
    const beforeExit = b.waitUntilExit();
    controls[1]!.exit(failure);
    await expect(beforeExit).rejects.toBe(failure);
    await expect(b.waitUntilExit()).rejects.toBe(failure);
    expect(second.output()).toContain("\x1b[?1049l");
  } finally {
    a.unmount();
    b.unmount();
    a.cleanup();
    b.cleanup();
    first.stdin.destroy();
    second.stdin.destroy();
    first.stdout.destroy();
    second.stdout.destroy();
  }
}, 5000);
