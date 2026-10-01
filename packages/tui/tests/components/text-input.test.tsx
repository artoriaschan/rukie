import { expect, test } from "bun:test";
import { useLayoutEffect, useState } from "react";
import { Box, Text, TextInput, render } from "../../src";
import { createTerminal } from "../helpers/terminal";

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
  const app = render(<View />, terminal);
  try {
    await terminal.flush();
    expect(terminal.cursor()).toEqual({ x: 1, y: 1 });
    terminal.stdin.write("中文A");
    await terminal.waitFor(() => terminal.screen()[1] === " 中文A");
    expect(changes).toEqual(["中", "中文", "中文A"]);
    expect(terminal.cursor()).toEqual({ x: 6, y: 1 });
    terminal.stdin.write("\x1b[D\x7f");
    await terminal.waitFor(() => terminal.screen()[1] === " 中A");
    expect(terminal.cursor()).toEqual({ x: 3, y: 1 });
    terminal.stdin.write("\x1b[3~");
    await terminal.waitFor(() => terminal.screen()[1] === " 中");
    expect(terminal.cursor()).toEqual({ x: 3, y: 1 });
    terminal.stdin.write("\r");
    expect(submissions).toEqual(["中"]);
    expect(changes.at(-1)).toBe("中");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("wrapped whitespace and graphemes keep cursor movement and deletion aligned after resize", async () => {
  const terminal = createTerminal(6, 6);
  function View() {
    const [value, setValue] = useState("中  AB");
    return <TextInput value={value} onChange={setValue} />;
  }
  const app = render(<View />, terminal);
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["中  AB", "", "", "", "", ""]);
    expect(terminal.cursor()).toEqual({ x: 0, y: 1 });
    terminal.stdin.write("\x1b[D");
    await terminal.waitFor(() => terminal.cursor().x === 5);
    expect(terminal.cursor()).toEqual({ x: 5, y: 0 });
    terminal.resize(4, 6);
    await terminal.flush();
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
  const app = render(<View />, terminal);
  try {
    await terminal.flush();
    reset();
    await terminal.waitFor(() => terminal.screen()[0] === "");
    terminal.stdin.write("ignored\r");
    await terminal.flush();
    expect(terminal.screen()[0]).toBe("");
  } finally {
    app.unmount();
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
  const app = render(<View />, terminal);
  try {
    await terminal.flush();
    replace();
    await terminal.waitFor(() => terminal.screen()[0] === "é👩‍💻");
    terminal.stdin.write("\x7f");
    await terminal.flush();
    expect(changes).toEqual(["👩‍💻"]);
    expect(terminal.cursor()).toEqual({ x: 0, y: 0 });
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

test("narrow resize omits overwide glyphs consistently for both text and cursor", async () => {
  const terminal = createTerminal(6, 6);
  const app = render(<TextInput value="中A" onChange={() => {}} />, terminal);
  try {
    await terminal.flush();
    terminal.resize(1, 6);
    await terminal.flush();
    expect(terminal.screen()).toEqual(["A", "", "", "", "", ""]);
    expect(terminal.cursor()).toEqual({ x: 0, y: 1 });
  } finally {
    app.unmount();
    terminal.dispose();
  }
});

test("the cursor remains visible before an explicit newline following a full Chinese line", async () => {
  const terminal = createTerminal(4, 5);
  const app = render(<TextInput value={"中文\nA"} onChange={() => {}} />, terminal);
  try {
    await terminal.flush();
    const before = terminal.bytesWritten();
    terminal.stdin.write("\x1b[D\x1b[D");
    await terminal.waitFor(() => terminal.bytesWritten() > before);
    expect(terminal.screen()).toEqual(["中文", "A", "", "", ""]);
    expect(terminal.cursor()).toEqual({ x: 0, y: 1 });
    expect(terminal.output().endsWith("\x1b[?25h")).toBe(true);
  } finally {
    app.unmount();
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
  const app = render(<View />, terminal);
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
    expect(submissions).toEqual(["one\n中\ntwo\n  A\n中文"]);
  } finally {
    app.unmount();
    terminal.dispose();
  }
});
