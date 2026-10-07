import { expect, test } from "bun:test";
import { ThemeProvider } from "../../../src/ink/index.ts";
import { FileActionsPanel } from "../../../src/tui/components/file-actions-panel";
import { createTuiI18n } from "../../../src/view/i18n";
import { renderComponent } from "../helpers/render-component";
import { createTerminal } from "../helpers/terminal";

test.each(["en", "zh"] as const)(
  "%s file actions reserve complete labels before side padding at 28 columns",
  async (locale) => {
    const terminal = createTerminal(28, 6);
    const app = renderComponent(
      <ThemeProvider>
        <FileActionsPanel
          path="new.txt"
          directory={false}
          focus={0}
          columns={28}
          rows={6}
          locale={locale}
          onPick={() => {}}
        />
      </ThemeProvider>,
      terminal,
    );
    try {
      await terminal.flush();
      const t = createTuiI18n(locale);
      const screen = terminal.screen();
      expect(screen[2]!.trim()).toBe(`❯ 1 ${t("file-actions.open")}`);
      expect(screen[3]!.trim()).toBe(`2 ${t("file-actions.reveal")}`);
      expect(screen[4]!.trim()).toBe(`3 ${t("file-actions.copy")}`);
    } finally {
      app.unmount();
      await app.waitUntilExit();
      app.cleanup();
      terminal.dispose();
    }
  },
);
