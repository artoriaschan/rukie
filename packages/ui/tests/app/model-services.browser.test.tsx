import { modelServicesFixture } from "../helpers/model-services";
import { expect, onTestFinished, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../../src/app";
import { ModelServices } from "../../src/app/model-services";
import { UiLocaleProvider } from "../../src/lib/i18n";
import type { ModelServiceSummary } from "@rukie/shared";
import "../../src/theme.css";

test("Pencil P01-E empty provider state preserves shell and opens the custom catalog", async () => {
  const originalClass = document.documentElement.className;
  onTestFinished(async () => {
    document.documentElement.className = originalClass;
    await page.viewport(1280, 900);
  });
  await page.viewport(1887, 1210);
  const screen = await render(
    <UiLocaleProvider locale="zh">
      <ModelServices
        services={{
          ...modelServicesFixture,
          list: async () => [],
          save: async () => {},
          delete: async () => {},
        }}
        onClose={() => {}}
        onChanged={async () => {}}
      />
    </UiLocaleProvider>,
  );
  try {
    const panel = document.querySelector<HTMLElement>(".model-services-panel")!;
    const workspace = document.querySelector<HTMLElement>(".model-services-workspace")!;
    const nav = document.querySelector<HTMLElement>(".model-services-navigation-scroll")!;
    console.log(
      "P01-E layout baseline",
      JSON.stringify({
        panel: panel.getBoundingClientRect().toJSON(),
        workspace: workspace.getBoundingClientRect().toJSON(),
        navigation: nav.getBoundingClientRect().toJSON(),
      }),
    );
    await expect.element(screen.getByRole("heading", { name: "暂无模型供应商" })).toBeVisible();
    expect(workspace.getBoundingClientRect().width).toBe(880);
    expect(workspace.getBoundingClientRect().top).toBe(100);
    expect(Math.abs(workspace.getBoundingClientRect().left - 660)).toBeLessThanOrEqual(1);
    expect(nav.getBoundingClientRect().left).toBe(52);
    expect(nav.getBoundingClientRect().width).toBe(268);
    expect(panel.getBoundingClientRect().height).toBe(560);
    expect(panel.getBoundingClientRect().top).toBe(188);
    expect(screen.getByRole("button", { name: "刷新供应商" }).query()).toBeNull();
    expect(document.querySelector(".model-services-providers-scroll")).toBeNull();
    expect(document.querySelector(".model-services-details-scroll")).toBeNull();
    const title = screen.getByRole("heading", { name: "暂无模型供应商" }).element();
    const description = screen.getByText("添加供应商后，即可配置模型并在聊天中使用。").element();
    const action = screen.getByRole("button", { name: "添加供应商", exact: true });
    const icon = panel.querySelector("svg")!;
    for (const dark of [true, false]) {
      document.documentElement.classList.toggle("dark", dark);
      await expect
        .poll(() => getComputedStyle(panel).backgroundColor)
        .toBe(dark ? "rgb(43, 43, 43)" : "rgb(255, 255, 255)");
      expect(getComputedStyle(title).color).toBe(dark ? "rgb(212, 212, 212)" : "rgb(38, 38, 38)");
      expect(getComputedStyle(description).fontSize).toBe("14px");
      expect(getComputedStyle(title).fontSize).toBe("16px");
      expect(getComputedStyle(icon).color).toBe(
        dark
          ? "color(srgb 0.831373 0.831373 0.831373 / 0.3)"
          : "color(srgb 0.14902 0.14902 0.14902 / 0.4)",
      );
      await expect
        .poll(() => getComputedStyle(action.element()).backgroundColor)
        .toBe(dark ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)");
      await expect
        .poll(() => getComputedStyle(action.element()).color)
        .toBe(dark ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)");
      for (const [node, top, width, height] of [
        [icon, 180, 32, 32],
        [title, 232, 560, 24],
        [description, 268, 560, 21],
        [action.element(), 312, 144, 28],
      ] as const) {
        const box = node.getBoundingClientRect();
        expect(box.top - panel.getBoundingClientRect().top).toBe(top);
        expect(box.width).toBe(width);
        expect(box.height).toBe(height);
        expect(
          Math.abs(box.left + box.width / 2 - (panel.getBoundingClientRect().left + 440)),
        ).toBeLessThanOrEqual(1);
      }
    }
    await page.viewport(420, 800);
    expect(document.documentElement.scrollWidth).toBe(420);
    expect(panel.getBoundingClientRect().width).toBeLessThan(420);
    expect(description.getBoundingClientRect().right).toBeLessThanOrEqual(
      panel.getBoundingClientRect().right,
    );
    action.element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByRole("button", { name: "创建自定义供应商" })).toBeVisible();
    await screen.getByRole("button", { name: "返回供应商" }).click();
    await expect.element(screen.getByRole("heading", { name: "暂无模型供应商" })).toBeVisible();
  } finally {
    await screen.unmount();
    document.documentElement.className = originalClass;
    await page.viewport(1280, 900);
  }
});

test("Pencil model footer keeps cancel surface and primary save colors in both themes", async () => {
  const originalClass = document.documentElement.className;
  onTestFinished(() => {
    document.documentElement.className = originalClass;
  });
  await page.viewport(1280, 900);
  const screen = await render(
    <UiLocaleProvider locale="en">
      <ModelServices
        services={{
          ...modelServicesFixture,
          list: async () => [
            {
              id: "local",
              name: "Local",
              api: "openai-completions",
              baseUrl: "https://example.com/v1",
              hasCredential: false,
              models: [{ id: "footer", contextWindow: 128000 }],
            },
          ],
          save: async () => {},
          delete: async () => {},
        }}
        onClose={() => {}}
        onChanged={async () => {}}
      />
    </UiLocaleProvider>,
  );
  try {
    await screen.getByRole("button", { name: "Edit", exact: true }).click();
    const cancel = screen.getByRole("button", { name: "Cancel", exact: true });
    const save = screen.getByRole("button", { name: "Save model", exact: true });
    for (const dark of [true, false]) {
      document.documentElement.classList.toggle("dark", dark);
      const surface = dark ? "rgb(43, 43, 43)" : "rgb(255, 255, 255)";
      const primary = dark ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)";
      const inverse = dark ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)";
      await expect.poll(() => getComputedStyle(cancel.element()).backgroundColor).toBe(surface);
      await expect.poll(() => getComputedStyle(save.element()).backgroundColor).toBe(primary);
      await expect.poll(() => getComputedStyle(save.element()).color).toBe(inverse);
      expect(getComputedStyle(save.element()).fontWeight).toBe("500");
      expect(getComputedStyle(cancel.element()).borderTopWidth).toBe("1px");
      await save.hover();
      await expect.poll(() => getComputedStyle(save.element()).backgroundColor).toBe(primary);
      cancel.element().focus();
      await userEvent.keyboard("{Tab}");
      await expect.element(save).toHaveFocus();
      expect(getComputedStyle(save.element()).outlineStyle).not.toBe("none");
      for (const [button, width] of [
        [cancel, 68],
        [save, 128],
      ] as const) {
        expect(button.element().getBoundingClientRect().width).toBe(width);
        expect(button.element().getBoundingClientRect().height).toBe(36);
        expect(getComputedStyle(button.element()).borderRadius).toBe("12px");
      }
    }
  } finally {
    try {
      await screen.unmount();
    } finally {
      document.documentElement.className = originalClass;
    }
  }
});

