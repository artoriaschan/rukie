import { expect, test } from "bun:test";
import { Notice } from "../../../../src/tui/components/notice";
import { renderComponent } from "../../helpers/render-component";
import { createTerminal } from "../../helpers/terminal";

for (const columns of [40, 80]) {
  for (const divider of [false, true]) {
    test(`${columns}-column ${divider ? "auxiliary" : "status"} notice preserves explicit lines and truncates each independently`, async () => {
      const terminal = createTerminal(columns, 8);
      const app = renderComponent(
        <Notice
          kind="dim"
          divider={divider}
          text={`Status: complete\nObjective: ${"宽🐋".repeat(50)}\n\nActivation: disarmed\nCommands: /goal edit <objective>, /goal clear`}
        />,
        terminal,
      );
      try {
        await terminal.flush();
        const top = Number(divider);
        expect(terminal.screen()[top]).toBe(`${divider ? "─ " : ""}Status: complete`);
        expect(terminal.screen()[top + 1]).toEndWith("…");
        expect(terminal.screen()[top + 2]).toBe("");
        expect(terminal.screen()[top + 3]).toBe("Activation: disarmed");
        expect(terminal.screen()[top + 4]).toStartWith("Commands: /goal edit");
        expect(
          terminal.terminal.buffer.active
            .getLine(top + 3)!
            .getCell(0)!
            .isDim(),
        ).toBeTruthy();
      } finally {
        app.unmount();
        await app.waitUntilExit();
        app.cleanup();
        terminal.dispose();
      }
    });
  }
}
