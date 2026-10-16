import { promptText } from "../helpers/prompt";
import { expect, onTestFinished, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { App } from "../../src/app";
import { modelServicesFixture } from "../helpers/model-services";
import { ownProjectBrowserTest } from "../helpers/project-browser";
import "../../src/theme.css";

test("Goal confirmation initially focuses Cancel and preserves the draft when cancelled", async () => {
  const owner = ownProjectBrowserTest();
  const connection = await owner.startWire();
  await page.viewport(1280, 900);
  const screen = await owner.render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  const prompt = screen.getByRole("combobox", { name: "Prompt", exact: true });
  await prompt.fill("Keep my target");
  await screen.getByRole("button", { name: "Attach images", exact: true }).click();
  await screen.getByRole("menuitemcheckbox", { name: "Goal mode", exact: true }).click();
  const dialog = screen.getByRole("dialog", { name: "Enable goal mode?", exact: true });
  await expect.element(dialog).toBeVisible();
  await expect.element(dialog.getByRole("button", { name: "Cancel", exact: true })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.poll(() => promptText(prompt.element())).toBe("Keep my target");
  expect(screen.getByRole("button", { name: "Close goal mode", exact: true }).query()).toBeNull();
});

async function fixture(port: number, action: string, value: unknown = {}) {
  await fetch(`http://127.0.0.1:${port}/${action}`, {
    method: "POST",
    body: JSON.stringify(value),
  });
}
async function recorded(port: number) {
  return (await (await fetch(`http://127.0.0.1:${port}/commands`)).json()) as {
    type: string;
    [key: string]: unknown;
  }[];
}

test("Goal confirmation awaits permission success, sends a new Goal and clears only the submitted draft", async () => {
  const owner = ownProjectBrowserTest();
  const connection = await owner.startWire();
  await page.viewport(1280, 900);
  const screen = await owner.render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  const prompt = screen.getByRole("combobox", { name: "Prompt", exact: true });
  await prompt.fill("Ship my goal");
  await screen.getByRole("button", { name: "Attach images", exact: true }).click();
  await screen.getByRole("menuitemcheckbox", { name: "Goal mode", exact: true }).click();
  await screen
    .getByRole("button", { name: "Switch to full access and enable", exact: true })
    .click();
  const chip = screen.getByRole("button", { name: "Close goal mode", exact: true });
  await expect.element(chip).toBeVisible();
  await expect.element(prompt).toHaveFocus();
  await fixture(connection.port, "error", { type: "session.create", code: "goal-busy" });
  await screen.getByRole("button", { name: "Send prompt", exact: true }).click();
  await expect.element(screen.getByRole("alert")).toBeVisible();
  await expect.poll(() => promptText(prompt.element())).toBe("Ship my goal");
  await expect.element(chip).toBeVisible();
  await fixture(connection.port, "hold");
  await screen.getByRole("button", { name: "Send prompt", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await recorded(connection.port)).filter((c) => c.type === "session.create").length,
    )
    .toBe(2);
  await prompt.fill("Newer draft");
  await fixture(connection.port, "flush");
  await expect.poll(() => promptText(prompt.element())).toBe("Newer draft");
  await expect.element(chip).not.toBeInTheDocument();
  const creates = (await recorded(connection.port)).filter((c) => c.type === "session.create");
  expect(creates[1]).toMatchObject({
    goal: true,
    text: "Ship my goal",
    permissionMode: "full-access",
  });
});

test("Existing Session enables only after successful permission response and sends goal_create", async () => {
  const owner = ownProjectBrowserTest();
  const connection = await owner.startWire();
  await page.viewport(1280, 900);
  const screen = await owner.render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  await screen.getByRole("button", { name: "Fix compiler", exact: true }).click();
  const prompt = screen.getByRole("combobox", { name: "Prompt", exact: true });
  await prompt.fill("Existing target");
  await screen.getByRole("button", { name: "Attach images", exact: true }).click();
  await screen.getByRole("menuitemcheckbox", { name: "Goal mode", exact: true }).click();
  await fixture(connection.port, "error", {
    type: "session.set_permission_mode",
    code: "session_busy",
  });
  await screen
    .getByRole("button", { name: "Switch to full access and enable", exact: true })
    .click();
  await expect.element(screen.getByRole("alert")).toBeVisible();
  expect(screen.getByRole("button", { name: "Close goal mode", exact: true }).query()).toBeNull();
  await fixture(connection.port, "hold");
  await screen
    .getByRole("button", { name: "Switch to full access and enable", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await recorded(connection.port)).filter((c) => c.type === "session.set_permission_mode")
          .length,
    )
    .toBe(2);
  expect(screen.getByRole("button", { name: "Close goal mode", exact: true }).query()).toBeNull();
  await fixture(connection.port, "flush");
  await expect
    .element(screen.getByRole("button", { name: "Close goal mode", exact: true }))
    .toBeVisible();
  await screen.getByRole("button", { name: "Send prompt", exact: true }).click();
  await expect
    .poll(async () =>
      (await recorded(connection.port)).find((c) => c.type === "session.goal_create"),
    )
    .toMatchObject({ sessionId: "one", text: "Existing target" });
  await expect.poll(() => promptText(prompt.element())).toBe("");
});

const goal = {
  id: "goal",
  objective:
    "A very long first target that must remain fully accessible even when it truncates across the composer",
  attachments: 0,
  phase: "active",
  armed: true,
  roundsStarted: 1,
  maxRounds: 10,
  elapsedMs: 2000,
  activeSince: 1000,
};
async function publishGoal(port: number, value: unknown) {
  await fixture(port, "message", {
    sessionId: "one",
    type: "tool_state_changed",
    name: "goal",
    value,
  });
}

test("Live Goal state renders above the composer with actions and disappears without a gap", async () => {
  const owner = ownProjectBrowserTest();
  const connection = await owner.startWire();
  await page.viewport(1280, 900);
  const screen = await owner.render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  await screen.getByRole("button", { name: "Fix compiler", exact: true }).click();
  await expect.element(screen.getByRole("combobox", { name: "Prompt", exact: true })).toBeVisible();
  const composer = document.querySelector<HTMLElement>(".conversation-composer")!;
  const baseline = composer.getBoundingClientRect();
  await publishGoal(connection.port, goal);
  await expect.element(screen.getByText("In progress", { exact: true })).toBeVisible();
  const bar = document.querySelector<HTMLElement>(".goal-status-bar")!;
  const box = bar.getBoundingClientRect();
  const after = composer.getBoundingClientRect();
  expect(box.height).toBe(40);
  expect(Math.abs(box.width - after.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.bottom - after.top)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.top - baseline.top)).toBeLessThanOrEqual(1);
  await screen.getByRole("button", { name: "Pause goal", exact: true }).click();
  await expect
    .poll(async () =>
      (await recorded(connection.port)).some((c) => c.type === "session.goal_pause"),
    )
    .toBe(true);
  await publishGoal(connection.port, {
    ...goal,
    phase: "paused",
    armed: false,
    activeSince: undefined,
    elapsedMs: 3000,
  });
  await expect.element(screen.getByText("Paused", { exact: true })).toBeVisible();
  await screen.getByRole("button", { name: "Resume goal", exact: true }).click();
  await screen.getByRole("button", { name: "Delete goal", exact: true }).click();
  const removal = screen.getByRole("dialog", { name: "Delete goal?", exact: true });
  await expect.element(removal).toBeVisible();
  await expect.element(removal.getByRole("button", { name: "Cancel", exact: true })).toHaveFocus();
  expect((await recorded(connection.port)).some((c) => c.type === "session.goal_clear")).toBe(
    false,
  );
  await userEvent.keyboard("{Escape}");
  await expect.element(removal).not.toBeInTheDocument();
  await expect
    .element(screen.getByRole("button", { name: "Delete goal", exact: true }))
    .toHaveFocus();
  await screen.getByRole("button", { name: "Delete goal", exact: true }).click();
  await removal.getByRole("button", { name: "Delete goal", exact: true }).click();
  await expect
    .poll(async () =>
      (await recorded(connection.port))
        .filter((c) => c.type.startsWith("session.goal_"))
        .map((c) => c.type),
    )
    .toEqual(["session.goal_pause", "session.goal_resume", "session.goal_clear"]);
  await publishGoal(connection.port, null);
  await expect.element(screen.getByText("Paused", { exact: true })).not.toBeInTheDocument();
  expect(document.querySelector(".goal-status-bar")).toBeNull();
  expect(Math.abs(composer.getBoundingClientRect().top - baseline.top)).toBeLessThanOrEqual(1);
  expect((await recorded(connection.port)).some((c) => c.type === "abort")).toBe(false);
});

test.each(["new", "one"] as const)(
  "Image-only Goal uses its single creation command (%s)",
  async (id) => {
    const owner = ownProjectBrowserTest();
    const connection = await owner.startWire();
    await page.viewport(1280, 900);
    const screen = await owner.render(
      <App
        host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
        locale="en"
      />,
    );
    if (id === "one")
      await screen.getByRole("button", { name: "Fix compiler", exact: true }).click();
    await expect
      .element(screen.getByRole("combobox", { name: "Prompt", exact: true }))
      .toBeVisible();
    await userEvent.upload(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File([new Uint8Array([137, 80, 78, 71])], "target.png", { type: "image/png" }),
    );
    await expect
      .element(screen.getByRole("img", { name: "target.png", exact: true }))
      .toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Send prompt", exact: true }))
      .toBeDisabled();
    await screen.getByRole("button", { name: "Attach images", exact: true }).click();
    await screen.getByRole("menuitemcheckbox", { name: "Goal mode", exact: true }).click();
    await screen
      .getByRole("button", { name: "Switch to full access and enable", exact: true })
      .click();
    await expect
      .element(screen.getByRole("button", { name: "Send prompt", exact: true }))
      .toBeEnabled();
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(async () =>
        (await recorded(connection.port)).find(
          (c) => c.type === (id === "new" ? "session.create" : "session.goal_create"),
        ),
      )
      .toMatchObject({
        text: "",
        images: [{ name: "target.png", mimeType: "image/png", data: "iVBORw==" }],
        ...(id === "new" ? { goal: true } : { sessionId: "one" }),
      });
    await expect
      .element(screen.getByRole("img", { name: "target.png", exact: true }))
      .not.toBeInTheDocument();
    expect((await recorded(connection.port)).some((c) => c.type === "prompt")).toBe(false);
  },
);

test("Cancelling a pending permission change never arms the Goal draft", async () => {
  const owner = ownProjectBrowserTest();
  const connection = await owner.startWire();
  await page.viewport(1280, 900);
  const screen = await owner.render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  await screen.getByRole("button", { name: "Fix compiler", exact: true }).click();
  await screen.getByRole("button", { name: "Attach images", exact: true }).click();
  await screen.getByRole("menuitemcheckbox", { name: "Goal mode", exact: true }).click();
  await fixture(connection.port, "hold");
  await screen
    .getByRole("button", { name: "Switch to full access and enable", exact: true })
    .click();
  await expect
    .poll(async () =>
      (await recorded(connection.port)).some((c) => c.type === "session.set_permission_mode"),
    )
    .toBe(true);
  await userEvent.keyboard("{Escape}");
  await fixture(connection.port, "flush");
  // A subsequent acknowledged prompt is a transport barrier after the permission response.
  await screen.getByRole("combobox", { name: "Prompt", exact: true }).fill("After cancel");
  await screen.getByRole("button", { name: "Send prompt", exact: true }).click();
  await expect
    .poll(() => promptText(screen.getByRole("combobox", { name: "Prompt", exact: true }).element()))
    .toBe("");
  expect(screen.getByRole("button", { name: "Close goal mode", exact: true }).query()).toBeNull();
  expect(
    (await recorded(connection.port)).filter((c) => c.type === "session.goal_create"),
  ).toHaveLength(0);
});

test("Goal drafts follow navigation and C37 keyboard cancellation preserves text and images", async () => {
  const owner = ownProjectBrowserTest();
  const connection = await owner.startWire();
  await page.viewport(1280, 900);
  const screen = await owner.render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  const prompt = screen.getByRole("combobox", { name: "Prompt", exact: true });
  await prompt.fill("New draft target");
  await userEvent.upload(
    document.querySelector<HTMLInputElement>('input[type="file"]')!,
    new File([new Uint8Array([137, 80, 78, 71])], "keep.png", { type: "image/png" }),
  );
  await screen.getByRole("button", { name: "Attach images", exact: true }).click();
  await screen.getByRole("menuitemcheckbox", { name: "Goal mode", exact: true }).click();
  await screen
    .getByRole("button", { name: "Switch to full access and enable", exact: true })
    .click();
  await screen.getByRole("button", { name: "Fix compiler", exact: true }).click();
  expect(screen.getByRole("button", { name: "Close goal mode", exact: true }).query()).toBeNull();
  await expect.poll(() => promptText(prompt.element())).toBe("");
  await prompt.fill("Session one draft");
  await screen.getByRole("button", { name: "Attach images", exact: true }).click();
  await screen.getByRole("menuitemcheckbox", { name: "Goal mode", exact: true }).click();
  await screen
    .getByRole("button", { name: "Switch to full access and enable", exact: true })
    .click();
  await screen.getByRole("button", { name: "Explore ideas", exact: true }).click();
  expect(screen.getByRole("button", { name: "Close goal mode", exact: true }).query()).toBeNull();
  await screen.getByRole("button", { name: "Back", exact: true }).click();
  await expect.poll(() => promptText(prompt.element())).toBe("Session one draft");
  await expect
    .element(screen.getByRole("button", { name: "Close goal mode", exact: true }))
    .toBeVisible();
  await screen.getByRole("button", { name: "Back", exact: true }).click();
  await expect.poll(() => promptText(prompt.element())).toBe("New draft target");
  const chip = screen.getByRole("button", { name: "Close goal mode", exact: true });
  await expect.element(chip).toBeVisible();
  expect(chip.element().getBoundingClientRect().height).toBe(28);
  await chip.hover();
  expect(getComputedStyle(chip.element().querySelector(".goal-close-icon")!).display).toBe("block");
  expect(getComputedStyle(chip.element().querySelector(".goal-target-icon")!).display).toBe("none");
  chip.element().focus();
  await userEvent.keyboard(" ");
  await expect.element(chip).not.toBeInTheDocument();
  await expect.poll(() => promptText(prompt.element())).toBe("New draft target");
  await expect.element(screen.getByRole("img", { name: "keep.png", exact: true })).toBeVisible();
  await expect.element(prompt).toHaveFocus();
  // Full access skips C42; a later permission choice belongs to this draft and is sent unchanged.
  await screen.getByRole("button", { name: "Attach images", exact: true }).click();
  await screen.getByRole("menuitemcheckbox", { name: "Goal mode", exact: true }).click();
  expect(screen.getByRole("dialog", { name: "Enable goal mode?", exact: true }).query()).toBeNull();
  await screen.getByRole("button", { name: "Permission mode", exact: true }).click();
  await screen.getByRole("menuitemradio", { name: /Ask/ }).click();
  await screen.getByRole("button", { name: "Send prompt", exact: true }).click();
  await expect
    .poll(async () => (await recorded(connection.port)).find((c) => c.type === "session.create"))
    .toMatchObject({ goal: true, permissionMode: "ask", text: "New draft target" });
  expect(screen.getByRole("dialog", { name: "Enable goal mode?", exact: true }).query()).toBeNull();
});

test("Running and unfinished Goal disable C09, while normal input keeps its prompt path", async () => {
  const owner = ownProjectBrowserTest();
  const connection = await owner.startWire();
  await page.viewport(1280, 900);
  const screen = await owner.render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  await screen.getByRole("button", { name: "Fix compiler", exact: true }).click();
  // Another window may publish a Goal after this window has armed its own draft.
  await screen.getByRole("button", { name: "Attach images", exact: true }).click();
  await screen.getByRole("menuitemcheckbox", { name: "Goal mode", exact: true }).click();
  await screen
    .getByRole("button", { name: "Switch to full access and enable", exact: true })
    .click();
  await fixture(connection.port, "message", { sessionId: "one", type: "run_start" });
  await screen.getByRole("button", { name: "Attach images", exact: true }).click();
  const row = screen.getByRole("menuitemcheckbox", { name: "Goal mode", exact: true });
  await expect.element(row).toHaveAttribute("aria-disabled", "true");
  await expect
    .element(screen.getByText("Unavailable while a Run is in progress", { exact: true }))
    .toBeVisible();
  expect(getComputedStyle(row.element()).cursor).toBe("not-allowed");
  const rowElement = row.element();
  if (!(rowElement instanceof HTMLElement)) throw new Error("Menu row must be HTML");
  rowElement.click();
  expect(screen.getByRole("dialog", { name: "Enable goal mode?", exact: true }).query()).toBeNull();
  await userEvent.keyboard("{Escape}");
  await fixture(connection.port, "message", { sessionId: "one", type: "run_end" });
  await publishGoal(connection.port, {
    ...goal,
    phase: "paused",
    armed: false,
    activeSince: undefined,
  });
  const prompt = screen.getByRole("combobox", { name: "Prompt", exact: true });
  await expect
    .element(prompt)
    .toHaveAttribute("aria-placeholder", "Add context, or click Resume to continue");
  await screen.getByRole("button", { name: "Attach images", exact: true }).click();
  await expect.element(row).toHaveAttribute("aria-disabled", "true");
  await expect
    .element(screen.getByText("This Session already has an unfinished goal", { exact: true }))
    .toBeVisible();
  await userEvent.keyboard("{Escape}");
  await publishGoal(connection.port, {
    ...goal,
    phase: "complete",
    armed: false,
    activeSince: undefined,
  });
  await expect.element(screen.getByText("Paused", { exact: true })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Close goal mode", exact: true }).query()).toBeNull();
  await publishGoal(connection.port, {
    ...goal,
    phase: "paused",
    armed: false,
    activeSince: undefined,
  });
  await expect
    .element(prompt)
    .toHaveAttribute("aria-placeholder", "Add context, or click Resume to continue");
  await prompt.fill("More context while paused");
  await screen.getByRole("button", { name: "Send prompt", exact: true }).click();
  await expect.poll(() => promptText(prompt.element())).toBe("");
  await publishGoal(connection.port, goal);
  await fixture(connection.port, "message", { sessionId: "one", type: "run_start" });
  await expect.element(prompt).toHaveAttribute("aria-placeholder", "Request subsequent changes");
  await prompt.fill("Change the next round");
  await userEvent.keyboard("{Enter}");
  await expect.poll(() => promptText(prompt.element())).toBe("");
  const sent = (await recorded(connection.port)).filter((c) => c.type === "prompt");
  expect(sent.map((c) => c.text)).toEqual(["More context while paused", "Change the next round"]);
  expect((await recorded(connection.port)).some((c) => c.type === "session.goal_resume")).toBe(
    false,
  );
  await fixture(connection.port, "message", { sessionId: "one", type: "run_end" });
  await publishGoal(connection.port, {
    ...goal,
    phase: "complete",
    armed: false,
    activeSince: undefined,
  });
  await screen.getByRole("button", { name: "Attach images", exact: true }).click();
  await expect.element(row).not.toHaveAttribute("aria-disabled", "true");
});

test.each([
  { locale: "en", width: 1280, dark: false },
  { locale: "zh", width: 420, dark: true },
] as const)(
  "C42 cancel, backdrop and C37 Enter preserve the draft ($locale)",
  async ({ locale, width, dark }) => {
    const owner = ownProjectBrowserTest();
    const connection = await owner.startWire();
    await page.viewport(width, 900);
    document.documentElement.classList.toggle("dark", dark);
    const screen = await owner.render(
      <App
        host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
        locale={locale}
      />,
    );
    const label =
      locale === "en"
        ? {
            attach: "Attach images",
            mode: "Goal mode",
            title: "Enable goal mode?",
            cancel: "Cancel",
            confirm: "Switch to full access and enable",
            close: "Close goal mode",
            prompt: "Prompt",
            backdrop: "Close modal",
          }
        : {
            attach: "添加图片",
            mode: "目标模式",
            title: "开启目标模式？",
            cancel: "取消",
            confirm: "切换到完全访问并开启",
            close: "关闭目标模式",
            prompt: "输入消息",
            backdrop: "关闭对话框",
          };
    const prompt = screen.getByRole("combobox", { name: label.prompt, exact: true });
    await prompt.fill("Keep this text");
    const open = async () => {
      await screen.getByRole("button", { name: label.attach, exact: true }).click();
      await screen.getByRole("menuitemcheckbox", { name: label.mode, exact: true }).click();
    };
    await open();
    const dialog = screen.getByRole("dialog", { name: label.title, exact: true });
    await expect.element(dialog).toBeVisible();
    const box = dialog.element().getBoundingClientRect();
    expect(Math.abs(box.width - Math.min(448, width - 32))).toBeLessThanOrEqual(1);
    await expect.poll(() => getComputedStyle(dialog.element()).transform).toBe("none");
    expect(getComputedStyle(dialog.element()).borderRadius).toBe("16px");
    const cancel = dialog.getByRole("button", { name: label.cancel, exact: true });
    await expect.element(cancel).toHaveFocus();
    expect(cancel.element().getBoundingClientRect().height).toBe(36);
    expect(
      dialog
        .getByRole("button", { name: label.confirm, exact: true })
        .element()
        .getBoundingClientRect().height,
    ).toBe(36);
    await cancel.click();
    await expect.element(dialog).not.toBeInTheDocument();
    await open();
    await screen
      .getByRole("button", { name: label.backdrop, exact: true })
      .click({ position: { x: 4, y: 4 } });
    await expect.element(dialog).not.toBeInTheDocument();
    expect(
      (await recorded(connection.port)).some((c) => c.type === "session.set_permission_mode"),
    ).toBe(false);
    await open();
    await dialog.getByRole("button", { name: label.confirm, exact: true }).click();
    const chip = screen.getByRole("button", { name: label.close, exact: true });
    await expect.element(chip).toBeVisible();
    chip.element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(chip).not.toBeInTheDocument();
    await expect.poll(() => promptText(prompt.element())).toBe("Keep this text");
    await open();
    await expect.element(chip).toBeVisible();
    await screen.getByRole("button", { name: label.attach, exact: true }).click();
    const row = screen.getByRole("menuitemcheckbox", { name: label.mode, exact: true });
    await expect.element(row).toHaveAttribute("aria-checked", "true");
    row.element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(chip).not.toBeInTheDocument();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  },
);

test("C09 hands focus to C42 without competing traps under reduced motion", async () => {
  const owner = ownProjectBrowserTest();
  await commands.reducedMotion(true);
  const connection = await owner.startWire();
  await page.viewport(1280, 900);
  const overlaps: boolean[] = [];
  const focus = (event: FocusEvent) => {
    if (
      event.target instanceof Element &&
      event.target.closest('[role="dialog"][aria-label="Enable goal mode?"]')
    )
      overlaps.push(Boolean(document.querySelector('[role="menu"][data-state="open"]')));
  };
  window.addEventListener("focusin", focus);
  onTestFinished(() => window.removeEventListener("focusin", focus));
  const errors: string[] = [];
  const error = (event: ErrorEvent) => errors.push(event.message);
  window.addEventListener("error", error);
  onTestFinished(() => window.removeEventListener("error", error));
  const screen = await owner.render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  const prompt = screen.getByRole("combobox", { name: "Prompt", exact: true });
  await prompt.fill("Keep my focus");
  await screen.getByRole("button", { name: "Attach images", exact: true }).click();
  const goalRow = screen
    .getByRole("menuitemcheckbox", { name: "Goal mode", exact: true })
    .element();
  if (!(goalRow instanceof HTMLElement)) throw new Error("Goal row must be HTML");
  goalRow.focus();
  goalRow.click();
  const dialog = screen.getByRole("dialog", { name: "Enable goal mode?", exact: true });
  const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
  await expect.element(cancel).toHaveFocus();
  await userEvent.keyboard("{Tab}");
  await expect
    .element(dialog.getByRole("button", { name: "Switch to full access and enable", exact: true }))
    .toHaveFocus();
  await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
  await expect.element(cancel).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(dialog).not.toBeInTheDocument();
  await screen.getByRole("button", { name: "Attach images", exact: true }).click();
  await screen.getByRole("menuitemcheckbox", { name: "Goal mode", exact: true }).click();
  await expect.element(cancel).toHaveFocus();
  await dialog
    .getByRole("button", { name: "Switch to full access and enable", exact: true })
    .click();
  await expect.element(prompt).toHaveFocus();
  expect(errors).toEqual([]);
  expect(overlaps).not.toContain(true);
});

test.each([
  { locale: "en", width: 1280, dark: false },
  { locale: "zh", width: 420, dark: true },
] as const)(
  "Goal removal keeps actions, errors and active lifecycle at18px ($locale)",
  async ({ locale, width, dark }) => {
    const owner = ownProjectBrowserTest();
    const connection = await owner.startWire();
    await page.viewport(width, 700);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.setProperty("--ui-font-size", "18px");
    onTestFinished(() => {
      document.documentElement.style.removeProperty("--ui-font-size");
    });
    const screen = await owner.render(
      <App
        host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
        locale={locale}
      />,
    );
    if (width < 768)
      await screen
        .getByRole("button", { name: locale === "en" ? "Toggle sidebar" : "切换侧栏", exact: true })
        .click();
    await screen.getByRole("button", { name: "Fix compiler", exact: true }).click();
    await publishGoal(connection.port, goal);
    const trash = screen.getByRole("button", {
      name: locale === "en" ? "Delete goal" : "删除目标",
      exact: true,
    });
    await trash.click();
    const dialog = screen.getByRole("dialog", {
      name: locale === "en" ? "Delete goal?" : "删除目标？",
      exact: true,
    });
    const cancel = dialog.getByRole("button", {
      name: locale === "en" ? "Cancel" : "取消",
      exact: true,
    });
    const confirm = dialog.getByRole("button", {
      name: locale === "en" ? "Delete goal" : "删除目标",
      exact: true,
    });
    await expect.element(cancel).toHaveFocus();
    await expect
      .poll(() => Math.round(dialog.element().getBoundingClientRect().width))
      .toBe(Math.min(448, width - 32));
    await expect.poll(() => getComputedStyle(dialog.element()).transform).toBe("none");
    expect(getComputedStyle(dialog.element()).borderRadius).toBe("16px");
    const body = dialog.element().querySelector(".goal-removal-content")!;
    expect(getComputedStyle(body).padding).toBe("20px 24px");
    expect(cancel.element().getBoundingClientRect().height).toBe(32);
    expect(confirm.element().getBoundingClientRect().height).toBe(36);
    expect(confirm.element().getBoundingClientRect().bottom).toBeLessThanOrEqual(684);
    await fixture(connection.port, "error", { type: "session.goal_clear", code: "session_busy" });
    await confirm.click();
    await expect.element(dialog.getByRole("alert")).toBeVisible();
    await expect.element(cancel).toHaveFocus();
    await fixture(connection.port, "hold");
    await confirm.click();
    await expect.element(confirm).toBeDisabled();
    await expect
      .poll(
        async () =>
          (await recorded(connection.port)).filter((c) => c.type === "session.goal_clear").length,
      )
      .toBe(2);
    await fixture(connection.port, "flush");
    await expect.element(dialog).not.toBeInTheDocument();
    const prompt = screen.getByRole("combobox", {
      name: locale === "en" ? "Prompt" : "输入消息",
      exact: true,
    });
    await publishGoal(connection.port, null);
    await expect.element(prompt).toHaveFocus();
    await expect.poll(() => document.querySelector(".goal-status-bar")).toBeNull();
    expect(
      (await recorded(connection.port)).some(
        (c) => c.type === "abort" || c.type === "session.set_permission_mode",
      ),
    ).toBe(false);
  },
);

test.each(["one", "two", "replacement"] as const)(
  "A dismissed Goal clear response preserves the newer removal and its focus (%s)",
  async (destination) => {
    const sessionId = destination === "two" ? "two" : "one";
    const nextGoalId =
      destination === "replacement"
        ? "replacement-goal"
        : sessionId === "two"
          ? "second-goal"
          : goal.id;
    const owner = ownProjectBrowserTest();
    const connection = await owner.startWire();
    await page.viewport(1280, 900);
    const screen = await owner.render(
      <App
        host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
        locale="en"
      />,
    );
    await screen.getByRole("button", { name: "Fix compiler", exact: true }).click();
    await publishGoal(connection.port, goal);
    const trash = screen.getByRole("button", { name: "Delete goal", exact: true });
    const dialog = screen.getByRole("dialog", { name: "Delete goal?", exact: true });
    await trash.click();
    await fixture(connection.port, "hold?type=session.goal_clear");
    await dialog.getByRole("button", { name: "Delete goal", exact: true }).click();
    await expect
      .poll(async () =>
        (await recorded(connection.port)).filter((c) => c.type === "session.goal_clear"),
      )
      .toMatchObject([{ sessionId: "one" }]);
    if (destination === "replacement") {
      await publishGoal(connection.port, { ...goal, id: nextGoalId });
      await expect.element(dialog).not.toBeInTheDocument();
    } else {
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect.element(dialog).not.toBeInTheDocument();
      await expect.element(trash).toHaveFocus();
    }
    // Dismissal/replacement closes the presentation; the sent clear remains in flight.
    if (sessionId === "two") {
      await screen.getByRole("button", { name: "Explore ideas", exact: true }).click();
      await expect
        .element(screen.getByRole("button", { name: "Attach images", exact: true }))
        .toBeEnabled();
      await fixture(connection.port, "message", {
        sessionId,
        type: "tool_state_changed",
        name: "goal",
        value: { ...goal, id: nextGoalId },
      });
    }
    await trash.click();
    const cancel = dialog.getByRole("button", { name: "Cancel", exact: true });
    await expect.element(cancel).toHaveFocus();
    const newerDialog = dialog.element();
    await fixture(connection.port, "flush");
    // This later WS state is an observable transport/render barrier after the held response.
    await fixture(connection.port, "message", {
      sessionId,
      type: "tool_state_changed",
      name: "goal",
      value: {
        ...goal,
        id: nextGoalId,
        objective: "Target after old response",
      },
    });
    await expect
      .element(screen.getByText("Target after old response", { exact: true }))
      .toBeInTheDocument();
    expect(newerDialog.isConnected).toBe(true);
    await expect.element(cancel).toHaveFocus();
    await expect
      .element(dialog.getByRole("button", { name: "Delete goal", exact: true }))
      .toBeEnabled();
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(trash).toHaveFocus();
    expect(
      (await recorded(connection.port)).filter((c) => c.type === "session.goal_clear"),
    ).toHaveLength(1);
    expect((await recorded(connection.port)).some((c) => c.type === "abort")).toBe(false);
  },
);

test("Goal removal restores Prompt focus when authoritative removal precedes its response", async () => {
  const owner = ownProjectBrowserTest();
  const connection = await owner.startWire();
  await page.viewport(1280, 900);
  const screen = await owner.render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  await screen.getByRole("button", { name: "Fix compiler", exact: true }).click();
  await publishGoal(connection.port, goal);
  await screen.getByRole("button", { name: "Delete goal", exact: true }).click();
  const dialog = screen.getByRole("dialog", { name: "Delete goal?", exact: true });
  await fixture(connection.port, "hold?type=session.goal_clear");
  await dialog.getByRole("button", { name: "Delete goal", exact: true }).click();
  await expect
    .poll(async () =>
      (await recorded(connection.port)).some((c) => c.type === "session.goal_clear"),
    )
    .toBe(true);
  await publishGoal(connection.port, null);
  await expect.element(dialog).not.toBeInTheDocument();
  await fixture(connection.port, "flush");
  // A later wire state exposes a render barrier without focusing any control from the test.
  await fixture(connection.port, "message", {
    type: "session_state",
    sessionId: "one",
    permissionMode: "full-access",
    thinkingLevel: "off",
    contextReport: {
      model: "test/script",
      window: 10000,
      used: 2500,
      categories: [],
      memoryFiles: [],
      mcpTools: [],
      skills: [],
      agentTypes: [],
    },
  });
  await expect
    .element(screen.getByRole("button", { name: "Permission mode", exact: true }))
    .toHaveTextContent("Full access");
  await expect.element(screen.getByRole("combobox", { name: "Prompt", exact: true })).toHaveFocus();
});
