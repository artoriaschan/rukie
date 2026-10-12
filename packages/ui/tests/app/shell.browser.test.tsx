import { expect, onTestFinished, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../../src/app";
import "../../src/theme.css";

test("titlebar keeps its blank space draggable and its controls clickable at narrow widths", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  const wasDark = document.documentElement.classList.contains("dark");
  const previousFontSize = document.documentElement.style.getPropertyValue("--ui-font-size");
  const region = (element: Element) =>
    getComputedStyle(element).getPropertyValue("-webkit-app-region");
  try {
    await expect.element(screen.getByText("Fix compiler").first()).toBeVisible();
    for (const width of [1280, 420]) {
      await page.viewport(width, 800);
      const header = document.querySelector("header")!;
      expect(region(header)).toBe("drag");
      const shell = document.querySelector("[data-workspace-shell]")!;
      const headerBounds = header.getBoundingClientRect();
      expect(headerBounds.left).toBe(0);
      expect(headerBounds.top).toBe(0);
      expect(headerBounds.width).toBe(width);
      expect(headerBounds.height).toBe(44);
      const safeSpace = header.querySelector('[aria-hidden="true"]')!;
      expect(safeSpace.getBoundingClientRect().width).toBe(76);
      for (const dark of [false, true]) {
        document.documentElement.classList.toggle("dark", dark);
        for (const fontSize of [14, 18]) {
          document.documentElement.style.setProperty("--ui-font-size", `${fontSize}px`);
          const main = screen.getByRole("main").element().getBoundingClientRect();
          expect(main.top).toBe(44);
          expect(main.bottom).toBe(796);
          expect(shell.scrollWidth).toBeLessThanOrEqual(shell.clientWidth);
          expect(header.getBoundingClientRect().height).toBe(44);
        }
      }
      for (const section of header.children) expect(region(section)).not.toBe("no-drag");
      const toggle = screen
        .getByRole("banner")
        .getByRole("button", { name: "Toggle sidebar", exact: true });
      expect(region(toggle.element())).toBe("no-drag");
      const toggleLeft = toggle.element().getBoundingClientRect().left;
      expect(toggleLeft).toBe(156);
      const sidebarBody = screen
        .getByRole("button", { name: "New chat", exact: true })
        .element()
        .closest("aside")!;
      expect(sidebarBody.getBoundingClientRect().width).toBe(268);
      expect(
        screen
          .getByRole("navigation", { name: "Home", exact: true })
          .element()
          .getBoundingClientRect().width,
      ).toBe(52);
      expect(sidebarBody.getBoundingClientRect().top).toBe(44);
      expect(sidebarBody.getBoundingClientRect().bottom).toBe(796);
      const previous = toggle.element().getAttribute("aria-pressed");
      await toggle.click();
      expect(toggle.element().getBoundingClientRect().left).toBe(toggleLeft);
      await expect.element(toggle).toHaveAttribute("aria-pressed", String(previous !== "true"));
      await toggle.click();
      if (width === 420) {
        const backdrop = screen.getByRole("button", { name: "Close sidebar", exact: true });
        await expect.element(backdrop).toBeVisible();
        expect(document.querySelectorAll('button[aria-label="Toggle sidebar"]')).toHaveLength(1);
        const bounds = backdrop.element().getBoundingClientRect();
        await backdrop.click({ position: { x: bounds.width - 8, y: 8 } });
        await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
        await expect.element(backdrop).not.toBeInTheDocument();
        await toggle.click();
      }
    }
    await userEvent.keyboard("{Control>}1{/Control}");
    const title = screen.getByRole("heading", { name: "Fix compiler", exact: true });
    await expect.element(title).toBeVisible();
    expect(getComputedStyle(title.element()).userSelect).toBe("none");
    for (const control of document.querySelectorAll("header button, header [tabindex]"))
      expect(region(control)).toBe("no-drag");
    await screen.getByRole("button", { name: "Session actions" }).click();
    await expect.element(screen.getByRole("menuitem", { name: "Copy", exact: true })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await screen.getByRole("button", { name: "Session summary", exact: true }).click();
    await expect
      .element(screen.getByRole("button", { name: "Session summary", exact: true }))
      .toHaveAttribute("aria-expanded", "true");
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
    await page.viewport(1280, 900);
    document.documentElement.classList.toggle("dark", wasDark);
    if (previousFontSize)
      document.documentElement.style.setProperty("--ui-font-size", previousFontSize);
    else document.documentElement.style.removeProperty("--ui-font-size");
  }
});

test("sidebar searches projects, selects a welcome target and creates a Session on first send", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  try {
    await expect
      .element(screen.getByRole("button", { name: "New chat", exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText("Fix compiler").first()).toBeVisible();
    await screen.getByRole("button", { name: "Search sessions", exact: true }).click();
    await userEvent.keyboard("Project");
    await expect.element(screen.getByRole("option", { name: /Fix compiler/ })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect
      .element(screen.getByRole("button", { name: "Search sessions", exact: true }))
      .toHaveFocus();
    await screen.getByRole("button", { name: "Workspace", exact: true }).click();
    await screen.getByRole("menuitem", { name: "Project", exact: true }).click();
    await expect
      .element(screen.getByRole("heading", { name: /What should we build/ }))
      .toHaveTextContent("What should we build in Project?");
    await screen.getByRole("textbox", { name: "Prompt", exact: true }).fill("Build a compiler");
    await userEvent.keyboard("{Enter}");
    await expect
      .element(screen.getByRole("heading", { name: "Build a compiler", exact: true }))
      .toBeVisible();
    const wire = await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
    expect(wire).toContainEqual(
      expect.objectContaining({
        type: "session.create",
        project: "project",
        text: "Build a compiler",
        modelSelection: { provider: "test", modelId: "script" },
      }),
    );
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("search is a modal keyboard surface and restores focus after selecting with Enter", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  try {
    const trigger = screen.getByRole("button", { name: "Search sessions", exact: true });
    await expect.element(screen.getByText("Fix compiler").first()).toBeVisible();
    await trigger.click();
    const input = screen.getByRole("combobox");
    await expect.element(input).toHaveFocus();
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(
      screen
        .getByRole("dialog", { name: "Command palette" })
        .element()
        .contains(document.activeElement),
    ).toBe(true);
    await input.fill("ideas");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    await expect
      .element(screen.getByRole("heading", { name: "Explore ideas", exact: true }))
      .toBeVisible();
    await expect.element(trigger).toHaveFocus();
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("composer selects reasoning from native capabilities, keeps IME input and uploads images", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  const wire = async () => (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
  try {
    await expect.element(screen.getByRole("button", { name: "Choose model" })).toBeEnabled();
    await screen.getByRole("button", { name: "Choose model" }).click();
    await userEvent.keyboard("{ArrowDown}");
    await expect.element(screen.getByRole("button", { name: "High", exact: true })).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Max", exact: true }))
      .not.toBeInTheDocument();
    await screen.getByRole("button", { name: "High", exact: true }).click();
    await screen.getByRole("button", { name: "Permission mode" }).click();
    await screen.getByRole("menuitemradio", { name: /Full access/ }).click();
    const input = screen.getByRole("textbox", { name: "Prompt", exact: true });
    await input.fill("编译器");
    input
      .element()
      .dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, isComposing: true }),
      );
    expect(
      (await wire()).filter((c: { type: string }) => c.type === "session.create"),
    ).toHaveLength(0);
    await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
    await expect.element(input).toHaveValue("编译器\n");
    const upload = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const transfer = new DataTransfer();
    transfer.items.add(
      new File([new Uint8Array([137, 80, 78, 71])], "diagram.png", { type: "image/png" }),
    );
    upload.files = transfer.files;
    upload.dispatchEvent(new Event("change", { bubbles: true }));
    await expect.element(screen.getByRole("img", { name: "diagram.png" })).toBeVisible();
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(async () => (await wire()).find((c: { type: string }) => c.type === "session.create"))
      .toMatchObject({
        permissionMode: "full-access",
        modelSelection: { provider: "test", modelId: "script", thinkingLevel: "high" },
        images: [{ mimeType: "image/png", name: "diagram.png" }],
      });
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("narrow layout retains new-chat shortcuts, manual project entry and final-disconnect Retry", async () => {
  await page.viewport(420, 800);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  try {
    await screen.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
    await expect
      .element(screen.getByRole("button", { name: "New chat", exact: true }))
      .toBeVisible();
    await screen.getByRole("button", { name: "Add project", exact: true }).click();
    await screen.getByRole("textbox", { name: "Project folder path" }).fill("/manual/project");
    await screen.getByRole("button", { name: "Add", exact: true }).click();
    await expect
      .poll(async () =>
        (await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json()).find(
          (c: { type: string }) => c.type === "project.add",
        ),
      )
      .toMatchObject({ path: "/manual/project" });
    await userEvent.keyboard("{Control>}1{/Control}");
    await expect
      .element(screen.getByRole("heading", { name: "Fix compiler", exact: true }))
      .toBeVisible();
    await screen.getByRole("button", { name: "Session actions" }).click();
    await expect.element(screen.getByRole("menuitem", { name: "Open with" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    window.dispatchEvent(new CustomEvent("rukie:connection-change", { detail: "disconnected" }));
    await expect.element(screen.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await expect
      .element(screen.getByRole("textbox", { name: "Prompt", exact: true }))
      .toBeDisabled();
    await screen.getByRole("button", { name: "Retry", exact: true }).click();
    await expect
      .element(screen.getByRole("textbox", { name: "Prompt", exact: true }))
      .toBeEnabled();
    await userEvent.keyboard("{Meta>}n{/Meta}");
    await expect.element(screen.getByRole("heading", { name: /What would you/ })).toBeVisible();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(innerWidth);
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
    await page.viewport(1280, 900);
  }
});

test("paste and drop preserve named image attachments across final disconnect", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  try {
    const input = screen.getByRole("textbox", { name: "Prompt", exact: true });
    await expect.element(input).toBeEnabled();
    await input.fill("Keep my draft");
    const png = Uint8Array.from(
      atob(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXioAAAAASUVORK5CYII=",
      ),
      (c) => c.charCodeAt(0),
    );
    const pasted = new DataTransfer();
    pasted.items.add(new File([png], "pasted.png", { type: "image/png" }));
    input
      .element()
      .dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: pasted, bubbles: true, cancelable: true }),
      );
    await expect.element(screen.getByRole("img", { name: "pasted.png" })).toBeVisible();
    const dropped = new DataTransfer();
    dropped.items.add(new File([png], "dropped.png", { type: "image/png" }));
    input
      .element()
      .dispatchEvent(
        new DragEvent("drop", { dataTransfer: dropped, bubbles: true, cancelable: true }),
      );
    await expect.element(screen.getByRole("img", { name: "dropped.png" })).toBeVisible();
    window.dispatchEvent(new CustomEvent("rukie:connection-change", { detail: "disconnected" }));
    await expect.element(input).toBeDisabled();
    await expect.element(input).toHaveValue("Keep my draft");
    await expect.element(screen.getByRole("img", { name: "pasted.png" })).toBeVisible();
    await screen.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.element(input).toBeEnabled();
    await input.click();
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(async () =>
        (await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json()).find(
          (c: { type: string }) => c.type === "session.create",
        ),
      )
      .toMatchObject({
        text: "Keep my draft",
        images: [{ name: "pasted.png" }, { name: "dropped.png" }],
      });
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("sidebar preferences, native context facts and readonly-busy Retry remain user visible", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  try {
    await expect.element(screen.getByText("Fix compiler").first()).toBeVisible();
    await screen.getByRole("button", { name: "Sidebar options" }).click();
    await screen.getByRole("menuitem", { name: "Sort sessions", exact: true }).click();
    await screen.getByRole("menuitemradio", { name: "By created time", exact: true }).click();
    await userEvent.keyboard("{Control>}1{/Control}");
    await expect
      .element(screen.getByRole("heading", { name: "Explore ideas", exact: true }))
      .toBeVisible();
    await screen.getByRole("button", { name: "Context usage 25%", exact: true }).click();
    await expect.element(screen.getByText("2.5K / 10K · share of used")).toBeVisible();
    await expect.element(screen.getByText("Opening context", { exact: true })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await fetch(`http://127.0.0.1:${connection.port}/busy`);
    await fetch(`http://127.0.0.1:${connection.port}/disconnect`);
    await expect
      .element(screen.getByText("This Session is open elsewhere. Close it there, then retry."))
      .toBeVisible();
    await expect
      .element(screen.getByRole("textbox", { name: "Prompt", exact: true }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("stopping hands queued text and named images back before the current draft", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  try {
    await expect.element(screen.getByText("Fix compiler").first()).toBeVisible();
    await userEvent.keyboard("{Control>}1{/Control}");
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "snapshot",
        sessionId: "one",
        messages: [],
        compactions: [],
        model: "test/script",
        run: { id: "run" },
      }),
    });
    const prompt = screen.getByRole("textbox", { name: "Prompt", exact: true });
    await prompt.fill("Current draft");
    await screen.getByRole("button", { name: "Stop generating", exact: true }).click();
    await expect.element(prompt).toHaveValue("Queued draft\n\nCurrent draft");
    await expect.element(screen.getByRole("button", { name: "Remove queued.png" })).toBeVisible();
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("Chinese project errors and disconnected pending sends present localized actionable copy", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="zh" />);
  const url = `http://127.0.0.1:${connection.port}`;
  try {
    await screen.getByRole("button", { name: "添加项目", exact: true }).click();
    await screen.getByRole("textbox", { name: "项目文件夹路径" }).fill("/missing");
    await fetch(`${url}/error`, {
      method: "POST",
      body: JSON.stringify({ type: "project.add", code: "project_not_found" }),
    });
    await screen.getByRole("button", { name: "添加", exact: true }).click();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("操作失败：项目文件夹不存在，请重新选择。");
    await fetch(`${url}/error`, {
      method: "POST",
      body: JSON.stringify({ type: "project.add", code: "unsafe-code-secret" }),
    });
    await screen.getByRole("button", { name: "添加", exact: true }).click();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("操作失败：无法处理此操作，请重试。");
    await screen.getByRole("button", { name: "取消", exact: true }).click();
    await fetch(`${url}/hold`);
    await screen.getByRole("textbox", { name: "输入消息", exact: true }).fill("等待回复");
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(async () =>
        (await (await fetch(`${url}/commands`)).json()).some(
          (c: { type: string }) => c.type === "session.create",
        ),
      )
      .toBe(true);
    window.dispatchEvent(new CustomEvent("rukie:connection-change", { detail: "disconnected" }));
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("操作失败：连接已断开，请重试。");
    expect(screen.getByRole("alert").element().textContent).not.toContain("disconnected");
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("sidebar status follows fresh summaries across unselected permission waits and completion", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} />);
  const send = async (message: object) =>
    fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      body: JSON.stringify(message),
    });
  const summary = (running: boolean, waitingPermission: boolean) => ({
    type: "sessions_changed",
    sessions: [
      {
        id: "one",
        title: "Fix compiler with a very long Session title ".repeat(8),
        titleSource: "prompt",
        createdAt: 1,
        updatedAt: 2,
        messageCount: 1,
        model: "test/script",
        cwd: "/project",
        running,
        waitingPermission,
      },
    ],
    projects: [
      { id: "long", path: "/project", name: "Project with a long folder name ".repeat(8) },
    ],
    pinned: [],
    preferences: {},
  });
  try {
    await expect.element(screen.getByText("Fix compiler").first()).toBeVisible();
    await send(summary(true, true));
    await expect.element(screen.getByLabelText("Waiting for confirmation").first()).toBeVisible();
    expect(screen.getByLabelText("Running").elements()).toHaveLength(0);
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    await send({ type: "run_start", sessionId: "one", inputs: [] });
    await screen.getByRole("button", { name: "New chat", exact: true }).click();
    await send(summary(false, false));
    await expect.poll(() => screen.getByLabelText("Running").elements().length).toBe(0);
    expect(screen.getByLabelText("Waiting for confirmation").elements()).toHaveLength(0);
    const sidebar = screen.getByRole("complementary", { name: "Home", exact: true }).element();
    expect(sidebar.scrollWidth).toBeLessThanOrEqual(sidebar.clientWidth);
    for (const child of sidebar.querySelectorAll("div")) {
      if (getComputedStyle(child).overflowY === "auto")
        expect(child.scrollWidth).toBeLessThanOrEqual(child.clientWidth);
    }
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("missing model errors remain actionable and preserve the current draft", async () => {
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  try {
    await expect.element(screen.getByRole("button", { name: "Choose model" })).toBeEnabled();
    await fetch(`http://127.0.0.1:${connection.port}/error`, {
      method: "POST",
      body: JSON.stringify({ type: "session.create", code: "model_unavailable" }),
    });
    const input = screen.getByRole("textbox", { name: "Prompt", exact: true });
    await input.fill("Preserve this draft");
    await userEvent.keyboard("{Enter}");
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Action failed: Choose an available model service before sending.");
    await expect.element(input).toHaveValue("Preserve this draft");
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("C01 navigation restores Session drafts and settings keeps a complete blank titlebar", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  onTestFinished(async () => {
    try {
      await commands.stopWire(connection.port);
    } finally {
      await page.viewport(1280, 900);
    }
  });
  const screen = await render(
    <App
      host={{
        getConnection: async () => connection,
        modelServices: { list: async () => [], save: async () => {}, delete: async () => {} },
      }}
      locale="en"
    />,
  );
  try {
    const back = screen.getByRole("banner").getByRole("button", { name: "Back", exact: true });
    const forward = screen
      .getByRole("banner")
      .getByRole("button", { name: "Forward", exact: true });
    await expect.element(back).toBeDisabled();
    await expect.element(forward).toBeDisabled();
    await expect.element(screen.getByText("Fix compiler").first()).toBeVisible();
    await screen.getByRole("textbox", { name: "Prompt", exact: true }).fill("Welcome draft");
    await userEvent.keyboard("{Control>}1{/Control}");
    await expect
      .element(screen.getByRole("heading", { name: "Fix compiler", exact: true }))
      .toBeVisible();
    await screen.getByRole("textbox", { name: "Prompt", exact: true }).fill("Session draft");
    await back.click();
    await expect
      .element(screen.getByRole("textbox", { name: "Prompt", exact: true }))
      .toHaveValue("Welcome draft");
    await forward.click();
    await expect
      .element(screen.getByRole("heading", { name: "Fix compiler", exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("textbox", { name: "Prompt", exact: true }))
      .toHaveValue("Session draft");
    await userEvent.keyboard("{Control>}2{/Control}");
    await expect
      .element(screen.getByRole("heading", { name: "Explore ideas", exact: true }))
      .toBeVisible();
    await screen.getByRole("textbox", { name: "Prompt", exact: true }).fill("Second Session draft");
    await back.click();
    await expect
      .element(screen.getByRole("heading", { name: "Fix compiler", exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("textbox", { name: "Prompt", exact: true }))
      .toHaveValue("Session draft");
    await forward.click();
    await expect
      .element(screen.getByRole("heading", { name: "Explore ideas", exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("textbox", { name: "Prompt", exact: true }))
      .toHaveValue("Second Session draft");
    await screen.getByRole("button", { name: "Model services", exact: true }).click();
    await expect.element(screen.getByRole("heading", { name: "No model providers" })).toBeVisible();
    const header = screen.getByRole("banner").element();
    expect(header.querySelector("h1")).toBeNull();
    expect(header.querySelector('[aria-label="Toggle sidebar"]')).toBeNull();
    expect(header.getBoundingClientRect().width).toBe(1280);
    expect(getComputedStyle(header.lastElementChild!).borderLeftWidth).toBe("0px");
    expect(back.element().getBoundingClientRect().left).toBe(88);
    expect(forward.element().getBoundingClientRect().left).toBe(122);
    for (const button of [back, forward]) {
      const bounds = button.element().getBoundingClientRect();
      expect(bounds.top + bounds.height / 2).toBe(22);
      expect(getComputedStyle(button.element()).getPropertyValue("-webkit-app-region")).toBe(
        "no-drag",
      );
    }
    await back.click();
    await expect
      .element(screen.getByRole("heading", { name: "Explore ideas", exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("textbox", { name: "Prompt", exact: true }))
      .toHaveValue("Second Session draft");
    await forward.click();
    await expect.element(screen.getByRole("heading", { name: "No model providers" })).toBeVisible();
    await screen.getByRole("button", { name: "Back to app", exact: true }).click();
    await expect
      .element(screen.getByRole("heading", { name: "Explore ideas", exact: true }))
      .toBeVisible();
    await expect.element(forward).toBeDisabled();
  } finally {
    await screen.unmount();
  }
});
