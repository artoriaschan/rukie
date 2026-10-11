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
      .element(screen.getByRole("checkbox", { name: "Structured output" }))
      .toBeDisabled();
    await screen.getByRole("textbox", { name: "Model ID", exact: true }).fill("script-model");
    await screen.getByRole("button", { name: "Save model", exact: true }).click();
    await expect.poll(() => providers[0]?.models[0]?.id).toBe("script-model");
    await screen.getByRole("button", { name: "Provider actions" }).click();
    await screen.getByRole("menuitem", { name: "Delete provider" }).click();
    await screen.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    expect(providers).toHaveLength(1);
  } finally {
    await screen.unmount();
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

test("Pencil settings geometry uses compact workspace and stacked model form", async () => {
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
    expect(url.left).toBe(908);
    expect(url.top).toBe(294);
    expect(url.width).toBe(608);
    expect(url.height).toBe(32);
    const nav = document
      .querySelector<HTMLElement>(".model-services-navigation")!
      .getBoundingClientRect();
    expect(nav.left).toBe(52);
    expect(nav.width).toBe(268);
    expect(nav.height).toBe(1162);
    await screen.getByRole("button", { name: "API 格式", exact: true }).click();
    const apiMenu = document.querySelector<HTMLElement>(".model-services-api-menu")!;
    await expect.poll(() => Math.round(apiMenu.getBoundingClientRect().height)).toBe(108);
    expect(apiMenu.getBoundingClientRect().top).toBe(366);
    expect(apiMenu.getBoundingClientRect().width).toBe(608);
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
    const tokens = screen
      .getByRole("spinbutton", { name: "最大输出 Token" })
      .element()
      .getBoundingClientRect();
    expect(context.left).toBe(tokens.left);
    expect(tokens.top - context.top).toBe(80);
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
    await screen.getByRole("switch", { name: "Enable provider models", exact: true }).click();
    await expect.poll(() => providers[0]!.models[0]!.enabled).toBe(false);
    await screen.getByRole("button", { name: "Edit", exact: true }).click();
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
