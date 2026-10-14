import { modelServicesFixture } from "../helpers/model-services";
import { expect, onTestFinished, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../../src/app";
import "../../src/theme.css";

test("titlebar keeps its blank space draggable and its controls clickable at narrow widths", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
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
    expect(
      document.querySelector('[role="menu"] kbd,[data-slot="dropdown-menu-shortcut"]'),
    ).toBeNull();
    await expect
      .element(screen.getByRole("menuitem", { name: "Unpin", exact: true }))
      .toBeVisible();
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
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  try {
    await expect
      .element(screen.getByRole("button", { name: "New chat", exact: true }))
      .toBeVisible();
    await expect.element(screen.getByText("Fix compiler").first()).toBeVisible();
    await screen.getByRole("button", { name: "Search chats", exact: true }).click();
    await userEvent.keyboard("Project");
    await expect.element(screen.getByRole("option", { name: /Fix compiler/ })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect
      .element(screen.getByRole("button", { name: "Search chats", exact: true }))
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
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  try {
    const trigger = screen.getByRole("button", { name: "Search chats", exact: true });
    await expect.element(screen.getByText("Fix compiler").first()).toBeVisible();
    await trigger.click();
    const input = screen.getByRole("combobox");
    await expect.element(input).toHaveFocus();
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(
      screen
        .getByRole("dialog", { name: "Search chats" })
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
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
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

test("narrow layout retains new-chat shortcuts, selected project folders and final-disconnect Retry", async () => {
  await page.viewport(420, 800);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{
        getConnection: async () => connection,
        modelServices: modelServicesFixture,
        pickProjectFolder: async () => ["/selected/project"],
      }}
      locale="en"
    />,
  );
  try {
    await screen.getByRole("button", { name: "Toggle sidebar", exact: true }).click();
    await expect
      .element(screen.getByRole("button", { name: "New chat", exact: true }))
      .toBeVisible();
    await screen.getByRole("button", { name: "Add project", exact: true }).click();
    await screen
      .getByRole("button", { name: "Add folders Rukie can read and edit", exact: true })
      .click();
    await screen.getByRole("button", { name: "Create project", exact: true }).click();
    await screen.getByRole("button", { name: "Trust and create", exact: true }).click();
    await expect
      .poll(async () =>
        (await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json()).find(
          (c: { type: string }) => c.type === "project.create",
        ),
      )
      .toMatchObject({ directories: ["/selected/project"], trusted: true });
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
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
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
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  try {
    await expect.element(screen.getByText("Fix compiler").first()).toBeVisible();
    await screen
      .getByRole("region", { name: "Projects", exact: true })
      .getByRole("button", { name: "Sidebar options" })
      .click();
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
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
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
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="zh"
    />,
  );
  const url = `http://127.0.0.1:${connection.port}`;
  try {
    await screen.getByRole("button", { name: "添加项目", exact: true }).click();
    await screen.getByRole("textbox", { name: "项目文件夹路径" }).fill("/missing");
    await fetch(`${url}/error`, {
      method: "POST",
      body: JSON.stringify({ type: "project.create", code: "project_not_found" }),
    });
    await screen.getByRole("button", { name: "创建项目", exact: true }).click();
    await screen.getByRole("button", { name: "信任并创建", exact: true }).click();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("项目文件夹不存在，请重新选择。");
    await fetch(`${url}/error`, {
      method: "POST",
      body: JSON.stringify({ type: "project.create", code: "unsafe-code-secret" }),
    });
    await screen.getByRole("button", { name: "信任并创建", exact: true }).click();
    await expect.element(screen.getByRole("alert")).toHaveTextContent("无法处理此操作，请重试。");
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
  const screen = await render(
    <App host={{ getConnection: async () => connection, modelServices: modelServicesFixture }} />,
  );
  const send = async (message: object) =>
    fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      body: JSON.stringify(message),
    });
  const summary = (running: boolean, waitingPermission: boolean) => ({
    type: "sessions_changed",
    homeDir: "/fixture-home",
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
        projectId: "long",
        running,
        waitingPermission,
      },
    ],
    projects: [
      {
        id: "long",
        directories: ["/project"],
        primary: "/project",
        trusted: true,
        name: "Project with a long folder name ".repeat(8),
      },
    ],
    pinned: [],
    archived: [],
    preferences: {},
  });
  try {
    await expect.element(screen.getByText("Fix compiler").first()).toBeVisible();
    await send(summary(true, true));
    await expect.element(screen.getByLabelText("Waiting for confirmation").first()).toBeVisible();
    // The category keeps its Run feedback while the Session row shows waiting confirmation.
    expect(screen.getByLabelText("Running").elements()).toHaveLength(1);
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
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
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
        modelServices: {
          ...modelServicesFixture,
          list: async () => [],
          save: async () => {},
          delete: async () => {},
        },
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
    await back.click();
    await expect
      .element(screen.getByRole("heading", { name: "Explore ideas", exact: true }))
      .toBeVisible();
    await expect.element(forward).toBeEnabled();
  } finally {
    await screen.unmount();
  }
});

test("sidebar gives each Session one category and hides the empty pinned category", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  try {
    const sidebar = screen.getByRole("complementary", { name: "Home", exact: true });
    await expect
      .element(sidebar.getByRole("button", { name: "Fix compiler", exact: true }))
      .toBeVisible();
    expect(sidebar.getByRole("button", { name: "Fix compiler", exact: true }).all()).toHaveLength(
      1,
    );
    expect(
      [...sidebar.element().querySelectorAll("section")].map((section) =>
        section.getAttribute("aria-label"),
      ),
    ).toEqual(["Pinned", "Projects", "Conversations"]);
    await sidebar.getByRole("button", { name: "Unpin Fix compiler", exact: true }).click();
    await expect
      .element(sidebar.getByRole("region", { name: "Pinned", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(
        sidebar
          .getByRole("region", { name: "Projects", exact: true })
          .getByRole("button", { name: "Fix compiler", exact: true }),
      )
      .toBeVisible();
    expect(sidebar.getByRole("button", { name: "Fix compiler", exact: true }).all()).toHaveLength(
      1,
    );
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("sidebar limits Projects and their Sessions independently and keeps category actions with running feedback", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  try {
    await expect
      .element(screen.getByRole("button", { name: "Fix compiler", exact: true }))
      .toBeVisible();
    const registry = {
      type: "sessions_changed",
      homeDir: "/fixture-home",
      pinned: [],
      archived: [],
      preferences: {},
      projects: Array.from({ length: 6 }, (_, index) => ({
        id: `p${index}`,
        name: `Project ${index}`,
        directories: [`/project${index}`],
        primary: `/project${index}`,
        trusted: true,
      })),
      sessions: Array.from({ length: 7 }, (_, index) => ({
        id: `s${index}`,
        title: `Project Session ${index}`,
        titleSource: "prompt",
        cwd: "/project0",
        projectId: "p0",
        model: "test/script",
        createdAt: 7 - index,
        updatedAt: 7 - index,
        messageCount: 1,
        running: index === 6,
      })),
    };
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      body: JSON.stringify(registry),
    });
    const projects = screen.getByRole("region", { name: "Projects", exact: true });
    await expect
      .element(projects.getByRole("button", { name: "Project 0", exact: true }))
      .toBeVisible();
    await expect
      .element(projects.getByRole("button", { name: "Project 5", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(projects.getByRole("button", { name: "Project Session 5", exact: true }))
      .not.toBeInTheDocument();
    const loading = projects.element().querySelector('[aria-label="Running"]')!;
    expect(loading).not.toBeNull();
    await projects.getByRole("button", { name: "Projects", exact: true }).hover();
    expect(getComputedStyle(loading).opacity).toBe("1");
    await expect
      .element(projects.getByRole("button", { name: "Add project", exact: true }))
      .toBeVisible();
    await projects.getByRole("button", { name: "Show more Projects", exact: true }).click();
    await expect
      .element(projects.getByRole("button", { name: "Project 5", exact: true }))
      .toBeVisible();
    await expect
      .element(projects.getByRole("button", { name: "Project Session 5", exact: true }))
      .not.toBeInTheDocument();
    await projects.getByRole("button", { name: "Show more Project 0", exact: true }).click();
    await expect
      .element(projects.getByRole("button", { name: "Running Project Session 6", exact: true }))
      .toBeVisible();
    await projects.getByRole("button", { name: "Projects", exact: true }).click();
    await expect
      .element(projects.getByRole("button", { name: "Projects", exact: true }))
      .toHaveAttribute("aria-expanded", "false");
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      body: JSON.stringify({ ...registry, preferences: { collapsedGroups: ["projects"] } }),
    });
    await expect.element(projects.getByLabelText("Running", { exact: true })).toBeVisible();
    await expect
      .element(projects.getByRole("button", { name: "Project 0", exact: true }))
      .not.toBeInTheDocument();
    expect(
      getComputedStyle(
        projects
          .getByRole("button", { name: "Projects", exact: true })
          .element()
          .querySelector("svg")!,
      ).opacity,
    ).toBe("1");
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("Session row exposes pin and more on hover and focus and shares pin actions across menu entries", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  try {
    const session = screen.getByRole("button", { name: "Fix compiler", exact: true });
    await expect.element(session).toBeVisible();
    const more = screen.getByRole("button", { name: "Session actions Fix compiler", exact: true });
    await expect.element(more).toBeInTheDocument();
    const pin = screen.getByRole("button", { name: "Unpin Fix compiler", exact: true });
    for (const target of [session, more, pin]) {
      const element = target.element();
      expect(getComputedStyle(element).cursor).toBe("pointer");
      for (const nested of element.querySelectorAll("svg,span"))
        expect(getComputedStyle(nested).cursor).toBe("pointer");
    }
    const back = screen.getByRole("button", { name: "Back", exact: true });
    await expect.element(back).toBeDisabled();
    expect(getComputedStyle(back.element()).cursor).toBe("not-allowed");
    expect(getComputedStyle(back.element().querySelector("svg")!).cursor).toBe("not-allowed");
    const disabledBackground = getComputedStyle(back.element()).backgroundColor;
    await back.hover();
    expect(getComputedStyle(back.element()).backgroundColor).toBe(disabledBackground);
    const backBounds = back.element().getBoundingClientRect();
    expect(
      document
        .elementFromPoint(backBounds.x + backBounds.width / 2, backBounds.y + backBounds.height / 2)
        ?.closest("button"),
    ).toBe(back.element());
    await back.click({ force: true });
    back.element().focus();
    expect(document.activeElement).not.toBe(back.element());
    const send = screen.getByRole("button", { name: "Send prompt", exact: true });
    await expect.element(send).toBeDisabled();
    expect(getComputedStyle(send.element()).cursor).toBe("not-allowed");
    await send.click({ force: true });
    expect(getComputedStyle(more.element()).opacity).toBe("0");
    await session.hover();
    expect(getComputedStyle(more.element()).opacity).toBe("1");
    await screen.getByRole("button", { name: "Search chats", exact: true }).hover();
    session.element().focus();
    expect(getComputedStyle(more.element()).opacity).toBe("1");
    await more.click();
    await expect
      .element(screen.getByRole("menuitem", { name: "Unpin", exact: true }))
      .toBeVisible();
    expect(screen.getByRole("menuitem").all()).toHaveLength(5);
    for (const item of screen.getByRole("menuitem").all()) {
      const cursor =
        item.element().getAttribute("aria-disabled") === "true" ? "not-allowed" : "pointer";
      expect(getComputedStyle(item.element()).cursor).toBe(cursor);
      expect(getComputedStyle(item.element().querySelector("svg")!).cursor).toBe(cursor);
    }
    expect(
      screen
        .getByRole("menuitem")
        .first()
        .element()
        .querySelector("kbd,[data-slot=dropdown-menu-shortcut]"),
    ).toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.element(more).toHaveFocus();
    session.element().focus();
    await userEvent.keyboard("{Shift>}{F10}{/Shift}");
    await expect
      .element(screen.getByRole("menuitem", { name: "Unpin", exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("menuitem", { name: "Rename", exact: true }))
      .toHaveFocus();
    await userEvent.keyboard("u");
    await expect
      .element(screen.getByRole("menuitem", { name: "Unpin", exact: true }))
      .toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect
      .element(screen.getByRole("menuitem", { name: "Archive", exact: true }))
      .toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(session.element().parentElement!.contains(document.activeElement)).toBe(true);
    await session.click({ button: "right", position: { x: 24, y: 16 } });
    await expect
      .element(screen.getByRole("menuitem", { name: "Unpin", exact: true }))
      .toBeVisible();
    expect(screen.getByRole("menuitem").all()).toHaveLength(5);
    const menu = screen.getByRole("menu", { name: "Session actions", exact: true }).element();
    expect(menu.querySelector('span[style*="transform"]')).toBeNull();
    for (const item of screen.getByRole("menuitem").all()) {
      const cursor = item.element().hasAttribute("disabled") ? "not-allowed" : "pointer";
      expect(getComputedStyle(item.element()).cursor).toBe(cursor);
    }
    const point = session.element().getBoundingClientRect();
    await expect
      .poll(() => Math.abs(menu.getBoundingClientRect().left - (point.left + 24)))
      .toBeLessThanOrEqual(1);
    await screen.getByRole("menuitem", { name: "Unpin", exact: true }).click();
    await expect
      .element(screen.getByRole("region", { name: "Pinned", exact: true }))
      .not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Fix compiler", exact: true }).click();
    await screen.getByRole("button", { name: "Session actions", exact: true }).click();
    await screen.getByRole("menuitem", { name: /^Pin/ }).click();
    await expect
      .element(
        screen
          .getByRole("region", { name: "Pinned", exact: true })
          .getByRole("button", { name: "Fix compiler", exact: true }),
      )
      .toBeVisible();
    await userEvent.keyboard("{Control>}");
    await expect
      .element(screen.getByRole("button", { name: /^Fix compiler/ }))
      .toHaveTextContent("Fix compiler");
    await userEvent.keyboard("{/Control}");
  } finally {
    await userEvent.keyboard("{/Control}");
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("archive menu hides a current Session from sidebar and search and returns to new chat", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
      Conversation={({ sessionId }) => <div>Open {sessionId}</div>}
    />,
  );
  try {
    await screen.getByRole("button", { name: "Fix compiler", exact: true }).click();
    await expect.element(screen.getByText("Open one", { exact: true })).toBeVisible();
    await screen.getByRole("button", { name: "Session actions", exact: true }).click();
    await expect
      .element(screen.getByRole("menuitem", { name: "Archive", exact: true }))
      .toBeVisible();
    await screen.getByRole("menuitem", { name: "Archive", exact: true }).click();
    await expect.element(screen.getByText("Open one", { exact: true })).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("button", { name: "Fix compiler", exact: true }))
      .not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("region", { name: "Pinned", exact: true }))
      .not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Search chats", exact: true }).click();
    await expect.element(screen.getByRole("option", { name: /Explore ideas/ })).toBeVisible();
    await expect
      .element(screen.getByRole("option", { name: /Fix compiler/ }))
      .not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    const sent = await fetch(`http://127.0.0.1:${connection.port}/commands`).then((response) =>
      response.json(),
    );
    expect(sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "session.archive", sessionId: "one" }),
        expect.objectContaining({ type: "session.unsubscribe", sessionId: "one" }),
      ]),
    );
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("archive is disabled for running and waiting Sessions in all three menu entries", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      Conversation={({ sessionId }) => <div>Open {sessionId}</div>}
    />,
  );
  try {
    await expect
      .element(screen.getByRole("button", { name: "Fix compiler", exact: true }))
      .toBeVisible();
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      body: JSON.stringify({
        type: "sessions_changed",
        homeDir: "/fixture-home",
        sessions: [
          {
            id: "one",
            title: "Fix compiler",
            titleSource: "prompt",
            updatedAt: 20,
            createdAt: 10,
            messageCount: 1,
            model: "test/script",
            cwd: "/project",
            projectId: "project",
            running: true,
          },
          {
            id: "two",
            title: "Explore ideas",
            titleSource: "prompt",
            updatedAt: 10,
            createdAt: 20,
            messageCount: 1,
            model: "test/script",
            cwd: "/workspace",
            projectId: null,
            waitingPermission: true,
          },
        ],
        projects: [
          {
            id: "project",
            name: "Project",
            directories: ["/project"],
            primary: "/project",
            trusted: true,
          },
        ],
        pinned: ["one"],
        archived: [],
        preferences: {},
      }),
    });
    const more = screen.getByRole("button", { name: "Session actions Fix compiler", exact: true });
    await more.click();
    await expect
      .element(screen.getByRole("menuitem", { name: "Archive", exact: true }))
      .toHaveAttribute("aria-disabled", "true");
    await expect
      .element(screen.getByRole("menuitem", { name: "Permanently delete", exact: true }))
      .toHaveAttribute("aria-disabled", "true");
    const disabledArchive = screen.getByRole("menuitem", { name: "Archive", exact: true });
    expect(getComputedStyle(disabledArchive.element()).cursor).toBe("not-allowed");
    expect(getComputedStyle(disabledArchive.element().querySelector("svg")!).cursor).toBe(
      "not-allowed",
    );
    await disabledArchive.click({ force: true });
    await screen
      .getByRole("menuitem", { name: "Permanently delete", exact: true })
      .click({ force: true });
    await expect.element(disabledArchive).toBeVisible();
    await expect
      .element(screen.getByRole("dialog", { name: "Permanently delete chat?", exact: true }))
      .not.toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await expect.element(more).toHaveFocus();
    const waiting = screen.getByRole("button", {
      name: "Waiting for confirmation Explore ideas",
      exact: true,
    });
    await waiting.click({ button: "right" });
    await expect
      .element(screen.getByRole("menuitem", { name: "Archive", exact: true }))
      .toBeDisabled();
    await expect
      .element(screen.getByRole("menuitem", { name: "Permanently delete", exact: true }))
      .toBeDisabled();
    const disabledContextArchive = screen.getByRole("menuitem", { name: "Archive", exact: true });
    expect(getComputedStyle(disabledContextArchive.element()).cursor).toBe("not-allowed");
    // The opening morph and ResizeObserver placement complete after the initial render.
    await expect
      .poll(() => {
        const contextBounds = disabledContextArchive.element().getBoundingClientRect();
        return document
          .elementFromPoint(
            contextBounds.x + contextBounds.width / 2,
            contextBounds.y + contextBounds.height / 2,
          )
          ?.closest("button");
      })
      .toBe(disabledContextArchive.element());
    await disabledContextArchive.click({ force: true });
    await expect.element(disabledContextArchive).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await screen.getByRole("button", { name: "Running Fix compiler", exact: true }).click();
    await screen.getByRole("button", { name: "Session actions", exact: true }).click();
    await expect
      .element(screen.getByRole("menuitem", { name: "Archive", exact: true }))
      .toHaveAttribute("aria-disabled", "true");
    await expect
      .element(screen.getByRole("menuitem", { name: "Permanently delete", exact: true }))
      .toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("{ArrowDown}{Enter}");
    const sent = await fetch(`http://127.0.0.1:${connection.port}/commands`).then((response) =>
      response.json(),
    );
    expect(sent.some((command: { type: string }) => command.type === "session.archive")).toBe(
      false,
    );
    expect(sent.some((command: { type: string }) => command.type === "session.delete")).toBe(false);
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("archiving another Session keeps the selected conversation open", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      Conversation={({ sessionId }) => <div>Open {sessionId}</div>}
    />,
  );
  try {
    await screen.getByRole("button", { name: "Fix compiler", exact: true }).click();
    await expect.element(screen.getByText("Open one", { exact: true })).toBeVisible();
    await screen
      .getByRole("button", { name: "Session actions Explore ideas", exact: true })
      .click();
    await screen.getByRole("menuitem", { name: "Archive", exact: true }).click();
    await expect
      .element(screen.getByRole("button", { name: "Explore ideas", exact: true }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("Open one", { exact: true })).toBeVisible();
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("permanent delete confirms from all Session menus, cancellation sends nothing and current deletion opens new chat", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      Conversation={({ sessionId }) => <div>Open {sessionId}</div>}
      locale="en"
    />,
  );
  const sent = () =>
    fetch(`http://127.0.0.1:${connection.port}/commands`).then((response) => response.json());
  try {
    const row = screen.getByRole("button", { name: "Fix compiler", exact: true });
    const more = screen.getByRole("button", { name: "Session actions Fix compiler", exact: true });
    await more.click();
    await screen.getByRole("menuitem", { name: "Permanently delete", exact: true }).click();
    await expect
      .element(screen.getByRole("dialog", { name: "Permanently delete chat?", exact: true }))
      .toBeVisible();
    await expect
      .element(
        screen.getByText(
          "This cannot be undone. The chat, subagents, attachments and file history will be permanently removed.",
          { exact: true },
        ),
      )
      .toBeVisible();
    await screen.getByRole("button", { name: "Cancel", exact: true }).click();
    await row.click({ button: "right" });
    await screen.getByRole("menuitem", { name: "Permanently delete", exact: true }).click();
    await userEvent.keyboard("{Escape}");
    await expect
      .element(screen.getByRole("dialog", { name: "Permanently delete chat?", exact: true }))
      .not.toBeInTheDocument();
    await row.click();
    await expect.element(screen.getByText("Open one", { exact: true })).toBeVisible();
    await screen.getByRole("button", { name: "Session actions", exact: true }).click();
    await screen.getByRole("menuitem", { name: "Permanently delete", exact: true }).click();
    await expect.element(screen.getByRole("button", { name: "Cancel", exact: true })).toHaveFocus();
    expect(
      (await sent()).some((command: { type: string }) => command.type === "session.delete"),
    ).toBe(false);
    await screen.getByRole("button", { name: "Permanently delete", exact: true }).click();
    await expect.element(screen.getByText("Open one", { exact: true })).not.toBeInTheDocument();
    await expect.element(row).not.toBeInTheDocument();
    await expect
      .element(screen.getByRole("textbox", { name: "Prompt", exact: true }))
      .toBeVisible();
    expect(
      (await sent()).filter((command: { type: string }) => command.type === "session.delete"),
    ).toMatchObject([{ sessionId: "one" }]);
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("permanent delete keeps failures visible and submitting once preserves another selected Session", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      Conversation={({ sessionId }) => <div>Open {sessionId}</div>}
      locale="zh"
    />,
  );
  try {
    await screen.getByRole("button", { name: "Fix compiler", exact: true }).click();
    await expect.element(screen.getByText("Open one", { exact: true })).toBeVisible();
    await screen.getByRole("button", { name: "会话更多 Explore ideas", exact: true }).click();
    await screen.getByRole("menuitem", { name: "永久删除", exact: true }).click();
    await expect
      .element(screen.getByRole("dialog", { name: "永久删除聊天？", exact: true }))
      .toBeVisible();
    await fetch(`http://127.0.0.1:${connection.port}/error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "session.delete", code: "session_busy" }),
    });
    await screen.getByRole("button", { name: "永久删除", exact: true }).click();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("会话被占用，请在空闲后重试。");
    await expect
      .element(screen.getByRole("dialog", { name: "永久删除聊天？", exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Explore ideas", exact: true }))
      .toBeVisible();
    await fetch(`http://127.0.0.1:${connection.port}/hold`);
    const confirm = screen.getByRole("button", { name: "永久删除", exact: true });
    await confirm.click();
    await expect.element(confirm).toBeDisabled();
    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByRole("button", { name: "取消", exact: true })).toBeDisabled();
    await fetch(`http://127.0.0.1:${connection.port}/flush`);
    await expect
      .element(screen.getByRole("dialog", { name: "永久删除聊天？", exact: true }))
      .not.toBeInTheDocument();
    await expect.element(screen.getByText("Open one", { exact: true })).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Explore ideas", exact: true }))
      .not.toBeInTheDocument();
    const sent = await fetch(`http://127.0.0.1:${connection.port}/commands`).then((response) =>
      response.json(),
    );
    expect(
      sent.filter((command: { type: string }) => command.type === "session.delete"),
    ).toMatchObject([{ sessionId: "two" }, { sessionId: "two" }]);
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("delete confirmation keeps readable destructive colors in both themes and pointer states", async () => {
  await page.viewport(1280, 900);
  await commands.reducedMotion(true);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  const previousClass = document.documentElement.className;
  const luminance = (color: string) => {
    const components = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((value) => {
        const c = value / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * components[0]! + 0.7152 * components[1]! + 0.0722 * components[2]!;
  };
  try {
    await screen.getByRole("button", { name: "Session actions Fix compiler", exact: true }).click();
    await screen.getByRole("menuitem", { name: "Permanently delete", exact: true }).click();
    const confirm = screen.getByRole("button", { name: "Permanently delete", exact: true });
    await expect.element(confirm).toBeVisible();
    for (const theme of ["light", "dark"]) {
      document.documentElement.classList.remove("light", "dark");
      document.documentElement.classList.add(theme);
      for (const state of ["default", "hover", "pressed"]) {
        if (state === "default")
          await screen
            .getByRole("heading", { name: "Permanently delete chat?", exact: true })
            .hover();
        else await confirm.hover();
        if (state === "pressed") {
          confirm.element().focus();
          await userEvent.keyboard("{Space>}");
          expect(confirm.element().matches(":active")).toBe(true);
        }
        const style = getComputedStyle(confirm.element());
        // Effective background composites the translucent destructive hover/pressed fill onto the dialog.
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        context.fillStyle = getComputedStyle(screen.getByRole("dialog").element()).backgroundColor;
        context.fillRect(0, 0, 1, 1);
        context.fillStyle = style.backgroundColor;
        context.fillRect(0, 0, 1, 1);
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
        const bg = luminance(`rgb(${r}, ${g}, ${b})`);
        const fg = luminance(style.color);
        expect(
          (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05),
          `${theme} ${state}`,
        ).toBeGreaterThanOrEqual(4.5);
        if (state === "pressed") {
          confirm.element().blur();
          await userEvent.keyboard("{/Space}");
        }
      }
    }
  } finally {
    document.documentElement.className = previousClass;
    await screen.unmount();
    await commands.stopWire(connection.port);
    await commands.reducedMotion(false);
  }
});

test("delete confirmation scrolls long titles while keeping title and actions visible at narrow height and larger font", async () => {
  await page.viewport(1280, 900);
  await commands.reducedMotion(true);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  const previousFont = document.documentElement.style.getPropertyValue("--ui-font-size");
  try {
    await screen.getByRole("button", { name: "Session actions Fix compiler", exact: true }).click();
    await screen.getByRole("menuitem", { name: "Permanently delete", exact: true }).click();
    await expect.element(screen.getByRole("button", { name: "Cancel", exact: true })).toHaveFocus();
    const normal = screen.getByRole("dialog").element().getBoundingClientRect();
    expect(normal.height).toBe(190);
    expect(normal.width).toBe(480);
    await screen.getByRole("button", { name: "Cancel", exact: true }).click();
    const title = "Long user title ".repeat(1000);
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "sessions_changed",
        homeDir: "/fixture-home",
        sessions: [
          {
            id: "long",
            title,
            titleSource: "user",
            cwd: "/workspace",
            projectId: null,
            updatedAt: 20,
            createdAt: 10,
            messageCount: 0,
            model: "test/script",
          },
        ],
        projects: [],
        pinned: [],
        archived: [],
        preferences: {},
      }),
    });
    await screen.getByRole("button", { name: `Session actions ${title}`, exact: true }).click();
    await screen.getByRole("menuitem", { name: "Permanently delete", exact: true }).click();
    await expect.element(screen.getByRole("button", { name: "Cancel", exact: true })).toHaveFocus();
    for (const font of [14, 18]) {
      document.documentElement.style.setProperty("--ui-font-size", `${font}px`);
      await page.viewport(420, 320);
      const dialog = screen.getByRole("dialog").element();
      const bounds = dialog.getBoundingClientRect();
      const cancel = screen.getByRole("button", { name: "Cancel", exact: true }).element();
      const confirm = screen
        .getByRole("button", { name: "Permanently delete", exact: true })
        .element();
      for (const action of [cancel, confirm]) {
        const rect = action.getBoundingClientRect();
        expect(rect.top).toBeGreaterThanOrEqual(bounds.top);
        expect(rect.bottom).toBeLessThanOrEqual(304);
        expect(
          document
            .elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
            ?.closest("button"),
        ).toBe(action);
      }
      expect(bounds.top).toBeGreaterThanOrEqual(16);
      expect(bounds.bottom).toBeLessThanOrEqual(304);
      expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
      const body = dialog.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')!;
      expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
      expect(body.clientHeight).toBeGreaterThan(0);
      body.focus();
      await userEvent.keyboard("{End}");
      await expect.poll(() => body.scrollTop).toBeGreaterThan(0);
      expect(
        screen
          .getByRole("heading", { name: "Permanently delete chat?", exact: true })
          .element()
          .getBoundingClientRect().top,
      ).toBeGreaterThanOrEqual(bounds.top);
      expect(confirm.getBoundingClientRect().bottom).toBeLessThanOrEqual(304);
      await userEvent.keyboard("{Tab}");
      await expect
        .element(screen.getByRole("scrollbar", { name: "Permanently delete chat?", exact: true }))
        .toHaveFocus();
      await userEvent.keyboard("{Tab}");
      await expect
        .element(screen.getByRole("button", { name: "Cancel", exact: true }))
        .toHaveFocus();
    }
    await userEvent.keyboard("{Enter}");
    await expect
      .element(screen.getByRole("dialog", { name: "Permanently delete chat?", exact: true }))
      .not.toBeInTheDocument();
    const sent = await fetch(`http://127.0.0.1:${connection.port}/commands`).then((response) =>
      response.json(),
    );
    expect(sent.some((command: { type: string }) => command.type === "session.delete")).toBe(false);
  } finally {
    document.documentElement.style.setProperty("--ui-font-size", previousFont);
    await screen.unmount();
    await commands.stopWire(connection.port);
    await commands.reducedMotion(false);
  }
});