test("Pencil model numeric fields hide native steppers while retaining numeric keyboard input", async () => {
  await page.viewport(1280, 900);
  const screen = await render(
    <UiLocaleProvider locale="en">
      <ModelServices
        services={{
          ...modelServicesFixture,
          list: async () => [
            {
              id: "local",
              name: "Local",
              api: "openai-completions",
              baseUrl: "https://example.com/v1",
              hasCredential: false,
              models: [{ id: "numeric", contextWindow: 128000, maxTokens: 16384 }],
            },
          ],
          save: async () => {},
          delete: async () => {},
        }}
        onClose={() => {}}
        onChanged={async () => {}}
      />
    </UiLocaleProvider>,
  );
  try {
    await screen.getByRole("button", { name: "Edit", exact: true }).click();
    await screen.getByRole("button", { name: /Advanced settings/ }).click();
    for (const [name, original] of [
      ["Context window", "128000"],
      ["Maximum output tokens", "16384"],
    ] as const) {
      const field = screen.getByRole("spinbutton", { name });
      const input = field.element() as HTMLInputElement;
      expect(getComputedStyle(input).appearance).toBe("textfield");
      expect(input.type).toBe("number");
      expect(input.min).toBe("1");
      await expect.poll(() => input.parentElement!.getBoundingClientRect().height).toBe(36);
      await field.click();
      await userEvent.keyboard("{ArrowUp}");
      await expect.element(field).toHaveValue(Number(original) + 1);
      await field.fill("0");
      expect(input.validity.rangeUnderflow).toBe(true);
      await field.fill("1");
      expect(input.validity.valid).toBe(true);
    }
  } finally {
    await screen.unmount();
  }
});

test("model services creates a provider and preserves input when encrypted save fails", async () => {
  await page.viewport(1280, 900);
  const originalRootStyle = document.documentElement.getAttribute("style");
  const originalRootClass = document.documentElement.className;
  let providers: ModelServiceSummary[] = [];
  let fail = false;
  const service = {
    ...modelServicesFixture,
    list: async () => providers,
    save: async (input: import("@rukie/shared").ModelServiceSave) => {
      if (fail) throw new Error("unsafe-secret");
      providers = [{ ...input.provider, hasCredential: input.credential.type === "replace" }];
    },
    delete: async () => {
      providers = [];
    },
  };
  const screen = await render(
    <UiLocaleProvider locale="en">
      <ModelServices services={service} onClose={() => {}} onChanged={async () => {}} />
    </UiLocaleProvider>,
  );
  try {
    await screen.getByRole("button", { name: "Add provider", exact: true }).first().click();
    await screen.getByRole("button", { name: "Create custom provider" }).click();
    await screen.getByRole("textbox", { name: "Base URL" }).fill("https://api.example.com/v1");
    await screen.getByLabelText("API Key", { exact: true }).fill("scripted-nonproduction");
    fail = true;
    await screen.getByRole("button", { name: "Save provider" }).click();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent(
        "Could not save. Your input is preserved. Retry or reconfigure credentials.",
      );
    await expect
      .element(screen.getByLabelText("API Key", { exact: true }))
      .toHaveValue("scripted-nonproduction");
    expect(screen.getByRole("alert").element().textContent).not.toContain("unsafe-secret");
    fail = false;
    await screen.getByRole("button", { name: "Save provider" }).click();
    await expect.poll(() => providers.length).toBe(1);
    await screen.getByRole("button", { name: "Add model", exact: true }).click();
    await expect.element(screen.getByRole("checkbox", { name: "Video" })).toBeDisabled();
    await expect.element(screen.getByRole("checkbox", { name: "PDF" })).toBeDisabled();
    await expect
      .element(screen.getByRole("checkbox", { name: "Video" }))
      .toHaveAccessibleDescription(
        "Video, PDF, structured output and native web search are unavailable in the current request adapter.",
      );
    await expect
      .poll(
        () =>
          screen
            .getByRole("button", { name: "Input capabilities information" })
            .element()
            .getBoundingClientRect().width,
      )
      .toBeCloseTo(14, 1);
    await expect
      .poll(
        () =>
          screen
            .getByRole("button", { name: "Input capabilities information" })
            .element()
            .getBoundingClientRect().height,
      )
      .toBeCloseTo(14, 1);
    await expect
      .element(screen.getByRole("radiogroup", { name: "Reasoning capabilities" }))
      .toBeVisible();
    const off = screen.getByRole("radio", { name: "No reasoning" });
    off.element().focus();
    await userEvent.keyboard("{ArrowRight}");
    await expect
      .element(screen.getByRole("radio", { name: "Configurable reasoning" }))
      .toHaveAttribute("aria-checked", "true");
    await expect
      .element(screen.getByRole("radio", { name: "Configurable reasoning" }))
      .toHaveFocus();
    await userEvent.keyboard("{ArrowRight}");
    await expect.element(off).toHaveFocus();
    await expect.element(off).toHaveAttribute("aria-checked", "true");
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    await expect.element(off).toHaveAttribute("aria-checked", "true");
    await screen.getByRole("button", { name: "Input capabilities information" }).click();
    await expect
      .element(page.getByRole("tooltip"))
      .toHaveTextContent(
        "Video, PDF, structured output and native web search are unavailable in the current request adapter.",
      );
    document.documentElement.classList.remove("dark");
    // Model a dark host palette with the independently scoped Light settings theme.
    document.documentElement.style.setProperty("--background", "#0d1117");
    document.documentElement.style.setProperty("--foreground", "#e6edf3");
    const advanced = screen.getByRole("button", { name: /Advanced settings/ });
    expect(getComputedStyle(advanced.element()).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    await advanced.hover();
    await expect
      .poll(() => getComputedStyle(advanced.element()).backgroundColor)
      .toBe("color(srgb 0.931373 0.931373 0.931373)");
    await expect.poll(() => getComputedStyle(advanced.element()).color).toBe("rgb(38, 38, 38)");
    // Rendered Light title/background have 12.98:1 contrast (38 against 237.5).
    advanced.element().focus();
    await expect.element(advanced).toHaveFocus();
    expect(getComputedStyle(advanced.element()).color).toBe("rgb(38, 38, 38)");
    await screen.getByRole("button", { name: /Advanced settings/ }).click();
    await screen.getByRole("textbox", { name: "Model ID", exact: true }).fill("script-model");
    const cancelBox = screen
      .getByRole("dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .element()
      .getBoundingClientRect();
    const saveBox = screen
      .getByRole("button", { name: "Save model", exact: true })
      .element()
      .getBoundingClientRect();
    expect(saveBox.left - cancelBox.right).toBe(8);
    await screen.getByRole("textbox", { name: "Model ID", exact: true }).click();
    await screen.getByRole("button", { name: "Save model", exact: true }).click();
    await expect.poll(() => providers[0]?.models[0]?.id).toBe("script-model");
    await screen.getByRole("button", { name: "Provider actions" }).click();
    await screen.getByRole("menuitem", { name: "Delete provider" }).click();
    await screen.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    expect(providers).toHaveLength(1);
  } finally {
    await screen.unmount();
    if (originalRootStyle === null) document.documentElement.removeAttribute("style");
    else document.documentElement.setAttribute("style", originalRootStyle);
    document.documentElement.className = originalRootClass;
  }
});

test("Chinese narrow settings preserves compatibility, maps, credentials and model operations", async () => {
  await page.viewport(420, 800);
  const initial: ModelServiceSummary = {
    id: "local",
    name: "本地",
    api: "openai-completions",
    baseUrl: "https://api.example.com/v1",
    hasCredential: true,
    models: [
      {
        id: "model-a",
        contextWindow: 100000,
        maxTokens: 5000,
        input: ["text", "image"],
        reasoning: true,
        thinkingLevelMap: { off: null, low: "light", high: "deep", xhigh: null, max: null },
        compat: {
          supportsStrictMode: true,
          maxTokensField: "max_tokens",
          supportsMidConvoSystemMessages: true,
        },
      },
    ],
  };
  let providers = [initial];
  const credentials: string[] = [];
  const tested: string[] = [];
  const services = {
    ...modelServicesFixture,
    list: async () => providers,
    save: async (input: import("@rukie/shared").ModelServiceSave) => {
      credentials.push(input.credential.type);
      providers = [{ ...input.provider, hasCredential: true }];
    },
    delete: async () => {
      providers = [];
    },
    test: async (_id: string, model: string) => {
      tested.push(model);
    },
  };
  const screen = await render(
    <UiLocaleProvider locale="zh">
      <ModelServices services={services} onClose={() => {}} onChanged={async () => {}} />
    </UiLocaleProvider>,
  );
  try {
    await expect.element(screen.getByRole("heading", { name: "本地" })).toBeVisible();
    const root = screen.getByRole("region", { name: "模型服务" }).element();
    expect(root.getBoundingClientRect().width).toBe(420);
    expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
    await screen.getByRole("button", { name: "编辑", exact: true }).click();
    const dialog = screen.getByRole("dialog");
    await expect.element(dialog).toBeVisible();
    expect(dialog.element().getBoundingClientRect().right).toBeLessThanOrEqual(420);
    expect(dialog.element().scrollWidth).toBeLessThanOrEqual(dialog.element().clientWidth);
    await screen.getByRole("textbox", { name: "模型 ID", exact: true }).fill("model-b");
    await screen.getByRole("button", { name: "保存模型", exact: true }).click();
    await expect.poll(() => providers[0]?.models[0]?.id).toBe("model-b");
    expect(providers[0]!.models[0]!.compat).toEqual(initial.models[0]!.compat);
    expect(providers[0]!.models[0]!.thinkingLevelMap).toEqual(initial.models[0]!.thinkingLevelMap);
    expect(credentials).toEqual(["keep"]);
    await screen.getByRole("button", { name: "验证连接", exact: true }).click();
    await expect.element(screen.getByRole("status")).toHaveTextContent("连接验证成功。");
    expect(tested).toEqual(["model-b"]);
    await screen.getByRole("switch", { name: "启用", exact: true }).click();
    await expect.poll(() => providers[0]?.models[0]?.enabled).toBe(false);
    await screen.getByRole("button", { name: "供应商操作", exact: true }).click();
    await screen.getByRole("menuitem", { name: "重命名", exact: true }).click();
    await screen.getByRole("dialog").getByRole("textbox", { name: "供应商名称" }).fill("改名");
    await screen
      .getByRole("dialog")
      .getByRole("button", { name: "保存供应商", exact: true })
      .click();
    await expect.poll(() => providers[0]?.name).toBe("改名");
    await screen.getByRole("button", { name: "编辑", exact: true }).click();
    await userEvent.keyboard("{Escape}");
    await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "供应商操作", exact: true }).click();
    await screen.getByRole("menuitem", { name: "删除供应商", exact: true }).click();
    await expect.element(screen.getByRole("dialog")).toHaveAccessibleName("删除供应商“改名”？");
    await screen.getByRole("dialog").getByRole("button", { name: "确认删除", exact: true }).click();
    await expect.poll(() => providers.length).toBe(0);
  } finally {
    await screen.unmount();
    await page.viewport(1280, 900);
  }
});

