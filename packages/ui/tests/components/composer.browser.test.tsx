import { expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { ContextReport, WireModelCatalogEntry } from "@rukie/shared";
import { Composer } from "../../src/components/composer";
import { UiLocaleProvider } from "../../src/lib/i18n";
import "../../src/theme.css";

const models: WireModelCatalogEntry[] = [
  {
    spec: "openai/first",
    id: "first",
    name: "First model",
    providerId: "openai",
    providerName: "OpenAI",
    input: ["text", "image"],
    reasoning: true,
    thinkingLevels: ["low", "high", "max"],
    contextWindow: 1_000_000,
    custom: true,
    authenticated: true,
  },
  {
    spec: "custom/second",
    id: "second",
    name: "Second model with a very long name that should retain its full accessible label",
    providerId: "custom",
    providerName: "Custom provider with a long name",
    input: ["text"],
    reasoning: false,
    thinkingLevels: [],
    contextWindow: 128_000,
    custom: true,
    authenticated: true,
  },
];

function fixture(
  onModel = vi.fn(),
  catalog = models,
  disabled = false,
  contextReport?: ContextReport,
) {
  return (
    <div style={{ position: "absolute", bottom: 16, left: 80, right: 16, maxWidth: 736 }}>
      <Composer
        draft=""
        images={[]}
        onDraft={vi.fn()}
        onImages={vi.fn()}
        disabled={disabled}
        running={false}
        permissionMode="ask"
        onPermission={vi.fn()}
        models={catalog}
        model={models[0]!.spec}
        thinkingLevel="max"
        onModel={onModel}
        onSend={vi.fn()}
        onStop={vi.fn()}
        contextReport={contextReport}
      />
    </div>
  );
}

test("Pencil model panels preserve the composer layout and show catalog facts", async () => {
  await page.viewport(1280, 900);
  const onModel = vi.fn();
  const screen = await render(fixture(onModel));
  const root = document.documentElement;
  const wasDark = root.classList.contains("dark");
  try {
    const trigger = screen.getByRole("button", { name: "Choose model", exact: true });
    const prompt = screen.getByRole("textbox", { name: "Prompt", exact: true }).element();
    const baseline = prompt.closest("form")!.getBoundingClientRect().toJSON();
    await trigger.click();
    const first = screen.getByRole("menuitem", { name: /First model/ });
    await expect.element(first).toBeVisible();
    const list = first.element().closest("[data-model-list]")!;
    expect(list.getBoundingClientRect().width).toBe(332);
    expect(first.element().getBoundingClientRect().height).toBe(32);
    const detail = screen.getByRole("region", { name: "First model", exact: true });
    await expect.element(detail).toBeVisible();
    const panel = detail.element().getBoundingClientRect();
    expect(panel.width).toBe(280);
    expect(panel.height).toBe(184);
    expect(panel.left - list.getBoundingClientRect().right).toBe(4);
    expect(panel.top).toBe(list.getBoundingClientRect().top);
    expect(first.element().getAttribute("data-selected")).toBe("true");
    expect(first.element().querySelector('[data-provider-brand="openai"]')).not.toBeNull();
    expect(first.element().querySelector("[data-model-check]")).not.toBeNull();
    expect(detail.element().textContent).toContain("Text / Image");
    expect(detail.element().textContent).toContain("1M");
    for (const dark of [false, true]) {
      root.classList.toggle("dark", dark);
      expect(getComputedStyle(list).backgroundColor).toBe(
        dark ? "rgb(43, 43, 43)" : "rgb(255, 255, 255)",
      );
      expect(getComputedStyle(first.element()).cursor).toBe("pointer");
      expect(getComputedStyle(first.element().querySelector("svg")!).cursor).toBe("pointer");
      expect(getComputedStyle(list).borderRadius).toBe("12px");
      expect(getComputedStyle(detail.element()).boxShadow).not.toBe("none");
    }
    expect(prompt.closest("form")!.getBoundingClientRect().toJSON()).toEqual(baseline);
    await userEvent.keyboard("{Escape}");
    await expect.element(trigger).toHaveFocus();
    expect(onModel).not.toHaveBeenCalled();
    await trigger.click();
    await userEvent.keyboard("{ArrowDown}{ArrowRight}");
    await expect.element(screen.getByRole("button", { name: "Low", exact: true })).toHaveFocus();
    await userEvent.keyboard("{ArrowLeft}{ArrowDown}");
    await expect
      .element(screen.getByRole("region", { name: models[1]!.name, exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "High", exact: true }))
      .not.toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(onModel).toHaveBeenCalledWith({
      provider: "custom",
      modelId: "second",
      thinkingLevel: undefined,
    });
    await trigger.click();
    await expect
      .element(screen.getByRole("region", { name: "First model", exact: true }))
      .toBeVisible();
    await screen.getByRole("button", { name: "High", exact: true }).click();
    expect(onModel).toHaveBeenLastCalledWith({
      provider: "openai",
      modelId: "first",
      thinkingLevel: "high",
    });
    await trigger.click();
    await userEvent.keyboard("{ArrowDown}{ArrowRight}{ArrowRight}");
    await expect.element(screen.getByRole("button", { name: "High", exact: true })).toHaveFocus();
    expect(getComputedStyle(document.activeElement!).cursor).toBe("pointer");
    expect(getComputedStyle(document.activeElement!).outlineWidth).toBe("2px");
    await userEvent.keyboard("{Enter}");
    expect(onModel).toHaveBeenLastCalledWith({
      provider: "openai",
      modelId: "first",
      thinkingLevel: "high",
    });
  } finally {
    await screen.unmount();
    root.classList.toggle("dark", wasDark);
  }
});

test("Pencil composer, permission and context controls retain their real actions and geometry", async () => {
  await page.viewport(1280, 900);
  const report: ContextReport = {
    model: models[0]!.spec,
    window: 1_000_000,
    used: 250_000,
    categories: [
      { name: "system-prompt", tokens: 50_000 },
      { name: "system-tools", tokens: 100_000 },
      { name: "messages", tokens: 100_000 },
    ],
    memoryFiles: [],
    mcpTools: [],
    skills: [],
    agentTypes: [],
  };
  const screen = await render(fixture(vi.fn(), models, false, report));
  try {
    const prompt = screen.getByRole("textbox", { name: "Prompt", exact: true }).element();
    const form = prompt.closest("form")!;
    expect(form.getBoundingClientRect().width).toBe(736);
    expect(form.getBoundingClientRect().height).toBe(100);
    const trigger = screen.getByRole("button", { name: "Permission mode", exact: true });
    expect(trigger.element().getBoundingClientRect().height).toBe(28);
    await trigger.click();
    const mode = screen.getByRole("menuitemradio", { name: /Ask before running/ });
    await expect.element(mode).toBeVisible();
    await expect
      .poll(() => mode.element().closest('[role="menu"]')!.getBoundingClientRect().width)
      .toBe(376);
    expect(mode.element().getBoundingClientRect().height).toBe(44);
    expect(mode.element().querySelector("svg")).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.element(trigger).toHaveFocus();
    await screen.getByRole("button", { name: "Context usage 25%", exact: true }).click();
    const context = document.querySelector<HTMLElement>(".conversation-context-panel")!;
    await expect.poll(() => Math.round(context.getBoundingClientRect().width)).toBe(348);
    expect(context.textContent).toContain("First model");
    expect(context.textContent).toContain("250,000 / 1,000,000 (25%)");
    expect(context.textContent).toContain("Opening context");
    await userEvent.keyboard("{Escape}");
  } finally {
    await screen.unmount();
  }
});

test("model panels stack at narrow width, scroll long catalogs and reflow enlarged localized text", async () => {
  await page.viewport(420, 900);
  const root = document.documentElement;
  const font = root.style.getPropertyValue("--ui-font-size");
  const catalog = [
    ...models,
    ...Array.from({ length: 14 }, (_, i) => ({
      ...models[1]!,
      spec: `custom/${i}`,
      id: String(i),
      name: `Additional model ${i}`,
    })),
  ];
  const screen = await render(
    <UiLocaleProvider locale="zh">{fixture(vi.fn(), catalog)}</UiLocaleProvider>,
  );
  try {
    await screen.getByRole("button", { name: "选择模型", exact: true }).click();
    const first = screen.getByRole("menuitem", { name: /First model/ });
    await expect.element(first).toBeVisible();
    const list = first.element().closest("[data-model-list]")!;
    const detail = screen.getByRole("region", { name: "First model", exact: true }).element();
    expect(detail.getBoundingClientRect().top - list.getBoundingClientRect().bottom).toBe(4);
    expect(list.getBoundingClientRect().left).toBeGreaterThanOrEqual(16);
    expect(detail.getBoundingClientRect().right).toBeLessThanOrEqual(404);
    const viewport = list.querySelector('[data-slot="scroll-area-viewport"]')!;
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
    await expect.element(screen.getByRole("scrollbar")).toBeVisible();
    await userEvent.keyboard("{End}");
    await expect
      .element(screen.getByRole("menuitem", { name: /Additional model 13/ }))
      .toHaveFocus();
    expect(viewport.scrollTop).toBeGreaterThan(0);
    root.style.setProperty("--ui-font-size", "18px");
    expect(first.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(32);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
    await userEvent.keyboard("{Escape}");
  } finally {
    await screen.unmount();
    if (font) root.style.setProperty("--ui-font-size", font);
    else root.style.removeProperty("--ui-font-size");
    await page.viewport(1280, 900);
  }
});

test("empty catalogs and disabled triggers cannot select models", async () => {
  const onModel = vi.fn();
  const screen = await render(fixture(onModel, []));
  try {
    await screen.getByRole("button", { name: "Choose model", exact: true }).click();
    await expect.element(screen.getByText("No authenticated models available")).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await screen.rerender(fixture(onModel, models, true));
    await expect
      .element(screen.getByRole("button", { name: "Choose model", exact: true }))
      .toBeDisabled();
    expect(
      getComputedStyle(screen.getByRole("button", { name: "Choose model", exact: true }).element())
        .cursor,
    ).toBe("not-allowed");
    expect(onModel).not.toHaveBeenCalled();
  } finally {
    await screen.unmount();
  }
});

test("short wide windows keep enlarged model details scrollable and every reasoning level reachable", async () => {
  await page.viewport(1280, 320);
  const root = document.documentElement;
  const font = root.style.getPropertyValue("--ui-font-size");
  root.style.setProperty("--ui-font-size", "18px");
  const catalog = [
    {
      ...models[0]!,
      name: "A very long configured model name that wraps in its detail header",
      thinkingLevels: ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const,
    },
  ];
  const screen = await render(
    fixture(
      vi.fn(),
      catalog.map((model) => ({ ...model, thinkingLevels: [...model.thinkingLevels] })),
    ),
  );
  try {
    await screen.getByRole("button", { name: "Choose model", exact: true }).click();
    const detail = screen.getByRole("region", { name: catalog[0]!.name, exact: true }).element();
    expect(detail.getBoundingClientRect().top).toBeGreaterThanOrEqual(16);
    expect(detail.getBoundingClientRect().bottom).toBeLessThanOrEqual(304);
    const viewport = detail.querySelector('[data-slot="scroll-area-viewport"]')!;
    expect(viewport.scrollHeight).toBeGreaterThan(viewport.clientHeight);
    await userEvent.keyboard("{ArrowDown}{ArrowRight}{End}");
    await expect
      .element(screen.getByRole("button", { name: "Maximum", exact: true }))
      .toHaveFocus();
    expect(viewport.scrollTop).toBeGreaterThan(0);
    await userEvent.keyboard("{Escape}");
  } finally {
    await screen.unmount();
    if (font) root.style.setProperty("--ui-font-size", font);
    else root.style.removeProperty("--ui-font-size");
    await page.viewport(1280, 900);
  }
});
