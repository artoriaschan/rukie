import { expect, test, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../../src/app";
import "../../src/theme.css";

test("App shows committed and streaming replies, with failed tool output expanded", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
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
    const user = { role: "user", entryId: "u", timestamp: 1, content: "Repair parser" };
    await send({
      type: "snapshot",
      model: "test/script",
      messages: [user],
      compactions: [],
      queuedInputs: [],
      toolStates: {},
      background: [],
      runSummaries: [],
      run: { inputs: [] },
    });
    await send({
      type: "message_update",
      message: {
        role: "assistant",
        timestamp: 2,
        content: [{ type: "text", text: "Checking **parser**" }],
      },
    });
    await expect.element(screen.getByText("parser", { exact: true })).toBeVisible();
    const assistant = {
      role: "assistant",
      entryId: "a",
      timestamp: 2,
      content: [
        { type: "text", text: "Checking **parser**" },
        {
          type: "toolCall",
          id: "call",
          name: "bash",
          arguments: { command: "check" },
          view: { card: "terminal", kind: "execute", command: "check" },
        },
      ],
    };
    await send({ type: "message_end", entryId: "a", messages: [assistant] });
    await expect.element(screen.getByText("Repair parser", { exact: true })).toBeVisible();
    await send({
      type: "tool_execution_start",
      toolCallId: "call",
      toolName: "bash",
      args: { command: "check" },
    });
    await send({
      type: "tool_execution_end",
      toolCallId: "call",
      toolName: "bash",
      result: {
        role: "toolResult",
        timestamp: 3,
        toolCallId: "call",
        toolName: "bash",
        isError: true,
        content: [{ type: "text", text: "\u001b[38;2;7;14;21mParser failed\u001b[0m" }],
      },
    });
    const result = {
      role: "toolResult",
      entryId: "r",
      timestamp: 3,
      toolCallId: "call",
      toolName: "bash",
      isError: true,
      content: [{ type: "text", text: "\u001b[38;2;7;14;21mParser failed\u001b[0m" }],
    };
    await send({ type: "message_start", message: result });
    await send({ type: "message_end", entryId: "r", messages: [result] });
    await expect.element(screen.getByText("Parser failed", { exact: true })).toBeVisible();
    expect(
      getComputedStyle(screen.getByText("Parser failed", { exact: true }).element()).color,
    ).toBe("rgb(7, 14, 21)");
    await expect.element(screen.getByText("Repair parser", { exact: true })).toBeVisible();
    await expect.element(screen.getByRole("feed")).toHaveAttribute("aria-busy", "true");
    await send({
      type: "message_end",
      entryId: "failure",
      messages: [
        {
          role: "assistant",
          entryId: "failure",
          timestamp: 4,
          content: [],
          stopReason: "error",
          errorMessage: "Provider unavailable",
        },
      ],
    });
    await send({
      type: "result",
      success: false,
      text: "",
      durationMs: 100,
      error: "Provider unavailable",
    });
    await expect.element(screen.getByRole("alert")).toHaveTextContent("Provider unavailable");
    await expect.element(screen.getByRole("feed")).toHaveAttribute("aria-busy", "false");
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("permission epochs reply by keyboard, stale replies disappear, and queue withdrawal preserves the current draft", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  const send = async (facts: object) => {
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "one", ...facts }),
    });
  };
  const identity = (epoch: string) => ({
    epoch,
    requestId: "permission",
    taskId: 1,
    conversationId: 1,
  });
  const ask = async (epoch: string) =>
    send({
      type: "interaction_requested",
      identity: identity(epoch),
      request: {
        identity: identity(epoch),
        toolName: "bash",
        toolCallId: "call",
        args: { command: "ls" },
        mode: "ask",
        reason: "Read workspace",
        sessionAllow: { kind: "tool", rule: "bash" },
      },
    });
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    await send({
      type: "snapshot",
      model: "test/script",
      compactions: [],
      messages: [{ role: "user", entryId: "prompt", timestamp: 1, content: "Review workspace" }],
      toolStates: {},
      run: { inputs: [] },
    });
    await ask("first");
    await expect.element(screen.getByRole("region", { name: "Permission required" })).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Allow ↵", exact: true }))
      .toHaveFocus();
    await userEvent.keyboard("a");
    await expect
      .element(screen.getByRole("region", { name: "Permission required" }))
      .not.toBeInTheDocument();
    const wire = await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json();
    expect(wire).toContainEqual(
      expect.objectContaining({
        type: "interaction.reply",
        identity: identity("first"),
        reply: "allow-session",
      }),
    );
    await expect
      .element(screen.getByText("Permission: Allowed for this Session", { exact: true }))
      .toBeVisible();
    await ask("denied");
    await screen.getByRole("button", { name: "Deny Esc", exact: true }).element().focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(screen.getByText("Permission: Denied", { exact: true })).toBeVisible();
    await ask("offline");
    window.dispatchEvent(new CustomEvent("rukie:connection-change", { detail: "disconnected" }));
    await expect
      .element(screen.getByRole("button", { name: "Allow ↵", exact: true }))
      .toBeDisabled();
    await screen.getByRole("button", { name: "Retry", exact: true }).click();
    await expect
      .element(screen.getByRole("textbox", { name: "Prompt", exact: true }))
      .toBeEnabled();
    await ask("replayed");
    await expect
      .element(screen.getByRole("button", { name: "Allow ↵", exact: true }))
      .toHaveFocus();
    await send({ type: "interaction_settled", identity: identity("replayed") });
    await ask("cancelled");
    await send({ type: "interaction_settled", identity: identity("cancelled") });
    await expect
      .element(screen.getByRole("region", { name: "Permission required" }))
      .not.toBeInTheDocument();
    await ask("stale");
    await fetch(`http://127.0.0.1:${connection.port}/error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "interaction.reply", code: "interaction_stale" }),
    });
    await screen.getByRole("button", { name: "Allow ↵", exact: true }).click();
    await expect
      .element(screen.getByRole("region", { name: "Permission required" }))
      .not.toBeInTheDocument();
    await send({
      type: "queued_inputs_update",
      items: [{ requestId: "queued", prompt: "Queued draft", images: [] }],
    });
    await screen.getByRole("textbox", { name: "Prompt", exact: true }).fill("Existing draft");
    await screen.getByRole("button", { name: "Send now", exact: true }).click();
    const queuedCommands = await (
      await fetch(`http://127.0.0.1:${connection.port}/commands`)
    ).json();
    expect(queuedCommands).toContainEqual(
      expect.objectContaining({ type: "steer_now", sessionId: "one", requestId: "queued" }),
    );
    await screen.getByRole("button", { name: "Withdraw", exact: true }).click();
    await expect
      .element(screen.getByRole("textbox", { name: "Prompt", exact: true }))
      .toHaveValue("Withdrawn draft\n\nExisting draft");
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("virtualized response groups follow streaming height, preserve upward reading, expand and jump by scale", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  const send = async (facts: object) => {
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "one", ...facts }),
    });
  };
  const messages = Array.from({ length: 80 }, (_, i) => [
    { role: "user", entryId: `u-${i}`, timestamp: Date.now(), content: `Question ${i + 1}` },
    {
      role: "assistant",
      entryId: `a-${i}`,
      timestamp: Date.now(),
      content: [{ type: "text", text: `Intermediate ${i + 1}` }],
    },
    {
      role: "assistant",
      entryId: `final-${i}`,
      timestamp: Date.now(),
      content: [{ type: "text", text: `Final ${i + 1}` }],
    },
  ]).flat();
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    await send({
      type: "snapshot",
      model: "test/script",
      messages,
      compactions: [],
      queuedInputs: [],
      toolStates: {},
      background: [],
      runSummaries: [],
      run: { inputs: [] },
    });
    const feed = screen.getByRole("feed").element();
    await screen.getByRole("button", { name: "Jump to response 80", exact: true }).click();
    await expect.element(screen.getByText("Final 80", { exact: true })).toBeVisible();
    expect(feed.querySelectorAll("article").length).toBeLessThan(15);
    await send({
      type: "message_update",
      message: {
        role: "assistant",
        timestamp: Date.now(),
        content: [
          {
            type: "text",
            text: Array.from({ length: 35 }, (_, i) => `Stream line ${i}`).join("\n\n"),
          },
        ],
      },
    });
    await expect
      .poll(() => feed.scrollHeight - feed.scrollTop - feed.clientHeight)
      .toBeLessThan(60);
    feed.scrollTop = 0;
    await expect
      .element(screen.getByRole("button", { name: "Jump to latest", exact: true }))
      .toBeVisible();
    const before = feed.scrollTop;
    await send({
      type: "message_update",
      message: {
        role: "assistant",
        timestamp: Date.now(),
        content: [{ type: "text", text: "Added while reading\n\n".repeat(80) }],
      },
    });
    await expect
      .element(screen.getByRole("button", { name: "Jump to latest", exact: true }))
      .toBeVisible();
    expect(feed.scrollTop).toBe(before);
    await screen.getByRole("button", { name: "Jump to response 5", exact: true }).click();
    await expect.element(screen.getByText("Final 5", { exact: true })).toBeVisible();
    const response = screen.getByRole("article", { name: "Response 5", exact: true });
    await response.getByRole("button", { name: "Show steps", exact: true }).click();
    await expect.element(screen.getByText("Intermediate 5", { exact: true })).toBeVisible();
    await send({
      type: "tool_state_changed",
      name: "todo",
      value: [{ content: "Review parser", status: "in_progress" }],
    });
    await send({
      type: "tool_state_changed",
      name: "subagents",
      value: [
        {
          id: "child",
          description: "Check parser",
          type: "general",
          active: false,
          latestRun: { outcome: "error" },
        },
      ],
    });
    const width = feed.getBoundingClientRect().width;
    const toggle = screen.getByRole("button", { name: "Session summary", exact: true });
    await toggle.click();
    await expect.element(screen.getByText("Review parser", { exact: true })).toBeVisible();
    await expect.element(screen.getByText("Check parser · Failed", { exact: true })).toBeVisible();
    expect(feed.getBoundingClientRect().width).toBeLessThan(width);
    await expect.element(toggle).toHaveFocus();
    await page.viewport(480, 800);
    const summary = screen.getByRole("complementary", { name: "Session summary", exact: true });
    await expect
      .poll(() => summary.element().getBoundingClientRect().width)
      .toBe(feed.getBoundingClientRect().width);
    await userEvent.keyboard("{Escape}");
    await expect.element(summary).not.toBeInTheDocument();
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("an abort response hands queued inputs back to its originating Session after switching to a new chat", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  const url = `http://127.0.0.1:${connection.port}`;
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    await fetch(`${url}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "run_start", sessionId: "one", inputs: [] }),
    });
    await expect
      .element(screen.getByRole("button", { name: "Stop generating", exact: true }))
      .toBeVisible();
    await fetch(`${url}/hold`);
    await screen.getByRole("button", { name: "Stop generating", exact: true }).click();
    await expect
      .poll(async () =>
        (await (await fetch(`${url}/commands`)).json()).some(
          (command: { type: string }) => command.type === "abort",
        ),
      )
      .toBe(true);
    await screen.getByRole("button", { name: "New chat", exact: true }).click();
    await screen
      .getByRole("textbox", { name: "Prompt", exact: true })
      .fill("New conversation draft");
    await fetch(`${url}/flush`);
    await expect
      .element(screen.getByRole("textbox", { name: "Prompt", exact: true }))
      .toHaveValue("New conversation draft");
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    await expect
      .element(screen.getByRole("textbox", { name: "Prompt", exact: true }))
      .toHaveValue("Queued draft");
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("running elapsed display advances at the virtual one-second deadline", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(1000);
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "snapshot",
        sessionId: "one",
        model: "test/script",
        compactions: [],
        messages: [{ role: "user", entryId: "u", timestamp: 1000, content: "Timed prompt" }],
        run: { inputs: [] },
      }),
    });
    await expect.element(screen.getByText("0.0s", { exact: true })).toBeVisible();
    await vi.advanceTimersByTimeAsync(999);
    await expect.element(screen.getByText("0.0s", { exact: true })).toBeVisible();
    await vi.advanceTimersByTimeAsync(1);
    await expect.element(screen.getByText("1.0s", { exact: true })).toBeVisible();
  } finally {
    await screen.unmount();
    vi.useRealTimers();
    await commands.stopWire(connection.port);
  }
});

test("a pending prompt response preserves newly typed input when the previous Run has finished", async () => {
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    const prompt = screen.getByRole("textbox", { name: "Prompt", exact: true });
    await expect.element(prompt).toBeEnabled();
    await fetch(`http://127.0.0.1:${connection.port}/hold`);
    await prompt.fill("Submitted input");
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(async () =>
        (await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json()).some(
          (command: { type: string }) => command.type === "prompt",
        ),
      )
      .toBe(true);
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "result",
        sessionId: "one",
        success: true,
        text: "Complete",
        durationMs: 1,
      }),
    });
    await prompt.fill("Next input");
    await prompt.fill("Submitted input");
    await fetch(`http://127.0.0.1:${connection.port}/flush`);
    await expect
      .element(screen.getByRole("button", { name: "Send prompt", exact: true }))
      .toBeEnabled();
    await expect.element(prompt).toHaveValue("Submitted input");
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("new-session creation hands edited input to the created Session without selecting over another chat", async () => {
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} locale="en" />);
  try {
    const prompt = screen.getByRole("textbox", { name: "Prompt", exact: true });
    await expect.element(prompt).toBeEnabled();
    await fetch(`http://127.0.0.1:${connection.port}/hold`);
    await prompt.fill("Create Session");
    await userEvent.keyboard("{Enter}");
    await expect
      .poll(async () =>
        (await (await fetch(`http://127.0.0.1:${connection.port}/commands`)).json()).some(
          (command: { type: string }) => command.type === "session.create",
        ),
      )
      .toBe(true);
    await prompt.fill("Next Session input");
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    await fetch(`http://127.0.0.1:${connection.port}/flush`);
    await expect
      .element(screen.getByRole("heading", { name: "Fix compiler", exact: true }))
      .toBeVisible();
    await expect.element(prompt).toHaveValue("");
    await screen.getByRole("button", { name: "Create Session", exact: true }).first().click();
    await expect.element(prompt).toHaveValue("Next Session input");
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});