test("Pencil advanced settings contains only reference fields and preserves hidden model metadata", async () => {
  await page.viewport(1280, 900);
  let providers: ModelServiceSummary[] = [
    {
      id: "local",
      name: "Local",
      api: "openai-completions",
      baseUrl: "https://api.example.com/v1",
      hasCredential: true,
      models: [
        {
          id: "known",
          contextWindow: 128000,
          maxTokens: 12000,
          reasoning: true,
          thinkingLevelMap: { high: "deep" },
          compat: { supportsMidConvoSystemMessages: true },
        },
      ],
    },
  ];
  const original = structuredClone(providers[0]!.models[0]!);
  const screen = await render(
    <UiLocaleProvider locale="en">
      <ModelServices
        services={{
          ...modelServicesFixture,
          list: async () => providers,
          save: async (input: import("@rukie/shared").ModelServiceSave) => {
            providers = [{ ...input.provider, hasCredential: true }];
          },
          delete: async () => {},
        }}
        onClose={() => {}}
        onChanged={async () => {}}
      />
    </UiLocaleProvider>,
  );
  try {
    await screen.getByRole("button", { name: "Edit", exact: true }).click();
    await screen.getByRole("button", { name: /Advanced settings/ }).click();
    const content = document.querySelector<HTMLElement>(".model-services-advanced")!;
    expect(
      Array.from(content.querySelectorAll("label[for]"), (label) => label.textContent),
    ).toEqual([
      "Compression threshold",
      "Temperature",
      "Maximum output tokens",
      "Maximum tool iterations",
      "Input price",
      "Output price",
      "Cache read price",
      "Cache write price",
      "Price source",
    ]);
    expect(content.querySelectorAll('[role="switch"], [role="checkbox"], textarea')).toHaveLength(
      0,
    );
    expect(
      Array.from(content.querySelectorAll("h3"), (item) => item.firstChild?.textContent),
    ).toEqual(["Automatic compression", "Runtime parameters", "Price (USD / million tokens)"]);
    expect(getComputedStyle(content).gap).toBe("16px");
    expect(content.getBoundingClientRect().width).toBe(608);
    for (const card of content.querySelectorAll<HTMLElement>(".model-services-option-card")) {
      expect(card.getBoundingClientRect().height).toBeGreaterThanOrEqual(189);
      expect(getComputedStyle(card).minHeight).toBe("189px");
      expect(getComputedStyle(card).borderRadius).toBe("16px");
    }
    const values = {
      "Compression threshold": "80",
      Temperature: "0.7",
      "Maximum tool iterations": "3",
      "Input price": "1.5",
      "Output price": "2.5",
      "Cache read price": "0.5",
      "Cache write price": "0.75",
    };
    for (const [name, value] of Object.entries(values))
      await screen.getByRole("spinbutton", { name, exact: true }).fill(value);
    await screen.getByRole("spinbutton", { name: "Temperature", exact: true }).fill("");
    await screen.getByRole("spinbutton", { name: "Temperature", exact: true }).click();
    await userEvent.keyboard("0.7");
    await expect
      .element(screen.getByRole("spinbutton", { name: "Temperature", exact: true }))
      .toHaveValue(0.7);
    await screen
      .getByRole("textbox", { name: "Price source", exact: true })
      .fill("https://prices.example.com");
    await screen.getByRole("checkbox", { name: "Low", exact: true }).click();
    await screen.getByRole("spinbutton", { name: "Maximum output tokens" }).fill("14000");
    await screen.getByRole("button", { name: "Save model", exact: true }).click();
    await expect.poll(() => providers[0]!.models[0]!.maxTokens).toBe(14000);
    expect(providers[0]!.models[0]!.thinkingLevelMap).toEqual({
      ...original.thinkingLevelMap,
      low: null,
    });
    expect(providers[0]!.models[0]!.compat).toEqual(original.compat);
    expect(providers[0]!.models[0]!).toMatchObject({
      compressionThreshold: 80,
      temperature: 0.7,
      maxToolIterations: 3,
      inputPrice: 1.5,
      outputPrice: 2.5,
      cacheReadPrice: 0.5,
      cacheWritePrice: 0.75,
      priceSource: "https://prices.example.com",
    });
    await screen.getByRole("button", { name: "Edit", exact: true }).click();
    await screen.getByRole("button", { name: /Advanced settings/ }).click();
    for (const [name, value] of Object.entries(values))
      await expect
        .element(screen.getByRole("spinbutton", { name, exact: true }))
        .toHaveValue(Number(value));
    await expect
      .element(screen.getByRole("textbox", { name: "Price source", exact: true }))
      .toHaveValue("https://prices.example.com");
  } finally {
    await screen.unmount();
  }
});

