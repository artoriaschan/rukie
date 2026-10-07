import { expect, test } from "bun:test";
import {
  AlternateScreen,
  Text,
  renderSync,
  useSelection,
  useInput,
} from "../../../src/ink/index.ts";
import { createTerminal } from "../helpers/terminal";

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
