import { expect, test } from "bun:test";
import { figures, render, ThemeProvider } from "@neant/tui";
import { AssistantMessage } from "../../../src/components/assistant-message";
import { createTerminal } from "../../helpers/terminal";

test("assistant text removes narration lines while preserving the reply", async () => {
  const terminal = createTerminal(80, 4);
  const app = render(
    <ThemeProvider>
      <AssistantMessage text={"⏵ 查一下报错原因\n答复中的 ⏵ 保留\n⏵ 给补丁跑个验证\n最后一行"} />
    </ThemeProvider>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual([`${figures.assistant} 答复中的 ⏵ 保留`, "最后一行", "", ""]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test.each(["⏵", "⏵ 查一下报错", "⏵ 查一下报错\n", "⏵ 查一下报错\r\n⏵ 验证补丁"])(
  "narration-only assistant text paints no reply marker: %j",
  async (text) => {
    const terminal = createTerminal(80, 3);
    const app = render(
      <ThemeProvider>
        <AssistantMessage text={text} />
      </ThemeProvider>,
      terminal,
    );
    try {
      await terminal.flush();
      expect(terminal.screen()).toEqual(["", "", ""]);
    } finally {
      app.unmount();
      await app.waitUntilExit();
      terminal.dispose();
    }
  },
);