test("provider API changes accept compatible models and preserve incompatible drafts", async () => {
  let providers: ModelServiceSummary[] = [
    {
      id: "local",
      name: "Local",
      api: "openai-completions",
      baseUrl: "https://api.example.com/v1",
      hasCredential: true,
      models: [{ id: "m", compat: { supportsMidConvoSystemMessages: true } }],
    },
  ];
  let saved = 0;
  const services = {
    ...modelServicesFixture,
    list: async () => providers,
    save: async (input: import("@rukie/shared").ModelServiceSave) => {
      saved++;
      providers = [{ ...input.provider, hasCredential: true }];
    },
    delete: async () => {},
  };
  const screen = await render(
    <UiLocaleProvider locale="en">
      <ModelServices services={services} onClose={() => {}} onChanged={async () => {}} />
    </UiLocaleProvider>,
  );
  try {
    await screen.getByRole("button", { name: "API format", exact: true }).click();
    await screen.getByRole("option", { name: "Responses (/responses)", exact: true }).click();
    await screen.getByRole("button", { name: "Save provider", exact: true }).click();
    await expect.poll(() => providers[0]?.api).toBe("openai-responses");
    expect(providers[0]!.models[0]!.compat).toEqual({ supportsMidConvoSystemMessages: true });
    providers = [
      { ...providers[0]!, models: [{ id: "m", compat: { supportsAdditionalTools: true } }] },
    ];
  } finally {
    await screen.unmount();
  }
  const incompatible = await render(
    <UiLocaleProvider locale="en">
      <ModelServices services={services} onClose={() => {}} onChanged={async () => {}} />
    </UiLocaleProvider>,
  );
  try {
    await incompatible.getByRole("button", { name: "API format", exact: true }).click();
    await incompatible
      .getByRole("option", { name: "Anthropic Messages (/v1/messages)", exact: true })
      .click();
    await incompatible.getByRole("button", { name: "Save provider", exact: true }).click();
    await expect
      .element(incompatible.getByRole("alert"))
      .toHaveTextContent(
        "Some model compatibility settings do not match this API. Edit or remove the incompatible models before saving.",
      );
    expect(saved).toBe(1);
    expect(providers[0]!.api).toBe("openai-responses");
    await expect
      .element(incompatible.getByRole("button", { name: "API format", exact: true }))
      .toHaveTextContent("Anthropic Messages (/v1/messages)");
  } finally {
    await incompatible.unmount();
  }
});

