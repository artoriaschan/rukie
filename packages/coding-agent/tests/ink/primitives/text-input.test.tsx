import { testClock } from "../../tui/helpers/test-clock";
import { expect, test } from "bun:test";
import { useLayoutEffect, useState } from "react";
import {
  AlternateScreen,
  Box,
  Text,
  TextInput,
  createTextInputHistory,
  renderSync as render,
} from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

test("history walks only past the editor edges and restores the draft caret", async () => {
  const terminal = createTerminal(6, 8);
  const submissions: string[] = [];
  const history = createTextInputHistory(["older", "中文👩‍💻"]);
  function View() {
    const [value, setValue] = useState("中A\nsecond");
    return (
      <TextInput
        value={value}
        onChange={setValue}
        history={history}
        onSubmit={(text) => submissions.push(text)}
      />
    );
  }
  const app = render(
    <AlternateScreen>
      <View />
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    terminal.stdin.write("\x1b[H\x1b[A");
    await terminal.waitFor(() => terminal.cursor().y === 0);
    expect(terminal.screen().slice(0, 2)).toEqual(["中A", "second"]);
    terminal.stdin.write("\x1b[A");
    await terminal.waitFor(() => terminal.screen()[0] === "中文👩‍💻");
    expect(terminal.cursor()).toEqual({ x: 0, y: 1 });
    // The wrapped caret row still belongs to the recalled input.
    terminal.stdin.write("\x1b[A");
    await terminal.waitFor(() => terminal.cursor().y === 0);
    expect(terminal.screen()[0]).toBe("中文👩‍💻");
    terminal.stdin.write("\x1b[A");
    await terminal.waitFor(() => terminal.screen()[0] === "older");
    terminal.stdin.write("\x1b[B");
    await terminal.waitFor(() => terminal.screen()[0] === "中文👩‍💻");
    terminal.stdin.write("\x1b[B");
    await terminal.waitFor(() => terminal.screen()[1] === "second");
    expect(terminal.cursor()).toEqual({ x: 0, y: 0 });
    terminal.stdin.write("!\r");
    await terminal.waitFor(() => submissions.length > 0);
    expect(submissions).toEqual(["!中A\nsecond"]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("controlled input edits Chinese text and positions the terminal cursor in display columns", async () => {
  const terminal = createTerminal(12, 6);
  const changes: string[] = [];
  const submissions: string[] = [];
  function View() {
    const [value, setValue] = useState("");
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text>Prompt</Text>
        <TextInput
          value={value}
          onChange={(next) => {
            changes.push(next);
            setValue(next);
          }}
          onSubmit={(text) => submissions.push(text)}
        />
      </Box>
    );
  }
  const app = render(
    <AlternateScreen>
      <View />
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    await terminal.waitFor(() => terminal.cursor().x === 1 && terminal.cursor().y === 1);
    expect(terminal.cursor()).toEqual({ x: 1, y: 1 });
    terminal.stdin.write("中文A");
    await terminal.waitFor(() => terminal.screen()[1] === " 中文A");
    expect(changes).toEqual(["中文A"]);
    expect(terminal.cursor()).toEqual({ x: 6, y: 1 });
    terminal.stdin.write("\x1b[D\x7f");
    await terminal.waitFor(() => terminal.screen()[1] === " 中A");
    expect(terminal.cursor()).toEqual({ x: 3, y: 1 });
    terminal.stdin.write("\x1b[3~");
    await terminal.waitFor(() => terminal.screen()[1] === " 中");
    expect(terminal.cursor()).toEqual({ x: 3, y: 1 });
    terminal.stdin.write("\r");
    await terminal.waitFor(() => submissions.length > 0);
    expect(submissions).toEqual(["中"]);
    expect(changes.at(-1)).toBe("中");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("wrapped whitespace and graphemes keep cursor movement and deletion aligned after resize", async () => {
  const terminal = createTerminal(6, 6);
  function View() {
    const [value, setValue] = useState("中  AB");
    return <TextInput value={value} onChange={setValue} />;
  }
  const app = render(
    <AlternateScreen>
      <View />
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["中  AB", "", "", "", "", ""]);
    expect(terminal.cursor()).toEqual({ x: 0, y: 1 });
    terminal.stdin.write("\x1b[D");
    await terminal.waitFor(() => terminal.cursor().x === 5);
    expect(terminal.cursor()).toEqual({ x: 5, y: 0 });
    terminal.resize(4, 6);
    await terminal.waitFor(() => terminal.cursor().x === 1 && terminal.cursor().y === 1);
    expect(terminal.screen()).toEqual(["中", "AB", "", "", "", ""]);
    expect(terminal.cursor()).toEqual({ x: 1, y: 1 });
    terminal.stdin.write("é👩‍💻");
    await terminal.waitFor(() => terminal.screen()[1] === "Aé👩‍💻");
    expect(terminal.cursor()).toEqual({ x: 0, y: 2 });
    terminal.stdin.write("\x1b[D\x7f");
    await terminal.waitFor(() => terminal.screen()[1] === "A👩‍💻B");
    expect(terminal.cursor()).toEqual({ x: 1, y: 1 });
    terminal.stdin.write("\x1b[3~");
    await terminal.waitFor(() => terminal.screen()[1] === "AB");
    expect(terminal.cursor()).toEqual({ x: 1, y: 1 });
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("an external value reset remains controlled and inactive inputs ignore stdin", async () => {
  const terminal = createTerminal();
  let reset = () => {};
  function View() {
    const [value, setValue] = useState("original");
    const [active, setActive] = useState(true);
    useLayoutEffect(() => {
      reset = () => {
        setValue("");
        setActive(false);
      };
    }, []);
    return <TextInput value={value} onChange={setValue} isActive={active} />;
  }
  const app = render(
    <AlternateScreen>
      <View />
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    reset();
    await terminal.waitFor(() => terminal.screen()[0] === "");
    terminal.stdin.write("ignored\r");
    await terminal.flush();
    expect(terminal.screen()[0]).toBe("");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("external controlled replacement snaps the cursor to a grapheme boundary before deletion", async () => {
  const terminal = createTerminal(12, 5);
  const changes: string[] = [];
  let replace = () => {};
  function View() {
    const [value, setValue] = useState("abc");
    useLayoutEffect(() => {
      replace = () => setValue("é👩‍💻");
    }, []);
    return (
      <TextInput
        value={value}
        onChange={(next) => {
          changes.push(next);
          setValue(next);
        }}
      />
    );
  }
  const app = render(
    <AlternateScreen>
      <View />
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    replace();
    await terminal.waitFor(() => terminal.screen()[0] === "é👩‍💻");
    terminal.stdin.write("\x7f");
    await terminal.waitFor(() => terminal.cursor().x === 0);
    expect(changes).toEqual(["👩‍💻"]);
    expect(terminal.cursor()).toEqual({ x: 0, y: 0 });
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("narrow resize omits overwide glyphs consistently for both text and cursor", async () => {
  const terminal = createTerminal(6, 6);
  const app = render(
    <AlternateScreen>
      <TextInput value="中A" onChange={() => {}} />
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    terminal.resize(1, 6);
    await terminal.waitFor(() => terminal.screen()[0] === "A");
    expect(terminal.screen()).toEqual(["A", "", "", "", "", ""]);
    expect(terminal.cursor()).toEqual({ x: 0, y: 1 });
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("the cursor remains visible before an explicit newline following a full Chinese line", async () => {
  const terminal = createTerminal(4, 5);
  const app = render(
    <AlternateScreen>
      <TextInput value={"中文\nA"} onChange={() => {}} />
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    terminal.stdin.write("\x1b[D\x1b[D");
    await terminal.waitFor(() => terminal.cursor().x === 0 && terminal.cursor().y === 1);
    expect(terminal.screen()).toEqual(["中文", "A", "", "", ""]);
    expect(terminal.cursor()).toEqual({ x: 0, y: 1 });
    // Native runtime parks the IME cursor; product block caret is painted separately.
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("a block caret follows wide graphemes and empty lines and clears when inactive", async () => {
  const terminal = createTerminal(4, 5);
  let deactivate = () => {};
  function View() {
    const [active, setActive] = useState(true);
    useLayoutEffect(() => {
      deactivate = () => setActive(false);
    }, []);
    return (
      <TextInput value={"中文\n\nA"} onChange={() => {}} cursorStyle="block" isActive={active} />
    );
  }
  const app = render(
    <AlternateScreen>
      <View />
    </AlternateScreen>,
    terminal,
  );
  const cell = (x: number, y: number) => terminal.terminal.buffer.active.getLine(y)!.getCell(x)!;
  try {
    await terminal.flush();
    expect(cell(1, 2).isInverse()).toBeTruthy();
    terminal.stdin.write("\x1b[H\x1b[A");
    await terminal.waitFor(() => terminal.cursor().y === 1);
    expect(cell(0, 1).isInverse()).toBeTruthy();
    expect(cell(1, 2).isInverse()).toBeFalsy();
    terminal.stdin.write("\x1b[A");
    await terminal.waitFor(() => terminal.cursor().y === 0);
    expect(cell(0, 0).isInverse()).toBeTruthy();
    expect(cell(1, 0).isInverse()).toBeTruthy();
    expect(cell(0, 1).isInverse()).toBeFalsy();
    deactivate();
    await terminal.waitFor(() => !cell(0, 0).isInverse());
    expect(terminal.screen()).toEqual(["中文", "", "A", "", ""]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("Shift+Enter and a backslash at line end insert newlines, while a paste changes the value once", async () => {
  const terminal = createTerminal(12, 7);
  const changes: string[] = [];
  const submissions: string[] = [];
  function View() {
    const [value, setValue] = useState("");
    return (
      <TextInput
        value={value}
        onChange={(next) => {
          changes.push(next);
          setValue(next);
        }}
        onSubmit={(text) => submissions.push(text)}
      />
    );
  }
  const app = render(
    <AlternateScreen>
      <View />
    </AlternateScreen>,
    terminal,
  );
  try {
    terminal.stdin.write("one\x1b[13;2u中\\\rtwo");
    await terminal.waitFor(() => terminal.screen()[2] === "two");
    expect(changes.at(-1)).toBe("one\n中\ntwo");
    expect(submissions).toEqual([]);
    expect(terminal.cursor()).toEqual({ x: 3, y: 2 });
    const beforePaste = changes.length;
    terminal.stdin.write("\x1b[200~\n  A\r\n中文\x1b[201~");
    await terminal.waitFor(() => terminal.screen()[4] === "中文");
    expect(changes.slice(beforePaste)).toEqual(["one\n中\ntwo\n  A\n中文"]);
    expect(terminal.screen()).toEqual(["one", "中", "two", "  A", "中文", "", ""]);
    expect(terminal.cursor()).toEqual({ x: 4, y: 4 });
    terminal.stdin.write("\r");
    await terminal.waitFor(() => submissions.length > 0);
    expect(submissions).toEqual(["one\n中\ntwo\n  A\n中文"]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("a screen-owned read-only editor paints the supplied grapheme caret without handling stdin", async () => {
  const terminal = createTerminal(12, 5);
  const changes: string[] = [];
  const submissions: string[] = [];
  let move = () => {};
  function View() {
    const [cursor, setCursor] = useState(2);
    useLayoutEffect(() => {
      move = () => setCursor(4);
    }, []);
    return (
      <TextInput
        value="中é👩‍💻A"
        onChange={(text) => changes.push(text)}
        onSubmit={(text) => submissions.push(text)}
        readOnly
        cursorOffset={cursor}
        cursorStyle="block"
      />
    );
  }
  const app = render(
    <AlternateScreen>
      <View />
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    // Offset 2 lies inside e + combining accent and must snap before that grapheme.
    expect(terminal.cursor()).toEqual({ x: 2, y: 0 });
    const cell = (x: number) => terminal.terminal.buffer.active.getLine(0)!.getCell(x)!;
    expect(cell(2).isInverse()).toBeTruthy();
    terminal.stdin.write("ignored\x1b[200~pasted\x1b[201~\x7f\r");
    await terminal.flush();
    expect(changes).toEqual([]);
    expect(submissions).toEqual([]);
    expect(terminal.screen()[0]).toBe("中é👩‍💻A");
    move();
    await terminal.waitFor(() => terminal.cursor().x === 3);
    expect(cell(3).isInverse()).toBeTruthy();
    expect(cell(4).isInverse()).toBeTruthy();
    expect(cell(2).isInverse()).toBeFalsy();
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("atomic units wrap together, activate only admitted glyphs, and shifted replacement reports the entire edit", async () => {
  const terminal = createTerminal(12, 6);
  const clicks: number[] = [];
  const edits: { start: number; end: number; text: string }[] = [];
  let draft = "a [image 1] z";
  function View() {
    const [value, setValue] = useState(draft);
    return (
      <TextInput
        value={value}
        atomicRanges={value.includes("[image 1]") ? [{ start: 2, end: 11 }] : []}
        onAtomicRangeClick={(offset) => clicks.push(offset)}
        onChange={(next, edit) => {
          draft = next;
          setValue(next);
          if (edit) edits.push(edit);
        }}
      />
    );
  }
  const app = render(
    <AlternateScreen>
      <View />
    </AlternateScreen>,
    terminal,
  );
  const click = (x: number, y: number) =>
    terminal.stdin.write(`\x1b[<0;${x + 1};${y + 1}M\x1b[<0;${x + 1};${y + 1}m`);
  try {
    await terminal.waitFor(() => terminal.screen()[0] === "a [image 1]");
    click(5, 0); // Internal atomic whitespace is an admitted hit.
    await terminal.waitFor(() => clicks.length === 1);
    expect(clicks).toEqual([2]);
    expect(terminal.cursor()).toEqual({ x: 2, y: 0 });
    click(0, 0);
    click(11, 0);
    await terminal.flush();
    expect(clicks).toEqual([2]);
    terminal.resize(10, 6);
    await terminal.waitFor(() => terminal.screen()[1] === "[image 1]");
    expect(terminal.screen()[0]).toBe("a");
    click(4, 1);
    await terminal.waitFor(() => clicks.length === 2);
    expect(terminal.cursor()).toEqual({ x: 0, y: 1 });
    terminal.stdin.write("\x1b[1;2C!");
    await terminal.waitFor(() => draft === "a ! z");
    expect(edits).toEqual([{ start: 2, end: 11, text: "!" }]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("asynchronous admitted paste inserts once at the live grapheme caret with normalized line endings", async () => {
  const terminal = createTerminal(12, 6);
  let accept!: (text: string) => void;
  let pasted = "";
  let caret = 0;
  const changes: string[] = [];
  const admitted = new Promise<string>((resolve) => {
    accept = resolve;
  });
  function View() {
    const [value, setValue] = useState("中文A");
    return (
      <TextInput
        value={value}
        onCursorChange={(offset) => {
          caret = offset;
        }}
        onPaste={(text, insert) => {
          pasted = text;
          void admitted.then(insert);
        }}
        onChange={(next) => {
          changes.push(next);
          setValue(next);
        }}
      />
    );
  }
  const app = render(
    <AlternateScreen>
      <View />
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    terminal.stdin.write("\x1b[200~original\r\n\x1b[201~");
    await terminal.waitFor(() => pasted === "original\r\n");
    terminal.stdin.write("\x1b[H\x1b[C");
    await terminal.waitFor(() => caret === 1);
    accept("X\r\nY");
    await terminal.waitFor(() => changes.length === 1);
    expect(changes).toEqual(["中X\nY文A"]);
    await terminal.waitFor(() => terminal.cursor().x === 1 && terminal.cursor().y === 1);
    expect(terminal.screen().slice(0, 2)).toEqual(["中X", "Y文A"]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("atomic activation requires press and release on the same admitted unit", async () => {
  const terminal = createTerminal(12, 4);
  const clicks: number[] = [];
  const app = render(
    <AlternateScreen>
      <TextInput
        value="[A] [B]"
        onChange={() => {}}
        atomicRanges={[
          { start: 0, end: 3 },
          { start: 4, end: 7 },
        ]}
        onAtomicRangeClick={(offset) => clicks.push(offset)}
      />
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.waitFor(() => terminal.screen()[0] === "[A] [B]");
    terminal.stdin.write("\x1b[<0;2;1M\x1b[<0;6;1m");
    await terminal.flush();
    expect(clicks).toEqual([]);
    terminal.stdin.write("\x1b[<0;4;1M\x1b[<0;6;1m");
    await terminal.flush();
    expect(clicks).toEqual([]);
    terminal.stdin.write("\x1b[<0;2;1M");
    await terminal.flush();
    const beforeResize = terminal.bytesWritten();
    terminal.resize(10, 4);
    await terminal.waitFor(() => terminal.bytesWritten() > beforeResize);
    terminal.stdin.write("\x1b[<0;6;1m");
    await terminal.flush();
    expect(clicks).toEqual([]);
    terminal.stdin.write("\x1b[<0;6;1M\x1b[<0;6;1m");
    await terminal.waitFor(() => clicks.length === 1);
    expect(clicks).toEqual([4]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

test("mouse positioning follows clipped input rows, blank lines and read-only state", async () => {
  testClock.useFakeTimers();
  const terminal = createTerminal(8, 6, (ms) => testClock.advanceTimersByTime(ms));
  let freeze = () => {};
  const changes: string[] = [];
  function View() {
    const [value, setValue] = useState("first\n\n中é👩‍💻A\nlast");
    const [readOnly, setReadOnly] = useState(false);
    freeze = () => setReadOnly(true);
    return (
      <TextInput
        value={value}
        onChange={(text) => {
          changes.push(text);
          setValue(text);
        }}
        maxLines={2}
        readOnly={readOnly}
        dim={readOnly}
      />
    );
  }
  const app = render(
    <AlternateScreen>
      <View />
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen().slice(0, 2)).toEqual(["中é👩‍💻A", "last"]);
    terminal.stdin.write("\x1b[<0;4;1M\x1b[<0;4;1m");
    await terminal.waitFor(() => terminal.cursor().x === 3 && terminal.cursor().y === 0);
    terminal.stdin.write("!");
    await terminal.waitFor(() => terminal.screen()[0] === "中é!👩‍💻A");
    expect(changes).toEqual(["first\n\n中é!👩‍💻A\nlast"]);
    // Keyboard navigation exposes the blank logical row; clicking its blank cells keeps that row.
    terminal.stdin.write("\x1b[A");
    await terminal.waitFor(() => terminal.screen()[0] === "");
    terminal.stdin.write("\x1b[<0;6;1M\x1b[<0;6;1m");
    await terminal.waitFor(() => terminal.cursor().x === 0 && terminal.cursor().y === 0);
    terminal.stdin.write("B");
    await terminal.waitFor(() => terminal.screen()[0] === "B");
    expect(changes.at(-1)).toBe("first\nB\n中é!👩‍💻A\nlast");
    freeze();
    await terminal.waitFor(() => !!terminal.terminal.buffer.active.getLine(0)!.getCell(0)!.isDim());
    const caret = terminal.cursor();
    terminal.stdin.write("\x1b[<0;4;2M\x1b[<0;4;2mX");
    testClock.advanceTimersByTime(32);
    await terminal.flush();
    expect(terminal.cursor()).toEqual(caret);
    expect(changes).toHaveLength(2);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
    testClock.useRealTimers();
  }
});
