import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { useLayoutEffect, useState } from "react";
import { AlternateScreen, Box, Text, renderSync } from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

for (const style of ["inverse", "italic", "underline"] as const) {
  test(`Text repaints an unchanged character when ${style} is enabled or disabled`, async () => {
    const terminal = createTerminal(8, 2);
    let update = (_enabled: boolean) => {};
    function View() {
      const [enabled, setEnabled] = useState(false);
      useLayoutEffect(() => {
        update = setEnabled;
      }, []);
      return <Text {...{ [style]: enabled }}>A</Text>;
    }
    const cell = () => terminal.terminal.buffer.active.getLine(0)!.getCell(0)!;
    const enabled = () =>
      style === "inverse"
        ? cell().isInverse()
        : style === "italic"
          ? cell().isItalic()
          : cell().isUnderline();
    const app = renderSync(<View />, terminal);
    try {
      await terminal.flush();
      expect(enabled()).toBeFalsy();
      update(true);
      await terminal.waitFor(() => !!enabled());
      expect(cell().getChars()).toBe("A");
      update(false);
      await terminal.waitFor(() => !enabled());
      expect(cell().getChars()).toBe("A");
    } finally {
      app.unmount();
      await app.waitUntilExit();
      app.cleanup();
      terminal.dispose();
    }
  });
}