test("settings returns keyboard focus and preserves chat geometry and draft", async () => {
  const connection = await commands.startWire();
  const services = {
    ...modelServicesFixture,
    list: async () => [],
    save: async () => {},
    delete: async () => {},
  };
  const screen = await render(
    <App host={{ getConnection: async () => connection, modelServices: services }} />,
  );
  try {
    const prompt = screen.getByRole("textbox", { name: "Prompt", exact: true });
    await prompt.fill("preserved draft");
    const main = screen.getByRole("main").element();
    const baseline = main.getBoundingClientRect();
    await screen.getByRole("button", { name: "Model services", exact: true }).click();
    await expect
      .element(screen.getByRole("button", { name: "Back to app", exact: true }))
      .toHaveFocus();
    await screen.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect.element(prompt).toHaveValue("preserved draft");
    await expect
      .element(screen.getByRole("button", { name: "Model services", exact: true }))
      .toHaveFocus();
    const restored = main.getBoundingClientRect();
    for (const key of ["left", "top", "width", "height"] as const)
      expect(Math.abs(restored[key] - baseline[key])).toBeLessThanOrEqual(1);
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("Pencil settings geometry uses current compact workspace and grouped model form", async () => {
  await page.viewport(1887, 1210);
  const services = {
    ...modelServicesFixture,
    list: async () => [
      {
        id: "deepseek",
        name: "DeepSeek",
        api: "anthropic-messages" as const,
        baseUrl: "https://api.deepseek.com/anthropic",
        hasCredential: true,
        models: [],
      },
    ],
    save: async () => {},
    delete: async () => {},
  };
  const screen = await render(
    <UiLocaleProvider locale="zh">
      <ModelServices services={services} onClose={() => {}} onChanged={async () => {}} />
    </UiLocaleProvider>,
  );
  try {
    await expect.element(screen.getByRole("heading", { name: "DeepSeek" })).toBeVisible();
    const workspace = document.querySelector<HTMLElement>(".model-services-workspace");
    expect(workspace).not.toBeNull();
    expect(getComputedStyle(workspace!).fontFamily.startsWith("system-ui")).toBe(true);
    const box = workspace!.getBoundingClientRect();
    expect(box.width).toBe(880);
    expect(box.top).toBe(100);
    expect(Math.abs(box.left - 660)).toBeLessThanOrEqual(1);
    const url = screen
      .getByRole("textbox", { name: "Base URL" })
      .element()
      .parentElement!.getBoundingClientRect();
    expect(url.left).toBe(900);
    expect(url.top).toBe(258);
    expect(url.width).toBe(624);
    expect(url.height).toBe(30);
    const nav = document
      .querySelector<HTMLElement>(".model-services-navigation-scroll")!
      .getBoundingClientRect();
    expect(nav.left).toBe(52);
    expect(nav.width).toBe(268);
    expect(nav.height).toBe(1162);
    await screen.getByRole("button", { name: "API 格式", exact: true }).click();
    const apiMenu = document.querySelector<HTMLElement>(".model-services-api-menu")!;
    await expect.poll(() => apiMenu.getBoundingClientRect().height).toBe(96);
    for (const option of apiMenu.querySelectorAll<HTMLElement>("[role=option]")) {
      expect(getComputedStyle(option.parentElement!).listStyleType).toBe("none");
      expect(option.getBoundingClientRect().height).toBe(28);
      expect(option.parentElement!.getBoundingClientRect().height).toBe(28);
      expect(getComputedStyle(option).paddingLeft).toBe("6px");
      expect(option.getBoundingClientRect().left - apiMenu.getBoundingClientRect().left).toBe(4);
      expect(option.getBoundingClientRect().width).toBe(apiMenu.getBoundingClientRect().width - 8);
    }
    const firstOption = apiMenu.querySelector<HTMLElement>("[role=option]")!;
    expect(firstOption.getBoundingClientRect().top - apiMenu.getBoundingClientRect().top).toBe(4);
    const lastOption = Array.from(apiMenu.querySelectorAll<HTMLElement>("[role=option]")).at(-1)!;
    expect(apiMenu.getBoundingClientRect().bottom - lastOption.getBoundingClientRect().bottom).toBe(
      4,
    );
    expect(apiMenu.getBoundingClientRect().top).toBe(322);
    expect(apiMenu.getBoundingClientRect().width).toBe(624);
    await screen
      .getByRole("option", { name: "Anthropic Messages (/v1/messages)", exact: true })
      .click();
    await screen.getByRole("button", { name: "添加模型", exact: true }).click();
    await expect
      .poll(() => screen.getByRole("dialog").element().getBoundingClientRect().width)
      .toBe(672);
    const context = screen
      .getByRole("spinbutton", { name: "上下文窗口" })
      .element()
      .getBoundingClientRect();
    await expect
      .element(screen.getByRole("button", { name: /高级设置/ }))
      .toHaveAttribute("aria-expanded", "false");
    await screen.getByRole("button", { name: /高级设置/ }).click();
    const tokens = screen
      .getByRole("spinbutton", { name: "最大输出 Token" })
      .element()
      .getBoundingClientRect();
    expect(context.left).toBeGreaterThan(
      screen.getByRole("textbox", { name: "显示名称" }).element().getBoundingClientRect().left,
    );
    expect(tokens.top).toBeGreaterThan(context.top);
    await screen.getByRole("button", { name: "关闭", exact: true }).click();
    await screen.getByRole("button", { name: "供应商操作", exact: true }).click();
    await screen.getByRole("menuitem", { name: "删除供应商", exact: true }).click();
    await expect
      .poll(() => Math.round(screen.getByRole("dialog").element().getBoundingClientRect().height))
      .toBe(180);
    expect(screen.getByRole("dialog").element().getBoundingClientRect().width).toBe(448);
    expect(
      getComputedStyle(
        screen.getByRole("dialog").element().querySelector("kbd")!,
      ).fontFamily.startsWith("ui-monospace"),
    ).toBe(true);
    await expect
      .poll(() => Math.round(screen.getByRole("dialog").element().getBoundingClientRect().top))
      .toBe(520);
  } finally {
    await screen.unmount();
    await page.viewport(1280, 900);
  }
});

test.each([
  {
    theme: "Light",
    dark: false,
    background: "color(srgb 0.931373 0.931373 0.931373)",
    foreground: "rgb(38, 38, 38)",
  },
  {
    theme: "Dark",
    dark: true,
    background: "color(srgb 0.123529 0.123529 0.123529)",
    foreground: "rgb(212, 212, 212)",
  },
])(
  "API option hover stays neutral and preserves selection and geometry in $theme",
  async ({ dark, background, foreground }) => {
    const originalRootClass = document.documentElement.className;
    const restoreRootClass = () => {
      document.documentElement.className = originalRootClass;
    };
    onTestFinished(restoreRootClass);
    document.documentElement.classList.toggle("dark", dark);
    const screen = await render(
      <UiLocaleProvider locale="en">
        <ModelServices
          services={{
            ...modelServicesFixture,
            list: async () => [
              {
                id: "local",
                name: "Local",
                api: "openai-completions",
                baseUrl: "https://api.example.com/v1",
                hasCredential: true,
                models: [],
              },
            ],
            save: async () => {},
            delete: async () => {},
          }}
          onClose={() => {}}
          onChanged={async () => {}}
        />
      </UiLocaleProvider>,
    );
    try {
      await screen.getByRole("button", { name: "API format", exact: true }).click();
      const menu = screen.getByRole("listbox").element();
      await expect.poll(() => menu.getBoundingClientRect().height).toBe(96);
      const option = screen.getByRole("option", { name: "Responses (/responses)", exact: true });
      const selected = screen.getByRole("option", {
        name: "Chat Completions (/chat/completions)",
        exact: true,
      });
      const baseline = option.element().getBoundingClientRect();
      await option.hover();
      await expect.poll(() => getComputedStyle(option.element()).backgroundColor).toBe(background);
      await expect.poll(() => getComputedStyle(option.element()).color).toBe(foreground);
      await expect.element(selected).toHaveAttribute("aria-selected", "true");
      await expect.element(option).toHaveAttribute("aria-selected", "false");
      expect(selected.element().querySelector("svg")!.getBoundingClientRect().width).toBe(16);
      const hovered = option.element().getBoundingClientRect();
      for (const key of ["left", "top", "width", "height"] as const)
        expect(hovered[key]).toBe(baseline[key]);
      expect(hovered.height).toBe(28);
      expect(menu.getBoundingClientRect().height).toBe(96);
    } finally {
      try {
        await screen.unmount();
      } finally {
        restoreRootClass();
      }
    }
  },
);

test("saved overview stays compact; dirty credentials and hidden mapping remain preserved", async () => {
  await page.viewport(1280, 900);
  let providers: ModelServiceSummary[] = [
    {
      id: "local",
      name: "Local",
      api: "openai-completions",
      baseUrl: "https://api.example.com/v1",
      hasCredential: true,
      models: [
        {
          id: "m",
          contextWindow: 128000,
          maxTokens: 16384,
          reasoning: true,
          thinkingLevelMap: { high: "deep" },
        },
      ],
    },
  ];
  const saved: import("@rukie/shared").ModelServiceSave[] = [];
  const services = {
    ...modelServicesFixture,
    list: async () => providers,
    save: async (input: import("@rukie/shared").ModelServiceSave) => {
      saved.push(input);
      providers = [{ ...input.provider, hasCredential: true }];
    },
    delete: async () => {},
  };
  const screen = await render(
    <UiLocaleProvider locale="en">
      <ModelServices services={services} onClose={() => {}} onChanged={async () => {}} />
    </UiLocaleProvider>,
  );
  try {
    await expect.element(screen.getByRole("heading", { name: "Local" })).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Save provider", exact: true }))
      .not.toBeInTheDocument();
    await screen.getByRole("textbox", { name: "Base URL" }).fill("https://replacement.example/v1");
    await screen.getByRole("button", { name: "Save provider", exact: true }).click();
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]!.credential.type).toBe("keep");
    for (const control of screen.getByRole("switch").elements()) {
      expect(control.getBoundingClientRect().width).toBe(32);
      expect(control.getBoundingClientRect().height).toBe(18);
      expect(control.firstElementChild!.getBoundingClientRect().height).toBe(14);
    }
    await screen.getByRole("switch", { name: "Enable provider models", exact: true }).click();
    await expect.poll(() => providers[0]!.models[0]!.enabled).toBe(false);
    await screen.getByRole("button", { name: "Edit", exact: true }).click();
    await screen.getByRole("button", { name: /Advanced settings/ }).click();
    await screen.getByRole("button", { name: "Save model", exact: true }).click();
    await expect.poll(() => saved.length).toBe(3);
    expect(providers[0]!.models[0]!.thinkingLevelMap).toEqual({ high: "deep" });
  } finally {
    await screen.unmount();
  }
});

test("keyboard Cancel preserves provider and credential while confirmation deletes", async () => {
  const provider: ModelServiceSummary = {
    id: "keyboard",
    name: "Keyboard",
    api: "openai-completions",
    baseUrl: "https://api.example.com/v1",
    hasCredential: true,
    models: [],
  };
  let providers = [provider];
  const screen = await render(
    <UiLocaleProvider locale="en">
      <ModelServices
        services={{
          ...modelServicesFixture,
          list: async () => providers,
          save: async () => {},
          delete: async () => {
            providers = [];
          },
        }}
        onClose={() => {}}
        onChanged={async () => {}}
      />
    </UiLocaleProvider>,
  );
  try {
    await expect.element(screen.getByRole("heading", { name: "Keyboard" })).toBeVisible();
    for (const key of ["{Enter}", " "]) {
      await screen.getByRole("button", { name: "Provider actions" }).click();
      await screen.getByRole("menuitem", { name: "Delete provider" }).click();
      await expect
        .element(screen.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }))
        .toBeVisible();
      screen
        .getByRole("dialog")
        .getByRole("button", { name: "Cancel", exact: true })
        .element()
        .focus();
      await userEvent.keyboard(key);
      await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
      expect(providers).toEqual([provider]);
      expect((await Promise.resolve(providers))[0]?.hasCredential).toBe(true);
    }
    await screen.getByRole("button", { name: "Provider actions" }).click();
    await screen.getByRole("menuitem", { name: "Delete provider" }).click();
    await expect
      .element(
        screen.getByRole("dialog").getByRole("button", { name: "Confirm delete", exact: true }),
      )
      .toBeVisible();
    screen
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm delete", exact: true })
      .element()
      .focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => providers.length).toBe(0);
  } finally {
    await screen.unmount();
  }
});

