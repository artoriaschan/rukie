import { expect, test } from "bun:test";
import { SubagentPanel } from "../../../../src/tui/components/subagent-panel";
import { renderComponent } from "../../helpers/render-component";
import { createTerminal } from "../../helpers/terminal";

test("compact child preview opens independently from the panel fold control", async () => {
  const terminal = createTerminal(80, 8);
  let folds = 0;
  const opened: string[] = [];
  const app = renderComponent(
    <SubagentPanel
      subagents={[
        {
          agentId: "reader",
          childSessionId: "reader",
          description: "Reader",
          subagentType: "general-purpose",
          status: "running",
          model: "faux",
          outputLines: [],
          toolCalls: [],
        },
      ]}
      collapsed={false}
      maxHeight={1}
      locale="en"
      onToggle={() => folds++}
      onOpen={(id) => opened.push(id)}
    />,
    terminal,
  );
  try {
    await terminal.flush();
    const row = terminal.screen()[0]!;
    const col = Bun.stringWidth(row.slice(0, row.indexOf("Reader")));
    terminal.stdin.write(`\x1b[<0;${col + 1};1M\x1b[<0;${col + 1};1m`);
    await terminal.waitFor(() => opened.length === 1);
    expect(opened).toEqual(["reader"]);
    expect(folds).toBe(0);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});