test("navigation previews escape the scroll rail and current response stays highlighted after jumping elsewhere", async () => {
  await page.viewport(1280, 900);
  const connection = await commands.startWire();
  const screen = await render(<App host={{ getConnection: async () => connection }} />);
  try {
    await screen
      .getByRole("button", { name: /Fix compiler/ })
      .first()
      .click();
    await fetch(`http://127.0.0.1:${connection.port}/message`, {
      method: "POST",
      body: JSON.stringify({
        type: "snapshot",
        sessionId: "one",
        model: "test/script",
        compactions: [],
        messages: [
          { role: "user", entryId: "u1", timestamp: 1, content: "First question" },
          {
            role: "assistant",
            entryId: "a1",
            timestamp: 2,
            content: [{ type: "text", text: "First final reply" }],
          },
          { role: "user", entryId: "u2", timestamp: 3, content: "Current question" },
        ],
        run: { inputs: [] },
        toolStates: {},
      }),
    });
    const current = screen.getByRole("button", { name: "Jump to response 2", exact: true });
    await expect.element(current).toHaveAttribute("aria-current", "location");
    const old = screen.getByRole("button", { name: "Jump to response 1", exact: true });
    await old.click();
    await userEvent.keyboard("{Tab}");
    old.element().focus();
    await expect
      .poll(() => document.querySelector('[data-slot="preview-rail-card"]')?.textContent)
      .toContain("First final reply");
    const card = document.querySelector<HTMLElement>('[data-slot="preview-rail-card"]')!;
    expect(card.getBoundingClientRect().width).toBeGreaterThan(200);
    expect(card.getBoundingClientRect().left).toBeGreaterThanOrEqual(8);
    expect(card.getBoundingClientRect().right).toBeLessThanOrEqual(innerWidth - 8);
    expect(card.getBoundingClientRect().top).toBeGreaterThanOrEqual(8);
    expect(card.getBoundingClientRect().bottom).toBeLessThanOrEqual(innerHeight - 8);
    expect(card.closest('[class*="overflow-y-auto"]')).toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector('[data-slot="preview-rail-card"]')).toBeNull();
    await expect.element(current).toHaveAttribute("aria-current", "location");
    await expect
      .poll(
        () =>
          current
            .element()
            .querySelector('[data-slot="preview-rail-tick"]')!
            .getBoundingClientRect().width,
      )
      .toBeGreaterThan(40);
  } finally {
    await screen.unmount();
    await commands.stopWire(connection.port);
  }
});