test("Pencil overlay scrollbars appear only for overflow and map keyboard and wheel endpoints", async () => {
  await page.viewport(1280, 900);
  const providers: ModelServiceSummary[] = Array.from({ length: 80 }, (_, index) => ({
    id: `custom-${index}`,
    name: `Custom ${index}`,
    api: "openai-completions",
    baseUrl: "https://api.example.com/v1",
    hasCredential: true,
    models: [],
  }));
  const screen = await render(
    <UiLocaleProvider locale="en">
      <ModelServices
        services={{
          ...modelServicesFixture,
          list: async () => providers,
          save: async () => {},
          delete: async () => {},
        }}
        onClose={() => {}}
        onChanged={async () => {}}
      />
    </UiLocaleProvider>,
  );
  try {
    await expect.element(screen.getByRole("heading", { name: "Custom 0" })).toBeVisible();
    const track = screen.getByRole("scrollbar", { name: "Custom providers" });
    await expect.element(track).toBeVisible();
    const rail = track.element();
    const thumb = rail.firstElementChild!;
    const feed = document.getElementById(rail.getAttribute("aria-controls")!)!;
    expect(rail.getBoundingClientRect().width).toBe(8);
    expect(thumb.getBoundingClientRect().width).toBe(4);
    expect(thumb.getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
    expect(getComputedStyle(feed).scrollbarWidth).toBe("none");
    expect(getComputedStyle(rail).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    rail.focus();
    await userEvent.keyboard("{End}");
    await expect.poll(() => feed.scrollTop + feed.clientHeight).toBe(feed.scrollHeight);
    await expect
      .poll(() =>
        Math.abs(thumb.getBoundingClientRect().bottom - rail.getBoundingClientRect().bottom),
      )
      .toBeLessThanOrEqual(1);
    await userEvent.keyboard("{Home}");
    await expect.poll(() => feed.scrollTop).toBe(0);
    await screen
      .getByRole("button", { name: "Custom 0", exact: true })
      .wheel({ delta: { y: 240, x: 0 } });
    await expect.poll(() => feed.scrollTop).toBeGreaterThan(0);
    rail.focus();
    await userEvent.keyboard("{Home}");
    await expect.poll(() => feed.scrollTop).toBe(0);
    await track.click({ position: { x: 4, y: rail.clientHeight - 4 } });
    await expect.poll(() => feed.scrollTop + feed.clientHeight).toBe(feed.scrollHeight);
    expect(
      getComputedStyle(
        document.querySelector<HTMLElement>(".model-services-details-scroll [role=scrollbar]")!,
      ).visibility,
    ).toBe("hidden");
  } finally {
    await screen.unmount();
    await page.viewport(1280, 900);
  }
});

test("expanded model form uses custom scrollbars at narrow widths", async () => {
  await page.viewport(1280, 900);
  const providers: ModelServiceSummary[] = [
    {
      id: "local",
      name: "Local",
      api: "openai-completions",
      baseUrl: "https://api.example.com/v1",
      hasCredential: true,
      models: [],
    },
  ];
  const screen = await render(
    <UiLocaleProvider locale="en">
      <ModelServices
        services={{
          ...modelServicesFixture,
          list: async () => providers,
          save: async () => {},
          delete: async () => {},
        }}
        onClose={() => {}}
        onChanged={async () => {}}
      />
    </UiLocaleProvider>,
  );
  try {
    await screen.getByRole("button", { name: "Add model", exact: true }).click();

    await screen.getByRole("button", { name: /Advanced settings/ }).click();
    await expect
      .element(screen.getByRole("scrollbar", { name: "Model configuration" }))
      .toBeVisible();
    await page.viewport(420, 900);
    await expect
      .poll(() => document.querySelector<HTMLElement>(".model-services")!.scrollWidth)
      .toBeLessThanOrEqual(420);
    expect(screen.getByRole("dialog").element().getBoundingClientRect().right).toBeLessThanOrEqual(
      420,
    );
  } finally {
    await screen.unmount();
    await page.viewport(1280, 900);
  }
});

test("model default reasoning is selectable, saved and restricted to supported levels", async () => {
  await page.viewport(1280, 900);
  let providers: ModelServiceSummary[] = [
    {
      id: "local",
      name: "Local",
      api: "openai-completions",
      baseUrl: "https://example.com/v1",
      hasCredential: true,
      models: [
        {
          id: "reasoner",
          name: "Separate display name",
          reasoning: true,
          contextWindow: 128000,
          maxTokens: 16384,
          thinkingLevelMap: { high: "deep", xhigh: null, max: null },
        },
      ],
    },
  ];
  const screen = await render(
    <UiLocaleProvider locale="en">
      <ModelServices
        services={{
          ...modelServicesFixture,
          list: async () => providers,
          save: async (input) => {
            providers = [{ ...input.provider, hasCredential: true }];
          },
          delete: async () => {},
        }}
        onClose={() => {}}
        onChanged={async () => {}}
      />
    </UiLocaleProvider>,
  );
  try {
    await screen.getByRole("button", { name: "Edit", exact: true }).click();
    await expect
      .element(screen.getByRole("textbox", { name: "Display name", exact: true }))
      .toBeEnabled();
    await screen.getByRole("textbox", { name: "Model ID", exact: true }).fill("changed-id");
    await expect
      .element(screen.getByRole("textbox", { name: "Display name", exact: true }))
      .toHaveValue("Separate display name");
    await screen
      .getByRole("textbox", { name: "Display name", exact: true })
      .fill("Independent label");
    await expect
      .element(screen.getByRole("textbox", { name: "Model ID", exact: true }))
      .toHaveValue("changed-id");
    const chips = [
      ...document.querySelectorAll(".model-services-reasoning .model-services-chips label > span"),
    ];
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "关闭",
      "自动",
      "Minimal",
      "Low",
      "Medium",
      "High",
      "XHigh",
      "Max",
    ]);
    const field = document.querySelector<HTMLElement>(".model-services-default-reasoning")!;
    await expect.poll(() => field.getBoundingClientRect().width).toBe(188);
    await expect.poll(() => field.getBoundingClientRect().height).toBe(60);
    await screen.getByRole("button", { name: "Default reasoning level", exact: true }).click();
    await expect.element(screen.getByRole("option", { name: "Low", exact: true })).toBeVisible();
    expect(screen.getByRole("option", { name: "XHigh", exact: true }).query()).toBeNull();
    expect(
      [...document.querySelectorAll(".model-services-reasoning-menu [role=option]")].map(
        (option) => option.textContent,
      ),
    ).toEqual(["关闭", "Minimal", "Low", "Medium", "High"]);
    await screen.getByRole("option", { name: "High", exact: true }).click();
    await screen.getByRole("button", { name: "Save model", exact: true }).click();
    await expect.poll(() => providers[0]!.models[0]!.defaultThinkingLevel).toBe("high");
    expect(providers[0]!.models[0]!.id).toBe("changed-id");
    expect(providers[0]!.models[0]!.name).toBe("Independent label");
    expect(providers[0]!.models[0]!.thinkingLevelMap?.high).toBe("deep");
    await screen.getByRole("button", { name: "Edit", exact: true }).click();
    await expect
      .element(screen.getByRole("button", { name: "Default reasoning level", exact: true }))
      .toHaveTextContent("High");
    await screen.getByRole("textbox", { name: "Display name", exact: true }).fill("");
    await screen.getByRole("checkbox", { name: "High", exact: true }).click();
    await screen.getByRole("button", { name: "Default reasoning level", exact: true }).click();
    expect(screen.getByRole("option", { name: "High", exact: true }).query()).toBeNull();
    await userEvent.keyboard("{Escape}");
    await screen.getByRole("button", { name: "Save model", exact: true }).click();
    await expect.poll(() => providers[0]!.models[0]!.defaultThinkingLevel).toBeUndefined();
    expect(providers[0]!.models[0]!.name).toBe("");
    expect(providers[0]!.models[0]!.id).toBe("changed-id");
    await screen.getByRole("button", { name: "Edit", exact: true }).click();
    await expect
      .element(screen.getByRole("textbox", { name: "Display name", exact: true }))
      .toHaveValue("");
    await screen.getByRole("checkbox", { name: "自动", exact: true }).click();
    await screen.getByRole("button", { name: "Default reasoning level", exact: true }).click();
    expect(
      [...document.querySelectorAll(".model-services-reasoning-menu [role=option]")].map(
        (option) => option.textContent,
      ),
    ).toEqual(["关闭", "自动", "Minimal", "Low", "Medium"]);
    await screen.getByRole("option", { name: "自动", exact: true }).click();
    await screen.getByRole("button", { name: "Save model", exact: true }).click();
    await expect.poll(() => providers[0]!.models[0]!.defaultThinkingLevel).toBe("automatic");
  } finally {
    await screen.unmount();
  }
});

