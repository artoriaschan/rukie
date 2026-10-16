import { expect, test, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { PlanPreview } from "../../src/components/plan-preview";
import { Transcript } from "../../src/components/transcript";
import { createDesktopStore } from "../../src/store";
import { UiLocaleProvider } from "../../src/lib/i18n";
import { App } from "../../src/app";
import { modelServicesFixture } from "../helpers/model-services";
import "../../src/theme.css";

test("plan review replaces the composer and approves without losing its draft", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  const identity = {
    epoch: "question-one",
    requestId: "question-one",
    taskId: 1,
    conversationId: 1,
  };
  const send = async (facts: object) => {
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "one", ...facts }),
    });
  };
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    const draft = screen.getByRole("textbox", { name: "Prompt", exact: true });
    await draft.fill("Keep this draft");
    await send({ type: "tool_state_changed", name: "plan", value: { active: true } });
    await expect.element(screen.getByRole("button", { name: "Close plan mode" })).toBeVisible();
    await send({
      type: "interaction_requested",
      identity,
      request: {
        kind: "plan_review",
        identity,
        toolCallId: "question-call",
        plan: "# Storage migration",
      },
    });
    await expect
      .element(screen.getByRole("region", { name: "Plan review required" }))
      .toBeVisible();
    await expect.element(draft).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Plan review required" }).element().getBoundingClientRect()
        .width,
    ).toBeCloseTo(752, 0);
    await userEvent.keyboard("1{Enter}");
    await expect.element(draft).toHaveValue("Keep this draft");
    await expect.element(draft).toHaveFocus();
    await expect.element(screen.getByRole("button", { name: "Close plan mode" })).toBeVisible();
    await send({ type: "tool_state_changed", name: "plan", value: { active: false } });
    await expect
      .element(screen.getByRole("button", { name: "Close plan mode" }))
      .not.toBeInTheDocument();

    const wire = await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
    expect(
      wire.filter((command: { type: string }) => command.type === "session.set_permission_mode"),
    ).toEqual([]);
    expect(wire).toContainEqual(
      expect.objectContaining({
        type: "interaction.reply",
        kind: "plan_review",
        identity,
        reply: { kind: "approve" },
      }),
    );
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("submitted plans remain visible outside collapsed Trace before execution starts", async () => {
  const store = createDesktopStore();
  store.receive({
    type: "snapshot",
    sessionId: "one",
    model: "test/script",
    compactions: [],
    messages: [
      { role: "user", timestamp: 1, entryId: "user", content: "Plan it" },
      {
        role: "assistant",
        timestamp: 2,
        entryId: "assistant",
        content: [
          { type: "thinking", thinking: "Inspecting" },
          {
            type: "toolCall",
            id: "plan",
            name: "exit_plan_mode",
            arguments: { plan: "Intro\n\nMigration **plan**\n===\n\n- Preserve data" },
          },
        ],
      },
    ],
  });
  const state = store.getState().views.one!.transcript!;
  const screen = await render(
    <UiLocaleProvider locale="en">
      <div style={{ height: 600, display: "flex" }}>
        <Transcript
          reader={{
            choices: {},
            choose: () => {},
            identities: new Map(),
            outputPages: {},
            showOutput: () => {},
          }}
          state={state}
          decisions={[]}
          waiting={false}
        />
      </div>
    </UiLocaleProvider>,
  );
  try {
    await expect
      .element(screen.getByRole("region", { name: "Plan preview: Migration plan" }))
      .toBeVisible();
    expect(
      screen
        .getByRole("region", { name: "Plan preview: Migration plan" })
        .element()
        .getBoundingClientRect().height,
    ).toBe(292);
    expect(
      screen
        .getByRole("region", { name: "Plan preview: Migration plan" })
        .element()
        .querySelector("[data-plan-body]")!
        .getBoundingClientRect().height,
    ).toBe(248);
    expect(
      screen
        .getByRole("region", { name: "Plan preview: Migration plan" })
        .element()
        .querySelector("header")!
        .getBoundingClientRect().height,
    ).toBe(44);
    expect(
      screen.getByText("Inspecting", { exact: true }).element().closest('[aria-hidden="true"]'),
    ).not.toBeNull();
  } finally {
    await screen.unmount();
  }
});

