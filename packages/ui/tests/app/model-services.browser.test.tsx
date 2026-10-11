import { expect, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../../src/app";
import { ModelServices } from "../../src/app/model-services";
import { UiLocaleProvider } from "../../src/lib/i18n";
import type { ModelServiceSummary } from "@rukie/shared";
import "../../src/theme.css";

test("model services creates a provider and preserves input when encrypted save fails", async () => {
  await page.viewport(1280, 900);
  const originalRootStyle = document.documentElement.getAttribute("style");
  const originalRootClass = document.documentElement.className;
  let providers: ModelServiceSummary[] = [];
  let fail = false;
  const service = {
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
    const advanced = screen.getByRole("button", { name: /Advanced configuration/ });
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
    await screen.getByRole("button", { name: /Advanced configuration/ }).click();
    await expect
      .element(screen.getByRole("checkbox", { name: "Structured output" }))
      .toBeDisabled();
    await screen.getByRole("textbox", { name: "Model ID", exact: true }).fill("script-model");
    const help = screen.getByRole("button", { name: "Intelligent configuration information" });
    expect(help.element().getBoundingClientRect().width).toBe(24);
    expect(help.element().querySelector("svg")!.getBoundingClientRect().width).toBe(14);
    expect(help.element().getBoundingClientRect().height).toBe(24);
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
    help.element().focus();
    await userEvent.keyboard("{Enter}");
    await expect
      .element(page.getByRole("tooltip"))
      .toHaveTextContent("Use a matching locked catalog template. Unknown IDs remain manual.");
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
    templates: async () => [{ ...initial, id: "template", name: "目录模板" }],
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

test("intelligent configuration uses explicit templates and leaves unknown IDs editable", async () => {
  let providers: ModelServiceSummary[] = [
    {
      id: "local",
      name: "Local",
      api: "openai-responses",
      baseUrl: "https://api.example.com/v1",
      hasCredential: true,
      models: [],
    },
  ];
  const template: import("@rukie/shared").ModelService = {
    id: "catalog",
    name: "Catalog",
    api: "openai-responses",
    baseUrl: "https://api.example.com/v1",
    models: [
      {
        id: "known",
        contextWindow: 200000,
        maxTokens: 12000,
        input: ["text", "image"],
        reasoning: true,
        thinkingLevelMap: { off: null, high: "deep" },
      },
    ],
  };
  const services = {
    list: async () => providers,
    templates: async () => [template],
    save: async (input: import("@rukie/shared").ModelServiceSave) => {
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
    await screen.getByRole("button", { name: "Add model", exact: true }).click();
    await screen.getByRole("button", { name: /Advanced configuration/ }).click();
    await expect
      .element(screen.getByRole("switch", { name: "Intelligent configuration" }))
      .toHaveAttribute("aria-checked", "true");
    await screen.getByRole("textbox", { name: "Model ID", exact: true }).fill("known");
    await expect
      .element(screen.getByRole("spinbutton", { name: "Context window" }))
      .toHaveValue(200000);
    await screen.getByRole("textbox", { name: "Model ID", exact: true }).fill("unknown");
    await expect
      .element(screen.getByText("No matching catalog template. Configure this model manually."))
      .toBeVisible();
    await expect.element(screen.getByRole("spinbutton", { name: "Context window" })).toBeEnabled();
    await screen.getByRole("button", { name: "Save model", exact: true }).click();
    await expect.poll(() => providers[0]?.models[0]?.id).toBe("unknown");
    expect(providers[0]!.models[0]!.input).toEqual(["text", "image"]);
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
  const services = { list: async () => [], save: async () => {}, delete: async () => {} };
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
      .element(screen.getByRole("button", { name: /高级配置/ }))
      .toHaveAttribute("aria-expanded", "false");
    await screen.getByRole("button", { name: /高级配置/ }).click();
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
    await expect
      .poll(() => Math.round(screen.getByRole("dialog").element().getBoundingClientRect().top))
      .toBe(520);
  } finally {
    await screen.unmount();
    await page.viewport(1280, 900);
  }
});

test("saved overview stays compact; dirty credentials and invalid mapping remain explicit", async () => {
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
    await screen.getByRole("button", { name: /Advanced configuration/ }).click();
    const mapping = screen.getByRole("textbox", {
      name: "Provider reasoning parameter",
      exact: true,
    });
    await mapping.fill('{"unknown":"deep"}');
    await screen.getByRole("button", { name: "Save model", exact: true }).click();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent(
        "Enter a JSON object mapping supported reasoning levels to strings or null.",
      );
    await expect.element(mapping).toHaveValue('{"unknown":"deep"}');
    expect(providers[0]!.models[0]!.thinkingLevelMap).toEqual({ high: "deep" });
    await mapping.fill('{"high":"maximum"}');
    await screen.getByRole("button", { name: "Save model", exact: true }).click();
    await expect.poll(() => providers[0]!.models[0]!.thinkingLevelMap?.high).toBe("maximum");
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

test("provider directory offers only the custom path even when templates exist", async () => {
  const templates = ["Anthropic", "OpenAI"].map((name) => ({
    id: name.toLowerCase(),
    name,
    api: "openai-completions" as const,
    baseUrl: "https://api.example.com/v1",
    models: [],
  }));
  const screen = await render(
    <UiLocaleProvider locale="en">
      <ModelServices
        services={{
          list: async () => [],
          templates: async () => templates,
          save: async () => {},
          delete: async () => {},
        }}
        onClose={() => {}}
        onChanged={async () => {}}
      />
    </UiLocaleProvider>,
  );
  try {
    await screen.getByRole("button", { name: "Add provider", exact: true }).first().click();
    await expect
      .element(screen.getByRole("button", { name: "Create custom provider" }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Anthropic", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "OpenAI", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "BigModel", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Z.ai Coding Plan", exact: true }))
      .not.toBeInTheDocument();
    expect(
      screen
        .getByRole("button", { name: "Create custom provider" })
        .element()
        .getBoundingClientRect().height,
    ).toBe(44);
    await screen.getByRole("button", { name: "Create custom provider" }).click();
    await expect.element(screen.getByRole("textbox", { name: "Base URL" })).toHaveValue("");
    await expect.element(screen.getByRole("heading", { name: "New provider" })).toBeVisible();
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
        services={{ list: async () => providers, save: async () => {}, delete: async () => {} }}
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

test("model form and long parameter mapping use custom scrollbars at narrow widths", async () => {
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
        services={{ list: async () => providers, save: async () => {}, delete: async () => {} }}
        onClose={() => {}}
        onChanged={async () => {}}
      />
    </UiLocaleProvider>,
  );
  try {
    await screen.getByRole("button", { name: "Add model", exact: true }).click();

    await screen.getByRole("button", { name: /Advanced configuration/ }).click();
    await expect
      .element(screen.getByRole("scrollbar", { name: "Model configuration" }))
      .toBeVisible();
    await screen
      .getByRole("textbox", { name: "Provider reasoning parameter", exact: true })
      .fill(Array.from({ length: 100 }, (_, index) => `line ${index}`).join("\n"));
    const mappingTrack = screen.getByRole("scrollbar", { name: "Provider reasoning parameter" });
    await expect.element(mappingTrack).toBeVisible();
    const mappingRail = mappingTrack.element();
    const mappingThumb = mappingRail.firstElementChild!;
    expect(mappingThumb.getBoundingClientRect().height).toBe(24);
    mappingRail.focus();
    await userEvent.keyboard("{End}");
    await expect
      .poll(() =>
        Math.abs(
          mappingThumb.getBoundingClientRect().bottom - mappingRail.getBoundingClientRect().bottom,
        ),
      )
      .toBeLessThanOrEqual(1);
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