test("API Key reveals saved credentials only on request and toggles compact masking without hover effects", async () => {
  const saved: import("@rukie/shared").ModelServiceSave[] = [];
  let reads = 0;
  const services = {
    ...modelServicesFixture,
    list: async () => [
      {
        id: "local",
        name: "Local",
        api: "openai-completions" as const,
        baseUrl: "https://example.com",
        models: [],
        hasCredential: true,
      },
    ],
    save: async (input: import("@rukie/shared").ModelServiceSave) => {
      saved.push(input);
    },
    delete: async () => {},
    revealKey: async () => {
      reads++;
      return "fixture-key-only";
    },
  };
  const screen = await render(
    <UiLocaleProvider locale="en">
      <ModelServices services={services} onClose={() => {}} onChanged={async () => {}} />
    </UiLocaleProvider>,
  );
  try {
    const input = screen.getByLabelText("API Key");
    await expect.element(input).toBeVisible();
    expect(reads).toBe(0);
    await screen.getByRole("button", { name: "Show API Key", exact: true }).click();
    await expect.element(input).toHaveValue("fixture-key-only");
    expect(reads).toBe(1);
    const hide = screen.getByRole("button", { name: "Hide API Key", exact: true });
    expect(getComputedStyle(hide.element()).cursor).toBe("pointer");
    expect(getComputedStyle(hide.element()).transitionDuration).toBe("0s");
    await hide.click();
    await expect.element(input).toHaveValue("");
    expect(input.element().getAttribute("placeholder")).toBe("••••••••");
    await input.fill("replacement-fixture");
    await screen.getByRole("button", { name: "Show API Key", exact: true }).click();
    await expect.element(input).toHaveAttribute("type", "text");
    expect(reads).toBe(1);
    await screen.getByRole("button", { name: "Hide API Key", exact: true }).click();
    await expect.element(input).toHaveAttribute("type", "password");
    await input.fill("");
    await screen.getByRole("textbox", { name: "Base URL" }).fill("https://changed.example.com");
    await screen.getByRole("button", { name: "Show API Key", exact: true }).click();
    await screen.getByRole("button", { name: "Save provider", exact: true }).click();
    await expect.poll(() => saved.length).toBe(1);
    expect(saved[0]!.credential).toEqual({ type: "keep" });
  } finally {
    await screen.unmount();
  }
});

