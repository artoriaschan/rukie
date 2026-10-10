import { expect, test } from "bun:test";
import { AlternateScreen, renderSync } from "../../../../src/ink/index.ts";
import { ModelPicker } from "../../../../src/tui/components/model-picker";
import { createTerminal } from "../../../ink/helpers/terminal";
import type { ModelCatalogEntry } from "@rukie/agent";

const model: ModelCatalogEntry = {
  spec: "test/model",
  id: "model",
  name: "Model",
  providerId: "test",
  providerName: "Test",
  input: ["text"],
  reasoning: true,
  thinkingLevels: ["off", "low", "high"],
  contextWindow: 128000,
  custom: true,
  authenticated: true,
};

test("picker height degradation removes spacing and explanation, shortens hints, hides capabilities, then hides the thinking strip", async () => {
  const terminal = createTerminal(80, 24);
  const picker = (maxHeight: number, columns = 80) => (
    <AlternateScreen>
      <ModelPicker
        tabs={[{ id: "test", name: "Test", custom: true, models: [model] }]}
        thinkingLevel="low"
        onThinking={() => {}}
        tab={0}
        focus={0}
        query=""
        filteredModels={[]}
        current={model.spec}
        maxHeight={maxHeight}
        columns={columns}
        locale="en"
        loading={false}
        failed={false}
        onPick={() => {}}
        onTab={() => {}}
        onWheel={() => {}}
      />
    </AlternateScreen>
  );
  const app = renderSync(picker(14), terminal);
  const text = () => terminal.screen().join("\n");
  try {
    await terminal.waitFor(() => text().includes("adjust thinking; Enter confirms"));
    expect(text()).toContain("Text input · Reasoning");
    app.rerender(picker(13));
    await terminal.waitFor(() => !text().includes("adjust thinking; Enter confirms"));
    expect(text()).toContain("Tab providers");
    expect(text()).toContain("Text input · Reasoning");
    expect(text()).not.toMatch(/^│ +│$/m);
    app.rerender(picker(13, 60));
    await terminal.waitFor(() => text().includes("Enter · Esc"));
    expect(text()).toContain("Text input · Reasoning");
    expect(text()).toContain("[low]");
    app.rerender(picker(8));
    await terminal.waitFor(() => !text().includes("Text input · Reasoning"));
    expect(text()).not.toContain("Text input · Reasoning");
    expect(text()).toContain("[low]");
    app.rerender(picker(3));
    await terminal.waitFor(() => text().includes("[low]"));
    app.rerender(picker(2));
    await terminal.waitFor(() => !text().includes("[low]"));
    expect(text()).toContain("test/model");
    expect(text()).toContain("Enter · Esc");
  } finally {
    app.unmount();
    await app.waitUntilExit();
    app.cleanup();
    terminal.dispose();
  }
});
