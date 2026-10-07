import { expect, test } from "bun:test";
import { createRef } from "react";
import type { ScrollBoxHandle } from "../../../../src/ink";
import { SubagentDetailScene } from "../../../../src/tui/components/subagent-detail";
import { renderComponent } from "../../helpers/render-component";
import { createTerminal } from "../../helpers/terminal";

for (const agentView of [false, true]) {
  test(`40x12 ${agentView ? "Agent View" : "detail"} keeps output and footer within its viewport`, async () => {
    const terminal = createTerminal(40, 12);
    const scrollRef = createRef<ScrollBoxHandle>();
    const app = renderComponent(
      <SubagentDetailScene
        subagent={{
          agentId: "child",
          childSessionId: "child",
          description: "Reader",
          subagentType: "general-purpose",
          status: "failed",
          model: "faux/faux",
          runReason: "failure ".repeat(20),
          outputLines: [],
          toolCalls: [],
          output: [
            {
              type: "text",
              text: Array.from({ length: 30 }, (_, index) => `output-${index}`).join("\n"),
            },
          ],
        }}
        page="output"
        thinkingOpen={false}
        scrollRef={scrollRef}
        rows={12}
        locale="en"
        onBack={() => {}}
        onPage={() => {}}
        onInterrupt={() => {}}
        agentView={agentView}
      />,
      terminal,
    );
    try {
      await terminal.flush();
      expect(terminal.screen()[10]).toContain(agentView ? "Read-only" : "Esc");
      expect(terminal.screen().join("\n")).toContain("Conclusion");
      scrollRef.current!.scrollToBottom();
      await terminal.waitFor(() => terminal.screen().join("\n").includes("output-29"));
      expect(terminal.screen()[10]).toContain(agentView ? "Read-only" : "Esc");
    } finally {
      app.unmount();
      await app.waitUntilExit();
      app.cleanup();
      terminal.dispose();
    }
  });
}