test("API Key ignores cancelled and stale reveals and retries a safe failure", async () => {
  let resolve: (value: string) => void = () => {};
  let failure = false;
  const providers: ModelServiceSummary[] = ["first", "second"].map((id) => ({
    id,
    name: id,
    api: "openai-completions",
    baseUrl: "https://example.com",
    models: [],
    hasCredential: true,
  }));
  const services = {
    ...modelServicesFixture,
    list: async () => providers,
    save: async () => {},
    delete: async () => {},
    revealKey: async () => {
      if (failure) throw new Error("private fixture failure");
      return new Promise<string>((done) => {
        resolve = done;
      });
    },
  };
  const screen = await render(
    <UiLocaleProvider locale="en">
      <ModelServices services={services} onClose={() => {}} onChanged={async () => {}} />
    </UiLocaleProvider>,
  );
  try {
    const input = screen.getByLabelText("API Key");
    await expect.element(input).toBeVisible();
    const show = () => screen.getByRole("button", { name: "Show API Key", exact: true });
    await show().click();
    await screen.getByRole("button", { name: "Hide API Key", exact: true }).click();
    resolve("cancelled-fixture");
    await show().click();
    await screen.getByRole("button", { name: /second/ }).click();
    resolve("stale-fixture");
    await expect
      .element(screen.getByRole("heading", { name: "second", exact: true }))
      .toBeVisible();
    await expect.element(input).toHaveValue("");
    failure = true;
    await show().click();
    await expect
      .element(
        screen.getByText("Could not reveal the saved key. Retry or reconfigure credentials."),
      )
      .toBeVisible();
    expect(document.body.textContent).not.toContain("private fixture failure");
    failure = false;
    await show().click();
    resolve("retry-fixture");
    await expect.element(input).toHaveValue("retry-fixture");
    const hide = screen.getByRole("button", { name: "Hide API Key", exact: true });
    (hide.element() as HTMLButtonElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(input).toHaveValue("");
  } finally {
    await screen.unmount();
  }
});

test("model USD price autofill preserves manual drafts, saves prices and ignores stale model requests", async () => {
  let providers: ModelServiceSummary[] = [
    {
      id: "local",
      name: "Local",
      api: "openai-completions",
      baseUrl: "https://api.deepseek.com/v1",
      hasCredential: false,
      models: [
        {
          id: "deepseek-chat",
          input: ["text"],
          reasoning: false,
          contextWindow: 128000,
          maxTokens: 8192,
          inputPrice: 9,
        },
      ],
    },
  ];
  const requests: string[] = [];
  const pending: ((value: import("@rukie/shared").ModelPriceResult) => void)[] = [];
  const screen = await render(
    <UiLocaleProvider locale="en">
      <ModelServices
        services={{
          ...modelServicesFixture,
          list: async () => providers,
          save: async ({ provider }) => {
            providers = [{ ...provider, hasCredential: false }];
          },
          delete: async () => {},
          prices: async ({ modelId }) => {
            requests.push(modelId);
            return new Promise((resolve) => pending.push(resolve));
          },
        }}
        onClose={() => {}}
        onChanged={async () => {}}
      />
    </UiLocaleProvider>,
  );
  try {
    await screen.getByRole("button", { name: "Edit", exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    await expect
      .element(screen.getByRole("button", { name: "Save model", exact: true }))
      .toBeDisabled();
    expect(
      getComputedStyle(screen.getByRole("button", { name: "Save model", exact: true }).element())
        .cursor,
    ).toBe("not-allowed");
    document.querySelector<HTMLFormElement>(".model-services-model-form")!.requestSubmit();
    expect(providers[0]!.models[0]!.cacheReadPrice).toBeUndefined();
    await screen.getByRole("button", { name: /Advanced settings/ }).click();
    await screen.getByLabelText("Output price", { exact: true }).fill("7.5");
    pending.shift()!({
      status: "found",
      prices: { inputPrice: 0.28, outputPrice: 0.42, cacheReadPrice: 0.028 },
      priceSource: "https://llmprice.cn/ · fixture USD",
    });
    await expect.element(screen.getByLabelText("Input price", { exact: true })).toHaveValue(9);
    await expect.element(screen.getByLabelText("Output price", { exact: true })).toHaveValue(7.5);
    await expect
      .element(screen.getByLabelText("Cache read price", { exact: true }))
      .toHaveValue(0.028);
    await screen.getByRole("button", { name: "Save model", exact: true }).click();
    await expect.poll(() => providers[0]!.models[0]!.cacheReadPrice).toBe(0.028);
    await screen.getByRole("button", { name: "Edit", exact: true }).click();
    await expect.poll(() => requests.length).toBe(2);
    await screen.getByLabelText("Model ID", { exact: true }).fill("different-id");
    document.querySelector<HTMLFormElement>(".model-services-model-form")!.requestSubmit();
    await expect.poll(() => requests.length).toBe(3);
    await expect
      .element(screen.getByRole("button", { name: "Save model", exact: true }))
      .toBeDisabled();
    expect(providers[0]!.models[0]!.id).toBe("deepseek-chat");
    pending.shift()!({
      status: "found",
      prices: { inputPrice: 99, outputPrice: 99, cacheWritePrice: 99 },
      priceSource: "stale",
    });
    await screen.getByRole("button", { name: /Advanced settings/ }).click();
    await expect
      .element(screen.getByLabelText("Cache write price", { exact: true }))
      .toHaveValue(null);
    await expect
      .element(screen.getByLabelText("Price source", { exact: true }))
      .toHaveValue("https://llmprice.cn/ · fixture USD");
    pending.shift()!({ status: "unavailable" });
    await expect
      .element(screen.getByRole("button", { name: "Save model", exact: true }))
      .toBeEnabled();
    expect(
      getComputedStyle(screen.getByRole("button", { name: "Save model", exact: true }).element())
        .cursor,
    ).toBe("pointer");
    await screen.getByRole("button", { name: "Save model", exact: true }).click();
    await expect.poll(() => providers[0]!.models[0]!.id).toBe("different-id");
  } finally {
    await screen.unmount();
  }
});

test("renaming a new provider draft does not require a Base URL", async () => {
  const saved: import("@rukie/shared").ModelServiceSave[] = [];
  const screen = await render(
    <UiLocaleProvider locale="en">
      <ModelServices
        services={{
          ...modelServicesFixture,
          save: async (input) => {
            saved.push(input);
          },
        }}
        onClose={() => {}}
        onChanged={async () => {}}
      />
    </UiLocaleProvider>,
  );
  onTestFinished(() => screen.unmount());
  await screen.getByRole("button", { name: "Add provider", exact: true }).click();
  await screen.getByRole("button", { name: "Create custom provider" }).click();
  await expect.element(screen.getByRole("textbox", { name: "Base URL" })).toHaveValue("");
  await screen.getByRole("button", { name: "Provider actions" }).click();
  await screen.getByRole("menuitem", { name: "Rename provider" }).click();
  await screen.getByRole("textbox", { name: "Provider name" }).fill("Draft supplier");
  await screen.getByRole("button", { name: "Save provider", exact: true }).last().click();
  expect(saved).toEqual([]);
  expect(screen.getByRole("alert").query()?.textContent ?? "").toBe("");
  await expect.element(screen.getByRole("heading", { name: "Draft supplier" })).toBeVisible();
  await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull();
  await screen.getByRole("textbox", { name: "Base URL" }).fill("https://example.com/v1");
  await screen.getByRole("button", { name: "Save provider", exact: true }).click();
  await expect.poll(() => saved[0]?.provider.name).toBe("Draft supplier");
});

test("renaming a saved provider persists its name and rejects blank names", async () => {
  let providers: ModelServiceSummary[] = [
    {
      id: "rename-existing",
      name: "Existing supplier",
      api: "openai-responses",
      baseUrl: "https://example.com/v1",
      models: [],
      hasCredential: false,
    },
  ];
  const saved: import("@rukie/shared").ModelServiceSave[] = [];
  const screen = await render(
    <UiLocaleProvider locale="en">
      <ModelServices
        services={{
          ...modelServicesFixture,
          list: async () => providers,
          save: async (input) => {
            saved.push(input);
            providers = [{ ...input.provider, hasCredential: false }];
          },
        }}
        onClose={() => {}}
        onChanged={async () => {}}
      />
    </UiLocaleProvider>,
  );
  onTestFinished(() => screen.unmount());
  await screen.getByRole("button", { name: "Provider actions" }).click();
  await screen.getByRole("menuitem", { name: "Rename provider" }).click();
  await screen.getByRole("textbox", { name: "Provider name" }).fill("   ");
  await screen.getByRole("button", { name: "Save provider", exact: true }).click();
  await expect.element(screen.getByRole("alert")).toBeVisible();
  expect(saved).toEqual([]);
  await screen.getByRole("textbox", { name: "Provider name" }).fill("Renamed supplier");
  await screen.getByRole("button", { name: "Save provider", exact: true }).click();
  await expect.element(screen.getByRole("heading", { name: "Renamed supplier" })).toBeVisible();
  expect(saved).toEqual([
    {
      provider: {
        id: "rename-existing",
        name: "Renamed supplier",
        api: "openai-responses",
        baseUrl: "https://example.com/v1",
        models: [],
      },
      credential: { type: "keep" },
    },
  ]);
  await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull();
  await screen.getByRole("textbox", { name: "Base URL" }).fill("");
  await screen.getByLabelText("API Key", { exact: true }).fill("fake-draft-key");
  await screen.getByRole("button", { name: "Provider actions" }).click();
  await screen.getByRole("menuitem", { name: "Rename provider" }).click();
  await screen.getByRole("textbox", { name: "Provider name" }).fill("Edited supplier");
  await screen.getByRole("button", { name: "Save provider", exact: true }).last().click();
  await expect.element(screen.getByRole("heading", { name: "Edited supplier" })).toBeVisible();
  expect(screen.getByRole("alert").query()).toBeNull();
  expect(saved).toHaveLength(1);
  await expect.element(screen.getByRole("textbox", { name: "Base URL" })).toHaveValue("");
  await expect
    .element(screen.getByLabelText("API Key", { exact: true }))
    .toHaveValue("fake-draft-key");
});
