import { renderComponent } from "../../helpers/render-component";
import { expect, test } from "bun:test";
import { figures, ThemeProvider } from "../../../../src/ink/index.ts";
import { AssistantMessage } from "../../../../src/tui/components/assistant-message";
import { createTerminal } from "../../helpers/terminal";

test("assistant marker stays beside a first word that wraps at the terminal edge", async () => {
  const terminal = createTerminal(12, 4);
  const app = renderComponent(
    <ThemeProvider>
      <AssistantMessage text="abcdefghijk" />
    </ThemeProvider>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual([`${figures.assistant} abcdefghij`, "  k", "", ""]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("leading blank lines and removed narration do not leave an orphan assistant marker", async () => {
  const terminal = createTerminal(40, 5);
  const app = renderComponent(
    <ThemeProvider>
      <AssistantMessage text={"\n\n⏵ 查一下\n\n答复\n\n下一段"} />
    </ThemeProvider>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual([`${figures.assistant} 答复`, "", "  下一段", "", ""]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test("assistant text removes narration lines while preserving the reply", async () => {
  const terminal = createTerminal(80, 4);
  const app = renderComponent(
    <ThemeProvider>
      <AssistantMessage text={"⏵ 查一下报错原因\n答复中的 ⏵ 保留\n⏵ 给补丁跑个验证\n最后一行"} />
    </ThemeProvider>,
    terminal,
  );
  try {
    await terminal.flush();
    expect(terminal.screen()).toEqual([
      `${figures.assistant} 答复中的 ⏵ 保留`,
      "  最后一行",
      "",
      "",
    ]);
  } finally {
    app.unmount();
    await app.waitUntilExit();
    terminal.dispose();
  }
});

test.each([
  " ",
  "   \t",
  "\r",
  "⏵",
  "⏵ 查一下报错",
  "⏵ 查一下报错\n",
  "⏵ 查一下报错\r\n⏵ 验证补丁",
])("blank or narration-only assistant text paints no reply marker: %j", async (text) => {
  const terminal = createTerminal(80, 3);
  const app = renderComponent(
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
});