test("inverse, italic and underline survive nesting and wrapping without leaking to siblings", async () => {
  const terminal = createTerminal(8, 4);
  const app = renderSync(
    <Box flexDirection="column" width={3}>
      <Text inverse italic underline>
        A
        <Text inverse={false} italic={false} underline={false}>
          B
        </Text>
        CD
      </Text>
      <Text>E</Text>
    </Box>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["ABC", "D", "E", ""]);
    const cell = (x: number, y: number) => terminal.terminal.buffer.active.getLine(y)!.getCell(x)!;
    for (const [x, y] of [
      [0, 0],
      [2, 0],
      [0, 1],
    ] as const) {
      expect(cell(x, y).isInverse()).toBeTruthy();
      expect(cell(x, y).isItalic()).toBeTruthy();
      expect(cell(x, y).isUnderline()).toBeTruthy();
    }
    for (const [x, y] of [
      [1, 0],
      [0, 2],
    ] as const) {
      expect(cell(x, y).isInverse()).toBeFalsy();
      expect(cell(x, y).isItalic()).toBeFalsy();
      expect(cell(x, y).isUnderline()).toBeFalsy();
    }
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

const execute = promisify(execFile);

/** TTY capability is established before Chalk's startup detection, in an isolated process. */
async function startupPaint(noColor: string | undefined, color: string, forceColor?: string) {
  const directory = await mkdtemp(join(tmpdir(), "ink-startup-color-"));
  const script = join(directory, "paint.tsx");
  const react = Bun.resolveSync("react", import.meta.dir);
  const ink = new URL("../../../src/ink/index.ts", import.meta.url).pathname;
  await writeFile(
    script,
    `
import React from ${JSON.stringify(react)};
import tty from "node:tty";
import { PassThrough, Writable } from "node:stream";
import { setImmediate } from "node:timers/promises";
// The injected frontend is a truecolor TTY. Chalk inspects the process fd before Ink is imported.
tty.isatty = () => true;
const { AlternateScreen, Box, Text, renderSync } = await import(${JSON.stringify(ink)});
const {RawAnsi} = await import(${JSON.stringify(new URL("../../../src/ink/components/RawAnsi.tsx", import.meta.url).pathname)});
let output = "";
const stdin = Object.assign(new PassThrough(), { isTTY: true, isRaw: false,
  setRawMode(value) { this.isRaw = value; return this; }, ref() {return this;}, unref() {return this;} });
const stdout = Object.assign(new Writable({write(chunk, _encoding, done) { output += chunk.toString(); done(); }}), {isTTY: true, columns: 8, rows: 8});
const color = ${JSON.stringify(color)};
const app = renderSync(<AlternateScreen>
  <Box width={8} height={1} backgroundColor={color}><Text color={color} bold inverse italic underline strikethrough>A</Text></Box>
  <Box width={8} height={1} backgroundColor={color}><Text color={color} dim inverse italic underline strikethrough>D</Text></Box>
  <Text color="#123456" backgroundColor="#abcdef">▀</Text>
  <Box width={8} height={3} borderStyle="round" borderColor={color}><Text>card</Text></Box>
  <RawAnsi width={1} lines={["\\x1b[31m\\x1b[44m\\x1b[1mR\\x1b[0m"]}/>
  <Text>end</Text>
</AlternateScreen>, {stdin,stdout,stderr:stdout,patchConsole:false,exitOnCtrlC:false,terminalImages:false});
try {
 const deadline = process.hrtime.bigint() + 1000000000n;
 while (!output.includes("end")) { if(process.hrtime.bigint() >= deadline) throw new Error("startup paint did not complete: " + JSON.stringify(output)); await setImmediate(); }
 const painted = output;
 app.unmount(); await app.waitUntilExit(); app.cleanup();
 process.stdout.write(painted);
} finally {stdin.destroy();stdout.destroy();}
`,
  );
  const env: NodeJS.ProcessEnv = { ...process.env, TERM: "xterm-kitty", COLORTERM: "truecolor" };
  delete env.NO_COLOR;
  delete env.FORCE_COLOR;
  delete env.CI;
  delete env.TMUX;
  if (noColor !== undefined) env.NO_COLOR = noColor;
  if (forceColor !== undefined) env.FORCE_COLOR = forceColor;
  try {
    return (await execute(process.execPath, [script], { env, timeout: 2000 })).stdout;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

for (const value of ["1", "", undefined]) {
  for (const color of ["#12ab34", "ansi:red"] as const) {
    test(`startup NO_COLOR=${JSON.stringify(value)} respects ${color}, padding and halfblock planes while retaining emphasis`, async () => {
      const output = await startupPaint(value, color);
      const terminal = createTerminal(8, 8);
      try {
        terminal.stdout.write(output);
        await terminal.flush();
        const cell = (x: number, y: number) =>
          terminal.terminal.buffer.active.getLine(y)!.getCell(x)!;
        for (const [y, glyph] of [
          [0, "A"],
          [1, "D"],
        ] as const) {
          expect(cell(0, y).getChars()).toBe(glyph);
          expect(!!cell(0, y).isBold()).toBe(y === 0);
          expect(!!cell(0, y).isDim()).toBe(y === 1);
          expect(cell(0, y).isInverse()).toBeTruthy();
          expect(cell(0, y).isItalic()).toBeTruthy();
          expect(cell(0, y).isUnderline()).toBeTruthy();
          expect(cell(0, y).isStrikethrough()).toBeTruthy();
          if (value) {
            expect(cell(0, y).isFgDefault()).toBeTruthy();
            expect(cell(0, y).isBgDefault()).toBeTruthy();
            expect(cell(7, y).isBgDefault()).toBeTruthy();
          } else {
            const expected = color === "ansi:red" ? 1 : 0x12ab34;
            expect(cell(0, y).getFgColor()).toBe(expected);
            expect(cell(0, y).getBgColor()).toBe(expected);
            expect(cell(7, y).getBgColor()).toBe(expected);
          }
        }
        expect(cell(0, 2).getChars()).toBe("▀");
        if (value) {
          expect(cell(0, 2).isFgDefault()).toBeTruthy();
          expect(cell(0, 2).isBgDefault()).toBeTruthy();
        } else {
          expect(cell(0, 2).getFgColor()).toBe(0x123456);
          expect(cell(0, 2).getBgColor()).toBe(0xabcdef);
        }
        expect(cell(0, 3).getChars()).toBe("╭");
        expect(cell(0, 3).isBold()).toBeFalsy();
        expect(cell(0, 3).isInverse()).toBeFalsy();
        expect(cell(0, 6).getChars()).toBe("R");
        expect(cell(0, 6).isBold()).toBeTruthy();
        if (value) {
          expect(cell(0, 3).isFgDefault()).toBeTruthy();
          expect(cell(0, 6).isFgDefault()).toBeTruthy();
          expect(cell(0, 6).isBgDefault()).toBeTruthy();
        } else {
          expect(cell(0, 3).getFgColor()).toBe(color === "ansi:red" ? 1 : 0x12ab34);
          expect(cell(0, 6).getFgColor()).toBe(1);
          expect(cell(0, 6).getBgColor()).toBe(4);
        }
      } finally {
        terminal.dispose();
      }
    });
  }
}

for (const forceColor of ["0", "3"]) {
  test(`startup FORCE_COLOR=${forceColor} does not override nonempty NO_COLOR`, async () => {
    const output = await startupPaint("1", "#12ab34", forceColor);
    const terminal = createTerminal(8, 8);
    try {
      terminal.stdout.write(output);
      await terminal.flush();
      const cell = terminal.terminal.buffer.active.getLine(0)!.getCell(0)!;
      expect(cell.getChars()).toBe("A");
      expect(cell.isFgDefault()).toBeTruthy();
      expect(cell.isBgDefault()).toBeTruthy();
      expect(!!cell.isBold()).toBe(forceColor === "3");
      expect(!!cell.isItalic()).toBe(forceColor === "3");
    } finally {
      terminal.dispose();
    }
  });
}

test("round borders preserve box layout while drawing rounded corner glyphs", async () => {
  const terminal = createTerminal(6, 3);
  const app = renderSync(
    <AlternateScreen>
      <Box width={6} height={3} borderStyle="round">
        <Text>card</Text>
      </Box>
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["╭────╮", "│card│", "╰────╯"]);
  } finally {
    app.unmount();
    app.cleanup();
    terminal.dispose();
  }
});

for (const resetStyle of ["bold", "inverse", "italic", "underline"] as const) {
  test(`nested explicit ${resetStyle}=false resets only that style and undefined inherits`, async () => {
    const terminal = createTerminal(12, 4);
    function Screen({ phase }: { phase: number }) {
      const reset = phase === 1 ? undefined : false;
      return (
        <AlternateScreen>
          <Text bold inverse italic underline color="#12ab34" backgroundColor="#234567">
            A<Text {...{ [resetStyle]: reset }}>B</Text>
            {phase}
          </Text>
        </AlternateScreen>
      );
    }
    const app = renderSync(<Screen phase={0} />, terminal);
    const flags = (x: number) => {
      const cell = terminal.terminal.buffer.active.getLine(0)!.getCell(x)!;
      return {
        bold: !!cell.isBold(),
        inverse: !!cell.isInverse(),
        italic: !!cell.isItalic(),
        underline: !!cell.isUnderline(),
      };
    };
    try {
      for (const phase of [0, 1, 2]) {
        if (phase) app.rerender(<Screen phase={phase} />);
        await terminal.waitFor(() => terminal.screen()[0] === `AB${phase}`);
        expect(flags(0)).toEqual({ bold: true, inverse: true, italic: true, underline: true });
        expect(flags(2)).toEqual(flags(0));
        expect(flags(1)).toEqual({ ...flags(0), [resetStyle]: phase === 1 });
        const cell = terminal.terminal.buffer.active.getLine(0)!.getCell(1)!;
        expect(cell.getChars()).toBe("B");
        expect(cell.getFgColor()).toBe(0x12ab34);
        expect(cell.getBgColor()).toBe(0x234567);
      }
    } finally {
      app.unmount();
      await app.waitUntilExit();
      app.cleanup();
      terminal.dispose();
    }
  });
}

for (const glyph of ["e\u0301", "👩‍👧"] as const) {
  test(`a grapheme split across styled children remains one owner on initial paint and rerender: ${glyph}`, async () => {
    const terminal = createTerminal(12, 4);
    function Screen({ phase }: { phase: number }) {
      const [head, ...tail] = Array.from(glyph);
      return (
        <AlternateScreen>
          <Box gap={1}>
            <Text color="ansi:green">
              {head}
              <Text bold={phase === 1}>{tail.join("")}</Text>中
            </Text>
            <Text>|{phase}</Text>
          </Box>
        </AlternateScreen>
      );
    }
    const app = renderSync(<Screen phase={0} />, terminal);
    try {
      for (const phase of [0, 1, 2]) {
        if (phase) app.rerender(<Screen phase={phase} />);
        await terminal.waitFor(() => terminal.screen()[0]!.includes(`|${phase}`));
        const width = glyph === "e\u0301" ? 1 : 2;
        const cell = (x: number) => terminal.terminal.buffer.active.getLine(0)!.getCell(x)!;
        expect(cell(0).getChars().normalize("NFC")).toBe(glyph.normalize("NFC"));
        expect(cell(0).getWidth()).toBe(width);
        expect(cell(0).getFgColor()).toBe(2);
        expect(cell(0).isBold()).toBeFalsy();
        if (width === 2) {
          expect(cell(1).getChars()).toBe("");
          expect(cell(1).getWidth()).toBe(0);
        }
        expect(cell(width).getChars()).toBe("中");
        expect(cell(width).getWidth()).toBe(2);
        expect(cell(width + 1).getWidth()).toBe(0);
        expect(cell(width + 3).getChars()).toBe("|");
        expect(cell(width + 3).isFgDefault()).toBeTruthy();
      }
    } finally {
      app.unmount();
      await app.waitUntilExit();
      app.cleanup();
      terminal.dispose();
    }
  });
}
