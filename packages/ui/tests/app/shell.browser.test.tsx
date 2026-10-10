import { expect, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../../src/app";
import "../../src/theme.css";

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
      .element(screen.getByRole("button", { name: "Maximum", exact: true }))
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
    await expect
      .element(screen.getByRole("menuitem", { name: "Open with" }))
      .not.toBeInTheDocument();
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
    await expect.element(screen.getByText("2,500 / 10,000 (25%)")).toBeVisible();
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
