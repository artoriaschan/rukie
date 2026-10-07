import { expect, test } from "bun:test";
import { useState } from "react";
import {
  AlternateScreen,
  Box,
  Text,
  renderSync,
  useSelection,
  useInput,
  useApp,
} from "../../../src/ink/index.ts";
import { createTerminal } from "../helpers/terminal";
import { testClock } from "../helpers/test-clock";

test("a root reads its own validated selection without native clipboard side effects", async () => {
  const terminal = createTerminal(20, 8);
  let selection: ReturnType<typeof useSelection> | undefined;
  function Content({ text }: { text: string }) {
    selection = useSelection();
    useInput(() => {});
    return <Text>{text}</Text>;
  }
  const app = renderSync(
    <AlternateScreen>
      <Content text="Alpha" />
    </AlternateScreen>,
    { ...terminal, patchConsole: false, exitOnCtrlC: false },
  );
  try {
    await terminal.waitFor(() => terminal.screen()[0] === "Alpha");
    terminal.stdin.write("\x1b[<0;1;1M\x1b[<32;5;1M\x1b[<0;5;1m");
    await terminal.waitFor(() => selection?.hasSelection() === true);
    expect(selection?.readSelectionText()).toBe("Alpha");
    expect(terminal.output()).not.toContain("\x1b]52;");
    app.rerender(
      <AlternateScreen>
        <Content text="Other" />
      </AlternateScreen>,
    );
    await terminal.waitFor(() => terminal.screen()[0] === "Other");
    expect(selection?.getState()?.stale).toBe(true);
    expect(selection?.readSelectionText()).toBe("");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("a scheduled paint failure rejects early and late waiters and restores only its terminal", async () => {
  const first = createTerminal(20, 8);
  const second = createTerminal(20, 8);
  const failure = new Error("scheduled paint failed");
  let fail = false;
  const originalWrite = first.stdout.write.bind(first.stdout);
  first.stdout.write = (
    chunk: string | Uint8Array,
    encoding?: BufferEncoding | ((error: Error | null | undefined) => void),
    callback?: (error: Error | null | undefined) => void,
  ) => {
    if (fail) {
      fail = false;
      throw failure;
    }
    return typeof encoding === "string"
      ? originalWrite(chunk, encoding, callback)
      : originalWrite(chunk, encoding);
  };
  function Content({ text }: { text: string }) {
    useInput(() => {});
    return <Text>{text}</Text>;
  }
  const tree = (text: string) => (
    <AlternateScreen>
      <Content text={text} />
    </AlternateScreen>
  );
  const a = renderSync(tree("first"), { ...first, patchConsole: false, exitOnCtrlC: false });
  const b = renderSync(tree("second"), { ...second, patchConsole: false, exitOnCtrlC: false });
  try {
    await first.waitFor(() => first.screen()[0] === "first");
    await second.waitFor(() => second.screen()[0] === "second");
    const exit = a.waitUntilExit();
    fail = true;
    a.rerender(tree("broken"));
    await expect(exit).rejects.toBe(failure);
    await expect(a.waitUntilExit()).rejects.toBe(failure);
    await first.flush();
    expect(first.stdin.isRaw).toBe(false);
    expect(first.output()).toContain("\x1b[?1049l");
    expect(second.stdin.isRaw).toBe(true);
    expect(second.output()).not.toContain("\x1b[?1049l");
    const disposedOutput = first.output();
    b.rerender(tree("healthy"));
    await second.waitFor(() => second.screen()[0] === "healthy");
    expect(first.output()).toBe(disposedOutput);
  } finally {
    a.unmount();
    b.unmount();
    a.cleanup();
    b.cleanup();
    first.dispose();
    second.dispose();
  }
});

test("wide cell tails admit whole glyphs and guard their owner text against replacement", async () => {
  const terminal = createTerminal(30, 8);
  let selection: ReturnType<typeof useSelection> | undefined;
  function Content({ replacement = false }: { replacement?: boolean }) {
    selection = useSelection();
    useInput(() => {});
    return (
      <Box>
        <Box width={2} noSelect flexShrink={0}>
          <Text>⏺</Text>
        </Box>
        <Text>{replacement ? "A国文🐋B" : "A中文🐋B"}</Text>
      </Box>
    );
  }
  const tree = (replacement = false) => (
    <AlternateScreen>
      <Content replacement={replacement} />
    </AlternateScreen>
  );
  const app = renderSync(tree(), {
    ...terminal,
    patchConsole: false,
    exitOnCtrlC: false,
    selectionIncludeNoSelectCells: false,
  });
  try {
    await terminal.waitFor(() => terminal.screen()[0] === "⏺ A中文🐋B");
    terminal.stdin.write("\x1b[<0;5;1M\x1b[<32;9;1M");
    await terminal.waitFor(() => selection?.hasSelection() === true);
    expect(selection!.readSelectionText()).toBe("中文🐋");
    const line = terminal.terminal.buffer.active.getLine(0)!;
    expect(line.getCell(3)!.isInverse()).toBeTruthy();
    expect(line.getCell(4)!.isInverse()).toBeTruthy();
    app.rerender(tree(true));
    await terminal.waitFor(() => terminal.screen()[0] === "⏺ A国文🐋B");
    expect(selection!.getState()?.stale).toBe(true);
    expect(selection!.readSelectionText()).toBe("");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("terminal resize cancels a held selection without publishing a completed gesture", async () => {
  const terminal = createTerminal(30, 8);
  let selection: ReturnType<typeof useSelection> | undefined;
  let completed = 0;
  function Content() {
    selection = useSelection();
    useInput(() => {});
    return <Text>resize selection</Text>;
  }
  const app = renderSync(
    <AlternateScreen>
      <Content />
    </AlternateScreen>,
    { ...terminal, patchConsole: false, exitOnCtrlC: false },
  );
  try {
    await terminal.waitFor(() => terminal.screen()[0] === "resize selection");
    const unsubscribe = selection!.subscribe(() => {
      const state = selection!.getState();
      if (state?.anchor && !state.isDragging) completed++;
    });
    try {
      terminal.stdin.write("\x1b[<0;1;1M\x1b[<32;7;1M");
      await terminal.waitFor(() => selection!.getState()?.isDragging === true);
      terminal.resize(31, 8);
      expect(selection!.hasSelection()).toBe(false);
      terminal.stdin.write("\x1b[<0;7;1m");
      await terminal.flush();
      expect(completed).toBe(0);
      expect(terminal.output()).not.toContain("\x1b]52;");
    } finally {
      unsubscribe();
    }
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("a handoff quarantine belongs to its root through the deadline and clock restoration", async () => {
  testClock.useFakeTimers();
  const first = createTerminal(20, 8),
    second = createTerminal(20, 8);
  let renderer: ReturnType<typeof useApp>["renderer"];
  const inputs: string[] = [];
  function Content({ owner }: { owner: string }) {
    const app = useApp();
    if (owner === "first") renderer = app.renderer;
    useInput((input) => inputs.push(owner + ":" + input));
    return <Text>{owner}</Text>;
  }
  const tree = (owner: string) => (
    <AlternateScreen>
      <Content owner={owner} />
    </AlternateScreen>
  );
  const a = renderSync(tree("first"), { ...first, patchConsole: false, exitOnCtrlC: false });
  const b = renderSync(tree("second"), { ...second, patchConsole: false, exitOnCtrlC: false });
  try {
    await first.flush();
    await second.flush();
    renderer!.exitAlternateScreen();
    testClock.advanceTimersByTime(119);
    first.stdin.write("a");
    second.stdin.write("b");
    await second.flush();
    await first.flush();
    expect(inputs).toEqual(["second:b"]);
    testClock.advanceTimersByTime(1);
    first.stdin.write("c");
    await first.flush();
    expect(inputs).toEqual(["second:b", "first:c"]);
    // Advance far enough that a process-global deadline would outlive restored wall time.
    testClock.advanceTimersByTime(10000);
    renderer!.exitAlternateScreen();
  } finally {
    a.unmount();
    await a.waitUntilExit();
    a.cleanup();
    first.dispose();
    b.unmount();
    await b.waitUntilExit();
    b.cleanup();
    second.dispose();
    testClock.useRealTimers();
  }
  const third = createTerminal(20, 8);
  const c = renderSync(tree("third"), { ...third, patchConsole: false, exitOnCtrlC: false });
  try {
    await third.flush();
    third.stdin.write("d");
    await third.flush();
    expect(inputs).toEqual(["second:b", "first:c", "third:d"]);
  } finally {
    c.unmount();
    await c.waitUntilExit();
    c.cleanup();
    third.dispose();
  }
});

test("Shift keys extend a fresh pointer anchor before its first motion", async () => {
  const terminal = createTerminal(20, 8);
  let selection: ReturnType<typeof useSelection> | undefined;
  function Content() {
    selection = useSelection();
    useInput((_input, key) => {
      if (key.shift && key.rightArrow) selection!.moveFocus("right");
    });
    return <Text>Alpha beta</Text>;
  }
  const app = renderSync(
    <AlternateScreen>
      <Content />
    </AlternateScreen>,
    { ...terminal, patchConsole: false, exitOnCtrlC: false },
  );
  try {
    await terminal.waitFor(() => terminal.screen()[0] === "Alpha beta");
    terminal.stdin.write("\x1b[<0;1;1M\x1b[1;2C\x1b[1;2C");
    await terminal.flush();
    expect(selection!.readSelectionText()).toBe("Alp");
    expect(selection!.getState()?.isDragging).toBe(true);
    terminal.stdin.write("\x1b[<0;3;1m");
    await terminal.flush();
    expect(selection!.readSelectionText()).toBe("Alp");
    expect(selection!.getState()?.isDragging).toBe(false);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test.each(["keyboard", "owner", "geometry"] as const)(
  "click chains restart after %s changes while stable text keeps native multi-clicks",
  async (change) => {
    const terminal = createTerminal(20, 8);
    let clicks = 0;
    function Content() {
      useInput(() => {});
      const [open, setOpen] = useState(false);
      const activate = () => {
        clicks++;
        if (change === "geometry") setOpen((value) => !value);
      };
      return (
        <Box flexDirection="column">
          <Box
            flexDirection="column"
            height={change === "geometry" && open ? 2 : 1}
            flexShrink={0}
            onClick={activate}
          >
            <Text>first</Text>
            {change === "geometry" && open && <Text>expanded</Text>}
          </Box>
          {change === "owner" && (
            <Box flexShrink={0} onClick={() => clicks++}>
              <Text>second</Text>
            </Box>
          )}
        </Box>
      );
    }
    const app = renderSync(
      <AlternateScreen>
        <Content />
      </AlternateScreen>,
      { ...terminal, patchConsole: false, exitOnCtrlC: false },
    );
    try {
      await terminal.waitFor(() => terminal.screen()[0] === "first");
      terminal.stdin.write("\x1b[<0;1;1M\x1b[<0;1;1m");
      await terminal.flush();
      expect(clicks).toBe(1);
      if (change === "keyboard") {
        terminal.stdin.write("a");
        await terminal.flush();
      }
      if (change === "geometry") await terminal.waitFor(() => terminal.screen()[1] === "expanded");
      const row = change === "keyboard" ? 1 : 2;
      terminal.stdin.write(`\x1b[<0;1;${row}M\x1b[<0;1;${row}m`);
      await terminal.flush();
      expect(clicks).toBe(2);
    } finally {
      app.unmount();
      await app.waitUntilExit();
      app.cleanup();
      terminal.dispose();
    }
  },
);
