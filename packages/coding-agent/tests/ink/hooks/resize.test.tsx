import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { AlternateScreen, Box, Text, renderSync, useTerminalSize } from "../../../src/ink";
import { createTerminal } from "../helpers/terminal";

test("resizing narrower, shorter and wider reflows content and clears the old viewport", async () => {
  const terminal = createTerminal(16, 6);
  function View() {
    const { columns, rows } = useTerminalSize();
    return (
      <Box flexDirection="column">
        <Text>
          {columns}x{rows}
        </Text>
        <Text>中文ABCDEF</Text>
      </Box>
    );
  }
  const app = renderSync(
    <AlternateScreen>
      <View />
    </AlternateScreen>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual(["16x6", "中文ABCDEF", "", "", "", ""]);
    terminal.resize(6, 4);
    await terminal.waitFor(() => terminal.screen()[0] === "6x4");
    expect(terminal.screen()).toEqual(["6x4", "中文AB", "CDEF", ""]);
    expect(terminal.cursor()).toEqual({ x: 0, y: 3 });
    terminal.resize(20, 7);
    await terminal.waitFor(() => terminal.screen()[0] === "20x7");
    expect(terminal.screen()).toEqual(["20x7", "中文ABCDEF", "", "", "", "", ""]);
    expect(terminal.cursor()).toEqual({ x: 0, y: 6 });
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});

const execute = promisify(execFile);
for (const conpty of [false, true]) {
  test(`${conpty ? "ConPTY rebuild" : "ordinary duplicate"} same-grid resize preserves the native surface policy`, async () => {
    // WT_SESSION is a startup terminal capability. It belongs to a separate
    // process so no imported frontend or neighbouring test inherits a late env mutation.
    const directory = await mkdtemp(join(tmpdir(), "ink-same-grid-"));
    const script = join(directory, "resize.tsx");
    await writeFile(
      script,
      `
import React from ${JSON.stringify(Bun.resolveSync("react", import.meta.dir))};
import {renderSync,AlternateScreen,Text,useInput} from ${JSON.stringify(new URL("../../../src/ink/index.ts", import.meta.url).pathname)};
import {createTerminal} from ${JSON.stringify(new URL("../helpers/terminal.ts", import.meta.url).pathname)};
const terminal=createTerminal(10,4);
function Screen(){useInput(()=>{});return <AlternateScreen><Text>clean</Text></AlternateScreen>;}
const app=renderSync(<Screen/>,terminal);
try {
 await terminal.waitFor(()=>terminal.screen()[0]==="clean");
 terminal.stdout.write("\\x1b[3;1Hresidue");await terminal.flush();
 const contaminated=terminal.screen();terminal.resize(10,4);
 ${conpty ? 'await terminal.waitFor(()=>terminal.screen()[2]==="");' : "await terminal.flush();"}
 const screen=terminal.screen(),cursor=terminal.cursor();
 app.unmount();await app.waitUntilExit();app.cleanup();await terminal.flush();
 process.stdout.write(JSON.stringify({contaminated,screen,cursor,raw:terminal.stdin.isRaw,buffer:terminal.terminal.buffer.active.type,paste:terminal.terminal.modes.bracketedPasteMode,shown:terminal.output().lastIndexOf("?25h")>terminal.output().lastIndexOf("?25l")}));
}finally{terminal.dispose();}
`,
    );
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.WT_SESSION;
    if (conpty) env.WT_SESSION = "native-conpty-capability";
    try {
      const { stdout } = await execute(process.execPath, [script], { env, timeout: 2000 });
      const result: unknown = JSON.parse(stdout);
      expect(result).toEqual({
        contaminated: ["clean", "", "residue", ""],
        screen: conpty ? ["clean", "", "", ""] : ["clean", "", "residue", ""],
        cursor: conpty ? { x: 0, y: 3 } : { x: 7, y: 2 },
        raw: false,
        buffer: "normal",
        paste: false,
        shown: true,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}