test("plan preview actions expose Markdown download, copy failures and expand, with review outcomes", async () => {
  const onExpand = vi.fn();
  const write = vi
    .fn()
    .mockRejectedValueOnce(new Error("Clipboard denied"))
    .mockResolvedValue(undefined);
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: write },
  });
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const download = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.download).toBe("Migration plan.md");
    expect(this.href).toBe("blob:test");
  });
  const submission = {
    id: "p",
    toolId: "a:call",
    title: "Migration plan",
    plan: "# Migration plan\n\nPreserve data",
    outcome: "approve" as const,
  };
  const screen = await render(
    <UiLocaleProvider locale="en">
      <PlanPreview submission={submission} onExpand={onExpand} />
    </UiLocaleProvider>,
  );
  try {
    await screen.getByRole("button", { name: "Copy plan" }).click();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Could not copy plan. Try again.");
    await screen.getByRole("button", { name: "Copy plan" }).click();
    expect(write).toHaveBeenCalledWith(submission.plan);
    await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
    await screen.getByRole("button", { name: "Download plan" }).click();
    expect(create.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
    const blob = create.mock.calls[0]![0];
    if (!(blob instanceof Blob)) throw new Error("Expected Markdown Blob");
    expect(await blob.text()).toBe(submission.plan);
    expect(download).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:test");
    create.mockImplementationOnce(() => {
      throw new Error("Download denied");
    });
    await screen.getByRole("button", { name: "Download plan" }).click();
    await expect
      .element(screen.getByRole("alert"))
      .toHaveTextContent("Could not download plan. Try again.");
    await screen.getByRole("button", { name: "Expand plan" }).click();
    expect(onExpand).toHaveBeenCalledWith(submission);
    for (const [outcome, text] of [
      ["approve", "Plan approved"],
      ["revise", "Continue planning"],
      ["takeover", "User took over"],
    ] as const) {
      await screen.rerender(
        <UiLocaleProvider locale="en">
          <PlanPreview submission={{ ...submission, outcome }} onExpand={onExpand} />
        </UiLocaleProvider>,
      );
      await expect.element(screen.getByText(text, { exact: true })).toBeVisible();
    }
  } finally {
    await screen.unmount();
    vi.restoreAllMocks();
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

test("restored repeated plan calls render separate cards with structured review outcomes outside Trace", async () => {
  const store = createDesktopStore();
  const messages: object[] = [{ role: "user", timestamp: 1, entryId: "user", content: "Plan it" }];
  for (const [index, kind] of ["approve", "revise", "takeover"].entries()) {
    messages.push(
      {
        role: "assistant",
        timestamp: index + 2,
        entryId: `a${index}`,
        content: [
          { type: "thinking", thinking: `Checking ${index}` },
          {
            type: "toolCall",
            id: "same",
            name: "exit_plan_mode",
            arguments: { plan: `# Plan ${index + 1}` },
          },
        ],
      },
      {
        role: "toolResult",
        timestamp: index + 2,
        entryId: `r${index}`,
        toolCallId: "same",
        toolName: "exit_plan_mode",
        content: [{ type: "text", text: "Misleading failure" }],
        isError: kind !== "approve",
        details: kind === "revise" ? { kind, feedback: "Try again" } : { kind },
      },
    );
  }
  store.receive({
    type: "snapshot",
    sessionId: "one",
    model: "test/script",
    compactions: [],
    messages,
  });
  const screen = await render(
    <UiLocaleProvider locale="en">
      <div style={{ height: 1200, display: "flex" }}>
        <Transcript
          reader={{
            choices: {},
            choose: () => {},
            identities: new Map(),
            outputPages: {},
            showOutput: () => {},
          }}
          state={store.getState().views.one!.transcript!}
          decisions={[]}
          waiting={false}
        />
      </div>
    </UiLocaleProvider>,
  );
  try {
    for (const title of ["Plan 1", "Plan 2", "Plan 3"])
      await expect
        .element(screen.getByRole("region", { name: `Plan preview: ${title}` }))
        .toBeVisible();
    for (const text of ["Plan approved", "Continue planning", "User took over"])
      await expect.element(screen.getByText(text, { exact: true })).toBeVisible();
    expect(
      screen.getByText("Checking 0", { exact: true }).element().closest('[aria-hidden="true"]'),
    ).not.toBeNull();
  } finally {
    await screen.unmount();
  }
});

test("Core result facts show plan review outcomes live and after App snapshot restoration", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(
    <App
      host={{ getConnection: async () => connection, modelServices: modelServicesFixture }}
      locale="en"
    />,
  );
  const send = async (facts: object) => {
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "one", ...facts }),
    });
  };
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    const messages: object[] = [
      { role: "user", timestamp: 1, entryId: "user", content: "Plan it" },
    ];
    const outcomes = [
      ["approve", "Plan approved"],
      ["revise", "Continue planning"],
      ["takeover", "User took over"],
    ] as const;
    for (const [index, [kind, label]] of outcomes.entries()) {
      const callId = `call_${index}|fc_${index}`;
      messages.push({
        role: "assistant",
        timestamp: index + 2,
        entryId: `a${index}`,
        content: [
          {
            type: "toolCall",
            id: callId,
            name: "exit_plan_mode",
            arguments: { plan: `# Runtime plan ${index + 1}` },
          },
        ],
      });
      await send({ type: "snapshot", model: "test/script", compactions: [], messages });
      await expect
        .element(screen.getByRole("region", { name: `Plan preview: Runtime plan ${index + 1}` }))
        .toBeVisible();
      const result = {
        role: "toolResult",
        timestamp: index + 3,
        entryId: `r${index}`,
        toolCallId: callId,
        toolName: "exit_plan_mode",
        isError: kind !== "approve",
        content: [{ type: "text", text: "Result text is not the review outcome" }],
        details: {
          ...(kind === "revise" ? { kind, feedback: "补充离线验收步骤" } : { kind }),
          outputRef: { id: `task-${index}-result` },
        },
      };
      await send({ type: "tool_execution_end", toolCallId: callId, result });
      await expect.element(screen.getByText(label, { exact: true })).toBeVisible();
      await send({ type: "snapshot", model: "test/script", compactions: [], messages });
      await expect.element(screen.getByText(label, { exact: true })).not.toBeInTheDocument();
      messages.push(result);
      await send({ type: "snapshot", model: "test/script", compactions: [], messages });
      await expect.element(screen.getByText(label, { exact: true })).toBeVisible();
    }
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});
